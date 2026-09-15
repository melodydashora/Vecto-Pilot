import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { getSnapshotReadiness } from '../../server/lib/location/snapshot-readiness.js';

let cacheRow;
let storedRow;
const inserted = [];
const cacheKeys = [];
const cacheLookup = jest.fn(async () => cacheRow ? [cacheRow] : []);
const marketLookup = jest.fn();
const briefing = jest.fn();
const environment = jest.fn();
const db = {
  select: () => ({ from: table => ({ where: predicate => ({ limit: async () => {
    expect(getTableName(table)).toBe('coords_cache');
    cacheKeys.push(new PgDialect().sqlToQuery(predicate).params);
    return cacheLookup();
  } }) }) }),
  insert: table => ({ values: async row => {
    expect(getTableName(table)).toBe('snapshots');
    inserted.push(row);
    storedRow = row;
  } }),
  query: { snapshots: { findFirst: async () => storedRow } },
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: completeSnapshot().user_id }; next(); },
}));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({
  requireSnapshotOwnership: (_req, _res, next) => next(),
}));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromMarket: marketLookup }));
jest.unstable_mockModule('../../server/lib/briefing/briefing-aggregator.js', () => ({ generateAndStoreBriefing: briefing }));
jest.unstable_mockModule('../../server/lib/location/snapshot-environment.js', () => ({ snapshotEnvironment: { both: environment } }));
const { default: router } = await import('../../server/api/location/snapshot.js');
const app = express().use(express.json()).use('/api/snapshot', router);
const payload = () => {
  const row = completeSnapshot();
  return {
    snapshot_id: row.snapshot_id, user_id: 'untrusted-owner', session_id: row.session_id,
    created_at: row.created_at.toISOString(), coord: { lat: row.lat, lng: row.lng },
    // Conflicting client labels/time must not replace the coordinate-resolved record.
    resolved: { city: 'Home city', state: 'Home state', country: 'Home country', timezone: 'UTC', formatted_address: 'Home address' },
    time_context: { hour: 16, dow: 4, date: '1999-01-01', day_part_key: 'afternoon' },
    weather: row.weather, air: row.air, permissions: row.permissions,
  };
};
const post = body => request(app).post('/api/snapshot').send(body);

beforeEach(() => {
  const row = completeSnapshot();
  cacheRow = { coord_key: row.coord_key, city: row.city, state: row.state, country: row.country,
    formatted_address: row.formatted_address, timezone: row.timezone };
  storedRow = null;
  inserted.length = 0;
  cacheKeys.length = 0;
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(row.created_at.getTime());
  environment.mockImplementation(async (lat, lng) => {
    const measured = completeSnapshot({ lat, lng });
    return { weather: measured.weather, air: measured.air };
  });
  cacheLookup.mockImplementation(async () => cacheRow ? [cacheRow] : []);
  marketLookup.mockResolvedValue({ market_name: row.market, timezone: 'UTC' });
  briefing.mockResolvedValue({ success: true, complete: true });
});
afterEach(() => { jest.restoreAllMocks(); });

test('Sunday midnight and zero values persist a complete row and hand the identical record to Briefing', async () => {
  const expected = completeSnapshot();
  const result = await post(payload());
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ ok: true, status: 'ok', missing_fields: [], briefing_status: 'complete', hour: 0, dow: 0 });
  expect(inserted).toHaveLength(1);
  expect(inserted[0]).toEqual(expected);
  expect(getSnapshotReadiness(inserted[0]).ready).toBe(true);
  expect(briefing).toHaveBeenCalledWith({ snapshotId: expected.snapshot_id, snapshot: inserted[0] });
  expect(briefing.mock.calls[0][0].snapshot).toBe(inserted[0]);
  expect(marketLookup).toHaveBeenCalledWith(expected.city, expected.state, expected.country);
  expect(cacheKeys).toEqual([[expected.coord_key]]);
});

test('coordinate precision is normalized before cache identity and H3 are derived', async () => {
  const result = await post({ ...payload(), coord: { lat: '1.12345649', lng: '-2.12345649' } });
  expect(result.status).toBe(201);
  expect(cacheKeys).toEqual([['1.123456_-2.123456']]);
  expect(inserted[0]).toMatchObject({ lat: 1.123456, lng: -2.123456 });
  expect(getSnapshotReadiness(inserted[0]).ready).toBe(true);
});

