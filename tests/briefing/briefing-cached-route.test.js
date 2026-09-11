import { jest, beforeEach, test, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';

const snapshotId = '11111111-1111-4111-8111-111111111111';
const snapshot = { snapshot_id: snapshotId, user_id: 'owner', status: 'ok', formatted_address: '123 Test Street' };
const strategy = { status: 'ok', strategy_for_now: 'Previous guidance', updated_at: new Date() };
let briefing, hasRanking, claimRace, briefingReads;
const statusWrites = [];
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ sseLog: log, venuesLog: log, dbLog: log, briefingLog: log, matrixLog: log }));
const mustNotGenerate = jest.fn(async () => { throw new Error('Unexpected provider work'); });
const db = {
  select: () => {
    let table;
    const chain = {
      from: value => { table = getTableName(value); return chain; }, where: () => chain,
      limit: async () => {
        if (table === 'briefings' && claimRace && ++briefingReads === 3) briefing = { ...briefing, status: 'pending' };
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
  briefing = { snapshot_id: snapshotId, status: 'pending', generation_token: 'active-owner', updated_at: new Date() }; hasRanking = true;
  claimRace = false; briefingReads = 0; statusWrites.length = 0; strategy.status = 'ok';
  mustNotGenerate.mockClear();
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
  const { body, code } = await invoke(method);
  expect(code).toBe(500); expect(body.error).toBe('briefing_failed');
  expect(statusWrites).toEqual(['pending_blocks', 'ok']); expect(strategy.status).toBe('ok');
  expect(mustNotGenerate).not.toHaveBeenCalled();
});
