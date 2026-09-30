import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, OP: {} }));
const writes = [];
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  CHANNELS: {}, errorMarker: error => ({ _generationFailed: true, error: error.message }),
  writeSectionAndNotify: async (_id, value) => writes.push(value),
}));
const { fetchWeatherConditions, discoverWeather } = await import('../../server/lib/briefing/pipelines/weather.js');
const originalFetch = global.fetch;
const realTimers = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
const observedAt = '2026-09-29T12:30:00Z';
let current, forecast;
const args = { snapshotId: 'weather-contract', snapshot: { lat: 1, lng: 2, country: 'US' } };
beforeEach(() => {
  writes.length = 0;
  process.env.GOOGLE_MAPS_API_KEY = 'mock-weather-key';
  current = { currentTime: observedAt, temperature: { degrees: 20, unit: 'CELSIUS' },
    weatherCondition: { description: { text: 'Cloudy' }, type: 'CLOUDY' },
    wind: { speed: { value: 36, unit: 'KILOMETERS_PER_HOUR' } } };
  forecast = [{ ...current, interval: { startTime: '2026-09-29T12:00:00Z', endTime: '2026-09-29T13:00:00Z' } }];
  global.fetch = jest.fn(async url => ({ ok: true, status: 200,
    json: async () => String(url).includes('forecast/') ? { forecastHours: forecast } : current }));
});
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); Object.assign(global, realTimers); });

test('Google nested wind uses the declared units and provider forecast interval', async () => {
  const result = await fetchWeatherConditions(args);
  expect(result.current.windSpeed).toBe(22);
  expect(result.forecast[0].windSpeed).toBe(22);
  expect(result.forecast[0].time).toBe(forecast[0].interval.startTime);
  expect(result.current.observedAt).toBe(observedAt);
  expect(result.current.feelsLike).toBeUndefined();
  expect(global.fetch.mock.calls.every(([url]) => new URL(url).searchParams.get('unitsSystem') === 'METRIC')).toBe(true);
});
test('zero wind and Fahrenheit inputs remain measured values', async () => {
  current.wind.speed = { value: 0, unit: 'MILES_PER_HOUR' };
  current.temperature = { degrees: 0, unit: 'FAHRENHEIT' };
  const result = await fetchWeatherConditions(args);
  expect(result.current.windSpeed).toBe(0);
  expect(result.current.tempF).toBe(0);
  expect(result.current.driverImpact).toContain('Freezing 0°F');
});
test('Australia does not accidentally match the US substring', async () => {
  const result = await fetchWeatherConditions({ snapshot: { ...args.snapshot, country: 'Australia' } });
  expect(result.current.tempUnit).toBe('°C'); expect(result.current.windSpeed).toBe(36);
});
test.each(['interval', 'temperature', 'weatherCondition'])('missing hourly %s fails both persisted sections without fabricated data', async field => {
  delete forecast[0][field];
  await expect(discoverWeather(args)).rejects.toThrow(/invalid/i);
  expect(writes.at(-1).weather_current._generationFailed).toBe(true);
  expect(writes.at(-1).weather_forecast._generationFailed).toBe(true);
});
test('missing current observation time cannot become fresh weather', async () => {
  delete current.currentTime;
  await expect(fetchWeatherConditions(args)).rejects.toThrow(/invalid/i);
});
test('rain in the provider current-hour interval is not shifted one hour ahead', async () => {
  forecast[0].weatherCondition = { description: { text: 'Rain' }, type: 'RAIN' };
  const result = await fetchWeatherConditions(args);
  expect(result.current.driverImpact).toContain('current forecast hour');
  expect(result.current.driverImpact).not.toContain('~1 hour');
});
test.each([[91, 2], [1, 181], ['1junk', 2], [null, 2]])('invalid coordinates %p,%p never reach Google', async (lat, lng) => {
  await expect(fetchWeatherConditions({ snapshot: { lat, lng } })).rejects.toThrow(/coordinates/i);
  expect(global.fetch).not.toHaveBeenCalled();
});
test('caller cancellation reaches both current and hourly provider requests', async () => {
  const controller = new AbortController();
  global.fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const pending = fetchWeatherConditions({ ...args, signal: controller.signal });
  controller.abort(new Error('Weather read cancelled'));
  await expect(pending).rejects.toThrow('Weather read cancelled');
  expect(global.fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
});
test('an already cancelled request never reaches the provider', async () => {
  const controller = new AbortController(); controller.abort(new Error('Cancelled before fetch'));
  await expect(fetchWeatherConditions({ ...args, signal: controller.signal })).rejects.toThrow('Cancelled before fetch');
  expect(global.fetch).not.toHaveBeenCalled();
});
test('provider deadline includes stalled response bodies and cancels both requests', async () => {
  jest.useFakeTimers();
  global.fetch.mockImplementation((_url, { signal }) => Promise.resolve({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }));
  const rejected = expect(fetchWeatherConditions(args)).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(global.fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
});
test('unknown optional wind units are omitted, not mislabelled as measured mph', async () => {
  current.wind.speed = { value: 36, unit: 'SPEED_UNIT_UNSPECIFIED' };
  const result = await fetchWeatherConditions(args);
  expect(result.current.windSpeed).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('NaN');
});
