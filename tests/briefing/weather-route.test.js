import { jest, beforeEach, test, expect } from '@jest/globals';
import { completeBriefing } from '../fixtures/complete-briefing.js';
const mustNotRun = jest.fn(() => { throw new Error('Unexpected work outside weather read'); });
const getBriefingBySnapshotId = jest.fn();
const fetchWeatherConditions = jest.fn();
const passthrough = (_req, _res, next) => next();
jest.unstable_mockModule('../../server/lib/briefing/briefing-aggregator.js', () => ({ getBriefingBySnapshotId, generateAndStoreBriefing: mustNotRun }));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({ assertMainRunForSnapshot: mustNotRun, withCurrentMainRun: mustNotRun, MainRunAdmissionError: class extends Error {} }));
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
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ chainLog: jest.fn(), tagLog: jest.fn(), triadLog: console, matrixLog: console, locationLog: console, OP: {} }));
const readMarketEvents = jest.fn();
const actualMarketReader = await import('../../server/lib/events/market-event-reader.js');
jest.unstable_mockModule('../../server/lib/events/market-event-reader.js', () => ({ ...actualMarketReader, readMarketEvents }));
const { assertBriefingReady, getBriefingReadiness } = await import('../../server/lib/briefing/briefing-readiness.js');
const { default: router } = await import('../../server/api/briefing/briefing.js');
const invoke = async (path = '/weather/:snapshotId', query = {}) => {
  const handler = router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle;
  let body, code = 200;
  const res = { status: value => { code = value; return res; }, json: value => { body = value; return res; } };
  await handler({ query, body: { snapshotId: 'owned-snapshot' }, snapshot: { snapshot_id: 'owned-snapshot', lat: 1, lng: 2, city: 'Test', state: 'TX', timezone: 'Etc/UTC' }, auth: { userId: 'owner' } }, res);
  return { body, code };
};
beforeEach(() => {
  jest.clearAllMocks(); fetchWeatherConditions.mockResolvedValue({ current: { tempF: 68 }, forecast: [] });
  readMarketEvents.mockResolvedValue({ rows: [], unresolvedCount: 0, marketName: 'Fixture market' });
});
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

const verifiedEvent = () => {
  const today = new Date().toISOString().slice(0, 10);
  return { id: 'verified-event', title: 'Verified fixture event', venue_id: 'verified-venue', venue: 'Verified fixture venue',
    address: 'Fixture public venue', latitude: 1.01, longitude: 2.01, impact: 'high',
    event_start_date: today, event_end_date: today, event_start_time: '00:00', event_end_time: '23:59',
    timezone: 'Etc/UTC' };
};

test('aggregate shows verified pending Events before final completion while Strategy stays held', async () => {
  const event = verifiedEvent();
  const row = { ...completeBriefing('owned-snapshot'), status: 'pending', generated_at: null,
    events: { items: [event], _pending: true } };
  const original = structuredClone(row);
  getBriefingBySnapshotId.mockResolvedValue(row);
  const { body, code } = await invoke('/snapshot/:snapshotId');
  expect(code).toBe(200); expect(body.status).toBe('pending');
  expect(body.briefing.events).toMatchObject({ items: [event], _pending: true, _generationFailed: false, reason: null });
  expect(body.briefing.weather.current).toEqual(row.weather_current);
  expect(getBriefingReadiness(row, row.snapshot_id).ready).toBe(false);
  expect(() => assertBriefingReady(row, row.snapshot_id)).toThrow('events');
  // Even mistaken terminal metadata cannot authorize a pending section.
  expect(() => assertBriefingReady({ ...row, status: 'complete', generated_at: new Date() }, row.snapshot_id)).toThrow('events');
  expect(row).toEqual(original); expect(mustNotRun).not.toHaveBeenCalled();
});

test.each(['pending', 'error'])('aggregate retains verified Events after a category fails with owner status %s', async status => {
  const event = verifiedEvent();
  const row = { ...completeBriefing('owned-snapshot'), status, generated_at: null,
    events: { items: [event], _generationFailed: true, error: 'Events category timed out' } };
  const original = structuredClone(row);
  getBriefingBySnapshotId.mockResolvedValue(row);
  const { body, code } = await invoke('/snapshot/:snapshotId');
  expect(code).toBe(200); expect(body.status).toBe(status);
  expect(body.briefing.events).toMatchObject({ items: [event], _pending: false, _generationFailed: true,
    reason: 'Events category timed out' });
  expect(body.briefing.airport_conditions.airports).toEqual(row.airport_conditions.airports);
  expect(getBriefingReadiness(row, row.snapshot_id).ready).toBe(false);
  expect(() => assertBriefingReady(row, row.snapshot_id)).toThrow('events');
  expect(row).toEqual(original); expect(mustNotRun).not.toHaveBeenCalled();
});

