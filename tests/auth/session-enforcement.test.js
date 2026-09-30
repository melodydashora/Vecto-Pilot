import { beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import process from 'node:process';
import { PgDialect } from 'drizzle-orm/pg-core';

const originalSecret = process.env.JWT_SECRET;
const originalAgentSecret = process.env.VECTO_AGENT_SECRET;
process.env.JWT_SECRET = 'synthetic-auth-regression-secret-for-jwt';
process.env.VECTO_AGENT_SECRET = 'synthetic-agent-regression-secret';
let session, beforeUpdate, pendingUpdate;
const dialect = new PgDialect();
const { structuredClone } = globalThis;
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => session ? [structuredClone(session)] : [] }) }) }),
  update: () => ({ set: values => ({ where: condition => {
    const query = dialect.sqlToQuery(condition);
    pendingUpdate = (async () => {
      await beforeUpdate?.();
      const equal = (actual, expected) => actual == null ? expected == null :
        actual instanceof Date || expected instanceof Date ? new Date(actual).getTime() === new Date(expected).getTime() : actual === expected;
      const comparisons = [...query.sql.matchAll(/"users"\."([^"]+)"\s*(?:=|IS NOT DISTINCT FROM)\s*\$(\d+)/g)];
      if (!session || !comparisons.every(([, column, index]) => equal(session[column], query.params[Number(index) - 1]))) return [];
      for (const [key, value] of Object.entries(values)) {
        if (typeof value?.getSQL === 'function') {
          const expression = dialect.sqlToQuery(value);
          if (!expression.sql.startsWith('GREATEST(')) throw new Error('Unsupported activity expression');
          session[key] = new Date(Math.max(new Date(session[key] || 0).getTime(), new Date(expression.params[0]).getTime()));
        } else session[key] = value;
      }
      return [structuredClone(session)];
    })();
    pendingUpdate.returning = () => pendingUpdate;
    return pendingUpdate;
  } }) }),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  authLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  matrixLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const { requireAuth, optionalAuth } = await import('../../server/middleware/auth.js');
const { signJWT } = await import('../../server/lib/jwt.js');
const userId = 'synthetic-user-123';
beforeEach(() => {
  session = { user_id: userId, session_id: 'current-session-123', session_start_at: new Date(), last_active_at: new Date() };
  beforeUpdate = null;
  pendingUpdate = null;
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
  if (originalAgentSecret === undefined) delete process.env.VECTO_AGENT_SECRET; else process.env.VECTO_AGENT_SECRET = originalAgentSecret;
});
async function invoke(headers, middleware = requireAuth) {
  const req = { headers, path: '/test' };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  const next = jest.fn();
  await middleware(req, res, next);
  return { req, res, next };
}
test('session-bound token works only for its original live session', async () => {
  const token = await signJWT({ sub: userId, sid: session.session_id });
  expect((await invoke({ authorization: 'Bearer ' + token })).next).toHaveBeenCalled();
  session.session_id = null;
  expect((await invoke({ authorization: 'Bearer ' + token })).res.statusCode).toBe(401);
  session.session_id = 'another-session-456';
  const result = await invoke({ authorization: 'Bearer ' + token });
  expect(result.res.statusCode).toBe(401);
  expect(result.next).not.toHaveBeenCalled();
});
test('pre-migration JWTs retain explicit compatibility while the live session is valid', async () => {
  const token = await signJWT({ sub: userId });
  expect((await invoke({ authorization: 'Bearer ' + token })).next).toHaveBeenCalled();
});
test.each([59 * 60 * 1000, 60 * 60 * 1000 - 1000])('a driver returning after %s ms inactive keeps the same session and current data', async inactiveMs => {
  const activity = new Date(Date.now() - inactiveMs);
  session.session_start_at = activity;
  session.last_active_at = activity;
  session.current_snapshot_id = 'same-snapshot';
  session.current_main_run_id = 'same-run';
  const token = await signJWT({ sub: userId, sid: session.session_id });
  const result = await invoke({ authorization: 'Bearer ' + token });
  await pendingUpdate;
  expect(result.res.statusCode).toBe(200);
  expect(result.next).toHaveBeenCalledTimes(1);
  expect(result.req.auth).toMatchObject({ sessionId: 'current-session-123', currentSnapshotId: 'same-snapshot' });
  expect(session).toMatchObject({ session_id: 'current-session-123',
    current_snapshot_id: 'same-snapshot', current_main_run_id: 'same-run' });
  expect(session.last_active_at.getTime()).toBeGreaterThan(activity.getTime());
});
test('optional service authentication uses the returned userId and attribution', async () => {
  const result = await invoke({ 'x-vecto-agent-secret': process.env.VECTO_AGENT_SECRET }, optionalAuth);
  expect(result.next).toHaveBeenCalled();
  expect(typeof result.req.auth.userId).toBe('string');
  expect(result.req.auth).toMatchObject({ isAgent: true, tokenSource: 'vecto-secret' });
});

