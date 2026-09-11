import { jest, describe, test, beforeEach, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
let strategy, briefing, ranking;
const db = { select: () => {
  let table;
  const chain = {
    from: value => { table = getTableName(value); return chain; }, where: () => chain,
    limit: async () => table === 'strategies' ? [strategy] : table === 'briefings' ? [briefing] : table === 'rankings' ? (ranking ? [ranking] : []) : [],
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
  await handler({ params: { snapshotId: 'test-snapshot' } }, response);
  return result;
};
beforeEach(() => {
  ranking = undefined; updatePhase.mockClear();
  strategy = { status: 'error', phase: 'analyzing', error_message: 'briefing_failed: weather_forecast: The data provider was unavailable.' };
  briefing = { snapshot_id: 'test-snapshot', status: 'pending', generation_token: 'active-owner', updated_at: new Date() };
});
describe('stored Briefing failure polling', () => {
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
    strategy = { status: 'ok', phase: 'venues', strategy_for_now: 'Previous guidance' };
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
