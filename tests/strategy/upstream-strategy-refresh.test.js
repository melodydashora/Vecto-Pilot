import { beforeAll, beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schema.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';
import { hashRuleset } from '../../server/lib/offers/ruleset-hash.js';

// Real SQL in disposable memory. Providers and every connection boundary are
// mocked before production modules load; the workspace database is never used.
let pg, orm, auth;
const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const location = jest.fn(), environment = jest.fn(), market = jest.fn();
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ resolveFreshGpsLocation: location }));
jest.unstable_mockModule('../../server/lib/location/snapshot-environment.js', () => ({ snapshotEnvironment: { both: environment } }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromMarket: market }));
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, locationLog: log, OP: {} }));
jest.unstable_mockModule('../../server/lib/briefing/dump-last-briefing.js', () => ({ dumpLastBriefingRow: async () => {} }));
const sections = Object.fromEntries(['weather', 'traffic', 'events', 'airport', 'news', 'schools', 'holiday'].map(key => [key, jest.fn()]));
for (const [name, fn] of Object.entries(sections)) {
  jest.unstable_mockModule(`../../server/lib/briefing/pipelines/${name}.js`, () => ({ [`discover${name[0].toUpperCase()}${name.slice(1)}`]: fn }));
}
const { captureUpstreamSnapshot, captureMainRunSnapshot } = await import('../../server/lib/location/main-run-snapshot.js');
const { continueMainRun, getMainRunSetup, assertCurrentMainRun, assertMainRunForSnapshot, withCurrentMainRun } = await import('../../server/lib/main-run-admission.js');
const { generateAndStoreBriefing } = await import('../../server/lib/briefing/briefing-aggregator.js');
const config = migrateRuleset(null), rulesHash = hashRuleset(config);
const input = () => ({ lat: 1.123456789, lng: -2.123456789, accuracy: 5, gps_timestamp: Date.now(), permission: 'granted' });
const capture = (captureId = randomUUID(), body = input()) => captureUpstreamSnapshot(auth, captureId, body);
const intent = (snapshot, extra = {}) => ({ requestId: randomUUID(), expectedSettingsRevision: 1,
  expectedRulesVersion: 1, expectedRulesHash: rulesHash, expectedRunId: null,
  expectedSnapshotId: snapshot.snapshot_id, ...extra });
const prepared = async () => {
  const snapshot = await capture();
  const result = await generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id });
  expect(result.complete).toBe(true);
  return snapshot;
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const readSnapshot = async id => (await orm.select().from(schema.snapshots).where(eq(schema.snapshots.snapshot_id, id)))[0];
const admitLegacy = async (expectedRunId = null) => {
  const body = intent({ snapshot_id: randomUUID() }, { expectedRunId });
  delete body.expectedSnapshotId;
  return continueMainRun(auth, body);
};

