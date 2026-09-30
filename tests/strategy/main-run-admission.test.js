import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import * as schema from '../../shared/schema.js';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';
import { hashRuleset } from '../../server/lib/offers/ruleset-hash.js';

// Actual PostgreSQL in disposable memory; the workspace database is never opened.
let pg, orm, app, auth, profileId, vehicleId;
const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, _res, next) { req.auth = { ...auth }; next(); } }));
const forbidden = jest.fn(async () => { throw new Error('Unexpected external request'); });
const geocodeAddress = jest.fn();
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ geocodeAddress }));
jest.unstable_mockModule('../../server/lib/location/address-validation.js', () => ({ validateAddress: forbidden }));
jest.unstable_mockModule('../../server/lib/markets/ensure-market.js', () => ({ ensureMarket: forbidden }));
jest.unstable_mockModule('../../server/lib/auth/oauth/google-oauth.js', () => ({ getGoogleAuthUrl: forbidden, exchangeGoogleCode: forbidden, verifyGoogleIdToken: forbidden, generateState: forbidden }));
jest.unstable_mockModule('../../server/lib/auth/email.js', () => ({ sendPasswordResetEmail: forbidden, sendEmailVerification: forbidden, sendWelcomeEmail: forbidden, isEmailConfigured: () => false }));
jest.unstable_mockModule('../../server/lib/auth/sms.js', () => ({ sendPasswordResetSMS: forbidden, isSmsConfigured: () => false, validatePhoneNumber: phone => ({ valid: true, formatted: phone }) }));
jest.unstable_mockModule('../../server/lib/jwt.js', () => ({ signJWT: forbidden }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ matrixLog: new Proxy({}, { get: () => jest.fn() }) }));
const { default: runRouter } = await import('../../server/api/strategy/main-runs.js');
const { default: authRouter } = await import('../../server/api/auth/auth.js');
const { default: rulesRouter } = await import('../../server/api/offer-analyzer/index.js');
const { assertCurrentMainRun, assertMainRunForSnapshot, withCurrentMainRun, withDriverSettingsLock, bindMainRunSnapshot } = await import('../../server/lib/main-run-admission.js');
const config = migrateRuleset(null), rulesHash = hashRuleset(config);
const intent = (extra = {}) => ({ requestId: randomUUID(), expectedSettingsRevision: 1, expectedRulesVersion: 1, expectedRulesHash: rulesHash, expectedRunId: null, ...extra });
const start = body => request(app).post('/runs/continue').send(body);
const save = body => request(app).put('/auth/profile').send({ expectedSettingsRevision: 1, ...body });

beforeAll(async () => {
  pg = new PGlite();
  // Build the five pre-admission tables from the existing ORM column types.
  // This harness intentionally omits new P1 columns so the actual migration adds them.
  for (const table of [schema.users, schema.driver_profiles, schema.driver_vehicles, schema.offer_rulesets, schema.snapshots]) {
    const { name, columns } = getTableConfig(table);
    const definitions = columns.filter(c => !['current_main_run_id', 'settings_revision', 'selected_services'].includes(c.name)).map(column => {
      const defaultSql = column.name === 'id' ? ' DEFAULT gen_random_uuid()' :
        ['created_at', 'updated_at'].includes(column.name) ? ' DEFAULT now()' : '';
      return `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${defaultSql}`;
    });
    await pg.exec(`CREATE TABLE "${name}" (${definitions.join(', ')})`);
  }
  await pg.exec('CREATE UNIQUE INDEX offer_rulesets_user_fixture ON offer_rulesets(user_id)');
  const migration = await readFile(new URL('../../migrations/20260929_main_run_admissions.sql', import.meta.url), 'utf8');
  await pg.exec(migration); await pg.exec(migration);
  orm = drizzle(pg, { schema });
  app = express().use(express.json()).use('/runs', runRouter).use('/auth', authRouter).use('/rules-api', rulesRouter);
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM main_run_admissions; DELETE FROM snapshots; DELETE FROM offer_rulesets; DELETE FROM driver_vehicles; DELETE FROM driver_profiles; DELETE FROM users;');
  auth = { userId, sessionId }; profileId = randomUUID(); vehicleId = randomUUID();
  await pg.query('INSERT INTO users(user_id,session_id,session_start_at,last_active_at) VALUES ($1,$2,now(),now())', [userId, sessionId]);
  await pg.query(`INSERT INTO driver_profiles(id,user_id,first_name,last_name,email,phone,address_1,city,state_territory,country,market,
    rideshare_platforms,terms_accepted,elig_economy,elig_comfort,selected_services,shortcut_token,home_formatted_address)
    VALUES ($1,$2,'Synthetic','Driver','driver@example.test','+15555550100','Fixture street','Fixture city','TX','US','Fixture market',
    '["uber"]',true,true,true,'["economy"]','NEVER-PIN-THIS','NEVER-PIN-HOME')`, [profileId, userId]);
  await pg.query(`INSERT INTO driver_vehicles(id,driver_profile_id,year,make,model,seatbelts,is_primary,is_active) VALUES ($1,$2,2020,'Test','Car',4,true,true)`, [vehicleId, profileId]);
  await pg.query('INSERT INTO offer_rulesets(user_id,version,config,config_hash) VALUES ($1,1,$2,$3)', [userId, JSON.stringify(config), rulesHash]);
  jest.clearAllMocks();
});
afterAll(async () => { await pg?.close(); });

