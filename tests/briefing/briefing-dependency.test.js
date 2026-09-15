import { jest, describe, test, beforeEach, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { SNAPSHOT_REQUIRED_FIELDS } from '../../server/lib/location/snapshot-readiness.js';

// Every provider and DB connection boundary is mocked BEFORE importing production
// orchestration. Running this file never loads the real connection manager.
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, triadLog: log, aiLog: log, dbLog: log, eventsLog: log, venuesLog: log, matrixLog: log, OP: {} }));
const model = jest.fn(async () => { throw new Error('Unexpected model dispatch'); });
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/lib/briefing/dump-last-briefing.js', () => ({ dumpLastBriefingRow: async () => {} }));

let row, writes, finalWrite, beforeUpdate, lockAvailable, transactionDepth, storedSnapshot;
const connect = jest.fn(() => { throw new Error('Briefing must not open an extra pool connection or read another URL'); });
jest.unstable_mockModule('../../server/db/connection-manager.js', () => ({ getPool: connect }));
const dialect = new PgDialect();
const matches = condition => {
  const query = dialect.sqlToQuery(condition);
  // Evaluate the actual bound SQL at write time, including AFTER a deferred await.
  // Tests below also inspect the predicate's column names (not just param count).
  if (query.params.length === 3) {
    expect(query.sql).toContain('"briefings"."generation_token"');
    expect(query.sql).toContain('"briefings"."status"');
    return row?.snapshot_id === query.params[0] && row?.generation_token === query.params[1] && row?.status === query.params[2];
  }
  return row?.snapshot_id === query.params[0];
};
const db = {
  select: () => {
    let table, joined = false;
    const query = {
      from: value => { table = getTableName(value); return query; },
      where: () => query, innerJoin: () => { joined = true; return query; }, leftJoin: () => { joined = true; return query; }, for: () => query, orderBy: () => query,
      limit: async () => joined ? [] : table === 'briefings' ? (row ? [{ ...row }] : []) : table === 'snapshots' ? (storedSnapshot ? [{ ...storedSnapshot }] : []) : [],
    };
    return query;
  },
  insert: () => ({ values: value => ({ onConflictDoNothing: () => ({ returning: async () => {
    if (row) return [];
    row = { ...value }; writes.push(value); return [{ ...row }];
  } }) }) }),
  update: () => ({ set: value => ({ where: condition => {
    const apply = async () => {
      if (value.status === 'complete') await finalWrite(value);
      await beforeUpdate(value);
      if (!matches(condition)) return [];
      row = { ...row, ...value }; writes.push(value); return [{ ...row }];
    };
    return { then: (resolve, reject) => apply().then(resolve, reject), returning: apply };
  } }) }),
  execute: jest.fn(async () => ({ rows: [{ acquired: lockAvailable }] })),
  transaction: async fn => {
    transactionDepth++;
    try { return await fn(db); } finally { transactionDepth--; }
  },
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));

const sections = {
  weather: jest.fn(), traffic: jest.fn(), events: jest.fn(), airport: jest.fn(),
  news: jest.fn(), schools: jest.fn(), holiday: jest.fn(),
};
for (const [name, fn] of Object.entries(sections)) {
  const exports = { [`discover${name[0].toUpperCase()}${name.slice(1)}`]: fn };
  if (name === 'news') exports.fetchRideshareNews = jest.fn();
  if (name === 'traffic') exports.fetchTrafficConditions = jest.fn();
  if (name === 'events') exports.fetchEventsForBriefing = jest.fn();
  jest.unstable_mockModule(`../../server/lib/briefing/pipelines/${name}.js`, () => exports);
}
const { generateAndStoreBriefing, refreshEventsInBriefing, getOrGenerateBriefing } = await import('../../server/lib/briefing/briefing-aggregator.js');
const { writeSectionAndNotify, CHANNELS } = await import('../../server/lib/briefing/briefing-notify.js');
const { withBriefingGeneration, writeBriefingGeneration } = await import('../../server/lib/briefing/briefing-generation.js');
const { runBriefing } = await import('../../server/lib/ai/providers/briefing.js');
const { runImmediateStrategy } = await import('../../server/lib/ai/providers/consolidator.js');
const snapshot = completeSnapshot({ snapshot_id: 'test-snapshot', city: 'Test City', state: 'Test State', timezone: 'Etc/UTC' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  row = null; writes = []; finalWrite = async () => {}; beforeUpdate = async () => {}; lockAvailable = true; transactionDepth = 0;
  storedSnapshot = { ...snapshot };
  jest.clearAllMocks();
  db.execute.mockImplementation(async () => ({ rows: [{ acquired: lockAvailable }] }));
  sections.weather.mockResolvedValue({ weather_current: { temperature: 20, conditions: 'Cloudy' }, weather_forecast: [{ temperature: 20, conditions: 'Cloudy' }] });
  sections.traffic.mockResolvedValue({ traffic_conditions: { summary: 'No incidents', incidents: [] } });
  sections.events.mockResolvedValue({ events: { items: [], reason: 'Successful search found no events' } });
  sections.news.mockResolvedValue({ news: { items: [], reason: 'Successful search found no news' } });
  sections.schools.mockResolvedValue({ closures: [], reason: 'Successful search found no closures' });
  sections.airport.mockResolvedValue({ airport_conditions: { airports: [], verifiedEmpty: true, reason: 'No airports within the search radius' } });
  sections.holiday.mockResolvedValue({ holiday: { holiday: 'none', is_holiday: false } });
});

