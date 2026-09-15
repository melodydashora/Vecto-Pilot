import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

let rows, failTable, beforeUpdate, beforeHash, transactionTail, transactionActive;
const dialect = new PgDialect();

// Evaluate the generated conjunctions against synthetic rows. This fake models
// the database's conditional writes rather than authorizing by handler inputs.
function matchesCondition(row, condition) {
  const query = dialect.sqlToQuery(condition);
  const comparisons = [...query.sql.matchAll(/"[^"]+"\."([^"]+)"\s*(=|>|is null)(?:\s+\$(\d+))?/g)];
  if (!comparisons.length) throw new Error('Unsupported synthetic query: ' + query.sql);
  return comparisons.every(([, column, operator, parameter]) => {
    const actual = row[column];
    if (operator === 'is null') return actual == null;
    const expected = query.params[Number(parameter) - 1];
    if (actual == null || expected == null) return false;
    if (operator === '=') return actual === expected;
    return typeof actual.getTime === 'function' ? actual.getTime() > new Date(expected).getTime() : actual > expected;
  });
}
const findFirst = name => async ({ where }) => {
  const row = rows[name].find(record => matchesCondition(record, where));
  return row && structuredClone(row);
};
const tokenSigner = jest.fn(async () => 'synthetic-token');
const exchangeGoogle = jest.fn(async () => ({ id_token: 'synthetic-provider-token' }));
function insert(table) {
  const name = getTableName(table);
  return { values(value) {
    let committed = false;
    const run = async () => {
      if (name === failTable) throw new Error('Synthetic persistence failure');
      if (!committed) { rows[name].push({ id: 'synthetic-row-' + name, ...value }); committed = true; }
      return [rows[name].at(-1)];
    };
    return { returning: run, then: (resolve, reject) => run().then(resolve, reject) };
  } };
}
const db = {
  query: {
    driver_profiles: { findFirst: findFirst('driver_profiles') },
    driver_vehicles: { findFirst: findFirst('driver_vehicles') },
    auth_credentials: { findFirst: findFirst('auth_credentials') },
    verification_codes: { findFirst: findFirst('verification_codes') },
  },
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  insert,
  delete: () => ({ where: () => ({ returning: async () => rows.oauth_states.splice(0, 1) }) }),
  update(table) {
    const name = getTableName(table);
    return { set(value) { return { where: condition => {
      const run = async () => {
        await beforeUpdate?.(name);
        if (name === failTable) throw new Error('Synthetic persistence failure');
        const targets = rows[name].filter(row => matchesCondition(row, condition));
        targets.forEach(row => Object.assign(row, value));
        return structuredClone(targets);
      };
      return { returning: run, then: (resolve, reject) => run().then(resolve, reject) };
    } }; } };
  },
  async transaction(work) {
    // Requests for the same reset credential contend on one PostgreSQL row.
    // Serialize these synthetic transactions, then re-evaluate their predicates
    // against committed state; reads before the transaction still run together.
    const previous = transactionTail;
    let release;
    transactionTail = new Promise(resolve => { release = resolve; });
    await previous;
    const before = structuredClone(rows);
    transactionActive = true;
    try { return await work(this); }
    catch (error) { rows = before; throw error; }
    finally { transactionActive = false; release(); }
  },
};
const forbidden = jest.fn(async () => { throw new Error('Unexpected provider call'); });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth() {} }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ matrixLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.unstable_mockModule('../../server/lib/jwt.js', () => ({ signJWT: tokenSigner }));
jest.unstable_mockModule('../../server/lib/auth/password.js', () => ({
  hashPassword: async password => {
    if (transactionActive) throw new Error('Password hashing must remain outside the transaction');
    await beforeHash?.();
    return 'synthetic-hash-' + password;
  },
  validatePasswordStrength: () => ({ valid: true }),
  verifyPassword: forbidden, generateResetToken: forbidden, generateVerificationCode: forbidden,
  getResetTokenExpiry: forbidden, getVerificationCodeExpiry: forbidden,
}));
jest.unstable_mockModule('../../server/lib/auth/oauth/google-oauth.js', () => ({
  getGoogleAuthUrl: forbidden, exchangeGoogleCode: exchangeGoogle,
  verifyGoogleIdToken: async () => ({ sub: 'synthetic-google-subject', given_name: 'Synthetic', family_name: 'Driver', name: 'Synthetic Driver', email: 'google@example.test' }),
  generateState: forbidden,
}));
jest.unstable_mockModule('../../server/lib/auth/email.js', () => ({
  sendPasswordResetEmail: forbidden, sendEmailVerification: forbidden,
  sendWelcomeEmail: async () => {}, isEmailConfigured: () => false,
}));
jest.unstable_mockModule('../../server/lib/auth/sms.js', () => ({
  sendPasswordResetSMS: forbidden, isSmsConfigured: () => false,
  validatePhoneNumber: () => ({ valid: true, formatted: 'synthetic' }),
}));
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ geocodeAddress: async () => null }));
// main's auth.js also imports ensure-market.js (-> resolveTimezone -> logger OP); keep it out of the graph.
jest.unstable_mockModule('../../server/lib/markets/ensure-market.js', () => ({
  ensureMarket: async ({ market_name }) => ({ already_existed: true, market_name, market_slug: 'synthetic', timezone: null }),
}));
jest.unstable_mockModule('../../server/lib/location/address-validation.js', () => ({ validateAddress: async () => ({ skipped: true }) }));
const { default: router } = await import('../../server/api/auth/auth.js');
const handler = path => router.stack.find(layer => layer.route?.path === path && layer.route.methods.post).route.stack.at(-1).handle;
async function post(path, body, auth) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  await handler(path)({ body, auth, protocol: 'https', get: () => 'example.test' }, res);
  return res;
}
beforeEach(() => {
  rows = { users: [], driver_profiles: [], driver_vehicles: [], auth_credentials: [], verification_codes: [], oauth_states: [] };
  failTable = null;
  beforeUpdate = null;
  beforeHash = null;
  transactionTail = Promise.resolve();
  transactionActive = false;
  jest.clearAllMocks();
});
const signup = { firstName: 'Synthetic', lastName: 'Driver', email: 'test@example.test', phone: 'synthetic', password: 'synthetic', address1: 'synthetic', city: 'synthetic', stateTerritory: 'synthetic', market: 'synthetic', vehicleYear: 2026, vehicleMake: 'synthetic', vehicleModel: 'synthetic', termsAccepted: true };
test.each(['driver_vehicles', 'auth_credentials'])('a %s failure rolls back every account row and allows retry', async table => {
  failTable = table;
  const first = await post('/register', signup);
  expect(first.statusCode).toBe(500);
  expect(Object.values(rows).every(records => records.length === 0)).toBe(true);
  expect(tokenSigner).not.toHaveBeenCalled();
  failTable = null;
  expect((await post('/register', signup)).statusCode).toBe(201);
  expect(rows.auth_credentials).toHaveLength(1);
  expect(tokenSigner).toHaveBeenCalledWith({ sub: rows.users[0].user_id, sid: rows.users[0].session_id });
  expect(forbidden).not.toHaveBeenCalled();
});
test('password reset revokes the session in the same transaction', async () => {
  rows.users.push({ user_id: 'synthetic-user', session_id: 'old-session', current_snapshot_id: 'old-snapshot' });
  rows.auth_credentials.push({ user_id: 'synthetic-user', password_hash: 'old-hash', password_reset_token: 'synthetic-reset', password_reset_expires: new Date(Date.now() + 60000) });
  expect((await post('/reset-password', { token: 'synthetic-reset', newPassword: 'synthetic' })).statusCode).toBe(200);
  expect(rows.users[0]).toMatchObject({ session_id: null, current_snapshot_id: null });
  expect(rows.auth_credentials[0].password_hash).toBe('synthetic-hash-synthetic');
});
test('failed session revocation also rolls back the password change', async () => {
  rows.users.push({ user_id: 'synthetic-user', session_id: 'old-session' });
  rows.auth_credentials.push({ user_id: 'synthetic-user', password_hash: 'old-hash', password_reset_token: 'synthetic-reset', password_reset_expires: new Date(Date.now() + 60000) });
  failTable = 'users';
  expect((await post('/reset-password', { token: 'synthetic-reset', newPassword: 'synthetic' })).statusCode).toBe(500);
  expect(rows.auth_credentials[0].password_hash).toBe('old-hash');
  expect(rows.users[0].session_id).toBe('old-session');
});