test('initial setup requires saved rules and service selection, without inferring eligibility', async () => {
  const ready = await request(app).get('/runs/setup');
  expect(ready.status).toBe(200);
  expect(ready.body).toMatchObject({ ready: true, settingsRevision: 1, rulesVersion: 1, currentRun: null, profile: { selectedServices: ['economy'] } });
  await pg.exec('UPDATE driver_profiles SET selected_services = NULL; DELETE FROM offer_rulesets');
  const held = await request(app).get('/runs/setup');
  expect(held.body.ready).toBe(false);
  expect(held.body.missingFields).toEqual(expect.arrayContaining(['profile.selectedServices', 'offerRules']));
  expect((await start(intent())).status).toBe(409);
  expect((await pg.query('SELECT count(*)::int AS n FROM main_run_admissions')).rows[0].n).toBe(0);
});

test('legacy saved setup can Continue without changes and retains null selection in storage and the receipt', async () => {
  await pg.exec('UPDATE driver_profiles SET selected_services = NULL');
  const setup = await request(app).get('/runs/setup');
  expect(setup.body).toMatchObject({ ready: true, missingFields: [], rulesHash, profile: { selectedServices: null } });
  const admitted = await start(intent());
  expect(admitted.status).toBe(201);
  expect(admitted.body.configuration.profile.selected_services).toBeNull();
  expect(admitted.body.configuration.rules).toEqual({ config, version: 1, hash: rulesHash });
  expect((await pg.query('SELECT selected_services, settings_revision FROM driver_profiles')).rows[0])
    .toEqual({ selected_services: null, settings_revision: 1 });
  expect((await pg.query('SELECT version, config_hash FROM offer_rulesets')).rows[0])
    .toEqual({ version: 1, config_hash: rulesHash });
});

test('older saved rules retain their raw hash while Continue pins the same effective config as Analyzer', async () => {
  const legacyConfig = JSON.parse(JSON.stringify(config));
  legacyConfig.schema_version = 2;
  legacyConfig.tiers.standard.floor_per_mile = 1.23;
  delete legacyConfig.delivery;
  delete legacyConfig.sanity;
  const legacyHash = hashRuleset(legacyConfig);
  const effectiveConfig = migrateRuleset(legacyConfig);
  expect(legacyHash).not.toBe(hashRuleset(effectiveConfig));
  await pg.exec('UPDATE driver_profiles SET selected_services = NULL');
  await pg.query('UPDATE offer_rulesets SET config = $1, config_hash = $2', [JSON.stringify(legacyConfig), legacyHash]);
  const setup = await request(app).get('/runs/setup').expect(200);
  const analyzer = await request(app).get('/rules-api/rules').expect(200);
  expect(setup.body).toMatchObject({ ready: true, missingFields: [], rulesHash: legacyHash, rules: effectiveConfig,
    profile: { selectedServices: null } });
  expect(analyzer.body).toMatchObject({ config: effectiveConfig, hash: legacyHash, version: 1 });
  expect(setup.body.rules).toEqual(analyzer.body.config);
  const admitted = await start(intent({ expectedRulesHash: legacyHash }));
  expect(admitted.status).toBe(201);
  expect(admitted.body.rulesHash).toBe(legacyHash);
  expect(admitted.body.configuration.profile.selected_services).toBeNull();
  expect(admitted.body.configuration.rules).toEqual({ config: effectiveConfig, version: 1, hash: legacyHash });
  expect((await pg.query('SELECT config, config_hash, version FROM offer_rulesets')).rows[0])
    .toEqual({ config: legacyConfig, config_hash: legacyHash, version: 1 });
  expect((await pg.query('SELECT selected_services, settings_revision FROM driver_profiles')).rows[0])
    .toEqual({ selected_services: null, settings_revision: 1 });
});

