import { jest, describe, test, beforeEach, expect } from '@jest/globals';
import { getTableName, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';
import { SNAPSHOT_REQUIRED_FIELDS } from '../../server/lib/location/snapshot-readiness.js';
import { mainRunBoundary } from '../fixtures/main-run-boundary.js';

// Every provider and DB connection boundary is mocked BEFORE importing production
// orchestration. Running this file never loads the real connection manager.
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, triadLog: log, aiLog: log, dbLog: log, eventsLog: log, venuesLog: log, matrixLog: log, OP: {}, tagLog: jest.fn() }));
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
      const resolved = Object.fromEntries(Object.entries(value).map(([field, update]) => {
        if (!(update instanceof SQL)) return [field, update];
        const query = dialect.sqlToQuery(update);
        expect(query.sql).toBe(`coalesce("briefings"."${field}", $1::jsonb)`);
        return [field, row[field] ?? JSON.parse(query.params[0])];
      }));
      row = { ...row, ...resolved }; writes.push(value); return [{ ...row }];
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
const admission = mainRunBoundary(db);
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => admission.exports);

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
const { withBriefingGeneration, writeBriefingGeneration, cancelUpstreamBriefingGenerations } = await import('../../server/lib/briefing/briefing-generation.js');
const { runBriefing } = await import('../../server/lib/ai/providers/briefing.js');
const { runImmediateStrategy } = await import('../../server/lib/ai/providers/consolidator.js');
const snapshot = completeSnapshot({ snapshot_id: 'test-snapshot', city: 'Test City', state: 'Test State', timezone: 'Etc/UTC' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  admission.state.allowed = true;
  admission.state.status = 'running';
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
  test('independent schools discovery starts while the other sections are still pending', async () => {
    const weather = deferred();
    sections.weather.mockReturnValueOnce(weather.promise);
    const run = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    await tick();
    try {
      expect(sections.schools).toHaveBeenCalledTimes(1);
      expect(row.status).toBe('pending');
    } finally {
      weather.resolve({ weather_current: { temperature: 20, conditions: 'Cloudy' }, weather_forecast: [{ temperature: 20, conditions: 'Cloudy' }] });
      await run;
    }
  });
  test('Briefing rejects an incomplete saved snapshot despite a complete supplied copy', async () => {
    storedSnapshot.weather = {};
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    expect(result.success).toBe(false);
    expect(row.status).toBe('error');
    for (const provider of Object.values(sections)) expect(provider).not.toHaveBeenCalled();
  });
  test('Briefing providers receive the persisted snapshot rather than a different supplied location', async () => {
    const supplied = { ...snapshot, snapshot_id: 'another-snapshot', city: 'Wrong city', lat: 55 };
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot: supplied });
    expect(result.complete).toBe(true);
    for (const provider of Object.values(sections)) {
      expect(provider).toHaveBeenCalledWith(expect.objectContaining({ snapshot: storedSnapshot }));
    }
  });
  test('a completed main run cannot launch a replacement from its old snapshot', async () => {
    admission.state.status = 'complete';
    await expect(generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot })).rejects.toMatchObject({ code: 'main_run_restart_required' });
    expect(writes).toEqual([]);
    for (const provider of Object.values(sections)) expect(provider).not.toHaveBeenCalled();
  });
  test('without explicit Continue no Briefing provider or placeholder is created', async () => {
    admission.state.allowed = false;
    await expect(generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot })).rejects.toMatchObject({ code: 'main_run_superseded' });
    expect(writes).toEqual([]);
    for (const provider of Object.values(sections)) expect(provider).not.toHaveBeenCalled();
  });
  test('a settings save while providers are pending prevents late completion and failure writes', async () => {
    const pending = deferred();
    sections.weather.mockReturnValueOnce(pending.promise);
    const run = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    const outcome = expect(run).rejects.toMatchObject({ code: 'main_run_superseded' });
    await tick();
    const before = { ...row };
    admission.state.allowed = false;
    pending.resolve({ weather_current: { temperature: 20 }, weather_forecast: [] });
    await outcome;
    expect(row).toEqual(before);
  });
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
    // The provider finished; its final DB write now holds the short admission
    // transaction until persistence resolves. No transaction covers providers.
    expect(completed).toBe(false); expect(transactionDepth).toBe(1); expect(connect).not.toHaveBeenCalled();
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
  test('a failed final save retains completed sections and verified partial Events', async () => {
    const weather = { weather_current: { temperature: 20, conditions: 'Cloudy' },
      weather_forecast: [{ temperature: 21, conditions: 'Clear' }] };
    const partialEvents = { items: [{ title: 'Verified event', venue: 'Verified venue' }], _pending: true };
    sections.weather.mockImplementationOnce(async () => {
      await writeSectionAndNotify(snapshot.snapshot_id, weather, CHANNELS.WEATHER);
      return weather;
    });
    sections.events.mockImplementationOnce(async () => {
      await writeSectionAndNotify(snapshot.snapshot_id, { events: partialEvents }, CHANNELS.EVENTS);
      return { events: { items: partialEvents.items } };
    });
    finalWrite = async () => { throw new Error('database write failed'); };
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    expect(result.success).toBe(false);
    expect(row.status).toBe('error'); expect(row.generated_at).toBeNull();
    expect(row.weather_current).toEqual(weather.weather_current);
    expect(row.weather_forecast).toEqual(weather.weather_forecast);
    expect(row.events).toEqual(partialEvents);
    expect(row.news).toMatchObject({ _generationFailed: true });
    expect(model).not.toHaveBeenCalled();
  });
  test('an Events failure envelope retains verified items without becoming a successful array', async () => {
    const retained = { items: [{ title: 'Verified event' }], _generationFailed: true, reason: 'provider timeout' };
    sections.events.mockResolvedValueOnce({ events: retained, reason: retained.reason });
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    expect(result.success).toBe(false); expect(row.status).toBe('error');
    expect(row.events).toEqual(retained);
    expect(row.weather_current).toEqual({ temperature: 20, conditions: 'Cloudy' });
    expect(model).not.toHaveBeenCalled();
  });
  test('a pending Events envelope cannot be flattened into completed Briefing evidence', async () => {
    const partial = { items: [{ title: 'Verified event' }], _pending: true };
    sections.events.mockResolvedValueOnce({ events: partial });
    const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    expect(result.success).toBe(false); expect(row.status).toBe('error');
    expect(row.events).toMatchObject({ ...partial, _generationFailed: true });
  });
  test('a late progressive write is preserved atomically when a final save fails', async () => {
    const gate = deferred();
    finalWrite = async () => { throw new Error('database write failed'); };
    beforeUpdate = async value => { if (value.status === 'error') await gate.promise; };
    const pending = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    await tick();
    const lateNews = { items: [{ title: 'Saved while failure update waited' }] };
    await withBriefingGeneration(snapshot.snapshot_id, row.generation_token,
      () => writeSectionAndNotify(snapshot.snapshot_id, { news: lateNews }, CHANNELS.NEWS));
    gate.resolve();
    expect((await pending).success).toBe(false);
    expect(row.news).toEqual(lateNews); expect(row.status).toBe('error');
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
  test('a changed stored generation fences an old final write during persistence', async () => {
    const gate = deferred();
    let firstWrite = true;
    finalWrite = async () => { if (firstWrite) { firstWrite = false; await gate.promise; } };
    const first = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    await tick();
    const oldToken = row.generation_token;
    row = completeBriefing(snapshot.snapshot_id, { generation_token: 'replacement-owner' });
    expect(row.generation_token).not.toBe(oldToken);
    const completedRow = { ...row };
    gate.resolve();
    expect((await first).briefing.generation_token).toBe(completedRow.generation_token);
    expect(row).toEqual(completedRow);
    expect(writes.filter(write => write.status === 'complete')).toHaveLength(0);
  });
  test('stale progressive writes cannot overwrite a replacement or write after completion', async () => {
    await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    const oldToken = row.generation_token;
    row = completeBriefing(snapshot.snapshot_id, { generation_token: 'replacement-owner' });
    const completedRow = { ...row };
    db.execute.mockClear();
    for (const token of [oldToken, row.generation_token]) {
      await withBriefingGeneration(snapshot.snapshot_id, token, () => writeSectionAndNotify(snapshot.snapshot_id, { news: { items: [], reason: 'Late old provider' } }, CHANNELS.NEWS));
    }
    expect(row).toEqual(completedRow); expect(db.execute).not.toHaveBeenCalled();
  });
  test('unowned or wrong-snapshot writes cannot mutate Briefing', async () => {
    await expect(writeBriefingGeneration(snapshot.snapshot_id, { status: 'complete' })).rejects.toThrow('generation owner');
    await expect(withBriefingGeneration('other-snapshot', 'token', () => writeBriefingGeneration(snapshot.snapshot_id, { status: 'complete' }))).rejects.toThrow('generation owner');
    expect(writes).toHaveLength(0);
  });
  test('Events receives the active generation signal instead of an unrelated transport signal', async () => {
    const gate = deferred();
    let signal;
    sections.events.mockImplementationOnce(options => { signal = options.signal; return gate.promise; });
    const pending = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    while (!signal) await tick();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    gate.resolve({ events: { items: [], reason: 'Successful search found no events' } });
    expect((await pending).complete).toBe(true);
  });
  test('upstream cancellation stops only matching preparatory work and preserves an admitted writer', async () => {
    const upstreamGate = deferred(), admittedGate = deferred(), unrelatedGate = deferred();
    const token = 'shared-current-generation';
    row = { ...completeBriefing(snapshot.snapshot_id, { generation_token: token }), status: 'pending', generated_at: null };
    let upstreamSignal, admittedSignal, unrelatedSignal;
    const upstream = withBriefingGeneration(snapshot.snapshot_id, token, async signal => {
      upstreamSignal = signal;
      await upstreamGate.promise;
      return writeBriefingGeneration(snapshot.snapshot_id, { news: { items: [], reason: 'Obsolete preparatory result' } });
    }, { upstream: true }).catch(error => error);
    const admitted = withBriefingGeneration(snapshot.snapshot_id, token, async signal => {
      admittedSignal = signal;
      await admittedGate.promise;
      return writeBriefingGeneration(snapshot.snapshot_id, { status: 'complete', generated_at: new Date() });
    });
    const unrelated = withBriefingGeneration('another-snapshot', token, async signal => {
      unrelatedSignal = signal;
      await unrelatedGate.promise;
    }, { upstream: true });
    cancelUpstreamBriefingGenerations(snapshot.snapshot_id);
    expect(upstreamSignal.aborted).toBe(true);
    expect(admittedSignal.aborted).toBe(false);
    expect(unrelatedSignal.aborted).toBe(false);
    upstreamGate.resolve();
    expect(await upstream).toMatchObject({ name: 'BriefingSupersededError' });
    expect(writes).toHaveLength(0);
    admittedGate.resolve();
    expect(await admitted).toMatchObject({ status: 'complete' });
    expect(row.news).not.toMatchObject({ reason: 'Obsolete preparatory result' });
    expect(writes).toHaveLength(1);
    unrelatedGate.resolve();
    await unrelated;
  });
  test('obsolete failure write cannot replace new success and its caller joins the new generation', async () => {
    const gate = deferred(); let failed = false;
    finalWrite = async () => { if (!failed) { failed = true; throw new Error('database unavailable'); } };
    let paused = false;
    beforeUpdate = async value => { if (value.status === 'error' && !paused) { paused = true; await gate.promise; } };
    const first = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot });
    await tick();
    row = completeBriefing(snapshot.snapshot_id, { generation_token: 'replacement-owner' });
    gate.resolve();
    expect((await first).briefing.generation_token).toBe('replacement-owner');
    expect(row.status).toBe('complete');
    expect(writes.some(write => write.status === 'error')).toBe(false);
  });
  test('legacy refresh cannot replace a completed step without a new Continue', async () => {
    const briefing = await getOrGenerateBriefing(snapshot.snapshot_id, snapshot);
    const before = { ...row };
    await expect(refreshEventsInBriefing(briefing, snapshot)).rejects.toMatchObject({ code: 'main_run_restart_required' });
    expect(row).toEqual(before); expect(sections.news).toHaveBeenCalledTimes(1);
  });
  test('same admission replays its immutable completed step, while invalid state requires new Continue', async () => {
    await runBriefing(snapshot.snapshot_id, { snapshot });
    const before = { ...row };
    await runBriefing(snapshot.snapshot_id, { snapshot });
    expect(row).toEqual(before); expect(sections.weather).toHaveBeenCalledTimes(1);
    row.status = null;
    await expect(runBriefing(snapshot.snapshot_id, { snapshot })).rejects.toMatchObject({ code: 'main_run_restart_required' });
    expect(sections.weather).toHaveBeenCalledTimes(1);
  });
  test('completed admission can replay its saved Briefing without new provider calls', async () => {
    await runBriefing(snapshot.snapshot_id, { snapshot });
    const before = { ...row };
    admission.state.status = 'complete';
    await expect(runBriefing(snapshot.snapshot_id, { snapshot })).resolves.toMatchObject({ briefing: before });
    expect(row).toEqual(before); expect(sections.weather).toHaveBeenCalledTimes(1);
  });
  test('cross-process claim contention cannot return an old completed row as fresh success', async () => {
    await runBriefing(snapshot.snapshot_id, { snapshot });
    const before = { ...row };
    lockAvailable = false;
    await expect(runBriefing(snapshot.snapshot_id, { snapshot })).rejects.toMatchObject({ code: 'main_run_busy' });
    expect(row).toEqual(before); expect(sections.weather).toHaveBeenCalledTimes(1);
  });
  test('ordinary duplicate pending work has a bounded failure and never takes over or dispatches providers', async () => {
    row = { snapshot_id: snapshot.snapshot_id, generation_token: 'another-owner', status: 'pending', generated_at: null };
    jest.useFakeTimers();
    try {
      const rejected = expect(generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id, snapshot })).rejects.toThrow('completion timed out');
      await jest.advanceTimersByTimeAsync(180000);
      await rejected;
      expect(row.generation_token).toBe('another-owner'); expect(writes).toHaveLength(0);
      expect(sections.weather).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });
});
