import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { snapshots } from '../../shared/schema.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { getSnapshotReadiness } from '../../server/lib/location/snapshot-readiness.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actualDb, admission, allowed;
const owner = completeSnapshot().user_id;
const session = completeSnapshot().session_id;
const runId = '00000000-0000-4000-8000-000000000004';
const db = new Proxy({}, { get: (_target, name) => typeof actualDb[name] === 'function' ? actualDb[name].bind(actualDb) : actualDb[name] });
const location = jest.fn(), environment = jest.fn(), market = jest.fn();
const recordError = jest.fn(async () => true);
class MainRunAdmissionError extends Error {
  constructor(status, code, message = code) { super(message); this.status = status; this.code = code; }
}
const assertAdmission = jest.fn(async (auth, id) => {
  if (!allowed || id !== runId || auth.userId !== owner || auth.sessionId !== session) throw new MainRunAdmissionError(409, 'main_run_required');
  return { ...admission };
});
const bind = jest.fn(async (tx, auth, id, row) => {
  await assertAdmission(auth, id);
  if (admission.snapshot_id) return (await tx.select().from(snapshots).where(eq(snapshots.snapshot_id, admission.snapshot_id)))[0];
  const [saved] = await tx.insert(snapshots).values(row).returning();
  admission.snapshot_id = saved.snapshot_id;
  return saved;
});
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({
  MainRunAdmissionError, assertCurrentMainRun: assertAdmission, bindMainRunSnapshot: bind,
  recordMainRunSnapshotError: recordError,
  assertMainRunForSnapshot: jest.fn(),
  withDriverSettingsLock: (auth, callback) => db.transaction(async tx => { await assertAdmission(auth, runId); return callback(tx); }),
}));
jest.unstable_mockModule('../../server/lib/briefing/briefing-generation.js', () => ({
  cancelUpstreamBriefingGenerations: jest.fn(),
}));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: owner, sessionId: session }; next(); },
}));
jest.unstable_mockModule('../../server/middleware/require-snapshot-ownership.js', () => ({ requireSnapshotOwnership: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ resolveFreshGpsLocation: location, getTimezoneDataForCoords: jest.fn(), pickAddressParts: jest.fn(), pickBestGeocodeResult: jest.fn() }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromMarket: market }));
jest.unstable_mockModule('../../server/lib/location/snapshot-environment.js', () => ({ snapshotEnvironment: { both: environment } }));
jest.unstable_mockModule('../../server/lib/location/enrich-snapshot.js', () => ({ enrichSnapshot: jest.fn() }));
const { default: snapshotRouter } = await import('../../server/api/location/snapshot.js');
const { default: locationRouter } = await import('../../server/api/location/location.js');
const { snapshotResponse } = await import('../../server/lib/location/main-run-snapshot.js');
const app = express().use(express.json()).use('/api/snapshot', snapshotRouter).use('/api/location', locationRouter);
const payload = () => ({ runId, lat: 1.123456789, lng: -2.123456789, accuracy: 5, gps_timestamp: Date.now(), permission: 'granted',
  created_at: '2099-01-01T00:00:00Z', resolved: { city: 'forged', timezone: 'UTC' }, weather: { tempF: 999 }, air: { aqi: 999 } });
const send = (path, data) => path.endsWith('/resolve') ? request(app).get(path).query(data) : request(app).post(path).send(data);
const rows = () => actualDb.select().from(snapshots);
beforeAll(async () => {
  pg = new PGlite(); actualDb = drizzle(pg, { schema: { snapshots } });
  await pg.exec('CREATE TABLE snapshots (' + getTableConfig(snapshots).columns.map(c => '"' + c.name + '" ' + c.getSQLType()).join(', ') + ')');
}, 30_000);
beforeEach(async () => {
  await pg.exec('TRUNCATE snapshots'); jest.clearAllMocks(); allowed = true;
  admission = { run_id: runId, user_id: owner, session_id: session, snapshot_id: null, created_at: new Date(Date.now() - 1000) };
  const fixture = completeSnapshot();
  location.mockResolvedValue({ city: fixture.city, state: fixture.state, country: fixture.country, formattedAddress: fixture.formatted_address, timeZone: fixture.timezone });
  market.mockResolvedValue({ market_name: fixture.market });
  environment.mockImplementation(async (lat, lng) => {
    const value = completeSnapshot({ lat, lng, createdAt: new Date() });
    return { weather: value.weather, air: value.air };
  });
});
afterAll(async () => { await pg?.close(); });