test('active events applies Briefing priority while keeping nearby and market draws in the map array', async () => {
  const source = [
    ['Far major draw', 'high', 3], ['Near medium draw', 'medium', 2.01],
    ['Near high draw', 'high', 2.02], ['Routine nearby', 'low', 2.001],
    ['Far medium draw', 'medium', 3], ['Unknown crowd', null, 2.001],
  ].map(([title, impact, longitude], index) => ({
    event: { ...verifiedEvent(), id: `source-${index}`, title, venue_id: `venue-${index}`, expected_attendance: impact,
      event_end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
    venue: { venue_name: `Fixture venue ${index}`, formatted_address: 'Fixture public venue',
      lat: 1, lng: longitude, timezone: 'Etc/UTC', capacity_estimate: 100000 },
  }));
  const original = structuredClone(source);
  getBriefingBySnapshotId.mockResolvedValue(completeBriefing('owned-snapshot'));
  readMarketEvents.mockResolvedValueOnce({ rows: source, unresolvedCount: 0, marketName: 'Fixture market' });
  const { body, code } = await invoke('/events/:snapshotId', { filter: 'active' });
  expect(code).toBe(200); expect(body.success).toBe(true);
  expect(body.events.map(event => event.title)).toEqual(['Near high draw', 'Near medium draw', 'Far major draw']);
  expect(body.events.map(event => event.event_scope)).toEqual(['nearby', 'nearby', 'market']);
  expect(body.marketEvents).toEqual([]);
  expect(source).toEqual(original); expect(mustNotRun).not.toHaveBeenCalled();
});

test('aggregate with only major market draws explains nearby absence without saying all events are absent', async () => {
  const event = { ...verifiedEvent(), latitude: 1, longitude: 3 };
  const row = { ...completeBriefing('owned-snapshot'), events: [event] };
  getBriefingBySnapshotId.mockResolvedValue(row);
  const { body, code } = await invoke('/snapshot/:snapshotId');
  expect(code).toBe(200);
  expect(body.briefing.events.items).toEqual([]);
  expect(body.briefing.events.marketEvents).toEqual([expect.objectContaining({ title: event.title, event_scope: 'market' })]);
  expect(body.briefing.events.reason).toBe('No nearby high-value events. Major crowd draws are listed below.');
  expect(body.briefing.events._pending).toBe(false); expect(body.briefing.events._generationFailed).toBe(false);
  expect(row.events).toEqual([event]); expect(mustNotRun).not.toHaveBeenCalled();
});

test('nearby supplemental market evidence never claims owned generation progress or a new saved timestamp', async () => {
  const event = { ...verifiedEvent(), expected_attendance: 'high' };
  const row = { ...completeBriefing('owned-snapshot'), status: 'pending', generated_at: null, events: null,
    updated_at: new Date('2026-10-05T10:00:00Z') };
  const original = structuredClone(row);
  getBriefingBySnapshotId.mockResolvedValue(row);
  readMarketEvents.mockResolvedValueOnce({ marketName: 'Fixture market', unresolvedCount: 0,
    rows: [{ event, venue: { venue_name: event.venue, formatted_address: event.address,
      lat: event.latitude, lng: event.longitude, timezone: event.timezone } }] });
  const { body, code } = await invoke('/snapshot/:snapshotId');
  expect(code).toBe(200); expect(body.status).toBe('pending');
  expect(body.briefing.events).toMatchObject({ items: [], _pending: true, _generationFailed: false, reason: null,
    marketEvents: [expect.objectContaining({ title: event.title, event_scope: 'nearby' })] });
  expect(body.updated_at).toEqual(row.updated_at); expect(body.generated_at).toBeNull();
  expect(getBriefingReadiness(row, row.snapshot_id).ready).toBe(false);
  expect(row).toEqual(original); expect(mustNotRun).not.toHaveBeenCalled();
});