test.each(['weather', 'air'])('browser %s is ignored; provider measurements still complete the row', async field => {
  const body = payload();
  body[field] = { forged: true, aqi: 999, tempF: 999 };
  const result = await post(body);
  expect(result.status).toBe(201);
  expect(inserted[0][field]).toEqual(completeSnapshot()[field]);
  expect(briefing).toHaveBeenCalledTimes(1);
});

test.each(['permissions'])('missing %s remains pending and never invokes Briefing', async field => {
  const body = payload();
  delete body[field];
  const result = await post(body);
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ status: 'pending', briefing_status: 'not_started' });
  expect(result.body.missing_fields).toContain(field);
  expect(inserted[0][field]).toBeNull();
  expect(briefing).not.toHaveBeenCalled();
});

test('provider failure is explicit and cannot be substituted with browser data', async () => {
  environment.mockRejectedValue(new Error('fixture provider unavailable'));
  const result = await post(payload());
  expect(result.status).toBe(502);
  expect(result.body.error).toBe('snapshot_environment_unavailable');
  expect(inserted).toHaveLength(0);
  expect(briefing).not.toHaveBeenCalled();
});

test('browser creation time cannot make old or future source appear current', async () => {
  const result = await post({ ...payload(), created_at: '2099-01-01T00:00:00Z' });
  expect(result.status).toBe(201);
  expect(inserted[0].created_at).toEqual(completeSnapshot().created_at);
});

test.each([null, new Error('fixture market unavailable')])('unresolved current market remains pending without a home-market fallback: %s', async outcome => {
  if (outcome instanceof Error) marketLookup.mockRejectedValue(outcome);
  else marketLookup.mockResolvedValue(outcome);
  const result = await post(payload());
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ status: 'pending', briefing_status: 'not_started' });
  expect(result.body.missing_fields).toContain('market');
  expect(inserted[0].market).toBeNull();
  expect(briefing).not.toHaveBeenCalled();
});

test.each([
  ['invalid coordinate', body => { body.coord.lat = 90.000001; }, () => {}, 'invalid_coordinates'],
  ['missing coordinate', body => { delete body.coord.lng; }, () => {}, 'invalid_coordinates'],
  ['invalid creation time', body => { body.created_at = 'invalid'; }, () => {}, 'invalid_created_at'],
  ['null creation time', body => { body.created_at = null; }, () => {}, 'invalid_created_at'],
  ['unresolved GPS', () => {}, () => { cacheRow = null; }, 'location_not_resolved'],
  ['invalid timezone', () => {}, () => { cacheRow.timezone = 'bad/timezone'; }, 'timezone_required'],
])('%s is rejected before persistence or Briefing', async (_label, changeBody, changeCache, error) => {
  const body = payload();
  changeBody(body);
  changeCache();
  const result = await post(body);
  expect(result.status).toBe(400);
  expect(result.body.error).toBe(error);
  expect(inserted).toHaveLength(0);
  expect(briefing).not.toHaveBeenCalled();
});

test('cache read failure cannot be substituted with client location labels', async () => {
  cacheLookup.mockRejectedValue(new Error('fixture database failure'));
  expect((await post(payload())).status).toBe(500);
  expect(inserted).toHaveLength(0);
  expect(briefing).not.toHaveBeenCalled();
});

test.each([{ success: false, complete: false }, { success: true, complete: false }, new Error('fixture Briefing failure')])('Briefing failure stays explicit even after a valid snapshot save: %s', async outcome => {
  if (outcome instanceof Error) briefing.mockRejectedValue(outcome);
  else briefing.mockResolvedValue(outcome);
  const result = await post(payload());
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ status: 'ok', briefing_status: 'failed' });
  expect(getSnapshotReadiness(inserted[0]).ready).toBe(true);
});

test.each([true, false])('GET computes readiness from the actual stored row, complete=%s', async complete => {
  storedRow = completeSnapshot();
  if (!complete) storedRow.weather = null;
  const result = await request(app).get(`/api/snapshot/${storedRow.snapshot_id}`);
  expect(result.status).toBe(200);
  expect(result.body.status).toBe(complete ? 'ok' : 'pending');
  expect(result.body.missing_fields).toEqual(complete ? [] : ['weather']);
  expect(storedRow.status).toBe('ok');
  expect(inserted).toHaveLength(0);
});
