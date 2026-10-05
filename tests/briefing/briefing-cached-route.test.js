import { jest, beforeEach, test, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';
import { mainRunBoundary } from '../fixtures/main-run-boundary.js';

const snapshotId = '11111111-1111-4111-8111-111111111111';
let snapshot;
const strategy = { status: 'ok', strategy_for_now: 'Previous guidance', updated_at: new Date() };
let briefing, hasRanking, claimRace, briefingReads, jobMode;
const statusWrites = [];
const admissionWrites = [];
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ sseLog: log, venuesLog: log, dbLog: log, briefingLog: log, matrixLog: log }));
const mustNotGenerate = jest.fn(async () => { throw new Error('Unexpected provider work'); });
const db = {
  select: () => {
    let table, joined = false;
    const chain = {
      from: value => { table = getTableName(value); return chain; }, where: () => chain,
      leftJoin: () => { joined = true; return chain; },
      limit: async () => {
        if ((table === 'briefings' || joined) && claimRace && ++briefingReads === 3) briefing = { ...briefing, status: 'pending' };
        if (joined) return [{ strategy, briefing }];
        return ({ snapshots: [snapshot], strategies: [strategy], briefings: [briefing], rankings: hasRanking ? [{ ranking_id: 'saved-ranking' }] : [] })[table] || [];
      },
      orderBy: async () => [{ name: 'Saved venue' }],
    };
    return chain;
  },
  insert: () => claimRace || jobMode !== 'forbid'
    ? { values: () => ({ onConflictDoNothing: () => ({ returning: async () => jobMode === 'new' ? [{ id: 'fixture-job' }] : [] }) }) }
    : mustNotGenerate(),
  update: table => ({ set: value => ({ where: async () => {
    if (getTableName(table) === 'strategies') { statusWrites.push(value.status); Object.assign(strategy, value); }
    if (getTableName(table) === 'main_run_admissions') { admissionWrites.push(value.status); admission.state.status = value.status; if (value.status === 'failed') admission.state.allowed = false; }
  } }) }),
  execute: async () => ({ rows: [{ acquired: true }] }),
  transaction: async fn => fn(db),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const admission = mainRunBoundary(db);
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => admission.exports);
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ expensiveEndpointLimiter: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({
  PHASE_EXPECTED_DURATIONS: {},
  isStrategyReady: async () => ({ ready: true, strategy, status: 'ok' }), ensureStrategyRow: mustNotGenerate, updatePhase: mustNotGenerate,
}));
jest.unstable_mockModule('../../server/lib/ai/providers/briefing.js', () => ({ runBriefing: mustNotGenerate }));
jest.unstable_mockModule('../../server/lib/ai/providers/consolidator.js', () => ({ runImmediateStrategy: mustNotGenerate }));
jest.unstable_mockModule('../../server/lib/venue/enhanced-smart-blocks.js', () => ({ generateEnhancedSmartBlocks: mustNotGenerate }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ resolveVenueAddressesBatch: mustNotGenerate }));
jest.unstable_mockModule('../../server/events/phase-emitter.js', () => ({ phaseEmitter: {} }));
jest.unstable_mockModule('../../server/validation/transformers.js', () => ({ toApiBlock: value => value }));
// Venue receipt SQL is covered by tests/feedback/venue-feedback.api.integration.mjs.
// This fixture retains the existing no-dismissal Briefing readiness assertions.
jest.unstable_mockModule('../../server/lib/venue/venue-feedback.js', () => ({
  applyVenueFeedbackExclusions: async (_db, { blocks }) => ({ blocks, scope_revision: 0, dismissed_place_ids: [], dismissals: [] }),
  readSavedVenueFeedback: mustNotGenerate,
  VenueFeedbackError: class extends Error {},
}));
const { default: router, ensureSmartBlocksExist, mapCandidatesToBlocks } = await import('../../server/api/strategy/blocks-fast.js');
const { router: pollRouter } = await import('../../server/api/strategy/content-blocks.js');
const poll = async () => {
  const handler = pollRouter.stack.find(layer => layer.route?.path === '/strategy/:snapshotId').route.stack.at(-1).handle;
  let body;
  const response = { status: () => response, json: value => { body = value; } };
  await handler({ params: { snapshotId }, snapshot, auth: { userId: 'owner' } }, response);
  return body;
};
const invoke = async method => {
  const handler = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods[method]).route.stack.at(-1).handle;
  let body, code = 200;
  const response = { status: value => { code = value; return response; }, json: value => { body = value; } };
  await handler({ params: {}, headers: {}, body: { snapshotId }, query: { snapshotId }, auth: { userId: 'owner' } }, response);
  return { body, code };
};
beforeEach(() => {
  admission.state.allowed = true;
  admission.state.status = 'running'; admissionWrites.length = 0;
  snapshot = completeSnapshot({ snapshot_id: snapshotId, user_id: 'owner', formatted_address: '123 Test Street' });
  briefing = { snapshot_id: snapshotId, status: 'pending', generation_token: 'active-owner', updated_at: new Date() }; hasRanking = true;
  claimRace = false; briefingReads = 0; statusWrites.length = 0; strategy.status = 'ok'; jobMode = 'forbid';
  strategy.error_message = null;
  strategy.venue_cache_metrics = null;
  mustNotGenerate.mockReset().mockImplementation(async () => { throw new Error('Unexpected provider work'); });
});
test.each(['get', 'post'])('%s without the current Continue admission cannot generate or reuse a fresh result', async method => {
  admission.state.allowed = false;
  const { body, code } = await invoke(method);
  expect(code).toBe(409); expect(body.error).toBe('main_run_superseded');
  expect(body.strategyFresh).toBe(false); expect(mustNotGenerate).not.toHaveBeenCalled();
  expect(statusWrites).toEqual([]);
});
test.each([
  ['missing weather', { weather: null }], ['incorrect coordinate key', { coord_key: '1.000000_1.000000' }],
  ['incorrect local time', { local_iso: new Date('2026-09-13T01:00:00.000Z') }],
])('GET rejects stored-ok snapshot with %s before cached reuse or provider work', async (_label, invalid) => {
  briefing = completeBriefing(snapshotId);
  Object.assign(snapshot, invalid);
  for (const exists of [true, false]) {
    hasRanking = exists;
    const { body, code } = await invoke('get');
    expect(code).toBe(503); expect(body.error).toBe('snapshot_incomplete');
    expect(body.strategyFresh).toBe(false); expect(body.retry).toBe('new_snapshot');
    expect(body.blocks).toEqual([]); expect(body.strategy).toBeUndefined();
    expect(mustNotGenerate).not.toHaveBeenCalled(); expect(statusWrites).toEqual([]);
  }
});
test.each(['get', 'post'])('%s cached route keeps saved results pending while Briefing is incomplete', async method => {
  const { body, code } = await invoke(method);
  expect(code).toBe(202); expect(body.status).toBe('pending'); expect(body.strategyFresh).toBe(false);
  expect(body.briefingStatus).toBe('pending'); expect(body.waitFor).toEqual(['briefing']);
  expect(body.strategy.strategyForNow).toBe('Previous guidance'); expect(body.blocks).toHaveLength(1);
  expect(mustNotGenerate).not.toHaveBeenCalled();
});
test.each(['get', 'post'])('%s route cannot start venue generation from pending Briefing when ranking is missing', async method => {
  hasRanking = false;
  const { body, code } = await invoke(method);
  expect(code).toBe(202); expect(body.status).toBe('pending');
  expect(mustNotGenerate).not.toHaveBeenCalled();
});
test.each(['get', 'post'])('%s cached route surfaces failed Briefing over old text and venues', async method => {
  briefing.status = 'error'; briefing.news = { _generationFailed: true, error: 'provider timeout' };
  const { body, code } = await invoke(method);
  expect(code).toBe(500); expect(body.error).toBe('briefing_failed'); expect(body.status).toBe('error');
  expect(body.message).toContain('timed out'); expect(body.strategy).toBeUndefined();
  expect(mustNotGenerate).not.toHaveBeenCalled();
});

