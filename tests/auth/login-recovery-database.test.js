import { afterAll, beforeAll, beforeEach, expect, test } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { decodeJwt } from 'jose';
import * as schema from '../../shared/schema.js';
import { beginLoginAttempt, withLoginAttempt, completeLoginAttempt, recoverLoginAttempt, cancelLoginAttempt }
  from '../../server/lib/auth/login-recovery.js';
import { createDriverSession } from '../../server/lib/auth/driver-session.js';
import { signJWT } from '../../server/lib/jwt.js';

// Real generated SQL and real JWTs, disposable in-memory PostgreSQL only.
// Cross-connection lock scheduling is covered separately by the scratch-PG run.
let pg, db;
const oldSecret = process.env.JWT_SECRET;
const userId = '00000000-0000-4000-8000-000000000001';
const proof = 'a'.repeat(64);
beforeAll(async () => {
  process.env.JWT_SECRET = 'synthetic-login-recovery-test-secret';
  pg = new PGlite();
  await pg.exec(`CREATE TABLE users (user_id uuid PRIMARY KEY, session_id uuid, current_snapshot_id uuid,
    current_main_run_id uuid, session_start_at timestamptz NOT NULL DEFAULT now(),
    last_active_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now())`);
  for (const table of [schema.driver_profiles, schema.driver_vehicles]) {
    const { name, columns } = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${name}" (${columns.map(column => `"${column.name}" ${column.getSQLType()}`).join(', ')})`);
  }
  const migration = await readFile(new URL('../../migrations/20261005_login_recovery.sql', import.meta.url), 'utf8');
  await pg.exec(migration);
  await pg.exec(migration);
  db = drizzle(pg, { schema });
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM auth_login_attempts; DELETE FROM driver_vehicles; DELETE FROM driver_profiles; DELETE FROM users');
  await pg.query('INSERT INTO users(user_id) VALUES ($1)', [userId]);
  await pg.query('INSERT INTO driver_profiles(id,user_id,first_name,email,settings_revision) VALUES ($1,$1,$2,$3,1)',
    [userId, 'Synthetic', 'test@example.test']);
});
afterAll(async () => {
  await pg?.close();
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
});
async function complete(attempt, flags = {}) {
  return withLoginAttempt(db, attempt, async tx => {
    const sessionId = randomUUID();
    const created = await createDriverSession(tx, userId, sessionId);
    const token = await signJWT({ sub: userId, sid: sessionId, issuedAt: created.sessionStartedAt });
    await completeLoginAttempt(tx, attempt, { userId, sessionId, ...flags });
    return { sessionId, token };
  });
}

test('migration constraints reject malformed receipts and overlapping claims have one owner', async () => {
  const claims = await Promise.all([beginLoginAttempt(db, proof, 'password'), beginLoginAttempt(db, proof, 'password')]);
  expect(claims.filter(result => result.claimed)).toHaveLength(1);
  expect(claims[0].attempt.attempt_id).toBe(claims[1].attempt.attempt_id);
  expect((await pg.query('SELECT proof_hash FROM auth_login_attempts')).rows[0].proof_hash).not.toBe(proof);
  await expect(pg.exec("UPDATE auth_login_attempts SET status='completed'"))
    .rejects.toMatchObject({ code: '23514' });
});

test('completed recovery preserves JWT, pointer identities, clock and Google response flags', async () => {
  const { attempt } = await beginLoginAttempt(db, proof, 'google');
  const original = await complete(attempt, { isNewUser: true, passwordRevoked: true });
  await pg.query('UPDATE users SET current_snapshot_id=$1,current_main_run_id=$1', [randomUUID()]);
  const before = (await pg.query('SELECT * FROM users')).rows[0];
  const recovered = await recoverLoginAttempt(db, proof);
  expect(recovered.status).toBe(200);
  expect(recovered.body).toMatchObject({ token: original.token, sessionId: original.sessionId, isNewUser: true, passwordRevoked: true });
  expect(decodeJwt(recovered.body.token).exp - decodeJwt(recovered.body.token).iat).toBe(7200);
  expect((await pg.query('SELECT * FROM users')).rows[0]).toEqual(before);
});

test('unknown recovery and cancellation before arrival cannot manufacture a login', async () => {
  expect((await recoverLoginAttempt(db, proof)).status).toBe(202);
  expect((await cancelLoginAttempt(db, proof)).status).toBe(200);
  const claim = await beginLoginAttempt(db, proof, 'password');
  expect(claim.claimed).toBe(false);
  expect(claim.attempt.status).toBe('cancelled');
  await expect(complete(claim.attempt)).rejects.toMatchObject({ code: 'login_attempt_ended' });
  expect((await pg.query('SELECT session_id FROM users')).rows[0].session_id).toBeNull();
});

test('expired processing receipt refuses late finalization and becomes terminal', async () => {
  const { attempt } = await beginLoginAttempt(db, proof, 'password');
  await pg.exec("UPDATE auth_login_attempts SET expires_at=now()-interval '1 second'");
  await expect(complete(attempt)).rejects.toMatchObject({ code: 'login_attempt_ended' });
  expect((await recoverLoginAttempt(db, proof)).status).toBe(410);
  expect((await pg.query('SELECT session_id FROM users')).rows[0].session_id).toBeNull();
});

test('completed recovery survives the work deadline but never renews inactive or hard-expired sessions', async () => {
  const { attempt } = await beginLoginAttempt(db, proof, 'password');
  await complete(attempt);
  await pg.exec("UPDATE auth_login_attempts SET expires_at=now()-interval '11 minutes'");
  expect((await recoverLoginAttempt(db, proof)).status).toBe(200);
  await pg.exec("UPDATE users SET session_start_at=now()-interval '90 minutes',last_active_at=now()-interval '61 minutes'");
  const before = (await pg.query('SELECT * FROM users')).rows[0];
  expect((await recoverLoginAttempt(db, proof)).status).toBe(410);
  expect((await pg.query('SELECT * FROM users')).rows[0]).toEqual(before);
  await pg.exec("UPDATE users SET session_start_at=now()-interval '121 minutes',last_active_at=now()");
  expect((await recoverLoginAttempt(db, proof)).status).toBe(410);
});

test('repeated cancellation cannot revoke a later unrelated session', async () => {
  const { attempt } = await beginLoginAttempt(db, proof, 'password');
  await complete(attempt);
  await cancelLoginAttempt(db, proof);
  expect((await recoverLoginAttempt(db, proof)).status).toBe(410);
  const nextId = randomUUID();
  await db.transaction(tx => createDriverSession(tx, userId, nextId));
  const before = (await pg.query('SELECT * FROM users')).rows[0];
  await cancelLoginAttempt(db, proof);
  expect((await pg.query('SELECT * FROM users')).rows[0]).toEqual(before);
});