test('logout clears the authenticated session and preserves the user row', async () => {
  rows.users.push({ user_id: 'synthetic-user', session_id: 'session-a', current_snapshot_id: 'snapshot-a' });
  const result = await post('/logout', {}, { userId: 'synthetic-user', sessionId: 'session-a' });
  expect(result.statusCode).toBe(200);
  expect(rows.users).toHaveLength(1);
  expect(rows.users[0]).toMatchObject({ session_id: null, current_snapshot_id: null });
});

test('a logout delayed after authentication cannot revoke a newer login', async () => {
  rows.users.push({ user_id: 'synthetic-user', session_id: 'session-a', current_snapshot_id: 'snapshot-a' });
  let reachedWrite, releaseWrite;
  const atWrite = new Promise(resolve => { reachedWrite = resolve; });
  const resume = new Promise(resolve => { releaseWrite = resolve; });
  beforeUpdate = async name => { if (name === 'users') { reachedWrite(); await resume; } };

  const pending = post('/logout', {}, { userId: 'synthetic-user', sessionId: 'session-a' });
  await atWrite;
  rows.users[0] = { user_id: 'synthetic-user', session_id: 'session-b', current_snapshot_id: 'snapshot-b' };
  releaseWrite();

  expect((await pending).statusCode).toBe(200);
  expect(rows.users[0]).toEqual({ user_id: 'synthetic-user', session_id: 'session-b', current_snapshot_id: 'snapshot-b' });
});

