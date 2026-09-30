import { jest, test, expect } from '@jest/globals';
const auth = (_req, _res, next) => next();
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: auth }));
const { default: router } = await import('../../server/api/strategy/tactical-plan.js');
test('retired unrendered tactical map returns no fabricated coordinates or successful plan', () => {
  const route = router.stack.find(layer => layer.route?.path === '/').route;
  expect(route.stack[0].handle).toBe(auth);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  route.stack.at(-1).handle({ body: { mission: { lat: 1, lng: 2 } } }, res);
  expect(res.status).toHaveBeenCalledWith(410);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'tactical_plan_retired', stagingZones: [], avoidZones: [] }));
});