test.each(['hard expiry', 'idle expiry', 'activity'])('a delayed %s write cannot change a newer session', async kind => {
  if (kind === 'hard expiry') session.session_start_at = new Date(Date.now() - 3 * 60 * 60 * 1000);
  if (kind === 'idle expiry') {
    session.session_start_at = new Date(Date.now() - 110 * 60 * 1000);
    session.last_active_at = new Date(Date.now() - 90 * 60 * 1000);
  }
  const token = await signJWT({ sub: userId, sid: session.session_id });
  let reachedWrite, releaseWrite;
  const atWrite = new Promise(resolve => { reachedWrite = resolve; });
  const resume = new Promise(resolve => { releaseWrite = resolve; });
  beforeUpdate = async () => { reachedWrite(); await resume; };

  const pending = invoke({ authorization: 'Bearer ' + token });
  await atWrite;
  const newer = { user_id: userId, session_id: 'new-session-456', current_snapshot_id: 'new-snapshot', session_start_at: new Date(), last_active_at: new Date(Date.now() + 1000) };
  session = { ...newer };
  releaseWrite();
  const result = await pending;
  await pendingUpdate;

  expect(session).toEqual(newer);
  if (kind === 'activity') expect(result.next).toHaveBeenCalled();
  else expect(result.res.statusCode).toBe(401);
});

test.each(['session_start_at', 'last_active_at'])('request authentication rejects malformed %s just as MAIN publication does', async column => {
  session[column] = 'invalid-timestamp';
  const token = await signJWT({ sub: userId, sid: session.session_id });
  const result = await invoke({ authorization: 'Bearer ' + token });
  expect(result.res.statusCode).toBe(401);
  expect(result.next).not.toHaveBeenCalled();
});


test('a late activity write cannot move the same session clock backwards', async () => {
  const token = await signJWT({ sub: userId, sid: session.session_id });
  let reachedWrite, releaseWrite;
  const atWrite = new Promise(resolve => { reachedWrite = resolve; });
  const resume = new Promise(resolve => { releaseWrite = resolve; });
  beforeUpdate = async () => { reachedWrite(); await resume; };
  const pending = invoke({ authorization: 'Bearer ' + token });
  await atWrite;
  const newer = new Date(Date.now() + 1000);
  session.last_active_at = newer;
  releaseWrite();
  await pending; await pendingUpdate;
  expect(session.last_active_at).toEqual(newer);
});

test('stale inactivity cleanup cannot log out a session renewed after its read', async () => {
  session.session_start_at = new Date(Date.now() - 110 * 60 * 1000);
  session.last_active_at = new Date(Date.now() - 65 * 60 * 1000);
  const token = await signJWT({ sub: userId, sid: session.session_id });
  let reachedWrite, releaseWrite;
  const atWrite = new Promise(resolve => { reachedWrite = resolve; });
  const resume = new Promise(resolve => { releaseWrite = resolve; });
  beforeUpdate = async () => { reachedWrite(); await resume; };
  const pending = invoke({ authorization: 'Bearer ' + token });
  await atWrite;
  session.last_active_at = new Date();
  beforeUpdate = null;
  releaseWrite();
  const result = await pending; await pendingUpdate;
  expect(session.session_id).toBe('current-session-123');
  expect(result.next).toHaveBeenCalledTimes(1);
  expect(result.res.statusCode).toBe(200);
});
