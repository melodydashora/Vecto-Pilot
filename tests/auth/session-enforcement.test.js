import { beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

const originalSecret = process.env.JWT_SECRET;
const originalAgentSecret = process.env.VECTO_AGENT_SECRET;
process.env.JWT_SECRET = 'synthetic-auth-regression-secret-for-jwt';
process.env.VECTO_AGENT_SECRET = 'synthetic-agent-regression-secret';
let session, beforeUpdate, pendingUpdate;
const dialect = new PgDialect();
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => session ? [session] : [] }) }) }),
  update: () => ({ set: values => ({ where: condition => {
    const query = dialect.sqlToQuery(condition);
    pendingUpdate = (async () => {
      await beforeUpdate?.();
      if (session?.user_id === query.params[0] && (
        !query.sql.includes('"users"."session_id"') || session.session_id === query.params[1]
      )) Object.assign(session, values);
    })();
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
test('optional service authentication uses the returned userId and attribution', async () => {
  const result = await invoke({ 'x-vecto-agent-secret': process.env.VECTO_AGENT_SECRET }, optionalAuth);
  expect(result.next).toHaveBeenCalled();
  expect(typeof result.req.auth.userId).toBe('string');
  expect(result.req.auth).toMatchObject({ isAgent: true, tokenSource: 'vecto-secret' });
});

test.each(['hard expiry', 'idle expiry', 'activity'])('a delayed %s write cannot change a newer session', async kind => {
  if (kind === 'hard expiry') session.session_start_at = new Date(Date.now() - 3 * 60 * 60 * 1000);
  if (kind === 'idle expiry') session.last_active_at = new Date(Date.now() - 90 * 60 * 1000);
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