beforeAll(async () => {
  pg = new PGlite();
  for (const table of [schema.users, schema.driver_profiles, schema.driver_vehicles, schema.offer_rulesets, schema.snapshots, schema.briefings]) {
    const { name, columns } = getTableConfig(table);
    const definitions = columns.map(column => {
      const defaultSql = column.name === 'id' ? ' DEFAULT gen_random_uuid()' :
        ['created_at', 'updated_at'].includes(column.name) ? ' DEFAULT now()' : '';
      return `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${defaultSql}`;
    });
    await pg.exec(`CREATE TABLE "${name}" (${definitions.join(', ')})`);
  }
  await pg.exec('CREATE UNIQUE INDEX briefing_snapshot_fixture ON briefings(snapshot_id)');
  await pg.exec(await readFile(new URL('../../migrations/20260929_main_run_admissions.sql', import.meta.url), 'utf8'));
  orm = drizzle(pg, { schema });
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM main_run_admissions; DELETE FROM briefings; DELETE FROM snapshots; DELETE FROM offer_rulesets; DELETE FROM driver_vehicles; DELETE FROM driver_profiles; DELETE FROM users;');
  auth = { userId, sessionId };
  const profileId = randomUUID();
  await pg.query('INSERT INTO users(user_id,session_id,session_start_at,last_active_at) VALUES ($1,$2,now(),now())', [userId, sessionId]);
  await pg.query(`INSERT INTO driver_profiles(id,user_id,settings_revision,phone,address_1,city,state_territory,country,market,
    rideshare_platforms,terms_accepted,elig_economy,selected_services)
    VALUES ($1,$2,1,'+15555550100','Fixture street','Fixture city','TX','US','Fixture market','["uber"]',true,true,'["economy"]')`, [profileId, userId]);
  await pg.query(`INSERT INTO driver_vehicles(id,driver_profile_id,year,make,model,seatbelts,is_primary,is_active)
    VALUES ($1,$2,2020,'Test','Car',4,true,true)`, [randomUUID(), profileId]);
  await pg.query('INSERT INTO offer_rulesets(user_id,version,config,config_hash) VALUES ($1,1,$2,$3)', [userId, JSON.stringify(config), rulesHash]);
  jest.clearAllMocks();
  location.mockResolvedValue({ city: 'Fixture city', state: 'Fixture region', country: 'US', formattedAddress: 'Fixture resolved address', timeZone: 'Etc/UTC' });
  market.mockResolvedValue({ market_name: 'Fixture current market' });
  environment.mockImplementation(async (lat, lng) => {
    const ready = completeSnapshot({ lat, lng, timezone: 'Etc/UTC', createdAt: new Date() });
    return { weather: ready.weather, air: ready.air };
  });
  const ready = completeBriefing('fixture');
  sections.weather.mockResolvedValue({ weather_current: ready.weather_current, weather_forecast: ready.weather_forecast });
  sections.traffic.mockResolvedValue({ traffic_conditions: ready.traffic_conditions });
  sections.events.mockResolvedValue({ events: ready.events });
  sections.news.mockResolvedValue({ news: ready.news });
  sections.schools.mockResolvedValue({ closures: [], reason: 'Successful search found no closures' });
  sections.airport.mockResolvedValue({ airport_conditions: ready.airport_conditions });
  sections.holiday.mockResolvedValue({ holiday: ready.holiday });
});
afterAll(async () => { await pg?.close(); });

test('incomplete saved setup can prepare GPS and Briefing, but cannot dispatch Strategy', async () => {
  await pg.exec('DELETE FROM offer_rulesets');
  const snapshot = await prepared();
  expect((await getMainRunSetup(auth)).currentSnapshot).toMatchObject({ snapshot_id: snapshot.snapshot_id, ready: true, briefingReady: true });
  await expect(assertMainRunForSnapshot(snapshot.snapshot_id)).rejects.toMatchObject({ code: 'main_run_required' });
  await expect(continueMainRun(auth, intent(snapshot))).rejects.toMatchObject({ code: 'setup_incomplete' });
  expect((await pg.query('SELECT count(*)::int AS n FROM main_run_admissions')).rows[0].n).toBe(0);
});

test('editing settings does not cancel independent upstream Briefing generation', async () => {
  const snapshot = await capture();
  let release;
  sections.events.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const pending = generateAndStoreBriefing({ snapshotId: snapshot.snapshot_id });
  while (!sections.events.mock.calls.length) await tick();
  await pg.exec('UPDATE driver_profiles SET settings_revision=2');
  release({ events: { items: [], reason: 'Successful search found no events' } });
  expect((await pending).complete).toBe(true);
  expect((await getMainRunSetup(auth)).currentSnapshot.briefingReady).toBe(true);
});

