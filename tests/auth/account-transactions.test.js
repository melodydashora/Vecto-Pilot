import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

let validationResult, geocodeResult, rows, failTable, beforeUpdate, beforeHash, beforeVerify, passwordValid, transactionTail, transactionActive;
const dialect = new PgDialect();
const { structuredClone } = globalThis;

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
    let conflictColumn = null;
    const run = async () => {
      if (name === failTable) throw new Error('Synthetic persistence failure');
      for (const column of getTableConfig(table).columns) {
        if (column.notNull && value[column.name] === null) throw new Error(`Null value for required ${name}.${column.name}`);
      }
      if (!committed && conflictColumn && rows[name].some(row => row[conflictColumn] === value[conflictColumn])) return [];
      if (!committed) { rows[name].push({ id: 'synthetic-row-' + name, ...value }); committed = true; }
      return [rows[name].at(-1)];
    };
    const query = { returning: run, then: (resolve, reject) => run().then(resolve, reject),
      onConflictDoNothing({ target }) { conflictColumn = target.name; return query; } };
    return query;
  } };
}
const db = {
  query: {
    driver_profiles: { findFirst: findFirst('driver_profiles') },
    driver_vehicles: { findFirst: findFirst('driver_vehicles') },
    auth_credentials: { findFirst: findFirst('auth_credentials') },
    verification_codes: { findFirst: findFirst('verification_codes') },
    users: { findFirst: findFirst('users') },
  },
  select: () => ({ from: table => ({ where: condition => {
    const query = { for: () => query, limit: async () =>
      structuredClone(rows[getTableName(table)]?.filter(row => matchesCondition(row, condition)) ?? []) };
    return query;
  } }) }),
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
  verifyPassword: async () => { await beforeVerify?.(); return passwordValid; }, generateResetToken: forbidden, generateVerificationCode: forbidden,
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
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ geocodeAddress: async () => geocodeResult }));
// main's auth.js also imports ensure-market.js (-> resolveTimezone -> logger OP); keep it out of the graph.
jest.unstable_mockModule('../../server/lib/markets/ensure-market.js', () => ({
  ensureMarket: async ({ market_name }) => ({ already_existed: true, market_name, market_slug: 'synthetic', timezone: null }),
}));
jest.unstable_mockModule('../../server/lib/location/address-validation.js', () => ({ validateAddress: async () => validationResult }));
const { default: router } = await import('../../server/api/auth/auth.js');
const handler = path => router.stack.find(layer => layer.route?.path === path && layer.route.methods.post).route.stack.at(-1).handle;
async function post(path, body, auth) {
  const res = { headers: {}, set(name, value) { this.headers[name] = value; return this; },
    statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  await handler(path)({ body, auth, headers: {}, protocol: 'https', get: () => 'example.test' }, res);
  return res;
}
beforeEach(() => {
  validationResult = { skipped: true }; geocodeResult = null;
  rows = { users: [], driver_profiles: [], driver_vehicles: [], auth_credentials: [], verification_codes: [], oauth_states: [], auth_login_attempts: [] };
  failTable = null;
  beforeUpdate = null;
  beforeHash = null;
  beforeVerify = null;
  passwordValid = true;
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
  expect(rows.users[0].session_id).toBeNull();
  expect(tokenSigner).toHaveBeenCalledWith({ sub: rows.users[0].user_id, sid: expect.any(String) });
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
  beforeVerify = null;
  passwordValid = true;
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

function passwordLoginFixture() {
  rows.users.push({ user_id: 'synthetic-user', session_id: 'old-session', current_snapshot_id: 'old-snapshot', current_main_run_id: 'old-run' });
  rows.driver_profiles.push({ id: 'synthetic-profile', user_id: 'synthetic-user', email: 'test@example.test', settings_revision: 7, selected_services: ['comfort'] });
  rows.auth_credentials.push({ user_id: 'synthetic-user', password_hash: 'old-hash', password_reset_token: 'synthetic-reset', password_reset_expires: new Date(Date.now() + 60000) });
  rows.driver_vehicles.push(
    { id: 'retired', driver_profile_id: 'synthetic-profile', is_primary: true, is_active: false, year: 2020 },
    { id: 'current', driver_profile_id: 'synthetic-profile', is_primary: true, is_active: true, year: 2026 },
  );
}

test('password login returns the same saved revision, chosen services and active vehicle as setup', async () => {
  passwordLoginFixture();
  const result = await post('/login', { email: 'test@example.test', password: 'old-password' });
  expect(result.statusCode).toBe(200);
  expect(result.body).toMatchObject({ sessionId: rows.users[0].session_id, settingsRevision: 7,
    profile: { selectedServices: ['comfort'], settingsRevision: 7 }, vehicle: { id: 'current' } });
  expect(rows.users[0]).toMatchObject({ current_snapshot_id: null, current_main_run_id: null });
});

function liveSessionFixture() {
  passwordLoginFixture();
  rows.users[0].session_start_at = new Date(Date.now() - 59 * 60 * 1000);
  rows.users[0].last_active_at = new Date(Date.now() - 59 * 60 * 1000);
}

test.each(['password', 'google'])('%s login refuses another live session without changing its guidance or clock', async method => {
  liveSessionFixture();
  rows.driver_profiles[0].google_id = 'synthetic-google-subject';
  rows.oauth_states.push({ id: 'synthetic-state-id', state: 'synthetic-state' });
  const previous = structuredClone(rows.users[0]);
  const credentials = structuredClone(rows.auth_credentials[0]);
  const result = method === 'password'
    ? await post('/login', { email: 'test@example.test', password: 'old-password' })
    : await post('/google/exchange', { code: 'synthetic-code', state: 'synthetic-state' });
  expect(result.statusCode).toBe(409);
  expect(result.body).toEqual({ error: 'session_already_active',
    message: 'You already have an active session. Log out of that session before starting a new one.' });
  expect(rows.users[0]).toEqual(previous);
  expect(rows.auth_credentials[0]).toEqual(credentials);
  expect(tokenSigner).not.toHaveBeenCalled();
});

test('simultaneous password sign-ins issue only one session token', async () => {
  passwordLoginFixture();
  let arrivals = 0, bothVerified, releaseVerify;
  const atVerify = new Promise(resolve => { bothVerified = resolve; });
  const resume = new Promise(resolve => { releaseVerify = resolve; });
  beforeVerify = async () => { if (++arrivals === 2) bothVerified(); await resume; };
  const requests = [1, 2].map(() => post('/login', { email: 'test@example.test', password: 'old-password' }));
  await atVerify; releaseVerify();
  const results = await Promise.all(requests);
  expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
  expect(results.find(result => result.statusCode === 200).body.sessionId).toBe(rows.users[0].session_id);
  expect(tokenSigner).toHaveBeenCalledTimes(1);
});

test('wrong credentials cannot discover or replace another active session', async () => {
  liveSessionFixture(); passwordValid = false;
  const previous = structuredClone(rows.users[0]);
  const result = await post('/login', { email: 'test@example.test', password: 'wrong-password' });
  expect(result.statusCode).toBe(401);
  expect(result.body.error).toBe('INVALID_CREDENTIALS');
  expect(rows.users[0]).toEqual(previous);
  expect(tokenSigner).not.toHaveBeenCalled();
});

test.each(['idle expiry', 'hard expiry', 'logout'])('%s permits a fresh session without extending the old lifetime', async state => {
  liveSessionFixture();
  if (state === 'idle expiry') {
    rows.users[0].session_start_at = new Date(Date.now() - 90 * 60 * 1000);
    rows.users[0].last_active_at = new Date(Date.now() - 61 * 60 * 1000);
  } else if (state === 'hard expiry') {
    rows.users[0].session_start_at = new Date(Date.now() - 121 * 60 * 1000);
    rows.users[0].last_active_at = new Date();
  } else {
    expect((await post('/logout', {}, { userId: 'synthetic-user', sessionId: 'old-session' })).statusCode).toBe(200);
  }
  const result = await post('/login', { email: 'test@example.test', password: 'old-password' });
  expect(result.statusCode).toBe(200);
  expect(result.body.sessionId).not.toBe('old-session');
  expect(rows.users[0]).toMatchObject({ session_id: result.body.sessionId, current_snapshot_id: null, current_main_run_id: null });
});

test('password registration leaves first sign-in available and its compatibility token cannot own that session', async () => {
  const signupResult = await post('/register', signup);
  expect(signupResult.statusCode).toBe(201);
  expect(signupResult.body.sessionId).toBeNull();
  expect(rows.users[0].session_id).toBeNull();
  const compatibilitySid = tokenSigner.mock.calls[0][0].sid;
  const loginResult = await post('/login', { email: signup.email, password: signup.password });
  expect(loginResult.statusCode).toBe(200);
  expect(loginResult.body.sessionId).toBe(rows.users[0].session_id);
  expect(loginResult.body.sessionId).not.toBe(compatibilitySid);
});

test('new Google signup creates exactly one usable session with its account', async () => {
  rows.oauth_states.push({ id: 'synthetic-state-id', state: 'synthetic-state' });
  const result = await post('/google/exchange', { code: 'synthetic-code', state: 'synthetic-state' });
  expect(result.statusCode).toBe(200);
  expect(result.body.isNewUser).toBe(true);
  expect(result.body.sessionId).toBe(rows.users[0].session_id);
  expect(tokenSigner).toHaveBeenCalledTimes(1);
  expect(tokenSigner).toHaveBeenCalledWith({ sub: rows.users[0].user_id, sid: rows.users[0].session_id,
    issuedAt: rows.users[0].session_start_at });
});

test('verified password account cannot be linked through Google while its current session is live', async () => {
  liveSessionFixture();
  rows.driver_profiles[0].email = 'google@example.test';
  rows.driver_profiles[0].email_verified = true;
  rows.oauth_states.push({ id: 'synthetic-state-id', state: 'synthetic-state' });
  const previous = structuredClone({ user: rows.users[0], profile: rows.driver_profiles[0], credentials: rows.auth_credentials[0] });
  const result = await post('/google/exchange', { code: 'synthetic-code', state: 'synthetic-state' });
  expect(result.statusCode).toBe(409);
  expect(result.body.error).toBe('session_already_active');
  expect({ user: rows.users[0], profile: rows.driver_profiles[0], credentials: rows.auth_credentials[0] }).toEqual(previous);
});

test('concurrent Google adoption can revoke the unverified registrant only once', async () => {
  liveSessionFixture();
  rows.driver_profiles[0].email = 'google@example.test';
  rows.driver_profiles[0].email_verified = false;
  rows.driver_profiles[0].phone = 'unverified-phone';
  rows.oauth_states.push({ id: 'one', state: 'state-one' }, { id: 'two', state: 'state-two' });
  // Hold both requests outside transactions so both see the unlinked profile.
  let releaseTransactions;
  transactionTail = new Promise(resolve => { releaseTransactions = resolve; });
  let arrivals = 0, bothRead;
  const readCredentials = db.select;
  const atRead = new Promise(resolve => { bothRead = resolve; });
  db.select = (...args) => {
    const query = readCredentials(...args);
    if (!transactionActive && args[0]?.password_hash && ++arrivals === 2) bothRead();
    return query;
  };
  try {
    const requests = ['one', 'two'].map(suffix => post('/google/exchange', { code: 'code-' + suffix, state: 'state-' + suffix }));
    await atRead; releaseTransactions();
    const results = await Promise.all(requests);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find(result => result.statusCode === 200).body;
    expect(winner.passwordRevoked).toBe(true);
    expect(rows.users[0].session_id).toBe(winner.sessionId);
    expect(rows.auth_credentials[0].password_hash).toBeNull();
    expect(rows.driver_profiles[0]).toMatchObject({ google_id: 'synthetic-google-subject', email_verified: true, phone: null });
    expect(tokenSigner).toHaveBeenCalledTimes(1);
  } finally { db.select = readCredentials; releaseTransactions(); }
});

test('password and linked Google sign-ins share the one-session admission rule', async () => {
  passwordLoginFixture(); rows.driver_profiles[0].google_id = 'synthetic-google-subject';
  rows.oauth_states.push({ id: 'one', state: 'state-one' });
  const results = await Promise.all([
    post('/login', { email: 'test@example.test', password: 'old-password' }),
    post('/google/exchange', { code: 'code-one', state: 'state-one' }),
  ]);
  expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
  expect(results.find(result => result.statusCode === 200).body.sessionId).toBe(rows.users[0].session_id);
  expect(tokenSigner).toHaveBeenCalledTimes(1);
});

test.each(['password', 'google'])('%s signing failure rolls back session creation so sign-in can be retried', async method => {
  passwordLoginFixture(); rows.driver_profiles[0].google_id = 'synthetic-google-subject';
  const previous = structuredClone(rows);
  const attempt = () => {
    rows.oauth_states.push({ id: 'one', state: 'state-one' });
    return method === 'password'
      ? post('/login', { email: 'test@example.test', password: 'old-password' })
      : post('/google/exchange', { code: 'code-one', state: 'state-one' });
  };
  tokenSigner.mockRejectedValueOnce(new Error('Synthetic token signing failure'));
  expect((await attempt()).statusCode).toBe(500);
  expect(rows.users).toEqual(previous.users);
  expect(rows.auth_credentials).toEqual(previous.auth_credentials);
  expect((await attempt()).statusCode).toBe(200);
});

test('new Google signup signing failure rolls back account and session together', async () => {
  rows.oauth_states.push({ id: 'one', state: 'state-one' });
  tokenSigner.mockRejectedValueOnce(new Error('Synthetic token signing failure'));
  expect((await post('/google/exchange', { code: 'code-one', state: 'state-one' })).statusCode).toBe(500);
  expect(rows.users).toEqual([]);
  expect(rows.driver_profiles).toEqual([]);
  expect(rows.auth_credentials).toEqual([]);
});

const proof = 'a'.repeat(64);
const secondProof = 'b'.repeat(64);
const recover = recoveryProof => post('/login/recovery', { recoveryProof });
const cancel = recoveryProof => post('/login/recovery/cancel', { recoveryProof });

test('lost password response recovers its same session and original token clock without touching guidance', async () => {
  passwordLoginFixture();
  const original = await post('/login', { email: 'test@example.test', password: 'old-password', recoveryProof: proof });
  expect(original.statusCode).toBe(200);
  const firstClaims = structuredClone(tokenSigner.mock.calls.at(-1)[0]);
  Object.assign(rows.users[0], { current_snapshot_id: 'current-snapshot', current_main_run_id: 'current-run' });
  // A phone may return after the processing deadline; completed receipts live
  // only as long as the original session, not the shorter work deadline.
  rows.auth_login_attempts[0].expires_at = new Date(Date.now() - 60000);
  const before = structuredClone(rows.users[0]);
  const response = await recover(proof);
  expect(response.statusCode).toBe(200);
  expect(response.body).toMatchObject({ recovered: true, sessionId: original.body.sessionId, settingsRevision: 7 });
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(rows.users[0]).toEqual(before);
  expect(tokenSigner.mock.calls.at(-1)[0]).toEqual(firstClaims);
  expect(rows.auth_login_attempts[0].proof_hash).not.toBe(proof);
  expect(JSON.stringify(rows.auth_login_attempts)).not.toContain(proof);
});

test('lost Google response recovers consumed code and exact signup flags without a second provider exchange', async () => {
  rows.oauth_states.push({ id: 'one', state: 'state-one' });
  const body = { code: 'code-one', state: 'state-one', recoveryProof: proof };
  const first = await post('/google/exchange', body);
  expect(first.statusCode).toBe(200);
  expect(rows.oauth_states).toHaveLength(0);
  const replay = await post('/google/exchange', body);
  expect(replay.statusCode).toBe(200);
  expect(replay.body).toMatchObject({ sessionId: first.body.sessionId, isNewUser: true, passwordRevoked: false, recovered: true });
  expect(exchangeGoogle).toHaveBeenCalledTimes(1);
  expect(rows.users).toHaveLength(1);
});

test('Google adoption recovery preserves the password-revoked flag', async () => {
  liveSessionFixture(); rows.driver_profiles[0].email = 'google@example.test';
  rows.driver_profiles[0].email_verified = false;
  rows.oauth_states.push({ id: 'one', state: 'state-one' });
  const first = await post('/google/exchange', { code: 'code-one', state: 'state-one', recoveryProof: proof });
  expect(first.body.passwordRevoked).toBe(true);
  expect((await recover(proof)).body).toMatchObject({ sessionId: first.body.sessionId, isNewUser: false, passwordRevoked: true });
});

test('unknown recovery remains pending, and cancellation before arrival fences a late password request', async () => {
  passwordLoginFixture();
  expect((await recover(proof)).statusCode).toBe(202);
  expect(rows.auth_login_attempts).toHaveLength(0);
  expect((await cancel(proof)).statusCode).toBe(200);
  const before = structuredClone(rows.users[0]);
  expect((await post('/login', { email: 'test@example.test', password: 'old-password', recoveryProof: proof })).statusCode).toBe(410);
  expect(rows.users[0]).toEqual(before);
  expect(tokenSigner).not.toHaveBeenCalled();
  expect((await cancel(proof)).statusCode).toBe(200);
  expect((await recover(proof)).statusCode).toBe(410);
});

test('cancel during password verification prevents late session creation and a duplicate cannot reverify', async () => {
  passwordLoginFixture();
  let reachedVerify, releaseVerify, verificationCount = 0;
  const atVerify = new Promise(resolve => { reachedVerify = resolve; });
  const resume = new Promise(resolve => { releaseVerify = resolve; });
  beforeVerify = async () => { verificationCount += 1; reachedVerify(); await resume; };
  const body = { email: 'test@example.test', password: 'old-password', recoveryProof: proof };
  const pendingLogin = post('/login', body);
  await atVerify;
  expect((await recover(proof)).statusCode).toBe(202);
  expect((await post('/login', body)).statusCode).toBe(202);
  expect(verificationCount).toBe(1);
  expect((await cancel(proof)).statusCode).toBe(200);
  releaseVerify();
  expect((await pendingLogin).statusCode).toBe(410);
  expect(rows.users[0].session_id).toBe('old-session');
  expect(rows.auth_login_attempts[0].status).toBe('cancelled');
  expect(tokenSigner).not.toHaveBeenCalled();
});

test('cancel during Google token exchange prevents late account/session creation', async () => {
  rows.oauth_states.push({ id: 'one', state: 'state-one' });
  let reachedExchange, releaseExchange;
  const atExchange = new Promise(resolve => { reachedExchange = resolve; });
  const resume = new Promise(resolve => { releaseExchange = resolve; });
  exchangeGoogle.mockImplementationOnce(async () => { reachedExchange(); await resume; return { id_token: 'synthetic-token' }; });
  const pendingLogin = post('/google/exchange', { code: 'code-one', state: 'state-one', recoveryProof: proof });
  await atExchange;
  expect((await cancel(proof)).statusCode).toBe(200);
  releaseExchange();
  expect((await pendingLogin).statusCode).toBe(410);
  expect(rows.users).toHaveLength(0);
  expect(rows.driver_profiles).toHaveLength(0);
  expect(rows.auth_login_attempts[0].status).toBe('cancelled');
  expect(tokenSigner).not.toHaveBeenCalled();
});

test('cancel after commit revokes only its own session and is safe to retry after another login', async () => {
  passwordLoginFixture();
  const body = { email: 'test@example.test', password: 'old-password', recoveryProof: proof };
  const original = await post('/login', body);
  expect(original.statusCode).toBe(200);
  expect((await cancel(proof)).statusCode).toBe(200);
  expect(rows.users[0]).toMatchObject({ session_id: null, current_snapshot_id: null, current_main_run_id: null });
  expect((await recover(proof)).statusCode).toBe(410);
  const next = await post('/login', { ...body, recoveryProof: secondProof });
  expect(next.statusCode).toBe(200);
  const before = structuredClone(rows.users[0]);
  expect((await cancel(proof)).statusCode).toBe(200);
  expect(rows.users[0]).toEqual(before);
});

test.each(['logout', 'reset', 'different session', 'inactivity', 'hard limit'])('%s prevents completed proof from restoring an ended session', async reason => {
  passwordLoginFixture();
  const original = await post('/login', { email: 'test@example.test', password: 'old-password', recoveryProof: proof });
  expect(original.statusCode).toBe(200);
  if (reason === 'logout') await post('/logout', {}, { userId: 'synthetic-user', sessionId: original.body.sessionId });
  if (reason === 'reset') await post('/reset-password', { token: 'synthetic-reset', newPassword: 'next-password' });
  if (reason === 'different session') rows.users[0].session_id = 'different-session';
  if (reason === 'inactivity') Object.assign(rows.users[0], {
    session_start_at: new Date(Date.now() - 90 * 60000), last_active_at: new Date(Date.now() - 61 * 60000) });
  if (reason === 'hard limit') rows.users[0].session_start_at = new Date(Date.now() - 121 * 60000);
  const before = structuredClone(rows.users[0]);
  expect((await recover(proof)).statusCode).toBe(410);
  expect(rows.users[0]).toEqual(before);
});

test('a different browser proof cannot acquire an existing session even with valid credentials', async () => {
  passwordLoginFixture();
  const body = { email: 'test@example.test', password: 'old-password' };
  const original = await post('/login', { ...body, recoveryProof: proof });
  expect(original.statusCode).toBe(200);
  const before = structuredClone(rows.users[0]);
  expect((await recover(secondProof)).statusCode).toBe(202);
  expect((await post('/login', { ...body, recoveryProof: secondProof })).statusCode).toBe(409);
  expect((await recover(secondProof)).statusCode).toBe(410);
  expect(rows.users[0]).toEqual(before);
});

test('failed credentials terminate their receipt without rolling back lockout attempts', async () => {
  passwordLoginFixture(); passwordValid = false;
  expect((await post('/login', { email: 'test@example.test', password: 'wrong', recoveryProof: proof })).statusCode).toBe(401);
  expect(rows.auth_credentials[0].failed_login_attempts).toBe(1);
  expect(rows.auth_login_attempts[0].status).toBe('failed');
  expect((await recover(proof)).statusCode).toBe(410);
});

test.each(['bad', 'A'.repeat(64), null, 123])('invalid proof %s is rejected before any receipt or session write', async badProof => {
  passwordLoginFixture();
  const before = structuredClone(rows);
  expect((await post('/login', { email: 'test@example.test', password: 'old-password', recoveryProof: badProof })).statusCode).toBe(400);
  expect((await recover(badProof)).statusCode).toBe(400);
  expect((await cancel(badProof)).statusCode).toBe(400);
  expect(rows).toEqual(before);
  expect(tokenSigner).not.toHaveBeenCalled();
});

test('a password reset during password verification cannot be followed by a session from the old password', async () => {
  passwordLoginFixture();
  let reachedVerify, releaseVerify;
  const atVerify = new Promise(resolve => { reachedVerify = resolve; });
  const resume = new Promise(resolve => { releaseVerify = resolve; });
  beforeVerify = async () => { reachedVerify(); await resume; };
  const pending = post('/login', { email: 'test@example.test', password: 'old-password' });
  await atVerify;
  expect((await post('/reset-password', { token: 'synthetic-reset', newPassword: 'new-password' })).statusCode).toBe(200);
  releaseVerify();
  const result = await pending;
  expect(result.statusCode).toBe(401);
  expect(result.body.error).toBe('INVALID_CREDENTIALS');
  expect(rows.users[0].session_id).toBeNull();
  expect(tokenSigner).not.toHaveBeenCalled();
});


test('Google login uses the same session, saved choices and active vehicle projection', async () => {
  passwordLoginFixture();
  rows.driver_profiles[0].google_id = 'synthetic-google-subject';
  rows.oauth_states.push({ id: 'synthetic-state-id', state: 'synthetic-state' });
  const result = await post('/google/exchange', { code: 'synthetic-code', state: 'synthetic-state' });
  expect(result.statusCode).toBe(200);
  expect(result.body).toMatchObject({ sessionId: rows.users[0].session_id, settingsRevision: 7,
    profile: { selectedServices: ['comfort'], settingsRevision: 7 }, vehicle: { id: 'current' } });
  expect(rows.users[0]).toMatchObject({ current_snapshot_id: null, current_main_run_id: null });
});

test('concurrent failed password checks accumulate instead of overwriting the attempt counter', async () => {
  passwordLoginFixture(); passwordValid = false;
  let reachedVerify, releaseVerify, arrivals = 0;
  const atVerify = new Promise(resolve => { reachedVerify = resolve; });
  const resume = new Promise(resolve => { releaseVerify = resolve; });
  beforeVerify = async () => { if (++arrivals === 5) reachedVerify(); await resume; };
  const pending = Array.from({ length: 5 }, () => post('/login', { email: 'test@example.test', password: 'wrong' }));
  await atVerify; releaseVerify();
  expect((await Promise.all(pending)).map(result => result.statusCode)).toEqual([401, 401, 401, 401, 401]);
  expect(rows.auth_credentials[0].failed_login_attempts).toBe(5);
  expect(rows.auth_credentials[0].locked_until.getTime()).toBeGreaterThan(Date.now());
  expect(rows.users[0].session_id).toBe('old-session');
});

test('failed session creation rolls back the successful-login credential writes', async () => {
  passwordLoginFixture(); rows.auth_credentials[0].failed_login_attempts = 3;
  failTable = 'users';
  const result = await post('/login', { email: 'test@example.test', password: 'old-password' });
  expect(result.statusCode).toBe(500);
  expect(rows.auth_credentials[0].failed_login_attempts).toBe(3);
  expect(rows.users[0].session_id).toBe('old-session');
  expect(tokenSigner).not.toHaveBeenCalled();
});


test('registration preserves the supplied address when validation is uncertain', async () => {
  validationResult = { valid: false, validationStatus: 'UNCONFIRMED_ADDRESS', corrected: { address1: 'Wrong inferred place', city: 'Other city', state: 'XX', country: 'US' }, lat: 40, lng: -70 };
  expect((await post('/register', signup)).statusCode).toBe(201);
  expect(rows.driver_profiles[0]).toMatchObject({ address_1: signup.address1, city: signup.city, home_lat: null, home_lng: null });
});
test('registration accepts confirmed zero coordinates and rejects malformed geocode fallback coordinates', async () => {
  validationResult = { valid: true, validationStatus: 'CONFIRMED', lat: 0, lng: 2 };
  expect((await post('/register', signup)).statusCode).toBe(201);
  expect(rows.driver_profiles[0]).toMatchObject({ home_lat: 0, home_lng: 2 });
});
test('registration fallback does not persist out-of-range home coordinates', async () => {
  geocodeResult = { lat: 95, lng: 2 };
  expect((await post('/register', signup)).statusCode).toBe(201);
  expect(rows.driver_profiles[0]).toMatchObject({ home_lat: null, home_lng: null });
});
test('registration market lookup cannot replace an explicit driver choice', async () => {
  rows.platform_data = [{ city: signup.city, platform: 'uber', market_anchor: 'Different auto market' }];
  expect((await post('/register', signup)).statusCode).toBe(201);
  expect(rows.driver_profiles[0].market).toBe(signup.market);
});
