import { jest, beforeEach, test, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';

const snapshotId = '11111111-1111-4111-8111-111111111111';
let snapshot;
const strategy = { status: 'ok', strategy_for_now: 'Previous guidance', updated_at: new Date() };
let briefing, hasRanking, claimRace, briefingReads;
const statusWrites = [];
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
  insert: () => claimRace
    ? { values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) }
    : mustNotGenerate(),
  update: () => ({ set: value => ({ where: async () => { statusWrites.push(value.status); strategy.status = value.status; } }) }),
  execute: async () => ({ rows: [{ acquired: true }] }),
  transaction: async fn => fn(db),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ expensiveEndpointLimiter: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({
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
const { default: router } = await import('../../server/api/strategy/blocks-fast.js');
const invoke = async method => {
  const handler = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods[method]).route.stack.at(-1).handle;
  let body, code = 200;
  const response = { status: value => { code = value; return response; }, json: value => { body = value; } };
  await handler({ params: {}, headers: {}, body: { snapshotId }, query: { snapshotId }, auth: { userId: 'owner' } }, response);
  return { body, code };
};
beforeEach(() => {
  snapshot = completeSnapshot({ snapshot_id: snapshotId, user_id: 'owner', formatted_address: '123 Test Street' });
  briefing = { snapshot_id: snapshotId, status: 'pending', generation_token: 'active-owner', updated_at: new Date() }; hasRanking = true;
  claimRace = false; briefingReads = 0; statusWrites.length = 0; strategy.status = 'ok';
  strategy.venue_cache_metrics = null;
  mustNotGenerate.mockClear();
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
  expect(statusWrites).toEqual(['pending_blocks', 'ok']); expect(strategy.status).toBe('ok');
  expect(mustNotGenerate).not.toHaveBeenCalled();
});
