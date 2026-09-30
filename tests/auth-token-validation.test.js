import { TextEncoder } from 'node:util';
import process from 'node:process';
// tests/auth-token-validation.test.js
// Issue #11 (Dec 2, 2025): UUID-format user IDs must authenticate.
//
// 2026-09-11 rewrite (Claude, sprint-20260911): the original test minted a legacy 2-segment
// HMAC token and expected requireAuth to call next() with NO session row. That has been
// impossible since session enforcement landed (2026-01-05: a users row with a live
// session_id is required; 2026-09-10 c0b6097b: sid binding) — the middleware logged
// "No session found ... requires re-login" and returned 401, so the suite failed on every
// run and it also queried the real DATABASE_URL. The assertion was stale, not the code.
// Issue #11's real claim is kept (a UUID subject in a legacy HMAC token authenticates when
// its session is live) and the contract that made the old assertion wrong is now asserted
// explicitly, against a mocked session store. Legacy HMAC removal is todo #32 Phase 1.5.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-auth-token-validation-32-chars-min';

import crypto from 'crypto';
import { SignJWT } from 'jose';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

let readError = null;
let sessionRow = null;          // what db.select().from(users).where(...).limit(1) returns
const updates = [];             // db.update(...).set(v) calls (session clears, last_active bumps)
const quiet = () => {};
jest.unstable_mockModule('../server/logger/workflow.js', () => ({
  authLog: { warn: quiet, error: quiet, info: quiet, debug: quiet },
  matrixLog: { info: quiet, warn: quiet, error: quiet },
}));
jest.unstable_mockModule('../server/db/drizzle.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (readError) throw readError; return sessionRow ? [sessionRow] : []; } }) }) }),
    update: () => ({ set: (v) => ({ where: () => {
      updates.push(v);
      return { catch: () => Promise.resolve(), returning: async () => { sessionRow = { ...sessionRow, ...v }; return [sessionRow]; } };
    } }) }),
  },
}));
const { requireAuth, isRequestAuthCurrent } = await import('../server/middleware/auth.js');
const { signJWT } = await import('../server/lib/jwt.js');

const TEST_UUID = 'ab85999f-e9aa-49c1-a77f-5723c5c80356';
const legacyToken = (userId) => `${userId}.${crypto.createHmac('sha256', process.env.JWT_SECRET).update(userId).digest('hex')}`;
const liveSession = (overrides = {}) => ({
  user_id: TEST_UUID, session_id: 'session-live-1', current_snapshot_id: null,
  session_start_at: new Date(), last_active_at: new Date(), ...overrides,
});

function run(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  let sent = null;
  const res = { status: (code) => ({ json: (data) => { sent = { code, data }; return sent; } }), json: (data) => { sent = { code: 200, data }; return sent; } };
  let nextCalled = false;
  return requireAuth(req, res, () => { nextCalled = true; }).then(() => ({ req, sent, nextCalled }));
}

beforeEach(() => { readError = null; sessionRow = null; updates.length = 0; });

