// Actual Express router + actual PostgreSQL SQL in disposable in-memory PGlite.
// PGlite may be supplied from an existing installation via NODE_PATH; no live DB is used.
import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
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
const removalMigration = await fs.readFile(new URL('../../migrations/20260928_offer_removal.sql', import.meta.url), 'utf8');
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
      confidence_score double precision, input_mode text, user_override text, response_time_ms integer, raw_text text,
      parsed_data_json jsonb NOT NULL DEFAULT '{}'
    );
  `);
  await syntheticDb.exec(await fs.readFile(new URL('../../migrations/20260703_offer_rulesets_outcomes.sql', import.meta.url), 'utf8'));
  await syntheticDb.exec(migration);
  await syntheticDb.exec(removalMigration);
  await syntheticDb.query('INSERT INTO users (user_id) VALUES ($1), ($2)', [userA, userB]);
  app = express(); app.use(express.json()); app.use('/api/offer-analyzer', router);
}, 20000);
beforeEach(async () => { await syntheticDb.exec('DELETE FROM offer_outcomes; DELETE FROM offer_intelligence;'); });
afterAll(async () => { await syntheticDb?.close(); });
async function offer({ user = userA, decision = 'ACCEPT', created = '2026-09-09T12:00:00Z', price = 12.5 } = {}) {
  const id = randomUUID();
  await syntheticDb.query('INSERT INTO offer_intelligence (id,user_id,created_at,decision,price,raw_text) VALUES ($1,$2,$3,$4,$5,$6)', [id, user, created, decision, price, `original-${id}`]);
  return id;
}
const post = (id, body, user = 'a') => request(app).post(`/api/offer-analyzer/offers/${id}/outcome`).set('Authorization', `Bearer synthetic-${user}`).send(body);
const remove = (id, body, user = 'a') => request(app).post(`/api/offer-analyzer/offers/${id}/remove`).set('Authorization', `Bearer synthetic-${user}`).send(body);
const restore = (id, body, user = 'a') => request(app).post(`/api/offer-analyzer/offers/${id}/restore`).set('Authorization', `Bearer synthetic-${user}`).send(body);
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

test('soft remove and restore are owner-scoped, revision-guarded, reversible, and preserve captures/outcomes', async () => {
  const id = await offer({ created: '2026-09-09T12:00:00Z' });
  await post(id, { expected_revision: null, driver_decision: 'Accepted', actual_pay: 0 });

  const removed = await remove(id, { expected_removal_revision: 0 });
  expect(removed.status).toBe(200);
  expect(removed.body.offer).toMatchObject({ id, removal_revision: 1 });
  expect(removed.body.offer.removed_at).toBeTruthy();
  expect((await get('/offers')).body.offers).toHaveLength(0);
  expect((await get('/offers?include_removed=1')).body.offers[0]).toMatchObject({
    id, removal_revision: 1, actual_pay: 0, driver_decision: 'Accepted',
  });
  expect((await get('/offers/stats?period=7d')).body.stats.analyzed).toBe(0);

  const staleRemove = await remove(id, { expected_removal_revision: 0 });
  expect(staleRemove.status).toBe(409);
  expect(staleRemove.body.current).toMatchObject({ id, removal_revision: 1 });
  expect((await restore(id, { expected_removal_revision: 0 })).status).toBe(409);
  expect((await remove(id, { expected_removal_revision: 0 }, 'b')).status).toBe(404);

  const restored = await restore(id, { expected_removal_revision: 1 });
  expect(restored.status).toBe(200);
  expect(restored.body.offer).toMatchObject({ id, removed_at: null, removal_revision: 2 });
  const persisted = (await syntheticDb.query(
    'SELECT raw_text, decision, price FROM offer_intelligence WHERE id = $1', [id],
  )).rows[0];
  expect(persisted).toEqual({ raw_text: `original-${id}`, decision: 'ACCEPT', price: 12.5 });
  expect((await get('/offers')).body.offers[0]).toMatchObject({
    id, removal_revision: 2, removed_at: null, actual_pay: 0, driver_decision: 'Accepted',
  });
  expect((await get('/offers/stats?period=7d')).body.stats).toMatchObject({
    analyzed: 1, driver_accepted: 1, reported_count: 1, reported_total: 0,
  });
});

test('simultaneous removals serialize at the owner revision and validation is strict', async () => {
  const id = await offer();
  const attempts = await Promise.all([
    remove(id, { expected_removal_revision: 0 }),
    remove(id, { expected_removal_revision: 0 }),
  ]);
  expect(attempts.map(response => response.status).sort()).toEqual([200, 409]);
  expect((await get('/offers?include_removed=1')).body.offers[0].removal_revision).toBe(1);
  for (const expected_removal_revision of [undefined, null, true, '1', -1, 1.5, 2147483647]) {
    expect((await restore(id, { expected_removal_revision })).status).toBe(400);
  }
  expect((await request(app).post(`/api/offer-analyzer/offers/${id}/remove`).set('Authorization', 'Bearer synthetic-a').send({})).status).toBe(400);
});

test('local-day list returns every offer and stats honor timezone DST boundaries and exclude removed', async () => {
  const ids = [];
  const springDayStart = Date.parse('2026-03-08T06:00:00.000Z');
  for (let index = 0; index < 31; index++) {
    ids.push(await offer({ created: new Date(springDayStart + index * 30 * 60_000).toISOString() }));
  }
  const removedId = ids[2];
  await post(removedId, { expected_revision: null, driver_decision: 'Completed', actual_pay: 0 });
  await remove(removedId, { expected_removal_revision: 0 });
  const before = await offer({ created: '2026-03-08T05:59:59.999Z' });
  const end = await offer({ created: '2026-03-09T05:00:00.000Z' });

  const day = await get('/offers?date=2026-03-08&timeZone=America%2FChicago');
  expect(day.status).toBe(200);
  expect(day.body).toMatchObject({ date: '2026-03-08', timeZone: 'America/Chicago', total: 30, include_removed: false });
  expect(day.body.offers).toHaveLength(30);
  expect(day.body.offers.some(offer => offer.id === removedId)).toBe(false);
  expect(day.body.offers.some(offer => offer.id === before || offer.id === end)).toBe(false);

  const includingRemoved = await get('/offers?date=2026-03-08&timeZone=America%2FChicago&include_removed=1');
  expect(includingRemoved.body.offers).toHaveLength(31);
  expect(includingRemoved.body.offers.find(offer => offer.id === removedId)).toMatchObject({
    removed_at: expect.any(String), removal_revision: 1, driver_decision: 'Completed', actual_pay: 0,
  });

  const stats = await get('/offers/stats?date=2026-03-08&timeZone=America%2FChicago');
  expect(stats.status).toBe(200);
  expect(stats.body).toMatchObject({ date: '2026-03-08', timeZone: 'America/Chicago' });
  expect(stats.body.period).toMatchObject({ date: '2026-03-08', timeZone: 'America/Chicago' });
  expect(new Date(stats.body.period.start).toISOString()).toBe('2026-03-08T06:00:00.000Z');
  expect(new Date(stats.body.period.end).toISOString()).toBe('2026-03-09T05:00:00.000Z');
  expect(stats.body.stats).toMatchObject({ analyzed: 30, unrecorded: 30, driver_accepted: 0, reported_total: 0 });

  expect((await remove(removedId, { expected_removal_revision: 1 })).status).toBe(409);
  await restore(removedId, { expected_removal_revision: 1 });
  expect((await get('/offers/stats?date=2026-03-08&timeZone=America%2FChicago')).body.stats)
    .toMatchObject({ analyzed: 31, driver_accepted: 1, reported_count: 1, reported_total: 0 });
  expect((await get('/offers?date=2026-03-08&timeZone=America%2FChicago')).body.offers).toHaveLength(31);
});

test('local-day validation fails loud and empty days return zero complete counts', async () => {
  expect((await get('/offers?date=2026-02-30&timeZone=UTC')).status).toBe(400);
  expect((await get('/offers?date=0000-01-01&timeZone=UTC')).status).toBe(400);
  expect((await get('/offers?date=2026-03-08')).status).toBe(400);
  expect((await get('/offers?date=2026-03-08&timeZone=Not%2FAZone')).status).toBe(400);
  expect((await get('/offers/stats?date=2026-03-08&timeZone=Not%2FAZone')).status).toBe(400);
  const empty = await get('/offers/stats?date=2026-03-08&timeZone=America%2FChicago');
  expect(empty.status).toBe(200);
  expect(empty.body.stats.analyzed).toBe(0);
  expect(empty.body.stats.unrecorded).toBe(0);
  expect(empty.body.stats.reported_total).toBe(0);
  expect((await get('/offers?date=2026-03-08&timeZone=America%2FChicago')).body.offers).toEqual([]);
  const fallBack = await get('/offers/stats?date=2026-11-01&timeZone=America%2FChicago');
  expect(fallBack.status).toBe(200);
  expect(new Date(fallBack.body.period.start).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  expect(new Date(fallBack.body.period.end).toISOString()).toBe('2026-11-02T06:00:00.000Z');
});