test.each(['get', 'post'])('%s rejects old Strategy after the replacement Briefing completes without dispatching providers', async method => {
  briefing = completeBriefing(snapshotId, { generation_token: 'generation-B' });
  strategy.updated_at = new Date(Date.now() + 1000);
  strategy.venue_cache_metrics = { strategy_source: { snapshot_id: snapshotId, briefing_generation_token: 'generation-A', briefing_generated_at: '2026-09-11T08:00:00Z', strategy_generated_at: '2026-09-11T08:01:00Z' } };
  const { body, code } = await invoke(method);
  expect(code).toBe(500); expect(body).toMatchObject({ status: 'error', error: 'strategy_source_changed', retry: 'new_snapshot', strategyFresh: false });
  expect(body.strategy).toBeUndefined(); expect(mustNotGenerate).not.toHaveBeenCalled();
});
test.each(['get', 'post'])('%s legacy cached context requests a new snapshot instead of endless pending', async method => {
  briefing.generation_token = null;
  const { body, code } = await invoke(method);
  expect(code).toBe(500); expect(body.error).toBe('briefing_failed'); expect(body.retry).toBe('new_snapshot');
  expect(body.message).toContain('not verified complete'); expect(mustNotGenerate).not.toHaveBeenCalled();
});
test.each(['get', 'post'])('%s abandoned pending context exposes the bounded retry without stealing ownership', async method => {
  briefing.updated_at = new Date(Date.now() - 91000);
  const { body } = await invoke(method);
  expect(body.status).toBe('error'); expect(body.retry).toBe('new_snapshot'); expect(body.message).toContain('timed out');
  expect(briefing.generation_token).toBe('active-owner'); expect(statusWrites).toEqual([]);
});
test.each(['get', 'post'])('%s replacement after the venue claim prevents provider work and releases pending_blocks', async method => {
  hasRanking = false; claimRace = true;
  briefing = {
    ...briefing, status: 'complete', generated_at: new Date(),
    weather_current: { temperature: 20, conditions: 'Cloudy' }, weather_forecast: [{ temperature: 20, conditions: 'Cloudy' }],
    traffic_conditions: { summary: 'No incidents' }, events: { items: [], reason: 'None found' }, news: { items: [], reason: 'None found' },
    school_closures: { items: [], reason: 'None found' }, airport_conditions: { airports: [], verifiedEmpty: true, reason: 'No nearby airports' },
    holiday: { holiday: 'none', is_holiday: false },
  };
  strategy.venue_cache_metrics = { strategy_source: { snapshot_id: snapshotId, briefing_generation_token: briefing.generation_token,
    briefing_generated_at: briefing.generated_at.toISOString(), strategy_generated_at: briefing.generated_at.toISOString() } };
  const { body, code } = await invoke(method);
  expect(code).toBe(500); expect(body.error).toBe('briefing_failed');
  expect(statusWrites).toEqual(['pending_blocks', 'failed']); expect(strategy.status).toBe('failed');
  expect(admissionWrites).toEqual(['failed']);
  expect(mustNotGenerate).not.toHaveBeenCalled();
});

