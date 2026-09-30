import { jest, beforeEach, test, expect } from '@jest/globals';
import { completeBriefing } from '../fixtures/complete-briefing.js';
const mustNotRun = jest.fn(() => { throw new Error('Unexpected work outside weather read'); });
const getBriefingBySnapshotId = jest.fn();
const fetchWeatherConditions = jest.fn();
const passthrough = (_req, _res, next) => next();
jest.unstable_mockModule('../../server/lib/briefing/briefing-aggregator.js', () => ({ getBriefingBySnapshotId, generateAndStoreBriefing: mustNotRun }));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({ assertMainRunForSnapshot: mustNotRun, MainRunAdmissionError: class extends Error {} }));
jest.unstable_mockModule('../../server/lib/briefing/pipelines/weather.js', () => ({ fetchWeatherConditions }));
jest.unstable_mockModule('../../server/lib/briefing/pipelines/traffic.js', () => ({ fetchTrafficConditions: mustNotRun }));
jest.unstable_mockModule('../../server/lib/briefing/pipelines/events.js', () => ({ filterInvalidEvents: mustNotRun }));
const select = jest.fn(() => {
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [{ snapshot_id: 'owned-snapshot', user_id: 'owner', timezone: 'Etc/UTC' }] };
  return chain;
});
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { select } }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: passthrough }));
jest.unstable_mockModule('../../server/middleware/require-operator.js', () => ({ isOperator: mustNotRun }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ expensiveEndpointLimiter: passthrough }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: passthrough }));
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({ filterFreshEvents: values => values, filterFreshNews: values => values, getEventStartTime: () => null, getEventEndTime: () => null }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ chainLog: jest.fn(), matrixLog: console, locationLog: console, OP: {} }));
const { default: router } = await import('../../server/api/briefing/briefing.js');
const invoke = async (path = '/weather/:snapshotId', query = {}) => {
  const handler = router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle;
  let body, code = 200;
  const res = { status: value => { code = value; return res; }, json: value => { body = value; return res; } };
  await handler({ query, body: { snapshotId: 'owned-snapshot' }, snapshot: { snapshot_id: 'owned-snapshot', lat: 1, lng: 2, city: 'Test', state: 'TX', timezone: 'Etc/UTC' }, auth: { userId: 'owner' } }, res);
  return { body, code };
};
beforeEach(() => { jest.clearAllMocks(); fetchWeatherConditions.mockResolvedValue({ current: { tempF: 68 }, forecast: [] }); });
test.each([null, { status: 'pending' }, { status: 'pending', weather_current: { temperature: 20, conditions: 'Cloudy' } }])('ordinary missing/pending read never starts duplicate provider work: %j', async row => {
  getBriefingBySnapshotId.mockResolvedValue(row);
  const { body, code } = await invoke();
  expect(code).toBe(202); expect(body.success).toBe(false); expect(body._pending).toBe(true);
  expect(fetchWeatherConditions).not.toHaveBeenCalled(); expect(mustNotRun).not.toHaveBeenCalled();
});
test.each([
  { weather_current: { _generationFailed: true, error: 'provider HTTP 503' } },
  { weather_current: { temperature: 20, conditions: 'Cloudy' }, weather_forecast: { _generationFailed: true, error: 'provider HTTP 503' } },
  { status: 'error' },
  { status: 'complete', weather_current: { temperature: null, conditions: 'Cloudy' }, weather_forecast: [] },
])('failed or malformed saved weather is never returned as success: %j', async row => {
  getBriefingBySnapshotId.mockResolvedValue(row);
  const { body, code } = await invoke();
  expect(code).toBe(503); expect(body.success).toBe(false); expect(body._generationFailed).toBe(true);
  expect(fetchWeatherConditions).not.toHaveBeenCalled();
});
test('complete weather pair is available progressively without refetching', async () => {
  const current = { temperature: 20, tempF: 68, conditions: 'Cloudy', observedAt: '2026-09-29T12:00:00Z' };
  const forecast = [{ temperature: 20, conditions: 'Cloudy', time: '2026-09-29T12:00:00Z' }];
  getBriefingBySnapshotId.mockResolvedValue({ status: 'pending', weather_current: current, weather_forecast: forecast });
  const { body, code } = await invoke();
  expect(code).toBe(200); expect(body.weather).toEqual({ current, forecast }); expect(fetchWeatherConditions).not.toHaveBeenCalled();
});
test('realtime coordinates reject numeric prefixes and out-of-range latitude', async () => {
  for (const lat of ['1junk', '91']) {
    const { code } = await invoke('/weather/realtime', { lat, lng: '2' }); expect(code).toBe(400);
  }
  expect(fetchWeatherConditions).not.toHaveBeenCalled();
});
test.each([
  [undefined, true, false],
  [{ _generationFailed: true, error: 'provider HTTP 503' }, false, true],
  [[{ temperature: 20, conditions: 'Cloudy' }], false, false],
])('aggregate weather checks the hourly half of the pair: %j', async (forecast, pending, failed) => {
  getBriefingBySnapshotId.mockResolvedValue({ status: 'pending', weather_current: { temperature: 20, conditions: 'Cloudy' }, weather_forecast: forecast });
  const { body, code } = await invoke('/snapshot/:snapshotId');
  expect(code).toBe(200); expect(body.briefing.weather._pending).toBe(pending);
  expect(body.briefing.weather._generationFailed).toBe(failed); expect(fetchWeatherConditions).not.toHaveBeenCalled();
});

