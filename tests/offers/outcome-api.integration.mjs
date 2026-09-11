// Actual Express router + actual PostgreSQL SQL in disposable in-memory PGlite.
// PGlite may be supplied from an existing installation via NODE_PATH; no live DB is used.
import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { parseOutcomeInput, offerPeriod } from '../../server/lib/offers/outcome-input.js';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const userA = '00000000-0000-4000-8000-00000000000a', userB = '00000000-0000-4000-8000-00000000000b';
const now = new Date('2026-09-10T12:00:00.000Z');
let syntheticDb, app;
const dialect = new PgDialect();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {
  execute: statement => { const query = dialect.sqlToQuery(statement); return syntheticDb.query(query.sql, query.params); },
} }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, res, next) {
  const userId = { 'Bearer synthetic-a': userA, 'Bearer synthetic-b': userB }[req.headers.authorization];
  if (!userId) return res.status(401).json({ error: 'synthetic_auth_required' });
  req.auth = { userId }; next();
} }));
jest.unstable_mockModule('../../server/lib/offers/ruleset-store.js', () => ({ hashRuleset: () => 'synthetic', generateShortcutToken: () => 'synthetic', invalidateUser() {} }));
// Fix only the clock boundary; production period validation/calculation is still executed.
jest.unstable_mockModule('../../server/lib/offers/outcome-input.js', () => ({ parseOutcomeInput, offerPeriod: key => offerPeriod(key, now) }));
const { default: router } = await import('../../server/api/offer-analyzer/index.js');
const migration = await fs.readFile(new URL('../../migrations/20260910_offer_outcome_revision_other.sql', import.meta.url), 'utf8');
beforeAll(async () => {
  syntheticDb = new PGlite();
  await syntheticDb.exec(`
    CREATE TABLE users (user_id uuid PRIMARY KEY);
    CREATE TABLE driver_profiles (user_id uuid PRIMARY KEY);
    CREATE TABLE offer_intelligence (
      id uuid PRIMARY KEY, user_id uuid, created_at timestamptz NOT NULL,
      decision text NOT NULL, decision_reasoning text, price double precision, per_mile double precision,
      total_miles double precision, total_minutes integer, pickup_minutes integer, pickup_miles double precision,
      pickup_address text, dropoff_address text, product_type text, platform text, surge double precision,
      confidence_score double precision, input_mode text, user_override text, response_time_ms integer,
      parsed_data_json jsonb NOT NULL DEFAULT '{}'
    );
  `);
  await syntheticDb.exec(await fs.readFile(new URL('../../migrations/20260703_offer_rulesets_outcomes.sql', import.meta.url), 'utf8'));
  await syntheticDb.exec(migration);
  await syntheticDb.query('INSERT INTO users (user_id) VALUES ($1), ($2)', [userA, userB]);
  app = express(); app.use(express.json()); app.use('/api/offer-analyzer', router);
}, 20000);
beforeEach(async () => { await syntheticDb.exec('DELETE FROM offer_outcomes; DELETE FROM offer_intelligence;'); });
afterAll(async () => { await syntheticDb?.close(); });
async function offer({ user = userA, decision = 'ACCEPT', created = '2026-09-09T12:00:00Z', price = 12.5 } = {}) {
  const id = randomUUID();
  await syntheticDb.query('INSERT INTO offer_intelligence (id,user_id,created_at,decision,price) VALUES ($1,$2,$3,$4,$5)', [id, user, created, decision, price]);
  return id;
}
const post = (id, body, user = 'a') => request(app).post(`/api/offer-analyzer/offers/${id}/outcome`).set('Authorization', `Bearer synthetic-${user}`).send(body);
const get = (path, user = 'a') => request(app).get('/api/offer-analyzer' + path).set('Authorization', `Bearer synthetic-${user}`);
test('input validation is strict, preserves zero and explicit null, and distinguishes Other from money', () => {
  expect(parseOutcomeInput({ expected_revision: null, driver_decision: 'Other', driver_reasoning: '  unreadable  ' }).fields).toEqual({ driver_decision: 'Other', driver_reasoning: 'unreadable' });
  expect(parseOutcomeInput({ expected_revision: 1, actual_pay: 0, extras: null }).fields).toEqual({ actual_pay: 0, extras: null });
  for (const value of [true, [], {}, '', '12', -1, 10001, NaN, Infinity]) expect(() => parseOutcomeInput({ expected_revision: 1, actual_pay: value })).toThrow();
  for (const expected_revision of [undefined, 0, '1', 1.5, -1, 2147483647]) expect(() => parseOutcomeInput({ expected_revision, driver_decision: 'Accepted' })).toThrow();
  expect(() => parseOutcomeInput({ expected_revision: null, driver_decision: 'Other', actual_pay: 12 })).toThrow(/Only accepted/);
  expect(() => parseOutcomeInput({ expected_revision: 1, driver_reasoning: 'x'.repeat(2001) })).toThrow();
  expect(() => parseOutcomeInput({ expected_revision: null, actual_pay: 12 })).toThrow();
  expect(() => parseOutcomeInput({ driver_decision: 'Accepted' })).toThrow(/out of date/);
  for (const value of ['bad', true, '2026-02-30T12:00:00Z', '2026-09-10T24:00:00Z', '2026-09-10', '2026-09-10T12:00:00.1234567Z']) expect(() => parseOutcomeInput({ expected_outcome_updated_at: value, driver_decision: 'Accepted' })).toThrow();
  expect(offerPeriod('7d', now)).toEqual({ key: '7d', label: 'Rolling last 7 days', start: '2026-09-03T12:00:00.000Z', end: now.toISOString() });
  for (const period of ['all', '0d', ['7d'], '7d;DROP']) expect(() => offerPeriod(period, now)).toThrow();
});
test('actual router saves canonical outcomes and preserves omitted fields, unknowns, explicit zero and original offer', async () => {
  const id = await offer();
  let response = await post(id, { expected_revision: null, driver_decision: 'Accepted' });
  expect(response.status).toBe(200); expect(response.body.outcome).toMatchObject({ offer_intelligence_id: id, revision: 1, actual_pay: null, total_earned: 0 });
  response = await post(id, { expected_revision: 1, actual_pay: 25, reimbursements: 0, extras: 3, other: 2, driver_reasoning: 'Actual receipt' });
  expect(response.status).toBe(200); expect(response.body.outcome).toMatchObject({ revision: 2, actual_pay: 25, total_earned: 30 });
  response = await post(id, { expected_revision: 2, driver_decision: 'Completed' });
  expect(response.status).toBe(200); expect(response.body.outcome).toMatchObject({ revision: 3, driver_decision: 'Completed', actual_pay: 25, reimbursements: 0, extras: 3, other: 2, total_earned: 30, driver_reasoning: 'Actual receipt' });
  response = await post(id, { expected_revision: 3, actual_pay: 0, extras: null });
  expect(response.body.outcome).toMatchObject({ revision: 4, actual_pay: 0, extras: null, other: 2, total_earned: 2 });
  const loaded = await get('/offers?limit=25'); expect(loaded.status).toBe(200);
  expect(loaded.body.offers[0]).toMatchObject({ id, price: 12.5, decision: 'ACCEPT', outcome_revision: 4, actual_pay: 0, extras: null });
});
test('Other/error and rejected outcomes stay distinct, clear prior monetary state, and survive migration reruns', async () => {
  const id = await offer();
  await post(id, { expected_revision: null, driver_decision: 'Accepted', actual_pay: 25, extras: 3 });
  let response = await post(id, { expected_revision: 1, driver_decision: 'Other', driver_reasoning: 'Wrong screen was sent' });
  expect(response.status).toBe(200); expect(response.body.outcome).toMatchObject({ revision: 2, driver_decision: 'Other', actual_pay: null, extras: null, total_earned: 0 });
  await syntheticDb.exec(migration); await syntheticDb.exec(migration);
  expect((await get('/offers')).body.offers[0]).toMatchObject({ driver_decision: 'Other', driver_reasoning: 'Wrong screen was sent', outcome_revision: 2 });
  response = await post(id, { expected_revision: 2, actual_pay: 99 }); expect(response.status).toBe(409); expect(response.body.current.actual_pay).toBeNull();
  response = await post(id, { expected_revision: 2, driver_decision: 'Rejected' }); expect(response.status).toBe(200); expect(response.body.outcome.driver_reasoning).toBe('Wrong screen was sent');
  expect((await get('/offers/stats')).body.stats).toMatchObject({ driver_rejected: 1, other: 0, reported_total: 0, reported_count: 0 });
});
test('forward migration preserves a pre-revision outcome and adds revision one without changing its amounts', async () => {
  const id = await offer();
  await post(id, { expected_revision: null, driver_decision: 'Completed', actual_pay: 0, extras: 7, driver_reasoning: 'Preserved synthetic record' });
  // Reconstruct the old constraint/column shape only inside this disposable database.
  await syntheticDb.exec("ALTER TABLE offer_outcomes DROP COLUMN revision; ALTER TABLE offer_outcomes DROP CONSTRAINT offer_outcomes_driver_decision_check; ALTER TABLE offer_outcomes ADD CONSTRAINT offer_outcomes_driver_decision_check CHECK (driver_decision IN ('Accepted','Rejected','Cancelled','Completed'));");
  const before = (await syntheticDb.query('SELECT * FROM offer_outcomes')).rows[0];
  await syntheticDb.exec(migration);
  const after = (await syntheticDb.query('SELECT * FROM offer_outcomes')).rows[0];
  expect(after).toEqual({ ...before, revision: 1 });
});
test('stale and simultaneous edits reject with canonical current state, including first-save retries', async () => {
  const id = await offer();
  expect((await post(id, { expected_revision: 1, driver_decision: 'Accepted' })).status).toBe(409);
  const starts = await Promise.all([post(id, { expected_revision: null, driver_decision: 'Accepted', actual_pay: 10 }), post(id, { expected_revision: null, driver_decision: 'Rejected' })]);
  expect(starts.map(result => result.status).sort()).toEqual([200, 409]);
  const original = starts.find(result => result.status === 200).body.outcome;
  const edits = await Promise.all([post(id, { expected_revision: original.revision, driver_decision: 'Accepted', actual_pay: 25 }), post(id, { expected_revision: original.revision, driver_decision: 'Completed', actual_pay: 35 })]);
  expect(edits.map(result => result.status).sort()).toEqual([200, 409]);
  const winner = edits.find(result => result.status === 200).body.outcome;
  const stale = await post(id, { expected_revision: 1, driver_decision: 'Rejected' });
  expect(stale.status).toBe(409); expect(stale.body.current).toEqual(winner);
  expect((await syntheticDb.query('SELECT count(*)::integer AS n FROM offer_outcomes')).rows[0].n).toBe(1);
});
test('ownership and authentication reject cross-user writes and exclude mismatched joins', async () => {
  const mine = await offer(), theirs = await offer({ user: userB });
  expect((await request(app).get('/api/offer-analyzer/offers/stats')).status).toBe(401);
  expect((await post(theirs, { expected_revision: null, driver_decision: 'Accepted', actual_pay: 50 })).status).toBe(404);
  // Synthetic inconsistent legacy row: even this outcome must not leak across the join.
  await syntheticDb.query("INSERT INTO offer_outcomes(user_id,offer_intelligence_id,driver_decision,actual_pay) VALUES ($1,$2,'Accepted',777)", [userB, mine]);
  expect((await get('/offers')).body.offers[0]).toMatchObject({ id: mine, outcome_id: null, actual_pay: null });
  expect((await get('/offers/stats')).body.stats).toMatchObject({ analyzed: 1, unrecorded: 1, reported_total: 0 });
  expect((await post(mine, { expected_revision: null, driver_decision: 'Rejected' })).status).toBe(409);
  expect((await get('/offers/stats', 'b')).body.stats).toMatchObject({ analyzed: 1, unrecorded: 1, reported_total: 0 });
  expect((await post('invalid', { expected_revision: null, driver_decision: 'Other' })).status).toBe(400);
  const outdated = await post(theirs, { driver_decision: 'Accepted' }, 'b');
  expect(outdated.status).toBe(400); expect(outdated.body).toMatchObject({ error: 'outcome_version_required' }); expect(outdated.body.message).toMatch(/Refresh/);
});
test('Claude timestamp clients retain guarded first saves, exact microsecond/offset updates and stale-error aliases', async () => {
  const id = await offer();
  let response = await post(id, { expected_outcome_updated_at: null, driver_decision: 'Accepted', actual_pay: 10 });
  expect(response.status).toBe(200); expect(response.body.outcome.revision).toBe(1);
  expect(response.body.outcome.updated_at).toMatch(/\.\d{6}Z$/);
  expect((await post(id, { expected_outcome_updated_at: null, driver_decision: 'Rejected' })).status).toBe(409);
  await syntheticDb.query("UPDATE offer_outcomes SET updated_at = '2026-09-10T12:00:00.123456Z' WHERE offer_intelligence_id = $1", [id]);
  const loaded = (await get('/offers')).body.offers[0]; expect(loaded.outcome_updated_at).toBe('2026-09-10T12:00:00.123456Z');
  response = await post(id, { expected_outcome_updated_at: '2026-09-10T07:00:00.123456-05:00', actual_pay: 25 });
  expect(response.status).toBe(200); expect(response.body.outcome).toMatchObject({ revision: 2, actual_pay: 25 });
  const oldTimestamp = response.body.outcome.updated_at;
  response = await post(id, { expected_revision: 2, driver_decision: 'Completed' }); expect(response.status).toBe(200);
  const stale = await post(id, { expected_outcome_updated_at: oldTimestamp, driver_decision: 'Rejected' });
  expect(stale.status).toBe(409); expect(stale.body.error).toBe('outcome_conflict'); expect(stale.body.outcome).toEqual(stale.body.current); expect(stale.body.current).toMatchObject({ revision: 3, driver_decision: 'Completed', actual_pay: 25 });
  await syntheticDb.query("UPDATE offer_outcomes SET updated_at = '2026-09-10T12:00:00.123457Z' WHERE offer_intelligence_id = $1", [id]);
  expect((await post(id, { expected_outcome_updated_at: loaded.outcome_updated_at, driver_decision: 'Rejected' })).status).toBe(409);
  expect((await post(id, { expected_outcome_updated_at: '2026-09-10T12:00:00.123Z', driver_decision: 'Rejected' })).status).toBe(409);
});
test('complete-window stats include beyond 100 visible offers, exact boundaries, separate unknowns and only reported earnings', async () => {
  const ids = [];
  for (let index = 0; index < 130; index++) ids.push(await offer({ decision: index < 80 ? 'ACCEPT' : index < 120 ? 'REJECT' : 'NO DATA' }));
  await offer({ created: '2026-09-03T12:00:00Z' }); // inclusive start
  await offer({ created: '2026-09-10T12:00:00Z' }); // exclusive end
  await offer({ created: '2026-09-03T11:59:59.999Z' });
  await offer({ user: userB });
  await post(ids[0], { expected_revision: null, driver_decision: 'Accepted', actual_pay: 10, extras: 2 });
  await post(ids[1], { expected_revision: null, driver_decision: 'Completed', actual_pay: 0 });
  await post(ids[2], { expected_revision: null, driver_decision: 'Accepted' }); // no earned amount reported
  await post(ids[3], { expected_revision: null, driver_decision: 'Rejected' });
  await post(ids[4], { expected_revision: null, driver_decision: 'Cancelled' });
  await post(ids[5], { expected_revision: null, driver_decision: 'Other' });
  expect((await get('/offers?limit=25')).body.offers).toHaveLength(25);
  const response = await get('/offers/stats?period=7d'); expect(response.status).toBe(200);
  expect(response.body.period).toEqual(offerPeriod('7d', now));
  expect(response.body.stats).toEqual({ analyzed: 131, analyzer_accepted: 81, analyzer_rejected: 40, analyzer_no_data: 10, driver_accepted: 3, driver_rejected: 1, cancelled: 1, other: 1, unrecorded: 125, reported_count: 2, reported_total: 12 });
  expect((await get('/offers/stats?period=30d')).body.stats.analyzed).toBe(132);
  expect((await get('/offers/stats?period=all')).status).toBe(400);
  await syntheticDb.exec('DELETE FROM offer_outcomes; DELETE FROM offer_intelligence;');
  const empty = (await get('/offers/stats?period=90d')).body.stats;
  expect(Object.values(empty).every(value => value === 0)).toBe(true);
});
