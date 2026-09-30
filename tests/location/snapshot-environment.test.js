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
  expect(new URL(url).searchParams.get('location.latitude')).toBe('1.12345678');
  expect(new URL(url).searchParams.get('unitsSystem')).toBe('METRIC');
  const [, options] = fetchImpl.mock.calls.find(([url]) => url.includes('airquality'));
  expect(JSON.parse(options.body).location).toEqual({ latitude: 1.12345678, longitude: -2.12345678 });
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

test('only simultaneous work shares provider calls; later attempts fetch again', async () => {
  const [first, second] = await Promise.all([environment.weather(1, 2, { scope: 'run-a' }), environment.weather(1, 2, { scope: 'run-a' })]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  first.source.coord_key = 'forged'; first.tempF = 999;
  expect(second.tempF).toBe(32);
  expect(second.source.coord_key).toBe('1.000000_2.000000');
  weather.temperature.degrees = 20;
  expect((await environment.weather(1, 2, { scope: 'run-a' })).tempF).toBe(68);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('even recent success cannot hide the next provider failure; failure is not cached', async () => {
  await environment.weather(0, 0);
  fetchImpl.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(environment.weather(0, 0)).rejects.toThrow('HTTP 503');
  await environment.weather(0, 0);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
test('distinct runs and extra GPS digits do not share in-flight responses', async () => {
  await Promise.all([
    environment.weather(1.12345671, 2, { scope: 'run-a' }),
    environment.weather(1.12345671, 2, { scope: 'run-b' }),
    environment.weather(1.12345679, 2, { scope: 'run-a' }),
  ]);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test('invalid coordinates and missing keys fail before any provider call', async () => {
  await expect(environment.weather('', null)).rejects.toThrow('coordinates');
  const unconfigured = createSnapshotEnvironment({ fetchImpl, env: {} });
  await expect(unconfigured.air(0, 0)).rejects.toThrow('not configured');
  expect(fetchImpl).not.toHaveBeenCalled();
});


for (const section of ['weather', 'air']) {
  const observedField = section === 'weather' ? 'currentTime' : 'dateTime';
  const observation = () => section === 'weather' ? weather : air;

  test.each(['2026-11-01T01:30:00', '2026-11-01'])(`${section} rejects zoneless observation %s even when its parsed epoch appears fresh`, async observed => {
    now = Date.parse(observed);
    observation()[observedField] = observed;
    await expect(environment[section](0, 0)).rejects.toThrow('incomplete measurements');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each([
    '2026-09-12T18:30:00.123456789Z',
    '2026-09-12T14:30:00.123456789-04:00',
    '2026-09-13T00:00:00.123456789+05:30',
  ])(`${section} preserves explicit provider instant %s without losing its offset or fraction`, async observed => {
    now = Date.parse('2026-09-12T18:30:00.123Z');
    observation()[observedField] = observed;
    const value = await environment[section](0, 0);
    expect(value.source.observed_at).toBe(observed);
    expect(value.source.fetched_at).toBe('2026-09-12T18:30:00.123Z');
    expect(section === 'weather' ? value.observedAt : value.dateTime).toBe(observed);
  });

  test.each(['2026-09-12T18:30:00+05:00', '2026-09-12T18:30:00-05:00'])(`${section} uses the offset when rejecting stale or future observation %s`, async observed => {
    observation()[observedField] = observed;
    await expect(environment[section](0, 0)).rejects.toThrow('stale or future-dated');
  });

  test.each(['2026-02-30T12:00:00Z', '2026-09-12T24:00:00Z'])(`${section} rejects calendar or clock rollover %s instead of inventing a different instant`, async observed => {
    now = Date.parse(observed);
    observation()[observedField] = observed;
    await expect(environment[section](0, 0)).rejects.toThrow('incomplete measurements');
  });

  test(`${section} retains a valid leap-day observation with offset and nanosecond evidence`, async () => {
    const observed = '2028-02-29T00:15:00.123456789+05:30';
    now = Date.parse('2028-02-28T18:45:00.123Z');
    observation()[observedField] = observed;
    expect((await environment[section](0, 0)).source.observed_at).toBe(observed);
  });
}