test.each(['/api/snapshot', '/api/location/snapshot', '/api/location/resolve'])('%s enforces admission before providers and persists fresh canonical data with full GPS precision', async path => {
  const held = await send(path, { ...payload(), runId: undefined });
  expect(held.status).toBe(409); expect(location).not.toHaveBeenCalled(); expect(environment).not.toHaveBeenCalled();
  const response = await send(path, payload());
  expect(response.status).toBe(path.endsWith('/resolve') ? 200 : 201);
  const [saved] = await rows();
  expect(saved).toMatchObject({ user_id: owner, session_id: session, lat: 1.123456789, lng: -2.123456789, city: 'Fixture city', status: 'ok' });
  expect(saved.created_at.getUTCFullYear()).not.toBe(2099);
  expect(saved.weather.tempF).toBe(0); expect(saved.air.aqi).toBe(0);
  expect(environment).toHaveBeenCalledWith(saved.lat, saved.lng, { scope: runId });
  expect(getSnapshotReadiness(saved).ready).toBe(true);
  expect(response.body.created_at).toBe(saved.created_at.toISOString());
  expect(response.body.local_iso).not.toMatch(/Z|[+-]\d\d:\d\d$/);
});

test('one admitted run binds once and duplicate delivery returns the same immutable source', async () => {
  const first = await send('/api/snapshot', payload());
  environment.mockRejectedValue(new Error('must not recollect already bound source'));
  const replay = await send('/api/location/resolve', payload());
  expect(replay.status).toBe(200); expect(replay.body.snapshot_id).toBe(first.body.snapshot_id);
  expect(environment).toHaveBeenCalledTimes(1); expect(await rows()).toHaveLength(1);
});

test('simultaneous identical-coordinate captures share provider work and return the saved GPS receipt', async () => {
  const releases = [];
  const data = payload();
  const ready = completeSnapshot({ lat: data.lat, lng: data.lng, createdAt: new Date() });
  environment.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
  const first = send('/api/snapshot', data).then(result => result);
  const second = send('/api/location/resolve', { ...data, accuracy: 8 }).then(result => result);
  while (assertAdmission.mock.calls.length < 2 || !releases.length) await new Promise(resolve => setImmediate(resolve));
  const providers = { location: location.mock.calls.length, environment: environment.mock.calls.length };
  // Settle every captured promise in the baseline too, so an assertion failure
  // cannot strand either HTTP request.
  for (const release of releases) release({ weather: ready.weather, air: ready.air });
  const responses = await Promise.all([first, second]);
  expect(providers).toEqual({ location: 1, environment: 1 });
  expect(responses.map(result => result.status)).toEqual([201, 200]);
  const [saved] = await rows();
  expect(await rows()).toHaveLength(1);
  for (const result of responses) {
    expect(result.body).toMatchObject({ snapshot_id: saved.snapshot_id, lat: saved.lat, lng: saved.lng,
      gps_timestamp: Date.parse(saved.permissions.observed_at), accuracy: saved.permissions.accuracy_m });
  }
});

test('after a failed capture the next attempt performs fresh provider work', async () => {
  location.mockRejectedValueOnce(new Error('fixture reverse geocode outage'));
  expect((await send('/api/snapshot', payload())).status).toBe(502);
  expect((await send('/api/snapshot', payload())).status).toBe(201);
  expect(location).toHaveBeenCalledTimes(2);
  expect(environment).toHaveBeenCalledTimes(2);
});