const savedSections = [
  ['traffic', 'traffic_conditions'], ['rideshare-news', 'news'],
  ['school-closures', 'school_closures'], ['airport', 'airport_conditions'], ['events', 'events'],
];
test.each(savedSections)('%s saved read keeps missing data pending and never triggers background generation', async (path, field) => {
  getBriefingBySnapshotId.mockResolvedValue({ status: 'pending', updated_at: new Date(Date.now() - 180000), [field]: null });
  const { body, code } = await invoke(`/${path}/:snapshotId`);
  expect(code).toBe(202); expect(body.success).toBe(false); expect(body._pending).toBe(true);
  expect(body._coverageEmpty).toBeUndefined(); expect(mustNotRun).not.toHaveBeenCalled();
});
test.each(savedSections)('%s saved read exposes malformed terminal data as failed', async (path, field) => {
  getBriefingBySnapshotId.mockResolvedValue({ status: 'complete', updated_at: new Date(), [field]: {} });
  const { body, code } = await invoke(`/${path}/:snapshotId`);
  expect(code).toBe(503); expect(body.success).toBe(false); expect(body._generationFailed).toBe(true);
});
test.each([
  ['traffic', 'traffic_conditions'], ['news', 'news'], ['events', 'events'],
  ['school_closures', 'school_closures'], ['airport_conditions', 'airport_conditions'], ['holiday', 'holiday'],
])('aggregate %s detects malformed terminal sections', async (key, field) => {
  getBriefingBySnapshotId.mockResolvedValue({ status: 'complete', [field]: {} });
  const { body, code } = await invoke('/snapshot/:snapshotId');
  expect(code).toBe(200); expect(body.briefing[key]._pending).toBe(false);
  expect(body.briefing[key]._generationFailed).toBe(true);
});

// Compatibility readers remain read-only and require the same terminal contract.
test.each(['/current', '/generate'])('%s never turns pending/failed Briefing into success', async path => {
  for (const [row, status] of [[{ status: 'pending' }, 202], [{ status: 'error' }, 503], [completeBriefing('owned-snapshot'), 200]]) {
    getBriefingBySnapshotId.mockResolvedValue(row);
    const result = await invoke(path);
    expect(result.code).toBe(status);
    if (status !== 200) expect(result.body.success).toBe(false);
  }
  expect(mustNotRun).not.toHaveBeenCalled();
});
