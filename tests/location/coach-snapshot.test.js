import { beforeAll, beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq, desc } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import * as schema from '../../shared/schema.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { excludeCoachSnapshots } from '../../server/lib/location/snapshot-purpose.js';

// Real SQL and session locks in disposable PostgreSQL memory. No live providers,
// gateway, MAIN generation or workspace database writes.
let pg, orm, auth, app;
const owner = '00000000-0000-4000-8000-000000000111';
const session = '00000000-0000-4000-8000-000000000112';
const mainId = '00000000-0000-4000-8000-000000000113';
const runId = '00000000-0000-4000-8000-000000000114';
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
const location = jest.fn(), environment = jest.fn(), market = jest.fn(), cancelMain = jest.fn();
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, _res, next) { req.auth = { ...auth }; next(); } }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ locationLog: log, OP: {} }));
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ resolveFreshGpsLocation: location }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromMarket: market }));
jest.unstable_mockModule('../../server/lib/location/snapshot-environment.js', () => ({ snapshotEnvironment: { both: environment } }));
jest.unstable_mockModule('../../server/lib/briefing/briefing-generation.js', () => ({ cancelUpstreamBriefingGenerations: cancelMain }));
const { readOwnedCoachSnapshot, captureCoachSnapshot } = await import('../../server/lib/location/coach-snapshot.js');
const { default: coachRouter } = await import('../../server/api/rideshare-coach/index.js');
const resolved = { city: 'Fixture city', state: 'TX', country: 'US', formattedAddress: 'Fixture resolved address', timeZone: 'America/Chicago' };
const input = (extra = {}) => ({ captureId: randomUUID(), lat: 0, lng: -2.123456789, accuracy: 5, gps_timestamp: Date.now(), permission: 'granted', ...extra });
const capture = body => request(app).post('/api/coach/snapshot').send(body);
const latest = () => request(app).get('/api/coach/snapshot');
const direct = body => captureCoachSnapshot(auth, body.captureId, body);
const tick = () => new Promise(resolve => setImmediate(resolve));
const users = async () => (await pg.query('SELECT * FROM users')).rows;
const count = async () => (await pg.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n;
const savedFixture = (id, started, observed, extra = {}) => completeSnapshot({ snapshot_id: id, user_id: owner, session_id: session,
  createdAt: started, lat: 0, lng: -2.123456789, timezone: 'America/Chicago',
  permissions: { geolocation: 'granted', context_kind: 'coach', accuracy_m: 5, observed_at: new Date(observed).toISOString(), gps_timestamp: observed }, ...extra });

beforeAll(async () => {
  pg = new PGlite();
  for (const table of [schema.users, schema.snapshots]) {
    const { name, columns } = getTableConfig(table);
    const definitions = columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${['created_at', 'updated_at'].includes(column.name) ? ' DEFAULT now()' : ''}`);
    await pg.exec(`CREATE TABLE "${name}" (${definitions.join(', ')})`);
  }
  orm = drizzle(pg, { schema });
  app = express().use(express.json()).use('/api/coach', coachRouter);
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM snapshots; DELETE FROM users;');
  auth = { userId: owner, sessionId: session };
  await pg.query('INSERT INTO users(user_id,session_id,session_start_at,last_active_at,current_snapshot_id,current_main_run_id) VALUES ($1,$2,now(),now(),$3,$4)', [owner, session, mainId, runId]);
  jest.clearAllMocks();
  location.mockResolvedValue(resolved); market.mockResolvedValue({ market_name: 'Fixture market' });
  environment.mockImplementation(async (lat, lng) => {
    const complete = completeSnapshot({ lat, lng, createdAt: new Date(), timezone: 'America/Chicago' });
    return { weather: complete.weather, air: complete.air };
  });
});
afterAll(async () => { await pg?.close(); });

test('GET absent is explicit; POST collects complete independent source and never changes MAIN pointers or users', async () => {
  expect((await latest()).body).toEqual({ ok: true, snapshot: null });
  const before = await users();
  const body = input({ created_at: '2099-01-01', context_kind: 'upstream', weather: { tempF: 999 }, user_id: randomUUID() });
  const result = await capture(body).expect(201);
  expect(result.body).toMatchObject({ ok: true, context_kind: 'coach', snapshot_id: body.captureId, sourceSnapshotId: body.captureId,
    user_id: owner, sessionId: session, lat: body.lat, lng: body.lng, gps_timestamp: body.gps_timestamp,
    accuracy: 5, timeZone: 'America/Chicago', market: 'Fixture market', ready: true, weather: { tempF: 0 }, air: { aqi: 0 } });
  expect(result.body.created_at).not.toContain('2099');
  expect((await latest()).body).toEqual(result.body);
  expect(await users()).toEqual(before); expect(cancelMain).not.toHaveBeenCalled();
  expect(environment).toHaveBeenCalledWith(body.lat, body.lng, { scope: `coach:${body.captureId}` });
  expect((await readOwnedCoachSnapshot(auth, body.captureId)).permissions.context_kind).toBe('coach');
  expect(await count()).toBe(1);
});
test('idempotent delivery preserves the whole receipt and does not collect again', async () => {
  const body = input({ gps_timestamp: Date.now() - 10 + 0.25 }); const first = await capture(body).expect(201);
  const second = await capture(body).expect(201);
  expect(second.body).toEqual(first.body); expect(await count()).toBe(1);
  expect(first.body.gps_timestamp).toBe(body.gps_timestamp);
  expect(location).toHaveBeenCalledTimes(1); expect(environment).toHaveBeenCalledTimes(1);
});
test.each([{ lat: 1 }, { lng: 1 }, { accuracy: 6 }, { gps_timestamp: 1 }])('reusing a UUID with another observation rejects %j', async changed => {
  const body = input(); await capture(body).expect(201);
  await capture({ ...body, ...changed }).expect(409);
  expect(location).toHaveBeenCalledTimes(1); expect(await count()).toBe(1);
});
test('an old exact replay restores its original sensor receipt instead of pretending to capture fresh GPS', async () => {
  const observed = Date.now() - 60000; const id = randomUUID();
  const saved = savedFixture(id, new Date(observed), observed);
  await orm.insert(schema.snapshots).values(saved);
  const result = await capture(input({ captureId: id, gps_timestamp: observed })).expect(201);
  expect(result.body.gps_timestamp).toBe(observed); expect(result.body.snapshot_id).toBe(id);
  expect(location).not.toHaveBeenCalled(); expect(environment).not.toHaveBeenCalled();
});
test.each([{ lat: '0' }, { accuracy: 101 }, { accuracy: false }, { gps_timestamp: 0 }, { permission: 'denied' }, { captureId: 'invalid' }])('invalid new observation fails before providers: %j', async bad => {
  await capture(input(bad)).expect(400); expect(await count()).toBe(0); expect(location).not.toHaveBeenCalled();
});
test('failed newer provider work preserves the last good Coach snapshot and MAIN pointers', async () => {
  const previous = (await capture(input()).expect(201)).body; const before = await users();
  environment.mockRejectedValueOnce(new Error('synthetic provider failure'));
  const result = await capture(input({ lat: 2 })).expect(502);
  expect(result.body).toMatchObject({ ok: false, error: 'snapshot_collection_failed' });
  expect((await latest()).body.snapshot_id).toBe(previous.snapshot_id);
  expect(await users()).toEqual(before); expect(await count()).toBe(1); expect(cancelMain).not.toHaveBeenCalled();
});
test('late older completion remains immutable history while latest follows observed GPS time', async () => {
  let release;
  location.mockImplementation(lat => lat === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(resolved));
  const oldBody = input({ lat: 1, gps_timestamp: Date.now() - 5000 });
  const older = direct(oldBody);
  while (!release) await tick();
  const newBody = input({ lat: 2 }); const newer = await direct(newBody);
  release(resolved); const oldSaved = await older;
  expect(oldSaved.snapshot_id).toBe(oldBody.captureId);
  expect((await readOwnedCoachSnapshot(auth)).snapshot_id).toBe(newer.snapshot_id);
  expect((await latest()).body.snapshot_id).toBe(newBody.captureId);
  expect(await count()).toBe(2); expect(cancelMain).not.toHaveBeenCalled();
});
test('equal observations use collection start time, not completion order', async () => {
  const observed = Date.now() - 5000;
  const a = savedFixture(randomUUID(), new Date(observed + 1000), observed);
  const b = savedFixture(randomUUID(), new Date(observed + 2000), observed);
  await orm.insert(schema.snapshots).values(b); await orm.insert(schema.snapshots).values(a);
  expect((await readOwnedCoachSnapshot(auth)).snapshot_id).toBe(b.snapshot_id);
});
test('concurrent duplicate UUID receives one immutable row and shared provider work', async () => {
  let release;
  location.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const body = input(); const first = direct(body);
  while (!location.mock.calls.length) await tick();
  const second = direct(body); await tick();
  release(resolved);
  const [a, b] = await Promise.all([first, second]);
  expect(a).toEqual(b); expect(await count()).toBe(1); expect(location).toHaveBeenCalledTimes(1);
});
test('session replacement while collecting rejects publication without any pointer mutation', async () => {
  let release; location.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const pending = direct(input()).catch(error => error);
  while (!location.mock.calls.length) await tick();
  await pg.query('UPDATE users SET session_id=$1 WHERE user_id=$2', [randomUUID(), owner]);
  const changedSession = await users(); release(resolved);
  expect(await pending).toMatchObject({ status: 401, code: 'session_expired' });
  expect(await count()).toBe(0); expect(await users()).toEqual(changedSession);
});
test('current-session purpose and ownership are mandatory for explicit IDs; latest never falls back to other rows', async () => {
  const now = Date.now();
  for (const extra of [{ user_id: randomUUID() }, { session_id: randomUUID() }, { permissions: { geolocation: 'granted', context_kind: 'upstream' } }]) {
    const fixture = savedFixture(randomUUID(), new Date(now), now, extra);
    await orm.insert(schema.snapshots).values(fixture);
    await expect(readOwnedCoachSnapshot(auth, fixture.snapshot_id)).rejects.toMatchObject({ status: 409 });
  }
  expect(await readOwnedCoachSnapshot(auth)).toBeNull();
  await expect(readOwnedCoachSnapshot(auth, randomUUID())).rejects.toMatchObject({ status: 409 });
  await expect(readOwnedCoachSnapshot(auth, 'bad')).rejects.toMatchObject({ status: 400 });
});
test.each([{ userId: owner }, { userId: owner, sessionId: session, isAgent: true }, { userId: owner, sessionId: 'not-current' }])('invalid sessions fail before collection and restore: %j', async identity => {
  auth = identity; await capture(input()).expect(401); await latest().expect(401);
  expect(location).not.toHaveBeenCalled(); expect(await count()).toBe(0);
});
test('corrupt saved readiness fails explicitly instead of becoming no snapshot', async () => {
  const now = Date.now(); const bad = savedFixture(randomUUID(), new Date(now), now, { weather: null });
  await orm.insert(schema.snapshots).values(bad);
  const response = await latest().expect(422);
  expect(response.body.error).toBe('snapshot_incomplete'); expect(response.body.snapshot).toBeUndefined();
});
test('existing latest-workflow predicate excludes newer Coach rows and retains legacy purpose-less snapshots', async () => {
  const now = Date.now();
  const legacy = savedFixture(mainId, new Date(now - 1000), now - 1000, { permissions: { geolocation: 'granted' } });
  await orm.insert(schema.snapshots).values(legacy); await direct(input());
  const [selected] = await orm.select().from(schema.snapshots).where(excludeCoachSnapshots()).orderBy(desc(schema.snapshots.created_at)).limit(1);
  expect(selected.snapshot_id).toBe(mainId);
  expect((await orm.select().from(schema.snapshots).where(eq(schema.snapshots.snapshot_id, mainId)))[0].permissions).toEqual({ geolocation: 'granted' });
});