test.each(['/api/snapshot', '/api/location/snapshot', '/api/location/resolve'])('%s classifies collection failure without exposing provider details', async path => {
  location.mockRejectedValueOnce(new Error('HTTP 503 https://example.invalid/?key=private-fixture-secret'));
  const result = await send(path, payload());
  expect(result.status).toBe(502);
  expect(result.body).toEqual({ ok: false, error: 'snapshot_collection_failed',
    message: 'Current location details could not be collected. Use Refresh to try again.' });
  expect(JSON.stringify(result.body)).not.toContain('private-fixture-secret');
  expect(recordError).toHaveBeenCalledWith({ userId: owner, sessionId: session }, runId, 'snapshot_collection_failed');
  expect(await rows()).toHaveLength(0);
});

test.each(['/api/snapshot', '/api/location/snapshot', '/api/location/resolve'])('%s hides unclassified failures instead of trusting upstream status or code', async path => {
  assertAdmission.mockRejectedValueOnce(Object.assign(new Error('private database detail'), { status: 403, code: 'upstream_private_code' }));
  const result = await send(path, payload());
  expect(result.status).toBe(500);
  expect(result.body).toEqual({ ok: false, error: 'snapshot_failed',
    message: 'Saved location could not be prepared. Use Refresh to try again.' });
  expect(location).not.toHaveBeenCalled();
  expect(environment).not.toHaveBeenCalled();
  expect(await rows()).toHaveLength(0);
});

test('simultaneous distinct full-precision fixes do not share sources; every reply describes the single saved winner', async () => {
  const firstInput = payload();
  const secondInput = { ...firstInput, lat: firstInput.lat + 0.00000001, accuracy: 8, gps_timestamp: firstInput.gps_timestamp + 1 };
  const releases = [];
  environment.mockImplementation((lat, lng) => new Promise(resolve => {
    const row = completeSnapshot({ lat, lng, createdAt: new Date() });
    releases.push(() => resolve({ weather: row.weather, air: row.air }));
  }));
  const first = send('/api/snapshot', firstInput).then(result => result);
  const second = send('/api/location/resolve', secondInput).then(result => result);
  while (releases.length < 2) await new Promise(resolve => setImmediate(resolve));
  releases[1]();
  const winner = await second;
  releases[0]();
  const loser = await first;
  expect(location).toHaveBeenCalledTimes(2);
  expect(environment).toHaveBeenCalledTimes(2);
  const [saved] = await rows();
  expect(saved.lat).toBe(secondInput.lat);
  expect(await rows()).toHaveLength(1);
  for (const result of [winner, loser]) expect(result.body).toMatchObject({ snapshot_id: saved.snapshot_id,
    lat: secondInput.lat, lng: secondInput.lng, accuracy: secondInput.accuracy, gps_timestamp: secondInput.gps_timestamp });
});

test('missing historical GPS receipt stays unavailable instead of borrowing the creation time', () => {
  const response = snapshotResponse(completeSnapshot(), runId);
  expect(response.gps_timestamp).toBeNull();
  expect(response.accuracy).toBeNull();
});

test('superseded provider response cannot bind or become current success', async () => {
  environment.mockImplementationOnce(async () => { allowed = false; const row = completeSnapshot({ createdAt: new Date(), lat: payload().lat, lng: payload().lng }); return { weather: row.weather, air: row.air }; });
  expect((await send('/api/snapshot', payload())).status).toBe(409);
  expect(await rows()).toHaveLength(0);
});

