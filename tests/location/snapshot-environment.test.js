import { jest, beforeEach, test, expect } from '@jest/globals';
import { createSnapshotEnvironment } from '../../server/lib/location/snapshot-environment.js';

let now, weather, air, fetchImpl, environment;
const env = { GOOGLE_MAPS_API_KEY: 'synthetic-weather-key', GOOGLEAQ_API_KEY: 'synthetic-air-key' };
const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
beforeEach(() => {
  now = Date.parse('2026-09-12T18:30:00Z');
  weather = { currentTime: new Date(now).toISOString(), temperature: { degrees: 0, unit: 'CELSIUS' },
    feelsLikeTemperature: { degrees: 0, unit: 'CELSIUS' }, weatherCondition: { description: { text: 'Clear' } } };
  air = { dateTime: '2026-09-12T18:00:00Z', indexes: [{ code: 'uaqi', aqi: 0, category: 'Good' }] };
  fetchImpl = jest.fn(async url => response(url.includes('airquality') ? air : weather));
  environment = createSnapshotEnvironment({ fetchImpl, now: () => now, env });
});

test('real zero measurements survive and carry exact coordinate and provider timestamps', async () => {
  const value = await environment.both(1.12345678, -2.12345678);
  expect(value.weather).toMatchObject({ tempF: 32, feelsLike: 32, conditions: 'Clear', source: {
    provider: 'google-weather', coord_key: '1.123457_-2.123457', fetched_at: new Date(now).toISOString(), observed_at: weather.currentTime,
  } });
  expect(value.air).toMatchObject({ aqi: 0, category: 'Good', source: { provider: 'google-air-quality', observed_at: air.dateTime } });
  const [url] = fetchImpl.mock.calls.find(([url]) => url.includes('weather.googleapis'));
  expect(new URL(url).searchParams.get('location.latitude')).toBe('1.123457');
  expect(new URL(url).searchParams.get('unitsSystem')).toBe('METRIC');
  const [, options] = fetchImpl.mock.calls.find(([url]) => url.includes('airquality'));
  expect(JSON.parse(options.body).location).toEqual({ latitude: 1.123457, longitude: -2.123457 });
});

test.each(['no index', 'missing AQI', 'text AQI', 'missing category', 'missing time', 'old time', 'future time'])('air %s is an explicit failure, never a fabricated zero', async problem => {
  if (problem === 'no index') air.indexes = [];
  if (problem === 'missing AQI') delete air.indexes[0].aqi;
  if (problem === 'text AQI') air.indexes[0].aqi = '0';
  if (problem === 'missing category') air.indexes[0].category = '';
  if (problem === 'missing time') delete air.dateTime;
  if (problem === 'old time') air.dateTime = '2026-09-12T15:00:00Z';
  if (problem === 'future time') air.dateTime = '2026-09-12T20:00:00Z';
  await expect(environment.air(0, 0)).rejects.toThrow(/incomplete|stale|future/);
});

test.each(['missing temperature', 'missing conditions', 'missing time', 'old time', 'unknown unit'])('weather %s cannot become an available snapshot value', async problem => {
  if (problem === 'missing temperature') delete weather.temperature;
  if (problem === 'missing conditions') weather.weatherCondition = {};
  if (problem === 'missing time') delete weather.currentTime;
  if (problem === 'old time') weather.currentTime = '2026-09-12T17:00:00Z';
  if (problem === 'unknown unit') weather.temperature.unit = 'OTHER';
  await expect(environment.weather(0, 0)).rejects.toThrow(/incomplete|stale/);
});

test('unit-aware conversion does not convert Fahrenheit twice', async () => {
  weather.temperature = { degrees: 32, unit: 'FAHRENHEIT' };
  expect((await environment.weather(0, 0)).tempF).toBe(32);
});

test('header and enrichment share fresh exact-coordinate results without sharing mutable objects', async () => {
  const [first] = await Promise.all([environment.weather(1, 2), environment.weather(1, 2)]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  first.source.coord_key = 'forged'; first.tempF = 999;
  expect((await environment.weather(1, 2)).tempF).toBe(32);
  expect((await environment.weather(1, 2)).source.coord_key).toBe('1.000000_2.000000');
  await environment.weather(1.000001, 2);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  now += 60_001; weather.currentTime = new Date(now).toISOString();
  await environment.weather(1, 2);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test('expired measurements do not return when the next provider call fails; failure is not cached', async () => {
  await environment.weather(0, 0); now += 60_001;
  fetchImpl.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(environment.weather(0, 0)).rejects.toThrow('HTTP 503');
  await environment.weather(0, 0);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test('invalid coordinates and missing keys fail before any provider call', async () => {
  await expect(environment.weather('', null)).rejects.toThrow('coordinates');
  const unconfigured = createSnapshotEnvironment({ fetchImpl, env: {} });
  await expect(unconfigured.air(0, 0)).rejects.toThrow('not configured');
  expect(fetchImpl).not.toHaveBeenCalled();
});