function readySource() {
  hasRanking = false;
  briefing = completeBriefing(snapshotId, { generation_token: 'active-owner' });
  strategy.venue_cache_metrics = { strategy_source: { snapshot_id: snapshotId, briefing_generation_token: briefing.generation_token,
    briefing_generated_at: briefing.generated_at.toISOString(), strategy_generated_at: briefing.generated_at.toISOString() } };
}

test('a failed venue attempt is terminal for that admission and cannot restart from a later GET', async () => {
  readySource();
  const result = await ensureSmartBlocksExist(snapshotId, { snapshot, briefingRow: briefing });
  expect(result.error).toBe('Unexpected provider work');
  expect(admissionWrites).toEqual(['failed']);
  expect(strategy.strategy_for_now).toBe('Previous guidance');
  await expect(ensureSmartBlocksExist(snapshotId)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect(mustNotGenerate).toHaveBeenCalledTimes(1);
});

test('a completed admission with a missing ranking cannot claim providers or change phase', async () => {
  readySource(); admission.state.status = 'complete';
  await expect(ensureSmartBlocksExist(snapshotId)).rejects.toMatchObject({ code: 'main_run_restart_required' });
  expect(statusWrites).toEqual([]); expect(admissionWrites).toEqual([]);
  expect(mustNotGenerate).not.toHaveBeenCalled();
});

test('a late post-completion error preserves the successful admission and Strategy', async () => {
  readySource();
  mustNotGenerate.mockImplementationOnce(async () => {
    admission.state.status = 'complete';
    throw new Error('Notification failed after persisted completion');
  });
  const result = await ensureSmartBlocksExist(snapshotId, { snapshot, briefingRow: briefing });
  expect(result.error).toBe('Notification failed after persisted completion');
  expect(admissionWrites).toEqual([]); expect(admission.state.status).toBe('complete');
  expect(strategy.strategy_for_now).toBe('Previous guidance');
});

test('direct cached ranking reuse rejects a changed Briefing source before returning ready', async () => {
  readySource(); hasRanking = true;
  briefing = { ...briefing, generation_token: 'replacement-generation' };
  await expect(ensureSmartBlocksExist(snapshotId)).rejects.toMatchObject({ code: 'strategy_source_changed' });
  expect(mustNotGenerate).not.toHaveBeenCalled();
});

test('a completed generator without a persisted ranking ends the admission instead of leaving pending_blocks', async () => {
  readySource(); mustNotGenerate.mockResolvedValueOnce({ ok: true });
  const result = await ensureSmartBlocksExist(snapshotId, { snapshot, briefingRow: briefing });
  expect(result.error).toMatch(/ranking/i);
  expect(admissionWrites).toEqual(['failed']);
  expect(strategy.status).toBe('failed');
  await expect(ensureSmartBlocksExist(snapshotId)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect(mustNotGenerate).toHaveBeenCalledTimes(1);
});

test('saved candidate mapper reads its canonical address without provider work or a catalog write', async () => {
  const result = await mapCandidatesToBlocks([
    { name: 'Saved venue', features: { address: '123 Saved Street' }, distance_miles: 0, drive_minutes: 0 },
    { name: 'Legacy venue' },
  ]);
  expect(result[0].address).toBe('123 Saved Street');
  expect(result[1].address).toBeNull();
  expect(mustNotGenerate).not.toHaveBeenCalled();
});

test('terminal poll exposes a venue failure while retaining saved text and rejecting same-run work', async () => {
  readySource();
  const result = await ensureSmartBlocksExist(snapshotId, { snapshot, briefingRow: briefing });
  expect(result.error).toBe('Unexpected provider work');
  expect(admission.state.status).toBe('failed');
  expect(strategy.strategy_for_now).toBe('Previous guidance');
  expect(strategy.status).toBe('failed');
  for (let read = 0; read < 2; read++) {
    const response = await poll();
    expect(response).toMatchObject({ status: 'error', error: 'strategy_failed' });
    expect(response.message).toContain('Venue generation failed');
    expect(response.waitFor).toBeUndefined();
  }
  await expect(ensureSmartBlocksExist(snapshotId)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect(mustNotGenerate).toHaveBeenCalledTimes(1);
});

test('failed venue response is an error on the GET that ends its admission', async () => {
  readySource();
  const result = await invoke('get');
  expect(admission.state.status).toBe('failed');
  expect(result).toMatchObject({ code: 500, body: { status: 'error', error: 'blocks_generation_failed' } });
});

test('a competing POST keeps an active venue owner pending after its local wait expires', async () => {
  readySource(); jobMode = 'existing';
  jest.useFakeTimers();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mustNotGenerate.mockImplementation(async () => {});
  mustNotGenerate.mockImplementationOnce(async () => { await gate; hasRanking = true; });
  const owner = ensureSmartBlocksExist(snapshotId, { snapshot, briefingRow: briefing });
  try {
    await jest.advanceTimersByTimeAsync(0);
    expect(strategy.status).toBe('pending_blocks');
    expect(mustNotGenerate).toHaveBeenCalledTimes(1);
    const waiter = invoke('post');
    await jest.advanceTimersByTimeAsync(41000);
    const response = await waiter;
    expect(response.code).toBe(202);
    expect(response.body.error).toBeUndefined();
    expect(admission.state.status).toBe('running');
    expect(hasRanking).toBe(false);
    release();
    await expect(owner).resolves.toMatchObject({ generated: true, error: null });
    expect(admissionWrites).toEqual([]);
  } finally { release(); await owner; jest.useRealTimers(); }
});

test('the original waterfall returns pending when a notification worker owns its unfinished venue stage', async () => {
  readySource(); jobMode = 'new';
  // The Strategy/Briefing stages have independent contract coverage. Simulate
  // the worker taking the venue claim just after the saved Strategy notification.
  mustNotGenerate.mockResolvedValueOnce(undefined) // ensureStrategyRow
    .mockResolvedValueOnce(undefined) // resolving phase
    .mockResolvedValueOnce(undefined) // analyzing phase
    .mockResolvedValueOnce({ briefing }) // runBriefing
    .mockResolvedValueOnce(undefined) // immediate phase
    .mockResolvedValueOnce(undefined) // runImmediateStrategy
    .mockImplementationOnce(async () => { strategy.status = 'pending_blocks'; }); // venues phase
  jest.useFakeTimers();
  try {
    const waterfall = invoke('post');
    await jest.advanceTimersByTimeAsync(41000);
    const response = await waterfall;
    expect(response).toMatchObject({ code: 202, body: { status: 'pending_blocks', snapshotId } });
    expect(response.body.error).toBeUndefined();
    expect(admission.state.status).toBe('running');
    expect(admissionWrites).toEqual([]);
    expect(mustNotGenerate).toHaveBeenCalledTimes(7);
  } finally { jest.useRealTimers(); }
});
