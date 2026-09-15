import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';

let cacheRow, owned;
const inserted = [], lookupKeys = [];
const measurements = { weather: jest.fn(), air: jest.fn() };
const enrich = jest.fn();
const db = {
  select: () => ({ from: table => ({ where: condition => ({ limit: async () => {
    expect(getTableName(table)).toBe('coords_cache');
    lookupKeys.push(new PgDialect().sqlToQuery(condition).params);
    return cacheRow ? [cacheRow] : [];
  } }) }) }),
  insert: table => ({ values: async row => { expect(getTableName(table)).toBe('snapshots'); inserted.push(row); } }),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ user_id: owned.user_id }] }) }) }),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.auth = { userId: owned.user_id }; next(); } }));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: (req, _res, next) => { req.snapshot = owned; next(); }, verifySnapshotOwnership: jest.fn() }));
jest.unstable_mockModule('../../server/lib/location/snapshot-environment.js', () => ({ snapshotEnvironment: measurements }));
jest.unstable_mockModule('../../server/lib/location/enrich-snapshot.js', () => ({ enrichSnapshot: enrich }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromMarket: async () => ({ market_name: 'Fixture current market' }), resolveTimezoneFromCoords: jest.fn() }));
jest.unstable_mockModule('../../server/lib/location/airports.js', () => ({ findNearbyAirports: async () => [], AIRPORT_RADIUS_MILES: 50 }));
jest.unstable_mockModule('../../server/lib/external/faa-asws.js', () => ({ fetchFAADelayData: jest.fn() }));
jest.unstable_mockModule('../../server/lib/infrastructure/job-queue.js', () => ({ jobQueue: {} }));
jest.unstable_mockModule('../../server/db/connection-manager.js', () => ({ getAgentState: () => ({ degraded: false }) }));
jest.unstable_mockModule('../../server/logger/ndjson.js', () => ({ ndjson: jest.fn() }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ matrixLog: new Proxy({}, { get: () => jest.fn() }) }));
const ensureStrategyRow = jest.fn();
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({ ensureStrategyRow }));
jest.unstable_mockModule('../../server/lib/ai/providers/briefing.js', () => ({ runBriefing: jest.fn() }));
const { default: router } = await import('../../server/api/location/location.js');
const app = express().use(express.json()).use('/api/location', router);
const { default: strategyRouter } = await import('../../server/api/strategy/strategy.js');
app.use('/api/strategy', strategyRouter);
const payload = () => ({ snapshot_id: owned.snapshot_id, coord: { lat: owned.lat, lng: owned.lng },
  session_id: owned.session_id, created_at: '2099-01-01T00:00:00Z',
  resolved: { city: 'forged city', state: 'forged state', country: 'forged country', formattedAddress: 'forged address', timezone: 'UTC' },
  weather: owned.weather, air: owned.air, permissions: owned.permissions });

beforeEach(() => {
  owned = completeSnapshot();
  cacheRow = { coord_key: owned.coord_key, city: owned.city, state: owned.state, country: owned.country,
    formatted_address: owned.formatted_address, timezone: owned.timezone };
  inserted.length = 0; lookupKeys.length = 0;
  jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(owned.created_at.getTime());
  enrich.mockResolvedValue(owned);
  measurements.weather.mockResolvedValue(owned.weather); measurements.air.mockResolvedValue(owned.air);
});
afterEach(() => { jest.restoreAllMocks(); });

test('full V1 saves server-resolved labels and current write time but never browser environmental data', async () => {
  const result = await request(app).post('/api/location/snapshot').send(payload());
  expect(result.status).toBe(200);
  expect(inserted).toHaveLength(1);
  expect(inserted[0]).toEqual({ ...owned, weather: null, air: null, status: 'pending' });
  expect(lookupKeys).toEqual([[owned.coord_key]]);
  expect(result.body.ready).toBe(false);
});

test('V1 cannot substitute its labels when exact server resolution is absent', async () => {
  cacheRow = null;
  const result = await request(app).post('/api/location/snapshot').send(payload());
  expect(result.status).toBe(400); expect(result.body.error).toBe('location_not_resolved');
  expect(inserted).toHaveLength(0);
});

test('V1 normalizes its precise coordinates before selecting cached location identity', async () => {
  const result = await request(app).post('/api/location/snapshot').send({ ...payload(), coord: { lat: 1.12345678, lng: -2.12345678 } });
  expect(result.status).toBe(200);
  expect(lookupKeys).toEqual([['1.123457_-2.123457']]);
  expect(inserted[0]).toMatchObject({ lat: 1.123457, lng: -2.123457 });
});

test('enrichment forwards only the owned row and identity, ignoring forged body coords, source and values', async () => {
  const result = await request(app).patch(`/api/location/snapshot/${owned.snapshot_id}/enrich`).send({ lat: 45, lng: 90, weather: { tempF: 999 }, air: { aqi: 999 } });
  expect(result.status).toBe(200);
  expect(enrich).toHaveBeenCalledWith(owned, owned.user_id);
  expect(enrich.mock.calls[0]).toHaveLength(2);
  expect(result.body).toMatchObject({ ok: true, status: 'ok', weather: owned.weather, air: owned.air });
});

test('enrichment provider failure cannot report success from the request body', async () => {
  enrich.mockRejectedValue(new Error('fixture unavailable'));
  const result = await request(app).patch(`/api/location/snapshot/${owned.snapshot_id}/enrich`).send({ weather: owned.weather, air: owned.air });
  expect(result.status).toBe(500); expect(result.body.ok).not.toBe(true);
});

test.each(['weather', 'airquality'])('%s GET rejects absent coordinates and fails explicitly on provider errors', async path => {
  expect((await request(app).get(`/api/location/${path}`)).status).toBe(400);
  const provider = measurements[path === 'weather' ? 'weather' : 'air'];
  provider.mockRejectedValue(new Error('fixture unavailable'));
  const result = await request(app).get(`/api/location/${path}?lat=0&lng=0`);
  expect(result.status).toBe(502); expect(result.body.available).toBe(false);
});

test('legacy Strategy retry requests a fresh GPS snapshot without copying or re-dating old source rows', async () => {
  const result = await request(app).post(`/api/strategy/${owned.snapshot_id}/retry`).send({});
  expect(result.status).toBe(409);
  expect(result.body).toMatchObject({ ok: false, error: 'fresh_location_required', retry: 'new_snapshot' });
  expect(inserted).toHaveLength(0);
  expect(ensureStrategyRow).not.toHaveBeenCalled();
});
