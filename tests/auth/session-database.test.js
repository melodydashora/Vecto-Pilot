import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../shared/schema.js';
import { createDriverSession } from '../../server/lib/auth/driver-session.js';

// Exercise generated session SQL on isolated PostgreSQL; no workspace connection.
let pg, orm;
const userId = '00000000-0000-4000-8000-000000000003';
const sessionId = '00000000-0000-4000-8000-000000000004';
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/jwt.js', () => ({ verifyJWT: async () => ({ userId, sessionId }) }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  authLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  matrixLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const { requireAuth } = await import('../../server/middleware/auth.js');
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE users (user_id uuid PRIMARY KEY, session_id uuid, current_snapshot_id uuid,
    current_main_run_id uuid, session_start_at timestamptz, last_active_at timestamptz,
    created_at timestamptz, updated_at timestamptz);`);
  for (const table of [schema.driver_profiles, schema.driver_vehicles]) {
    const { name, columns } = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${name}" (${columns.map(column => `"${column.name}" ${column.getSQLType()}`).join(', ')})`);
  }
  orm = drizzle(pg, { schema });
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM users; DELETE FROM driver_profiles; DELETE FROM driver_vehicles');
  await pg.query(`INSERT INTO users(user_id, session_id, session_start_at, last_active_at, created_at, updated_at)
    VALUES ($1, $2, now() - interval '10 minutes', now() - interval '5 minutes', now(), now())`, [userId, sessionId]);
  await pg.query('INSERT INTO driver_profiles(id,user_id) VALUES ($1,$2)', [userId, userId]);
});
afterAll(async () => { await pg?.close(); });
async function authenticate() {
  const req = { headers: { authorization: 'Bearer synthetic.test.token' } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const next = jest.fn();
  await requireAuth(req, res, next);
  return { req, res, next };
}
test('live authentication advances the PostgreSQL activity clock and retains session identity', async () => {
  const result = await authenticate();
  expect(result.next).toHaveBeenCalledTimes(1);
  const saved = (await pg.query('SELECT session_id, last_active_at FROM users')).rows[0];
  expect(saved.session_id).toBe(sessionId);
  expect(new Date(saved.last_active_at).getTime()).toBeGreaterThan(Date.now() - 10000);
});
test.each(['session_start_at', 'last_active_at'])('expired %s clears the captured session and both pointers', async column => {
  await pg.exec(`UPDATE users SET ${column} = now() - interval '3 hours', current_main_run_id = '${sessionId}', current_snapshot_id = '${sessionId}'`);
  // Keep timestamps ordered so this is expiration, not corrupt-session rejection.
  if (column === 'last_active_at') await pg.exec("UPDATE users SET session_start_at = now() - interval '4 hours'");
  const result = await authenticate();
  expect(result.res.statusCode).toBe(401);
  expect(result.next).not.toHaveBeenCalled();
  expect((await pg.query('SELECT session_id,current_main_run_id,current_snapshot_id FROM users')).rows[0])
    .toEqual({ session_id: null, current_main_run_id: null, current_snapshot_id: null });
});
test.each(['NULL', "'infinity'"])('invalid PostgreSQL timestamp %s rejects without serializing an invalid date into a write', async value => {
  await pg.exec(`UPDATE users SET session_start_at = ${value}`);
  const result = await authenticate();
  expect(result.res.statusCode).toBe(401);
  expect(result.next).not.toHaveBeenCalled();
});

test('admission rejects an existing 59-minute session using actual PostgreSQL timestamps and retains its pointers', async () => {
  await pg.query(`UPDATE users SET session_start_at=now()-interval '59 minutes', last_active_at=now()-interval '59 minutes',
    current_snapshot_id=$1,current_main_run_id=$1`, [sessionId]);
  const before = (await pg.query('SELECT * FROM users')).rows;
  await expect(orm.transaction(tx => createDriverSession(tx, userId, '00000000-0000-4000-8000-000000000005')))
    .rejects.toMatchObject({ code: 'session_already_active' });
  expect((await pg.query('SELECT * FROM users')).rows).toEqual(before);
  expect((await authenticate()).next).toHaveBeenCalledTimes(1);
});

test('61-minute inactivity expires within the two-hour hard limit and permits a fresh login', async () => {
  await pg.exec("UPDATE users SET session_start_at=now()-interval '90 minutes',last_active_at=now()-interval '61 minutes'");
  expect((await authenticate()).res.statusCode).toBe(401);
  const nextSession = '00000000-0000-4000-8000-000000000005';
  await orm.transaction(tx => createDriverSession(tx, userId, nextSession));
  expect((await pg.query('SELECT session_id,current_snapshot_id,current_main_run_id FROM users')).rows[0])
    .toEqual({ session_id: nextSession, current_snapshot_id: null, current_main_run_id: null });
});

test('overlapping isolated database admissions yield one winner without replacing its session', async () => {
  await pg.exec('UPDATE users SET session_id=NULL');
  const sessions = ['00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006'];
  const outcomes = await Promise.allSettled(sessions.map(id => orm.transaction(tx => createDriverSession(tx, userId, id))));
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find(result => result.status === 'rejected').reason).toMatchObject({ code: 'session_already_active' });
  const winner = sessions[outcomes.findIndex(result => result.status === 'fulfilled')];
  expect((await pg.query('SELECT session_id FROM users')).rows[0].session_id).toBe(winner);
});