test('Google credential failure rolls back its account rows after consuming state', async () => {
  rows.oauth_states.push({ id: 'synthetic-state-id', state: 'synthetic-state' });
  failTable = 'auth_credentials';
  const result = await post('/google/exchange', { code: 'synthetic-code', state: 'synthetic-state' });
  expect(result.statusCode).toBe(500);
  expect(rows.users).toHaveLength(0);
  expect(rows.driver_profiles).toHaveLength(0);
  expect(rows.auth_credentials).toHaveLength(0);
  expect(rows.oauth_states).toHaveLength(0);
  expect(tokenSigner).not.toHaveBeenCalled();
  expect(exchangeGoogle).toHaveBeenCalledTimes(1);
  expect((await post('/google/exchange', { code: 'synthetic-code', state: 'synthetic-state' })).body.error).toBe('INVALID_STATE');
  expect(exchangeGoogle).toHaveBeenCalledTimes(1);
});

function resetFixture(method) {
  rows.users.push({ user_id: 'synthetic-user', session_id: 'old-session', current_snapshot_id: 'old-snapshot' });
  rows.auth_credentials.push({ user_id: 'synthetic-user', password_hash: 'old-hash', password_reset_token: 'synthetic-reset', password_reset_expires: new Date(Date.now() + 60000) });
  rows.driver_profiles.push({ user_id: 'synthetic-user', email: 'test@example.test' });
  rows.verification_codes.push({ id: 'synthetic-code', user_id: 'synthetic-user', code: '123456', code_type: 'password_reset_sms', expires_at: new Date(Date.now() + 60000), used_at: null });
  return method === 'token' ? { token: 'synthetic-reset' } : { code: '123456', email: 'test@example.test' };
}

test.each(['token', 'sms'])('only one concurrent %s reset can claim the credential and change the password', async method => {
  const credential = resetFixture(method);
  let arrivals = 0, bothRead, releaseHash;
  const atHash = new Promise(resolve => { bothRead = resolve; });
  const resume = new Promise(resolve => { releaseHash = resolve; });
  beforeHash = async () => { if (++arrivals === 2) bothRead(); await resume; };

  const requests = ['first', 'second'].map(newPassword => post('/reset-password', { ...credential, newPassword }));
  await atHash; // Both requests passed the preliminary credential read.
  releaseHash();
  const results = await Promise.all(requests);

  expect(results.map(result => result.statusCode).sort()).toEqual([200, 400]);
  expect(results.find(result => result.statusCode === 400).body.error).toBe(method === 'token' ? 'INVALID_TOKEN' : 'INVALID_CODE');
  const winner = results[0].statusCode === 200 ? 'first' : 'second';
  expect(rows.auth_credentials[0]).toMatchObject({ password_hash: 'synthetic-hash-' + winner, password_reset_token: null });
  expect(rows.users[0]).toMatchObject({ session_id: null, current_snapshot_id: null });
  if (method === 'sms') expect(rows.verification_codes[0].used_at).toBeInstanceOf(Date);
  beforeHash = null;
  expect((await post('/reset-password', { ...credential, newPassword: 'replay' })).statusCode).toBe(400);
  expect(forbidden).not.toHaveBeenCalled();
});

test.each(['token', 'sms'])('a %s credential that expires after its preliminary read is rejected before mutation', async method => {
  const credential = resetFixture(method);
  beforeHash = async () => {
    if (method === 'token') rows.auth_credentials[0].password_reset_expires = new Date(Date.now() - 1);
    else rows.verification_codes[0].expires_at = new Date(Date.now() - 1);
  };
  expect((await post('/reset-password', { ...credential, newPassword: 'new' })).statusCode).toBe(400);
  expect(rows.auth_credentials[0].password_hash).toBe('old-hash');
  expect(rows.verification_codes[0].used_at).toBeNull();
  expect(rows.users[0].session_id).toBe('old-session');
});

test.each([
  ['token', 'users'], ['sms', 'auth_credentials'], ['sms', 'users'],
])('%s reset rolls back its claim when %s persistence fails, then permits retry', async (method, table) => {
  const credential = resetFixture(method);
  const before = structuredClone(rows);
  failTable = table;
  expect((await post('/reset-password', { ...credential, newPassword: 'new' })).statusCode).toBe(500);
  expect(rows).toEqual(before);
  failTable = null;
  expect((await post('/reset-password', { ...credential, newPassword: 'retry' })).statusCode).toBe(200);
  expect(rows.auth_credentials[0].password_hash).toBe('synthetic-hash-retry');
  expect(rows.users[0].session_id).toBeNull();
});

test('reissuing an email token after its read prevents the old token from resetting the password', async () => {
  const credential = resetFixture('token');
  beforeHash = async () => { rows.auth_credentials[0].password_reset_token = 'replacement-token'; };
  expect((await post('/reset-password', { ...credential, newPassword: 'new' })).body.error).toBe('INVALID_TOKEN');
  expect(rows.auth_credentials[0]).toMatchObject({ password_hash: 'old-hash', password_reset_token: 'replacement-token' });
  expect(rows.users[0].session_id).toBe('old-session');
});
