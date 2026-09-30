import { jest, beforeEach, test, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const { structuredClone } = globalThis;
const dialect = new PgDialect();

let records, staged, committed, rejectCommit, rejectJobWrite, rejectSelect, admitted;
const writes = [];
const delivered = [];
let pendingNotifications = [];
const tx = {
  execute: async statement => {
    const query = dialect.sqlToQuery(statement);
    if (!query.sql.includes("pg_notify('blocks_ready'")) throw new Error('Unexpected notification SQL');
    pendingNotifications.push(JSON.parse(query.params[0]));
    return { rows: [] };
  },
  select: () => ({ from: table => ({ where: () => ({ limit: async () => {
    if (rejectSelect) throw new Error('Synthetic read failed');
    const value = staged[getTableName(table)]; return value ? [value] : [];
  } }) }) }),
  update: table => ({ set: values => ({ where: async () => {
    const name = getTableName(table);
    if (name === 'triad_jobs' && rejectJobWrite) throw new Error('Synthetic job write failed');
    writes.push({ table: name, values });
    if (staged[name]) Object.assign(staged[name], values);
  } }) }),
};
const db = {
  transaction: async callback => {
    staged = structuredClone(records); pendingNotifications = [];
    const result = await callback(tx);
    if (rejectCommit) throw new Error('Synthetic COMMIT failed');
    records = staged; committed = true; delivered.push(...pendingNotifications);
    return result;
  },
  // Any accidental write outside the supplied admission transaction fails.
  select() { throw new Error('Use the admitted transaction'); },
  update() { throw new Error('Use the admitted transaction'); },
};
class MainRunAdmissionError extends Error {}
const withCurrentMainRun = jest.fn(async (_snapshotId, callback) => {
  if (!admitted) throw new MainRunAdmissionError('Synthetic superseded admission');
  return db.transaction(transaction => callback(transaction, { run_id: 'fixture-run' }));
});
const assertCurrentStrategySource = jest.fn();
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({ withCurrentMainRun, MainRunAdmissionError }));
jest.unstable_mockModule('../../server/lib/strategy/strategy-source-store.js', () => ({ assertCurrentStrategySource }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ triadLog: log, OP: { DB: 'DB' }, tagLog: jest.fn() }));
const { updatePhase, ensureStrategyRow } = await import('../../server/lib/strategy/strategy-utils.js');
const emitter = { emit: jest.fn(() => { expect(committed).toBe(true); }) };

beforeEach(() => {
  records = {
    strategies: { phase: 'verifying', status: 'pending_blocks' },
    rankings: { ranking_id: 'fixture-ranking' },
    triad_jobs: { status: 'queued' },
    main_run_admissions: { status: 'running' },
  };
  writes.length = 0; delivered.length = 0; committed = false; rejectCommit = false; rejectJobWrite = false; rejectSelect = false; admitted = true;
  jest.clearAllMocks(); assertCurrentStrategySource.mockReset();
  assertCurrentStrategySource.mockResolvedValue({ strategy: {}, briefing: {} });
});

test('failed transaction commit never emits a completion or changes persisted phase/run status', async () => {
  rejectCommit = true;
  await expect(updatePhase('fixture-snapshot', 'complete', { phaseEmitter: emitter })).rejects.toThrow('COMMIT failed');
  expect(emitter.emit).not.toHaveBeenCalled();
  expect(records.strategies).toEqual({ phase: 'verifying', status: 'pending_blocks' });
  expect(records.main_run_admissions.status).toBe('running');
  expect(delivered).toEqual([]);
});

test('completion validates source/ranking and commits strategy/job/admission together before notification', async () => {
  await updatePhase('fixture-snapshot', 'complete', { phaseEmitter: emitter });
  expect(assertCurrentStrategySource).toHaveBeenCalledWith('fixture-snapshot', tx);
  expect(writes.map(write => write.table)).toEqual(['strategies', 'triad_jobs', 'main_run_admissions']);
  expect(records.strategies).toMatchObject({ phase: 'complete', status: 'ok' });
  expect(records.triad_jobs.status).toBe('ok');
  expect(records.main_run_admissions.status).toBe('complete');
  expect(emitter.emit).toHaveBeenCalledTimes(1);
  expect(emitter.emit).toHaveBeenCalledWith('change', expect.objectContaining({ snapshot_id: 'fixture-snapshot', phase: 'complete' }));
  expect(delivered).toEqual([{ snapshot_id: 'fixture-snapshot', ranking_id: 'fixture-ranking', timestamp: expect.any(String) }]);
  await updatePhase('fixture-snapshot', 'complete', { phaseEmitter: emitter });
  expect(delivered).toHaveLength(1);
  expect(emitter.emit).toHaveBeenCalledTimes(1);
});

test('failed terminal job write rolls back the Strategy and leaves admission running without notification', async () => {
  rejectJobWrite = true;
  await expect(updatePhase('fixture-snapshot', 'complete', { phaseEmitter: emitter })).rejects.toThrow('job write failed');
  expect(committed).toBe(false);
  expect(records.strategies).toEqual({ phase: 'verifying', status: 'pending_blocks' });
  expect(records.triad_jobs.status).toBe('queued');
  expect(records.main_run_admissions.status).toBe('running');
  expect(emitter.emit).not.toHaveBeenCalled();
});

test('missing persisted ranking blocks completion without a write or event', async () => {
  records.rankings = null;
  await expect(updatePhase('fixture-snapshot', 'complete', { phaseEmitter: emitter })).rejects.toThrow(/ranking/i);
  expect(writes).toHaveLength(0); expect(emitter.emit).not.toHaveBeenCalled();
  expect(records.main_run_admissions.status).toBe('running');
  expect(delivered).toEqual([]);
});

test('invalid strategy source blocks completion without a write or event', async () => {
  assertCurrentStrategySource.mockRejectedValue(new Error('Synthetic source changed'));
  await expect(updatePhase('fixture-snapshot', 'complete', { phaseEmitter: emitter })).rejects.toThrow('source changed');
  expect(writes).toHaveLength(0); expect(emitter.emit).not.toHaveBeenCalled();
});

test.each(['verifying', 'venues'])('duplicate or backward phase %s does not emit or mutate completion', async phase => {
  await updatePhase('fixture-snapshot', phase, { phaseEmitter: emitter });
  expect(writes).toHaveLength(0); expect(emitter.emit).not.toHaveBeenCalled();
  expect(assertCurrentStrategySource).not.toHaveBeenCalled();
});

test('superseded admission never enters the write transaction or emits old progress', async () => {
  admitted = false;
  await expect(updatePhase('fixture-snapshot', 'complete', { phaseEmitter: emitter })).rejects.toBeInstanceOf(MainRunAdmissionError);
  expect(committed).toBe(false); expect(writes).toHaveLength(0); expect(emitter.emit).not.toHaveBeenCalled();
});


test('a Strategy-row database failure is propagated before later stages can proceed', async () => {
  rejectSelect = true;
  await expect(ensureStrategyRow('fixture-snapshot')).rejects.toThrow('Synthetic read failed');
  expect(writes).toHaveLength(0);
});

test('a missing Strategy cannot publish a phantom phase or completion event', async () => {
  delete records.strategies;
  await expect(updatePhase('fixture-snapshot', 'venues', { phaseEmitter: emitter })).rejects.toThrow(/strategy/i);
  expect(writes).toHaveLength(0);
  expect(emitter.emit).not.toHaveBeenCalled();
});