test('Continue atomically consumes exact immutable source without refetching upstream', async () => {
  const source = await prepared();
  const firstBriefing = (await orm.select().from(schema.briefings).where(eq(schema.briefings.snapshot_id, source.snapshot_id)))[0];
  const run = await continueMainRun(auth, intent(source));
  expect(run.snapshotId).not.toBe(source.snapshot_id);
  expect(run.sourceSnapshotId).toBe(source.snapshot_id);
  expect(run.configuration.context_source).toMatchObject({ snapshot_id: source.snapshot_id,
    briefing_generation_token: firstBriefing.generation_token, captured_at: source.created_at.toISOString() });
  const consumed = await readSnapshot(run.snapshotId);
  expect(consumed.created_at).toEqual(source.created_at);
  expect(consumed.permissions.observed_at).toBe(source.permissions.observed_at);
  expect(consumed.weather).toEqual(source.weather);
  const briefing = (await orm.select().from(schema.briefings).where(eq(schema.briefings.snapshot_id, run.snapshotId)))[0];
  expect(briefing.generated_at).toEqual(firstBriefing.generated_at);
  expect(briefing.generation_token).toBe(firstBriefing.generation_token);
  expect(location).toHaveBeenCalledTimes(1);
  expect(environment).toHaveBeenCalledTimes(1);
  for (const provider of Object.values(sections)) expect(provider).toHaveBeenCalledTimes(1);
  expect((await assertMainRunForSnapshot(run.snapshotId)).run_id).toBe(run.runId);
  expect((await getMainRunSetup(auth)).currentSnapshot).toMatchObject({ snapshot_id: run.snapshotId, sourceSnapshotId: source.snapshot_id, briefingReady: true });
});

