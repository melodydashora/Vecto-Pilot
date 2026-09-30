import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../shared/schema.js';

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
  orm = drizzle(pg, { schema });
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM users');
  await pg.query(`INSERT INTO users(user_id, session_id, session_start_at, last_active_at, created_at, updated_at)
    VALUES ($1, $2, now() - interval '10 minutes', now() - interval '5 minutes', now(), now())`, [userId, sessionId]);
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
