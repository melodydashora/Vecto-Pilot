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
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

let sessionRow = null;          // what db.select().from(users).where(...).limit(1) returns
const updates = [];             // db.update(...).set(v) calls (session clears, last_active bumps)
const quiet = () => {};
jest.unstable_mockModule('../server/logger/workflow.js', () => ({
  authLog: { warn: quiet, error: quiet, info: quiet, debug: quiet },
  matrixLog: { info: quiet, warn: quiet, error: quiet },
}));
jest.unstable_mockModule('../server/db/drizzle.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (sessionRow ? [sessionRow] : []) }) }) }),
    update: () => ({ set: (v) => ({ where: async () => { updates.push(v); } }) }),
  },
}));
const { requireAuth } = await import('../server/middleware/auth.js');
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

beforeEach(() => { sessionRow = null; updates.length = 0; });

describe('Auth Token Validation (Issue #11) — current requireAuth contract', () => {
  it('UUID subject in a legacy HMAC token authenticates when its session is live', async () => {
    sessionRow = liveSession();
    const { req, nextCalled } = await run(legacyToken(TEST_UUID));
    expect(nextCalled).toBe(true);
    expect(req.auth).toMatchObject({ userId: TEST_UUID, sessionId: 'session-live-1' });
    expect(updates.some(u => u.last_active_at instanceof Date)).toBe(true); // sliding window extended
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
