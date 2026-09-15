import { jest, describe, test, beforeEach, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';
let strategy, briefing, ranking, snapshot;
const db = { select: () => {
  let table, joined = false;
  const chain = {
    from: value => { table = getTableName(value); return chain; }, where: () => chain,
    leftJoin: () => { joined = true; return chain; },
    limit: async () => joined ? (strategy ? [{ strategy, briefing }] : []) : table === 'strategies' ? [strategy] : table === 'briefings' ? [briefing] : table === 'rankings' ? (ranking ? [ranking] : []) : [],
    orderBy: async () => [{ name: 'Saved venue' }],
  };
  return chain;
} };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: (_req, _res, next) => next() }));
const updatePhase = jest.fn();
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({ PHASE_EXPECTED_DURATIONS: {}, updatePhase }));
jest.unstable_mockModule('../../server/validation/transformers.js', () => ({ toApiBlock: value => value }));
const { router } = await import('../../server/api/strategy/content-blocks.js');
const handler = router.stack.find(layer => layer.route?.path === '/strategy/:snapshotId').route.stack.at(-1).handle;
const poll = async () => {
  let result;
  const response = { json: body => { result = body; }, status: () => response };
  await handler({ params: { snapshotId: 'test-snapshot' }, snapshot }, response);
  return result;
};
beforeEach(() => {
  snapshot = completeSnapshot({ snapshot_id: 'test-snapshot' });
  ranking = undefined; updatePhase.mockClear();
  strategy = { status: 'error', phase: 'analyzing', error_message: 'briefing_failed: weather_forecast: The data provider was unavailable.' };
  briefing = { snapshot_id: 'test-snapshot', status: 'pending', generation_token: 'active-owner', updated_at: new Date() };
});
describe('stored Briefing failure polling', () => {
  test('a phase timestamp bump cannot revive text from an older Briefing generation', async () => {
    briefing = completeBriefing('test-snapshot', { generation_token: 'new-generation', generated_at: new Date('2026-09-11T09:00:00Z') });
    strategy = { status: 'ok', phase: 'complete', strategy_for_now: 'Historical A guidance', updated_at: new Date('2026-09-11T10:00:00Z'), venue_cache_metrics: { strategy_source: {
      snapshot_id: 'test-snapshot', briefing_generation_token: 'old-generation', briefing_generated_at: '2026-09-11T08:00:00Z', strategy_generated_at: '2026-09-11T08:01:00Z',
    } } };
    ranking = { ranking_id: 'old-ranking' };
    const result = await poll();
    expect(result).toMatchObject({ status: 'error', error: 'strategy_source_changed', retry: 'new_snapshot', strategyFresh: false, generatedAt: '2026-09-11T08:01:00.000Z' });
    expect(result.strategy).toBeUndefined(); expect(result.blocks).toBeUndefined();
    expect(strategy.strategy_for_now).toBe('Historical A guidance'); expect(updatePhase).not.toHaveBeenCalled();
  });
  test('saved text without a source update time fails explicitly instead of polling forever', async () => {
    strategy = { status: 'ok', strategy_for_now: 'Unverifiable old guidance', updated_at: null };
    briefing = completeBriefing('test-snapshot');
    const result = await poll();
    expect(result.status).toBe('error'); expect(result.error).toBe('strategy_source_time_missing');
    expect(result.strategyFresh).toBe(false); expect(result.strategy).toBeUndefined();
  });
  test('source timestamps preserve saved times, including null when Strategy has no update time', async () => {
    strategy = { status: 'running', created_at: '2026-09-11T08:00:00.000Z', updated_at: '2026-09-11T08:03:00.000Z' };
    const result = await poll();
    expect(result.generatedAt).toBeNull();
    expect(result.strategyUpdatedAt).toBe('2026-09-11T08:03:00.000Z');
    expect(result.strategyCreatedAt).toBe('2026-09-11T08:00:00.000Z');
    expect(result.snapshotCreatedAt).toBe(snapshot.created_at.toISOString());
    strategy.updated_at = null;
    expect((await poll()).generatedAt).toBeNull();
    strategy.updated_at = 'invalid';
    expect((await poll()).generatedAt).toBeNull();
  });
  test.each([
    ['missing weather', { weather: null }], ['incoherent time', { hour: 1 }],
    ['wrong coordinate key', { coord_key: '1.000000_1.000000' }],
  ])('stored-ok Strategy cannot mask snapshot %s', async (_label, invalid) => {
    briefing = completeBriefing('test-snapshot');
    Object.assign(snapshot, invalid);
    strategy = { status: 'ok', phase: 'venues', strategy_for_now: 'Previous guidance', updated_at: new Date() };
    ranking = { ranking_id: 'saved-ranking' };
    const result = await poll();
    expect(result.status).toBe('error'); expect(result.error).toBe('snapshot_incomplete');
    expect(result.strategyFresh).toBe(false); expect(result.waitFor).toEqual(['snapshot']);
    expect(result.strategy).toBeUndefined(); expect(result.blocks).toBeUndefined();
    expect(updatePhase).not.toHaveBeenCalled();
  });
  test('partially enriched new snapshot stays pending without publishing Strategy', async () => {
    snapshot.status = 'pending'; snapshot.weather = null;
    strategy = undefined;
    const result = await poll();
    expect(result.status).toBe('pending'); expect(result.waitFor).toEqual(['snapshot']);
    expect(result.strategyFresh).toBe(false); expect(result.error).toBeUndefined();
    expect(result.strategy).toBeUndefined(); expect(updatePhase).not.toHaveBeenCalled();
  });
  test('stored error with no strategy text returns error and concrete reason, not pending', async () => {
    const result = await poll();
    expect(result.status).toBe('error'); expect(result.error).toBe('briefing_failed');
    expect(result.message).toContain('weather_forecast'); expect(result.strategy).toBeUndefined();
  });
  test('old strategy text cannot mask the failed replacement Briefing', async () => {
    strategy.strategy_for_now = 'Previous guidance';
    const result = await poll();
    expect(result.status).toBe('error'); expect(result.strategy).toBeUndefined();
  });
  test('a progressive Briefing failure is visible before the waterfall returns', async () => {
    strategy.status = 'running'; briefing.news = { _generationFailed: true, error: 'provider timeout' };
    const result = await poll();
    expect(result.status).toBe('error'); expect(result.message).toContain('timed out');
  });
  test('Briefing failure is visible even before a strategy row exists', async () => {
    strategy = undefined; briefing.status = 'error';
    const result = await poll();
    expect(result.status).toBe('error'); expect(result.error).toBe('briefing_failed');
  });
  test('ordinary pending Briefing remains pending', async () => {
    strategy.status = 'running';
    const result = await poll();
    expect(result.status).toBe('pending');
  });
  test.each([false, true])('old guidance remains available but cannot be fresh while Briefing is pending (ranking=%s)', async hasRanking => {
    strategy = { status: 'ok', phase: 'venues', strategy_for_now: 'Previous guidance', updated_at: new Date() };
    if (hasRanking) ranking = { ranking_id: 'saved-ranking' };
    const result = await poll();
    expect(result.status).toBe('pending'); expect(result.briefingStatus).toBe('pending');
    expect(result.strategyFresh).toBe(false); expect(result.waitFor).toEqual(['briefing']);
    expect(result.strategy.strategyForNow).toBe('Previous guidance');
    expect(result.blocks).toHaveLength(hasRanking ? 1 : 0);
    expect(updatePhase).not.toHaveBeenCalled();
  });
  test.each(['legacy', 'abandoned'])('%s cached Briefing produces an explicit new-snapshot retry', async kind => {
    strategy = { status: 'ok', strategy_for_now: 'Previous guidance' };
    if (kind === 'legacy') briefing.generation_token = null;
    else briefing.updated_at = new Date(Date.now() - 91000);
    const result = await poll();
    expect(result.status).toBe('error'); expect(result.error).toBe('briefing_failed'); expect(result.retry).toBe('new_snapshot');
    expect(updatePhase).not.toHaveBeenCalled();
  });
});