describe('Briefing before Strategy orchestration', () => {
  test.each(SNAPSHOT_REQUIRED_FIELDS)('Strategy refuses saved snapshot with invalid %s despite complete supplied object', async field => {
    await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    storedSnapshot[field] = null;
    await expect(runImmediateStrategy(snapshot.snapshot_id, { snapshot })).rejects.toThrow('Snapshot is not complete');
    expect(model).not.toHaveBeenCalled();
  });
  test('Strategy refuses failed snapshot measurements even with stored status ok', async () => {
    await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    storedSnapshot.weather = {};
    await expect(runImmediateStrategy(snapshot.snapshot_id, { snapshot })).rejects.toThrow('weather');
    expect(model).not.toHaveBeenCalled();
  });
  test('same-process callers share one generation and wait for final persistence', async () => {
    const gate = deferred(); finalWrite = () => gate.promise;
    const first = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    const second = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    expect(second).toBe(first);
    let completed = false; first.then(() => { completed = true; });
    await tick();
    expect(row.status).toBe('pending'); expect(row.generated_at).toBeNull();
    expect(completed).toBe(false); expect(transactionDepth).toBe(0); expect(connect).not.toHaveBeenCalled();
    gate.resolve();
    expect((await first).complete).toBe(true);
    expect(sections.weather).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('complete'); expect(connect).not.toHaveBeenCalled();
  });
  test.each(Object.keys(sections))('failed %s prevents runBriefing success and model invocation', async name => {
    sections[name].mockRejectedValueOnce(new Error('provider HTTP 503'));
    await expect(runBriefing(snapshot.snapshot_id, { snapshot })).rejects.toThrow('Briefing');
    expect(row.status).toBe('error'); expect(row.generated_at).toBeNull();
    await expect(runImmediateStrategy(snapshot.snapshot_id, { snapshot })).rejects.toThrow('Briefing');
    expect(model).not.toHaveBeenCalled();
  });
  test('fulfilled failure marker is retained as failure instead of converted to no results', async () => {
    sections.news.mockResolvedValueOnce({ news: { _generationFailed: true, error: 'provider timeout' } });
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    expect(result.success).toBe(false); expect(row.news._generationFailed).toBe(true);
    expect(row.events.reason).toBe('Successful search found no events');
  });
  test('stored section error preserves a safe cause without leaking upstream credentials', async () => {
    sections.news.mockRejectedValueOnce(new Error('HTTP 503 https://example.invalid/?key=secret-test-value'));
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    expect(row.news.error).toContain('unavailable');
    expect(JSON.stringify(row.news)).not.toContain('secret-test-value');
    expect(result.error).toContain('news:');
  });
  test('final persistence failure cannot publish complete or invoke Strategy', async () => {
    finalWrite = async () => { throw new Error('database write failed'); };
    await expect(runBriefing(snapshot.snapshot_id, { snapshot })).rejects.toThrow();
    expect(writes.some(write => write.status === 'complete')).toBe(false);
    expect(row.status).toBe('error'); expect(model).not.toHaveBeenCalled();
  });
  test('direct Strategy caller cannot bypass persisted pending state with a complete supplied object', async () => {
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    const supplied = { ...result.briefing }; row.status = 'pending';
    await expect(runImmediateStrategy(snapshot.snapshot_id, { snapshot, briefingRow: supplied })).rejects.toThrow('not complete');
    expect(model).not.toHaveBeenCalled();
  });
  test('provider work holds no transaction and never obtains an extra pool or URL', async () => {
    const original = { holiday: { holiday: 'none', is_holiday: false } };
    sections.holiday.mockImplementationOnce(async () => {
      expect(transactionDepth).toBe(0);
      expect(connect).not.toHaveBeenCalled();
      return original;
    });
    expect((await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot })).complete).toBe(true);
  });
  test('force refresh fences an old final write even when replacement commits during the await', async () => {
    const gate = deferred();
    let firstWrite = true;
    finalWrite = async () => { if (firstWrite) { firstWrite = false; await gate.promise; } };
    const first = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    await tick();
    const oldToken = row.generation_token;
    sections.news.mockResolvedValueOnce({ news: { items: [], reason: 'Replacement search completed' } });
    const second = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot, forceRefresh: true });
    expect(second.briefing.generation_token).not.toBe(oldToken);
    const completedRow = { ...row };
    gate.resolve();
    expect((await first).briefing.generation_token).toBe(completedRow.generation_token);
    expect(row).toEqual(completedRow);
    expect(writes.filter(write => write.status === 'complete')).toHaveLength(1);
  });
  test('stale progressive writes cannot overwrite a replacement or write after completion', async () => {
    await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    const oldToken = row.generation_token;
    const second = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot, forceRefresh: true });
    const completedRow = { ...row };
    db.execute.mockClear();
    for (const token of [oldToken, second.briefing.generation_token]) {
      await withBriefingGeneration(snapshot.snapshot_id, token, () => writeSectionAndNotify(snapshot.snapshot_id, { news: { items: [], reason: 'Late old provider' } }, CHANNELS.NEWS));
    }
    expect(row).toEqual(completedRow); expect(db.execute).not.toHaveBeenCalled();
  });
  test('unowned or wrong-snapshot writes cannot mutate Briefing', async () => {
    await expect(writeBriefingGeneration(snapshot.snapshot_id, { status: 'complete' })).rejects.toThrow('generation owner');
    await expect(withBriefingGeneration('other-snapshot', 'token', () => writeBriefingGeneration(snapshot.snapshot_id, { status: 'complete' }))).rejects.toThrow('generation owner');
    expect(writes).toHaveLength(0);
  });
  test('obsolete failure write cannot replace new success and its caller joins the new generation', async () => {
    const gate = deferred(); let failed = false;
    finalWrite = async () => { if (!failed) { failed = true; throw new Error('database unavailable'); } };
    let paused = false;
    beforeUpdate = async value => { if (value.status === 'error' && !paused) { paused = true; await gate.promise; } };
    const first = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    await tick();
    const second = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot, forceRefresh: true });
    gate.resolve();
    expect((await first).briefing.generation_token).toBe(second.briefing.generation_token);
    expect(row.status).toBe('complete');
    expect(writes.some(write => write.status === 'error')).toBe(false);
  });
  test('legacy refresh invalidates completion before providers and propagates failure', async () => {
    const briefing = await getOrGenerateBriefing(snapshot.snapshot_id, snapshot);
    const gate = deferred();
    sections.holiday.mockImplementationOnce(() => gate.promise);
    sections.news.mockRejectedValueOnce(new Error('provider HTTP 503'));
    const refresh = refreshEventsInBriefing(briefing, snapshot);
    await tick();
    expect(row.status).toBe('pending'); expect(row.generated_at).toBeNull();
    expect(briefing.status).toBe('complete');
    gate.resolve({ holiday: { holiday: 'none', is_holiday: false } });
    await expect(refresh).rejects.toThrow('Briefing');
    expect(row.status).toBe('error');
  });
  test('recent complete briefing deduplicates, while older unmarked data regenerates every section', async () => {
    await runBriefing(snapshot.snapshot_id, { snapshot });
    await runBriefing(snapshot.snapshot_id, { snapshot });
    expect(sections.weather).toHaveBeenCalledTimes(1);
    row.status = null;
    await runBriefing(snapshot.snapshot_id, { snapshot });
    expect(sections.weather).toHaveBeenCalledTimes(2);
  });
  test('cross-process contention does not accept an old complete row before the owner releases', async () => {
    await runBriefing(snapshot.snapshot_id, { snapshot });
    let transactionCount = 0;
    db.execute.mockImplementation(async () => ({ rows: [{ acquired: ++transactionCount > 2 }] }));
    jest.useFakeTimers();
    try {
      let completed = false;
      const promise = runBriefing(snapshot.snapshot_id, { snapshot }).then(result => { completed = true; return result; });
      await jest.advanceTimersByTimeAsync(0);
      expect(completed).toBe(false);
      await jest.advanceTimersByTimeAsync(3000);
      await promise;
      expect(completed).toBe(true); expect(sections.weather).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });
  test('ordinary duplicate pending work has a bounded failure and never takes over or dispatches providers', async () => {
    row = { snapshot_id: snapshot.snapshot_id, generation_token: 'another-owner', status: 'pending', generated_at: null };
    jest.useFakeTimers();
    try {
      const rejected = expect(generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot })).rejects.toThrow('completion timed out');
      await jest.advanceTimersByTimeAsync(90000);
      await rejected;
      expect(row.generation_token).toBe('another-owner'); expect(writes).toHaveLength(0);
      expect(sections.weather).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });
});