test('request replay binds once and another explicit Refresh retains original run evidence', async () => {
  const source = await prepared(), body = intent(source);
  const first = await continueMainRun(auth, body);
  expect(await continueMainRun(auth, body)).toMatchObject({ runId: first.runId, snapshotId: first.snapshotId, replayed: true });
  await expect(continueMainRun(auth, { ...body, expectedSnapshotId: first.snapshotId })).rejects.toMatchObject({ code: 'continue_intent_conflict' });
  const next = await continueMainRun(auth, intent({ snapshot_id: first.snapshotId }, { expectedRunId: first.runId }));
  expect(next.snapshotId).not.toBe(first.snapshotId);
  expect(next.sourceSnapshotId).toBe(source.snapshot_id);
  expect(await readSnapshot(first.snapshotId)).toBeTruthy();
  expect((await pg.query('SELECT count(*)::int AS n FROM main_run_admissions')).rows[0].n).toBe(2);
  await expect(assertCurrentMainRun(auth, first.runId)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect(environment).toHaveBeenCalledTimes(1);
});

test('new upstream capture does not revoke the old Strategy until explicit replacement', async () => {
  const oldSource = await prepared();
  const oldRun = await continueMainRun(auth, intent(oldSource));
  const newSource = await prepared();
  expect((await assertCurrentMainRun(auth, oldRun.runId)).run_id).toBe(oldRun.runId);
  const writer = jest.fn();
  await withCurrentMainRun(oldRun.snapshotId, writer);
  expect(writer).toHaveBeenCalledTimes(1);
  await expect(continueMainRun(auth, intent(oldSource, { expectedRunId: oldRun.runId }))).rejects.toMatchObject({ code: 'context_conflict' });
  const newRun = await continueMainRun(auth, intent(newSource, { expectedRunId: oldRun.runId }));
  await expect(withCurrentMainRun(oldRun.snapshotId, writer)).rejects.toMatchObject({ code: 'main_run_superseded' });
  expect(newRun.sourceSnapshotId).toBe(newSource.snapshot_id);
});

test('a current unbound legacy capture records its failure and a successful retry clears the saved error', async () => {
  const run = await admitLegacy();
  location.mockRejectedValueOnce(new Error('private provider fixture failure'));
  await expect(captureMainRunSnapshot(auth, run.runId, input())).rejects.toMatchObject({ code: 'snapshot_collection_failed' });
  expect((await getMainRunSetup(auth)).currentRun).toMatchObject({ runId: run.runId,
    status: 'awaiting_snapshot', errorCode: 'snapshot_collection_failed', snapshotId: null });
  expect((await pg.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(0);
  const saved = await captureMainRunSnapshot(auth, run.runId, input());
  expect((await getMainRunSetup(auth)).currentRun).toMatchObject({ runId: run.runId,
    status: 'running', errorCode: null, snapshotId: saved.snapshot_id });
  expect(location).toHaveBeenCalledTimes(2);
  expect((await pg.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(1);
});

test('late legacy capture failure cannot change a newer admission', async () => {
  const oldRun = await admitLegacy();
  let fail;
  location.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const pending = captureMainRunSnapshot(auth, oldRun.runId, input()).catch(error => error);
  while (!fail) await tick();
  const replacement = await admitLegacy(oldRun.runId);
  fail(new Error('late private provider failure'));
  expect(await pending).toMatchObject({ code: 'snapshot_collection_failed' });
  const admissions = (await pg.query('SELECT run_id,error_code,snapshot_id,status FROM main_run_admissions')).rows;
  expect(admissions).toHaveLength(2);
  for (const admission of admissions) expect(admission).toMatchObject({ error_code: null,
    snapshot_id: null, status: 'awaiting_snapshot' });
  expect((await getMainRunSetup(auth)).currentRun.runId).toBe(replacement.runId);
});

test('late losing legacy capture failure cannot change the already bound winning snapshot', async () => {
  const run = await admitLegacy();
  let fail;
  location.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const pending = captureMainRunSnapshot(auth, run.runId, input()).catch(error => error);
  while (!fail) await tick();
  const saved = await captureMainRunSnapshot(auth, run.runId, { ...input(), lat: 3 });
  fail(new Error('late private provider failure'));
  expect(await pending).toMatchObject({ code: 'snapshot_collection_failed' });
  expect((await getMainRunSetup(auth)).currentRun).toMatchObject({ runId: run.runId,
    errorCode: null, status: 'running', snapshotId: saved.snapshot_id });
  expect((await pg.query('SELECT snapshot_id FROM snapshots')).rows).toEqual([{ snapshot_id: saved.snapshot_id }]);
});

test('component refresh can repeatedly use the original displayed source identity', async () => {
  const source = await prepared();
  const first = await continueMainRun(auth, intent(source));
  const second = await continueMainRun(auth, intent(source, { expectedRunId: first.runId }));
  const third = await continueMainRun(auth, intent(source, { expectedRunId: second.runId }));
  expect(new Set([first.snapshotId, second.snapshotId, third.snapshotId]).size).toBe(3);
  expect([first.sourceSnapshotId, second.sourceSnapshotId, third.sourceSnapshotId]).toEqual([
    source.snapshot_id, source.snapshot_id, source.snapshot_id,
  ]);
  await expect(continueMainRun(auth, intent({ snapshot_id: first.snapshotId }, { expectedRunId: third.runId })))
    .rejects.toMatchObject({ code: 'context_conflict' });
  expect(environment).toHaveBeenCalledTimes(1);
});

test('Continue cannot consume pending, failed or missing-generation Briefing', async () => {
  const source = await capture();
  await expect(continueMainRun(auth, intent(source))).rejects.toMatchObject({ code: 'briefing_pending' });
  await generateAndStoreBriefing({ snapshotId: source.snapshot_id });
  await pg.query("UPDATE briefings SET status='error' WHERE snapshot_id=$1", [source.snapshot_id]);
  await expect(continueMainRun(auth, intent(source))).rejects.toMatchObject({ code: 'briefing_failed' });
  await pg.query("UPDATE briefings SET status='complete', generation_token=NULL WHERE snapshot_id=$1", [source.snapshot_id]);
  await expect(continueMainRun(auth, intent(source))).rejects.toMatchObject({ code: 'briefing_pending' });
  expect((await pg.query('SELECT count(*)::int AS n FROM main_run_admissions')).rows[0].n).toBe(0);
});

test('a late previous GPS result cannot displace the newer context', async () => {
  let release;
  environment.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const oldId = randomUUID(), body = input();
  const older = capture(oldId, body).catch(error => error);
  while (!release) await tick();
  const newer = await capture();
  const ready = completeSnapshot({ lat: body.lat, lng: body.lng, createdAt: new Date() });
  release({ weather: ready.weather, air: ready.air });
  expect(await older).toMatchObject({ code: 'context_superseded' });
  expect(await readSnapshot(oldId)).toBeUndefined();
  expect((await getMainRunSetup(auth)).currentSnapshot.snapshot_id).toBe(newer.snapshot_id);
});

test('setup distinguishes a claimed unfinished capture from an initial session with no context', async () => {
  expect(await getMainRunSetup(auth)).toMatchObject({ currentSnapshot: null, currentSnapshotId: null, currentContextPending: false });
  let release;
  environment.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const id = randomUUID(), body = input();
  const pending = capture(id, body);
  while (!release) await tick();
  expect(await getMainRunSetup(auth)).toMatchObject({ currentSnapshot: null, currentSnapshotId: id, currentContextPending: true });
  const ready = completeSnapshot({ lat: body.lat, lng: body.lng, createdAt: new Date() });
  release({ weather: ready.weather, air: ready.air });
  await pending;
  expect(await getMainRunSetup(auth)).toMatchObject({ currentSnapshotId: id, currentContextPending: false,
    currentSnapshot: { snapshot_id: id, ready: true } });
});

test('historical incomplete time context returns truthful partial data without breaking setup', async () => {
  const source = await capture();
  await pg.query("UPDATE snapshots SET timezone='Invalid/Fixture' WHERE snapshot_id=$1", [source.snapshot_id]);
  const setup = await getMainRunSetup(auth);
  expect(setup.currentSnapshot).toMatchObject({ snapshot_id: source.snapshot_id, ready: false,
    timeZone: 'Invalid/Fixture', local_iso: null, missingFields: expect.arrayContaining(['timezone']) });
  expect(environment).toHaveBeenCalledTimes(1);
});

test('an unfinished replacement capture retains the genuine prior run location for display', async () => {
  const source = await prepared();
  const run = await continueMainRun(auth, intent(source));
  let release;
  environment.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const id = randomUUID(), body = input();
  const pending = capture(id, body);
  while (!release) await tick();
  const setup = await getMainRunSetup(auth);
  expect(setup).toMatchObject({ currentSnapshotId: id, currentContextPending: true,
    currentRun: { runId: run.runId }, currentSnapshot: { snapshot_id: run.snapshotId,
      sourceSnapshotId: source.snapshot_id, created_at: source.created_at } });
  await expect(continueMainRun(auth, intent(source, { expectedRunId: run.runId })))
    .rejects.toMatchObject({ code: 'context_required' });
  const ready = completeSnapshot({ lat: body.lat, lng: body.lng, createdAt: new Date() });
  release({ weather: ready.weather, air: ready.air });
  await pending;
  expect((await getMainRunSetup(auth)).currentSnapshot.snapshot_id).toBe(id);
});

test('capture replay uses the original receipt and rejects changed coordinates', async () => {
  const id = randomUUID(), body = input();
  const first = await capture(id, body);
  const duplicate = await capture(id, body);
  expect(duplicate).toEqual(first);
  const delayedDelivery = await capture(id, { ...body, gps_timestamp: Date.now() - 60_000 });
  expect(delayedDelivery).toEqual(first);
  expect(environment).toHaveBeenCalledTimes(1);
  await expect(capture(id, { ...body, lat: 3 })).rejects.toMatchObject({ code: 'capture_intent_conflict' });
});

test('session replacement rejects upstream reads and fresh collection before provider work', async () => {
  const source = await prepared();
  await pg.query('UPDATE users SET session_id=$1', [randomUUID()]);
  await expect(assertMainRunForSnapshot(source.snapshot_id, { auth, allowUpstream: true })).rejects.toMatchObject({ code: 'context_superseded' });
  await expect(getMainRunSetup(auth)).rejects.toMatchObject({ code: 'session_expired' });
  await expect(capture()).rejects.toMatchObject({ code: 'session_expired' });
  const attempts = environment.mock.calls.length;
  expect(attempts).toBe(1);
});

test('session replacement during provider work prevents late snapshot publication', async () => {
  let release;
  environment.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const id = randomUUID(), body = input();
  const pending = capture(id, body).catch(error => error);
  while (!release) await tick();
  await pg.query('UPDATE users SET session_id=$1', [randomUUID()]);
  const ready = completeSnapshot({ lat: body.lat, lng: body.lng, createdAt: new Date() });
  release({ weather: ready.weather, air: ready.air });
  expect(await pending).toMatchObject({ code: 'session_expired' });
  expect(await readSnapshot(id)).toBeUndefined();
});

test('superseding upstream location during Briefing work fences the original final write', async () => {
  const source = await capture();
  let release;
  sections.events.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const pending = generateAndStoreBriefing({ snapshotId: source.snapshot_id }).catch(error => error);
  while (!sections.events.mock.calls.length) await tick();
  const newer = await capture();
  release({ events: { items: [], reason: 'Successful search found no events' } });
  expect(await pending).toMatchObject({ code: 'context_superseded' });
  const [oldBriefing] = await orm.select().from(schema.briefings).where(eq(schema.briefings.snapshot_id, source.snapshot_id));
  expect(oldBriefing.status).toBe('pending');
  expect(oldBriefing.generated_at).toBeNull();
  expect((await getMainRunSetup(auth)).currentSnapshot.snapshot_id).toBe(newer.snapshot_id);
});

test('new upstream GPS aborts the exact Events generation and preserves its historical pending receipt', async () => {
  const source = await capture();
  let providerSignal;
  sections.events.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
    providerSignal = signal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const pending = generateAndStoreBriefing({ snapshotId: source.snapshot_id }).catch(error => error);
  while (!providerSignal) await tick();
  const before = (await orm.select().from(schema.briefings).where(eq(schema.briefings.snapshot_id, source.snapshot_id)))[0];
  const newer = await capture();
  expect(providerSignal.aborted).toBe(true);
  expect(await pending).toMatchObject({ code: 'context_superseded' });
  const after = (await orm.select().from(schema.briefings).where(eq(schema.briefings.snapshot_id, source.snapshot_id)))[0];
  expect(after.generation_token).toBe(before.generation_token);
  expect(after.status).toBe('pending');
  expect(after.generated_at).toBeNull();
  expect((await getMainRunSetup(auth)).currentSnapshot.snapshot_id).toBe(newer.snapshot_id);
});

test('settings conflict prevents admission while retaining independent prepared source', async () => {
  const source = await prepared();
  await pg.exec('UPDATE driver_profiles SET settings_revision=2');
  await expect(continueMainRun(auth, intent(source))).rejects.toMatchObject({ code: 'settings_conflict' });
  expect((await getMainRunSetup(auth)).currentSnapshot).toMatchObject({ snapshot_id: source.snapshot_id, briefingReady: true });
});

test('saving vehicle preferences can Continue with existing valid Offer Analyzer settings', async () => {
  const source = await prepared();
  // Profile/vehicle saves advance the shared settings revision. They do not
  // require an unrelated save or version change in Offer Analyzer.
  await pg.exec("UPDATE driver_vehicles SET seatbelts=6; UPDATE driver_profiles SET settings_revision=2");
  const setup = await getMainRunSetup(auth);
  expect(setup).toMatchObject({ ready: true, settingsRevision: 2, rulesVersion: 1, rulesHash });
  const run = await continueMainRun(auth, intent(source, { expectedSettingsRevision: 2 }));
  expect(run.configuration.vehicle.seatbelts).toBe(6);
  expect(run.configuration.rules).toEqual({ config, version: 1, hash: rulesHash });
  expect((await pg.query('SELECT version FROM offer_rulesets')).rows[0].version).toBe(1);
});

test('wrong owner cannot read upstream context through the optional preparation guard', async () => {
  const source = await prepared();
  await expect(assertMainRunForSnapshot(source.snapshot_id, { auth: { userId: randomUUID(), sessionId }, allowUpstream: true }))
    .rejects.toMatchObject({ code: 'context_superseded' });
});

const completedThenReplacement = async (status = 'running') => {
  const source = await prepared();
  const previous = await continueMainRun(auth, intent(source));
  await pg.query("UPDATE main_run_admissions SET status='complete', created_at='2026-09-29T17:00:00Z' WHERE run_id=$1", [previous.runId]);
  const current = await continueMainRun(auth, intent(source, { expectedRunId: previous.runId }));
  await pg.query('UPDATE main_run_admissions SET status=$1 WHERE run_id=$2', [status, current.runId]);
  return { source, previous, current };
};

test.each(['running', 'failed'])('setup exposes completed prior metadata during a %s replacement without restarting work', async status => {
  const { source, previous, current } = await completedThenReplacement(status);
  const counts = { location: location.mock.calls.length, environment: environment.mock.calls.length,
    sections: sections.events.mock.calls.length };
  const setup = await getMainRunSetup(auth);
  expect(setup).toMatchObject({ currentRun: { runId: current.runId, status }, previousRun: {
    runId: previous.runId, sessionId, snapshotId: previous.snapshotId, status: 'complete',
    settingsRevision: 1, rulesVersion: 1, rulesHash, sourceSnapshotId: source.snapshot_id,
    sourceBriefingGenerationToken: previous.sourceBriefingGenerationToken,
  } });
  expect({ location: location.mock.calls.length, environment: environment.mock.calls.length,
    sections: sections.events.mock.calls.length }).toEqual(counts);
  expect((await pg.query('SELECT current_main_run_id FROM users')).rows[0].current_main_run_id).toBe(current.runId);
  await pg.query("UPDATE main_run_admissions SET status='complete' WHERE run_id=$1", [current.runId]);
  expect((await getMainRunSetup(auth)).previousRun).toBeNull();
});

test.each(['admission owner', 'admission session', 'snapshot owner', 'snapshot session', 'missing snapshot'])('previousRun refuses a completed admission with mismatched %s', async field => {
  const { previous } = await completedThenReplacement();
  if (field === 'admission owner') {
    const otherOwner = randomUUID();
    await pg.query('INSERT INTO users(user_id) VALUES ($1)', [otherOwner]);
    await pg.query('UPDATE main_run_admissions SET user_id=$1 WHERE run_id=$2', [otherOwner, previous.runId]);
  }
  if (field === 'admission session') await pg.query('UPDATE main_run_admissions SET session_id=$1 WHERE run_id=$2', [randomUUID(), previous.runId]);
  if (field === 'snapshot owner') await pg.query('UPDATE snapshots SET user_id=$1 WHERE snapshot_id=$2', [randomUUID(), previous.snapshotId]);
  if (field === 'snapshot session') await pg.query('UPDATE snapshots SET session_id=$1 WHERE snapshot_id=$2', [randomUUID(), previous.snapshotId]);
  if (field === 'missing snapshot') await pg.query('UPDATE main_run_admissions SET snapshot_id=NULL WHERE run_id=$1', [previous.runId]);
  expect((await getMainRunSetup(auth)).previousRun).toBeNull();
});

test('previousRun chooses latest completed metadata deterministically and never follows future history', async () => {
  const { source, previous, current } = await completedThenReplacement();
  await pg.query("UPDATE main_run_admissions SET status='complete', created_at='2026-09-29T17:00:00Z' WHERE run_id=$1", [current.runId]);
  const replacement = await continueMainRun(auth, intent(source, { expectedRunId: current.runId }));
  const expected = [previous.runId, current.runId].sort().at(-1);
  expect((await getMainRunSetup(auth)).previousRun.runId).toBe(expected);
  await pg.query("UPDATE main_run_admissions SET created_at='2999-01-01T00:00:00Z' WHERE run_id=$1", [expected]);
  const remaining = expected === previous.runId ? current : previous;
  expect((await getMainRunSetup(auth)).previousRun.runId).toBe(remaining.runId);
  expect((await getMainRunSetup(auth)).currentRun.runId).toBe(replacement.runId);
});