test('a fresh attempt cannot use an earlier completed source to hide missing required provider data', async () => {
  const first = await send('/api/snapshot', payload());
  admission.snapshot_id = null; admission.created_at = new Date(Date.now() - 1);
  environment.mockRejectedValueOnce(new Error('required provider failed'));
  const next = await send('/api/snapshot', payload());
  expect(next.status).toBe(502); expect(next.body.ok).toBe(false);
  expect((await rows()).map(row => row.snapshot_id)).toEqual([first.body.snapshot_id]);
});

test.each([
  ['denied permission', data => { data.permission = 'denied'; }],
  ['stale GPS', data => { data.gps_timestamp = Date.now() - 120000; }],
  ['GPS predates admission', data => { data.gps_timestamp = Date.now() - 15000; }],
  ['invalid accuracy', data => { data.accuracy = 0; }],
  ['boolean accuracy', data => { data.accuracy = true; }],
  ['array accuracy', data => { data.accuracy = [5]; }],
  ['missing coordinate', data => { delete data.lng; }],
])('%s blocks before provider work', async (_label, change) => {
  const data = payload(); change(data);
  expect((await send('/api/snapshot', data)).status).toBe(400);
  expect(environment).not.toHaveBeenCalled(); expect(location).not.toHaveBeenCalled(); expect(await rows()).toHaveLength(0);
});

test('unresolved current market cannot inherit the home profile or become ready', async () => {
  market.mockResolvedValue(null);
  const result = await send('/api/snapshot', payload());
  expect(result.status).toBe(422); expect(result.body.error).toBe('snapshot_incomplete');
  expect(await rows()).toHaveLength(0);
});

test.each([true, false])('owned historical GET reports actual readiness without generation, complete=%s', async complete => {
  const row = completeSnapshot(); if (!complete) row.weather = null;
  await actualDb.insert(snapshots).values(row);
  const result = await request(app).get('/api/snapshot/' + row.snapshot_id);
  expect(result.status).toBe(200); expect(result.body.status).toBe(complete ? 'ok' : 'pending');
  expect(result.body.missing_fields).toEqual(complete ? [] : ['weather']);
  expect(environment).not.toHaveBeenCalled();
});

test.each([
  ['2026-03-08T06:59:00Z', '2026-03-08T01:59:00', -300],
  ['2026-03-08T07:01:00Z', '2026-03-08T03:01:00', -240],
  ['2026-11-01T05:30:00Z', '2026-11-01T01:30:00', -240],
  ['2026-11-01T06:30:00Z', '2026-11-01T01:30:00', -300],
])('DB/API preserve true instant %s and separate DST wall time %s', async (instant, wall, offsetMinutes) => {
  const fixture = completeSnapshot({ createdAt: instant });
  const [saved] = await actualDb.insert(snapshots).values(fixture).returning();
  const raw = (await pg.query('SELECT local_iso::text AS wall, created_at FROM snapshots')).rows[0];
  expect(raw.wall.replace(' ', 'T')).toBe(wall);
  expect(new Date(raw.created_at).toISOString()).toBe(new Date(instant).toISOString());
  expect(saved.created_at.toISOString()).toBe(new Date(instant).toISOString());
  const response = JSON.parse(JSON.stringify(snapshotResponse(saved, runId)));
  expect(response.created_at).toBe(new Date(instant).toISOString());
  expect(response.local_iso).toBe(wall);
  expect((Date.parse(wall + 'Z') - Date.parse(response.created_at)) / 60000).toBe(offsetMinutes);
  expect(getSnapshotReadiness(saved).ready).toBe(true);
  const fetched = await request(app).get('/api/snapshot/' + saved.snapshot_id);
  expect(fetched.body.local_iso).toBe(wall);
  expect(fetched.body.created_at).toBe(response.created_at);
});

test.each(['/api/snapshot/drop', '/api/location/release-snapshot'])('%s preserves earlier source rows and requires Continue', async path => {
  await actualDb.insert(snapshots).values(completeSnapshot());
  expect((await request(app).post(path).send({})).status).toBe(409);
  expect(await rows()).toHaveLength(1);
});
