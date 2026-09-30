import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const previousKey = process.env.GOOGLE_MAPS_API_KEY;
process.env.GOOGLE_MAPS_API_KEY = 'synthetic-location-key';
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.auth = { userId: 'fixture' }; next(); } }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/lib/location/main-run-snapshot.js', () => ({ portalSnapshotHandler: jest.fn(), sendSnapshotError: jest.fn() }));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({ assertCurrentMainRun: jest.fn(), assertMainRunForSnapshot: jest.fn() }));
jest.unstable_mockModule('../../server/lib/location/enrich-snapshot.js', () => ({ enrichSnapshot: jest.fn() }));
const { default: router } = await import('../../server/api/location/location.js');
const { getTimezoneForCoords } = await import('../../server/lib/location/geocode.js');
if (previousKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = previousKey;
const app = express().use(express.json()).use('/api/location', router);
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ status: 'OK', timeZoneId: 'UTC' }) })); });
afterEach(() => jest.restoreAllMocks());

test.each(['geocode/reverse', 'timezone', 'pollen'])('%s rejects blank, coerced and out-of-range coordinates before Google', async path => {
  for (const query of [{ lat: '', lng: '' }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: ['1', '2'], lng: 0 }]) {
    expect((await request(app).get('/api/location/' + path).query(query)).status).toBe(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});
test('timezone transport and HTTP route both reject malformed provider zones', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'OK', timeZoneId: 'Not/A_Timezone' }) });
  await expect(getTimezoneForCoords(0, 0)).resolves.toBeNull();
  const result = await request(app).get('/api/location/timezone').query({ lat: 0, lng: 0 });
  expect(result.status).toBe(502);
  expect(result.body.timeZone).toBeUndefined();
});
test('a real zero latitude/longitude and Google timezone are preserved', async () => {
  const result = await request(app).get('/api/location/timezone').query({ lat: 0, lng: 0 });
  expect(result.status).toBe(200); expect(result.body.timeZone).toBe('UTC');
  expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('location')).toBe('0,0');
});
test('reverse geocoding cannot report an empty successful provider result as a resolved address', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'OK', results: [] }) });
  const result = await request(app).get('/api/location/geocode/reverse').query({ lat: 0, lng: 0 });
  expect(result.status).toBe(502); expect(result.body.formattedAddress).toBeUndefined();
});
test('retired IP location never calls a provider or returns replacement coordinates', async () => {
  const result = await request(app).get('/api/location/ip');
  expect(result.status).toBe(410); expect(result.body.error).toBe('gps_required');
  expect(result.body.latitude).toBeUndefined(); expect(fetch).not.toHaveBeenCalled();
});
test('pollen without measured indexes is unavailable rather than fabricated None', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ dailyInfo: [{ date: { year: 2026, month: 9, day: 29 }, pollenTypeInfo: [{ code: 'GRASS' }] }] }) });
  const result = await request(app).get('/api/location/pollen').query({ lat: 0, lng: 0 });
  expect(result.status).toBe(502); expect(result.body.available).toBe(false);
});
test.each([-1, 0, 6, 'junk'])('pollen days=%s is rejected before providers', async days => {
  expect((await request(app).get('/api/location/pollen').query({ lat: 0, lng: 0, days })).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