test.each(['raw hash mismatch', 'missing global', 'invalid global'])('Continue rejects %s instead of manufacturing saved rules', async invalidPart => {
  const stored = JSON.parse(JSON.stringify(config));
  if (invalidPart === 'missing global') delete stored.global;
  if (invalidPart === 'invalid global') stored.global = [];
  const storedHash = invalidPart === 'raw hash mismatch' ? 'a'.repeat(64) : hashRuleset(stored);
  await pg.query('UPDATE offer_rulesets SET config = $1, config_hash = $2', [JSON.stringify(stored), storedHash]);
  const setup = await request(app).get('/runs/setup').expect(200);
  expect(setup.body).toMatchObject({ ready: false, missingFields: ['offerRules.invalid'], rules: null });
  const held = await start(intent({ expectedRulesHash: storedHash }));
  expect(held.status).toBe(409);
  expect(held.body).toMatchObject({ error: 'setup_incomplete', missingFields: ['offerRules.invalid'] });
  expect((await pg.query('SELECT count(*)::int AS n FROM main_run_admissions')).rows[0].n).toBe(0);
  expect((await pg.query('SELECT config, config_hash, version FROM offer_rulesets')).rows[0])
    .toEqual({ config: stored, config_hash: storedHash, version: 1 });
});

test('same Continue intent is idempotent across requests and a distinct stale-tab intent conflicts', async () => {
  const body = intent();
  const results = await Promise.all([start(body), start(body)]);
  expect(results.map(r => r.status).sort()).toEqual([200, 201]);
  expect(new Set(results.map(r => r.body.runId)).size).toBe(1);
  const first = results[0].body;
  expect(first.configuration.profile).toMatchObject({ selected_services: ['economy'], elig_comfort: true });
  expect(JSON.stringify(first.configuration)).not.toMatch(/NEVER-PIN|shortcut_token|first_name|home_formatted_address|email/);
  expect((await start(intent())).status).toBe(409);
  const second = await start(intent({ expectedRunId: first.runId }));
  expect(second.status).toBe(201); expect(second.body.runId).not.toBe(first.runId);
  expect((await start(body)).body).toMatchObject({ runId: first.runId, replayed: true, current: false });
  expect((await pg.query('SELECT count(*)::int AS n FROM main_run_admissions')).rows[0].n).toBe(2);
});

