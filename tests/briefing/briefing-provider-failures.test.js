import { jest, describe, test, beforeEach, afterAll, expect } from '@jest/globals';
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, matrixLog: log, OP: {} }));
const callModel = jest.fn();
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/briefing/shared/get-market-for-location.js', () => ({ getMarketForLocation: async () => 'Test Market' }));
const writes = [];
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  CHANNELS: {}, errorMarker: err => ({ _generationFailed: true, error: err.message }),
  writeSectionAndNotify: async (_id, value) => writes.push(value),
}));
// Traffic imports its real helpers, but any accidental database use must fail.
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: new Proxy({}, { get: () => { throw new Error('Unexpected database access'); } }) }));
const originalFetch = global.fetch;
global.fetch = jest.fn();
const { discoverWeather } = await import('../../server/lib/briefing/pipelines/weather.js');
const { discoverNews } = await import('../../server/lib/briefing/pipelines/news.js');
const { discoverSchools } = await import('../../server/lib/briefing/pipelines/schools.js');
const { discoverTraffic } = await import('../../server/lib/briefing/pipelines/traffic.js');
const { briefingSectionIssue } = await import('../../server/lib/briefing/briefing-readiness.js');
const args = { snapshotId: 'test-snapshot', snapshot: { city: 'Test City', state: 'Test State', timezone: 'Etc/UTC', market: 'Test Market', country: 'GB', lat: 1, lng: 1 } };

beforeEach(() => {
  writes.length = 0; jest.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test-key'; process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  delete process.env.TOMTOM_API_KEY;
  global.fetch.mockRejectedValue(new Error('Unexpected network access'));
});
afterAll(() => { global.fetch = originalFetch; });

describe('Briefing provider errors remain errors', () => {
  test('weather authentication/configuration failure marks both sections', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    await expect(discoverWeather(args)).rejects.toThrow('not configured');
    expect(writes.at(-1).weather_current._generationFailed).toBe(true);
    expect(writes.at(-1).weather_forecast._generationFailed).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('current weather success does not hide forecast HTTP failure', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(discoverWeather(args)).rejects.toThrow('forecast HTTP 503');
  });
  test('HTTP 200 with malformed weather is still failure', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(discoverWeather(args)).rejects.toThrow('invalid current conditions');
  });
  test('successful weather keeps actual current and hourly values', async () => {
    const payload = { temperature: { degrees: 20 }, weatherCondition: { description: { text: 'Cloudy' } } };
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ forecastHours: [payload] }) });
    const result = await discoverWeather(args);
    expect(briefingSectionIssue('weather_current', result.weather_current)).toBeNull();
    expect(briefingSectionIssue('weather_forecast', result.weather_forecast)).toBeNull();
  });
  test.each([['news', discoverNews, 'news'], ['schools', discoverSchools, 'school_closures']])('%s model failure never becomes verified empty', async (_name, discover, field) => {
    callModel.mockResolvedValue({ ok: false, error: 'provider HTTP 503' });
    await expect(discover(args)).rejects.toThrow('provider');
    expect(writes.at(-1)[field]._generationFailed).toBe(true);
  });
  test.each([['news', discoverNews, 'news'], ['schools', discoverSchools, 'school_closures']])('%s malformed JSON never becomes verified empty', async (_name, discover, field) => {
    callModel.mockResolvedValue({ ok: true, output: '{"wrong":"shape"}' });
    await expect(discover(args)).rejects.toThrow();
    expect(writes.at(-1)[field]._generationFailed).toBe(true);
  });
  test('successful empty school search retains its existing explained-empty contract', async () => {
    callModel.mockResolvedValue({ ok: true, output: '[]' });
    const result = await discoverSchools(args);
    expect(result.closures).toEqual([]); expect(result.reason).toContain('No school closures');
    expect(writes.at(-1).school_closures._generationFailed).toBeUndefined();
  });
  test('successful empty news search preserves the model explanation', async () => {
    callModel.mockResolvedValue({ ok: true, output: '{"items":[],"reason":"No recent reports relevant to this search"}' });
    const result = await discoverNews(args);
    expect(result.news.reason).toBe('No recent reports relevant to this search');
  });
  test('unavailable traffic providers return a failure marker', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await discoverTraffic(args);
    expect(result.traffic_conditions._generationFailed).toBe(true);
    expect(briefingSectionIssue('traffic_conditions', result.traffic_conditions)).toContain('unavailable');
  });
  test('invalid traffic model response does not become ordinary traffic', async () => {
    callModel.mockResolvedValue({ ok: true, output: '{}' });
    const result = await discoverTraffic(args);
    expect(result.traffic_conditions._generationFailed).toBe(true);
  });
});
