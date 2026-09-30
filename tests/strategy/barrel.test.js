import { expect, jest, test } from '@jest/globals';
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../../server/lib/strategy/tactical-planner.js', () => ({ generateTacticalPlan: async () => {} }));
test('strategy barrel links only existing exports without reviving a removed fallback', async () => {
  const strategy = await import('../../server/lib/strategy/index.js');
  expect(typeof strategy.ensureStrategyRow).toBe('function');
  expect(typeof strategy.updatePhase).toBe('function');
  expect(typeof strategy.generateTacticalPlan).toBe('function');
  expect(strategy).not.toHaveProperty('fallbackStrategy');
});