test('profile and vehicle commit in one revision, concurrent saves conflict, and save never starts generation', async () => {
  const results = await Promise.all([
    save({ nickname: 'Winner A', vehicle: { make: 'One' }, selectedServices: ['comfort'] }),
    save({ nickname: 'Winner B', vehicle: { make: 'Two' }, selectedServices: ['economy'] }),
  ]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const saved = results.find(r => r.status === 200).body;
  expect(saved.settingsRevision).toBe(2);
  expect(saved.vehicle.make).toBe(saved.profile.nickname === 'Winner A' ? 'One' : 'Two');
  expect((await pg.query('SELECT count(*)::int AS n FROM main_run_admissions')).rows[0].n).toBe(0);
  expect((await save({ expectedSettingsRevision: 2, nickname: 'Must not save', vehicle: { year: 0 } })).status).toBe(400);
  expect((await request(app).get('/runs/setup')).body.settingsRevision).toBe(2);
  expect(forbidden).not.toHaveBeenCalled();
});

test('settings save invalidates replay and stage publication while retaining original admission', async () => {
  const body = intent(), admitted = (await start(body)).body;
  expect((await save({ selectedServices: ['comfort'] })).status).toBe(200);
  expect((await start(body)).body).toMatchObject({ runId: admitted.runId, replayed: true, current: false });
  await expect(assertCurrentMainRun(auth, admitted.runId)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect((await start(intent({ expectedRunId: admitted.runId }))).body.error).toBe('settings_conflict');
  const newer = await start(intent({ expectedRunId: admitted.runId, expectedSettingsRevision: 2 }));
  expect(newer.status).toBe(201);
  expect(newer.body.configuration.profile.selected_services).toEqual(['comfort']);
});

test('snapshot binding deduplicates late capture responses and fences a superseded worker atomically', async () => {
  const admitted = (await start(intent())).body;
  const snapshot = { snapshot_id: randomUUID(), user_id: userId, session_id: sessionId, created_at: new Date(), lat: 1.123456789, lng: 2.987654321 };
  const first = await withDriverSettingsLock(auth, tx => bindMainRunSnapshot(tx, auth, admitted.runId, snapshot));
  const duplicate = await withDriverSettingsLock(auth, tx => bindMainRunSnapshot(tx, auth, admitted.runId, { ...snapshot, snapshot_id: randomUUID() }));
  expect(duplicate.snapshot_id).toBe(first.snapshot_id);
  expect(first.lat).toBe(1.123456789);
  expect((await assertMainRunForSnapshot(first.snapshot_id)).run_id).toBe(admitted.runId);
  const publish = jest.fn(async tx => { await tx.execute(sql`UPDATE main_run_admissions SET status = 'complete' WHERE run_id = ${admitted.runId}`); });
  await withCurrentMainRun(first.snapshot_id, publish); expect(publish).toHaveBeenCalledTimes(1);
  const next = (await start(intent({ expectedRunId: admitted.runId }))).body;
  await expect(withCurrentMainRun(first.snapshot_id, publish)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect(publish).toHaveBeenCalledTimes(1);
  expect((await pg.query('SELECT status FROM main_run_admissions WHERE run_id=$1', [admitted.runId])).rows[0].status).toBe('complete');
  await expect(withDriverSettingsLock(auth, tx => bindMainRunSnapshot(tx, auth, next.runId, { ...snapshot, snapshot_id: randomUUID(), created_at: new Date(0) })))
    .rejects.toMatchObject({ code: 'main_run_snapshot_mismatch' });
});

test('rules save requires exact version, invalidates old admission, and a different session cannot use it', async () => {
  const admitted = (await start(intent())).body;
  expect((await request(app).put('/rules-api/rules').send({ config })).status).toBe(400);
  const saved = await request(app).put('/rules-api/rules').send({ config, expected_version: 1 });
  expect(saved.status).toBe(200); expect(saved.body.version).toBe(2);
  expect((await request(app).put('/rules-api/rules').send({ config, expected_version: 1 })).status).toBe(409);
  await expect(assertCurrentMainRun(auth, admitted.runId)).rejects.toMatchObject({ code: 'main_run_superseded' });
  await pg.query('UPDATE users SET session_id=$1', [randomUUID()]);
  expect((await start(intent())).status).toBe(401);
  expect((await save({ nickname: 'Old session' })).status).toBe(401);
});

test.each([
  ['missing', undefined], ['null', null], ['boolean', false], ['number', 7], ['string', 'rules'],
  ['array', []], ['empty object', {}], ['null global', { global: null }], ['array global', { global: [] }],
  ['empty global', { global: {} }], ['missing rating floor', { global: { require_verified: true } }],
  ['missing verification rule', { global: { rating_floor: 4.93 } }],
])('malformed %s rules save cannot replace personal rules or invalidate its admitted run', async (_label, malformed) => {
  const personal = JSON.parse(JSON.stringify(config));
  personal.global.rating_floor = 4.93;
  personal.avoid = [{ place_id: 'fixture-place', label: 'Fixture avoided place', lat: 30, lng: -97,
    mode: 'destination_in', radius_mi: 2, enabled: true }];
  const personalHash = hashRuleset(personal);
  await pg.query('UPDATE offer_rulesets SET config=$1, config_hash=$2', [JSON.stringify(personal), personalHash]);
  const body = intent({ expectedRulesHash: personalHash });
  const admitted = await start(body).expect(201);
  const rejected = await request(app).put('/rules-api/rules').send({ config: malformed, expected_version: 1 });
  expect(rejected.status).toBe(422);
  expect((await pg.query('SELECT config,config_hash,version FROM offer_rulesets')).rows)
    .toEqual([{ config: personal, config_hash: personalHash, version: 1 }]);
  expect((await start(body)).body).toMatchObject({ runId: admitted.body.runId, replayed: true, current: true });
  await pg.query('UPDATE driver_profiles SET settings_revision=2');
  expect((await start(body)).body).toMatchObject({ runId: admitted.body.runId, replayed: true, current: false });
  expect(forbidden).not.toHaveBeenCalled();
});

test.each(['full', 'original core only'])('valid %s legacy rules save migrates omitted newer fields while preserving driver choices', async shape => {
  let legacy = JSON.parse(JSON.stringify(config));
  legacy.schema_version = 2;
  legacy.global.rating_floor = 4.73;
  legacy.tiers.standard.floor_per_mile = 1.23;
  delete legacy.delivery;
  delete legacy.sanity;
  if (shape === 'original core only') legacy = { schema_version: 2, global: { rating_floor: 4.73, require_verified: false } };
  const expected = migrateRuleset(legacy);
  const saved = await request(app).put('/rules-api/rules').send({ config: legacy, expected_version: 1 }).expect(200);
  expect(saved.body).toMatchObject({ version: 2, config: expected, hash: hashRuleset(expected) });
  expect((await pg.query('SELECT config,config_hash,version FROM offer_rulesets')).rows)
    .toEqual([{ config: expected, config_hash: hashRuleset(expected), version: 2 }]);
});

test('vehicle insert failure rolls back profile changes and revisions', async () => {
  await pg.exec('DELETE FROM driver_vehicles');
  const failed = await save({ nickname: 'Must not persist', vehicle: { make: 'Incomplete' } });
  expect(failed.status).toBe(400);
  const row = (await pg.query('SELECT driver_nickname,settings_revision FROM driver_profiles')).rows[0];
  expect(row).toEqual({ driver_nickname: null, settings_revision: 1 });
});

test.each(['last_active_at', 'session_start_at'])('background publication rejects expired %s before lazy logout', async column => {
  const admitted = (await start(intent())).body;
  await pg.exec(`UPDATE users SET ${column} = now() - INTERVAL '3 hours'`);
  await expect(assertCurrentMainRun(auth, admitted.runId)).rejects.toMatchObject({ code: 'main_run_superseded' });
});

test('concurrent first rules saves cannot overwrite one another and numeric expectation cannot create a missing row', async () => {
  await pg.exec('DELETE FROM offer_rulesets');
  expect((await request(app).put('/rules-api/rules').send({ config, expected_version: 1 })).status).toBe(409);
  const responses = await Promise.all([
    request(app).put('/rules-api/rules').send({ config, expected_version: null }),
    request(app).put('/rules-api/rules').send({ config, expected_version: null }),
  ]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await pg.query('SELECT version FROM offer_rulesets')).rows).toEqual([{ version: 1 }]);
});

test('Continue rejects coerced identities and selected services never overwrite capability flags', async () => {
  expect((await start(intent({ requestId: [randomUUID()] }))).status).toBe(400);
  expect((await start(intent({ expectedRunId: [randomUUID()] }))).status).toBe(400);
  expect((await save({ selectedServices: ['xl'] })).status).toBe(400);
  expect((await save({ selectedServices: ['comfort'] })).status).toBe(200);
  const row = (await pg.query('SELECT elig_economy,elig_comfort,selected_services FROM driver_profiles')).rows[0];
  expect(row).toEqual({ elig_economy: true, elig_comfort: true, selected_services: ['comfort'] });
});