describe('Auth Token Validation (Issue #11) — current requireAuth contract', () => {
  it('UUID subject in a legacy HMAC token authenticates when its session is live', async () => {
    sessionRow = liveSession();
    const { req, nextCalled } = await run(legacyToken(TEST_UUID));
    expect(nextCalled).toBe(true);
    expect(req.auth).toMatchObject({ userId: TEST_UUID, sessionId: 'session-live-1' });
    const activity = updates.find(u => u.last_active_at)?.last_active_at;
    const query = new PgDialect().sqlToQuery(activity);
    expect(query.sql).toMatch(/GREATEST\(/i); // delayed requests cannot regress the sliding window
    expect(query.sql).toContain('last_active_at');
    expect(query.params.some(value => value instanceof Date)).toBe(true);
  });

  it('the same token is rejected with 401 session_expired when no session row exists (what the 2025 test wrongly expected to pass)', async () => {
    sessionRow = null;
    const { req, sent, nextCalled } = await run(legacyToken(TEST_UUID));
    expect(nextCalled).toBe(false);
    expect(req.auth).toBeUndefined();
    expect(sent).toMatchObject({ code: 401, data: { error: 'session_expired' } });
  });

  it('a logged-out row (session_id null) is rejected', async () => {
    sessionRow = liveSession({ session_id: null });
    const { sent, nextCalled } = await run(legacyToken(TEST_UUID));
    expect(nextCalled).toBe(false);
    expect(sent).toMatchObject({ code: 401, data: { error: 'session_expired' } });
  });

  it('a tampered legacy signature is rejected as invalid', async () => {
    sessionRow = liveSession();
    const { sent, nextCalled } = await run(`${TEST_UUID}.deadbeef`);
    expect(nextCalled).toBe(false);
    expect(sent.code).toBe(401);
  });

  it('a JWT bound to the live session (sid) authenticates; one bound to a superseded session does not', async () => {
    sessionRow = liveSession({ session_id: 'session-live-1' });
    const current = await run(await signJWT({ sub: TEST_UUID, sid: 'session-live-1' }));
    expect(current.nextCalled).toBe(true);
    expect(current.req.auth.userId).toBe(TEST_UUID);
    const stale = await run(await signJWT({ sub: TEST_UUID, sid: 'session-older-0' }));
    expect(stale.nextCalled).toBe(false);
    expect(stale.sent).toMatchObject({ code: 401, data: { error: 'session_expired' } });
  });

  it('a session past the 2-hour hard limit is cleared and rejected', async () => {
    sessionRow = liveSession({ session_start_at: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    const { sent, nextCalled } = await run(legacyToken(TEST_UUID));
    expect(nextCalled).toBe(false);
    expect(sent.code).toBe(401);
    expect(updates.some(u => u.session_id === null)).toBe(true);
  });
});


describe('non-mutating authorization for a captured stream', () => {
  const captured = token => ({ headers: { authorization: `Bearer ${token}` }, auth: { userId: TEST_UUID, sessionId: 'session-live-1' } });
  it.each(['jwt', 'legacy'])('rechecks %s credentials and the captured session without updating activity', async kind => {
    sessionRow = liveSession();
    const token = kind === 'jwt' ? await signJWT({ sub: TEST_UUID, sid: 'session-live-1' }) : legacyToken(TEST_UUID);
    const req = captured(token);
    expect(await isRequestAuthCurrent(req)).toBe(true);
    sessionRow = liveSession({ session_id: 'session-live-2' });
    expect(await isRequestAuthCurrent(req)).toBe(false);
    expect(updates).toEqual([]);
  });
  it('rejects logout, invalid clocks, idle/hard expiry and database errors', async () => {
    const req = captured(await signJWT({ sub: TEST_UUID, sid: 'session-live-1' }));
    for (const row of [null, liveSession({ session_id: null }), liveSession({ last_active_at: 'bad' }),
      liveSession({ session_start_at: new Date(Date.now() - 90 * 60000), last_active_at: new Date(Date.now() - 70 * 60000) }),
      liveSession({ session_start_at: new Date(Date.now() - 3 * 3600000) })]) {
      sessionRow = row;
      expect(await isRequestAuthCurrent(req)).toBe(false);
    }
    sessionRow = liveSession(); readError = new Error('synthetic outage');
    expect(await isRequestAuthCurrent(req)).toBe(false);
    expect(updates).toEqual([]);
  });
  it('rejects expired or replaced credentials even while the database session is live', async () => {
    sessionRow = liveSession();
    const expired = await new SignJWT({ sid: 'session-live-1' }).setProtectedHeader({ alg: 'HS256' }).setSubject(TEST_UUID)
      .setIssuer('vecto-pilot').setAudience('vecto-pilot-api').setExpirationTime(1)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    for (const token of [expired, `${TEST_UUID}.invalid`, await signJWT({ sub: '22222222-2222-4222-8222-222222222222', sid: 'session-live-1' }),
      await signJWT({ sub: TEST_UUID, sid: 'session-live-2' })]) expect(await isRequestAuthCurrent(captured(token))).toBe(false);
    expect(updates).toEqual([]);
  });
  it.each([['x-vecto-agent-secret', 'VECTO_AGENT_SECRET', 'vecto-secret'], ['x-claude-bridge-token', 'CLAUDE_BRIDGE_TOKEN', 'claude-bridge']])('revalidates agent credential rotation for %s', async (header, envName, source) => {
    const previous = process.env[envName];
    process.env[envName] = 'synthetic-agent-secret-for-unit-tests';
    const req = { headers: { [header]: process.env[envName] }, auth: { userId: '00000000-0000-0000-0000-000000000001', isAgent: true, tokenSource: source } };
    readError = new Error('agent must not read a driver session');
    try {
      expect(await isRequestAuthCurrent(req)).toBe(true);
      req.auth.tokenSource = 'different-source';
      expect(await isRequestAuthCurrent(req)).toBe(false);
      req.auth.tokenSource = source;
      process.env[envName] = 'rotated-synthetic-agent-secret';
      expect(await isRequestAuthCurrent(req)).toBe(false);
      delete process.env[envName];
      expect(await isRequestAuthCurrent(req)).toBe(false);
      expect(updates).toEqual([]);
    } finally { if (previous === undefined) delete process.env[envName]; else process.env[envName] = previous; }
  });
});
