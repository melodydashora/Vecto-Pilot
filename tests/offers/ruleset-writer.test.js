const { structuredClone, AbortController } = globalThis;
import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../shared/schema.js';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';
import { hashRuleset } from '../../server/lib/offers/ruleset-hash.js';
import { initialRulesetFromProfile } from '../../server/lib/offers/profile-ruleset.js';
import { applyCoachRulesPatch } from '../../server/lib/offers/coach-rules-patch.js';
let pg, orm;
const userId = '00000000-0000-4000-8000-000000000011';
const otherId = '00000000-0000-4000-8000-000000000012';
const sessionId = '00000000-0000-4000-8000-000000000013';
const auth = { userId, sessionId };
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const { saveOfferRules } = await import('../../server/lib/offers/ruleset-writer.js');
const baseline = migrateRuleset(null);
const baselineHash = hashRuleset(baseline);
const patch = (value = false) => config => applyCoachRulesPatch(config, {
  reason: 'Driver requested tuning', changes: [{ path: 'global.require_verified', value }],
});
const savePatch = (extra = {}, input = { expected_version: 1 }, identity = auth) => saveOfferRules(identity, input, { transform: patch(), expectedHash: baselineHash, ...extra });
const read = async (owner = userId) => (await pg.query('SELECT config,version,config_hash FROM offer_rulesets WHERE user_id=$1', [owner])).rows[0];
beforeAll(async () => {
  pg = new PGlite();
  for (const table of [schema.users, schema.driver_profiles, schema.offer_rulesets]) {
    const { name, columns } = getTableConfig(table);
    const definitions = columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.name === 'id' ? ' DEFAULT gen_random_uuid()' : ['created_at', 'updated_at'].includes(column.name) ? ' DEFAULT now()' : ''}`);
    await pg.exec(`CREATE TABLE "${name}" (${definitions.join(', ')})`);
  }
  await pg.exec('CREATE UNIQUE INDEX offer_rulesets_owner_fixture ON offer_rulesets(user_id)');
  orm = drizzle(pg, { schema });
}, 30000);
beforeEach(async () => {
  await pg.exec('DELETE FROM offer_rulesets; DELETE FROM driver_profiles; DELETE FROM users');
  await pg.query('INSERT INTO users(user_id,session_id,session_start_at,last_active_at) VALUES ($1,$2,now(),now())', [userId, sessionId]);
  await pg.query('INSERT INTO driver_profiles(id,user_id,pref_shared,max_deadhead_mi) VALUES ($1,$2,false,7)', [userId, userId]);
  for (const owner of [userId, otherId]) await pg.query('INSERT INTO offer_rulesets(user_id,version,config,config_hash) VALUES ($1,1,$2,$3)', [owner, JSON.stringify(baseline), baselineHash]);
});
afterAll(async () => { await pg?.close(); });

test('Coach partial save commits canonical config, version/hash and exact changes for the authenticated owner only', async () => {
  const saved = await savePatch();
  expect(saved).toMatchObject({ success: true, changed: true, version: 2,
    changes: [{ path: 'global.require_verified', label: 'Require Verified rider', before: true, after: false }] });
  expect(saved.hash).toBe(hashRuleset(saved.config));
  expect(await read()).toEqual({ config: saved.config, version: 2, config_hash: saved.hash });
  expect(saved.config.tiers).toEqual(baseline.tiers);
  expect(await read(otherId)).toEqual({ config: baseline, version: 1, config_hash: baselineHash });
});
test('an intervening editor save rejects the stale Coach patch without overwriting either control', async () => {
  const editor = structuredClone(baseline); editor.global.rating_floor = 4.9;
  await saveOfferRules(auth, { config: editor, expected_version: 1 });
  await expect(savePatch()).rejects.toMatchObject({ status: 409, body: { error: 'version_conflict' } });
  expect((await read()).config).toEqual(editor);
  expect((await read()).version).toBe(2);
});
test('a Coach save rejects an older editor full-config save through the same writer', async () => {
  await savePatch();
  await expect(saveOfferRules(auth, { config: baseline, expected_version: 1 })).rejects.toMatchObject({ status: 409 });
  expect((await read()).config.global.require_verified).toBe(false);
});
test('no-op saved rules preserve revision and canonical hash', async () => {
  const result = await savePatch({ transform: patch(true) });
  expect(result).toMatchObject({ changed: false, version: 1, hash: baselineHash, changes: [] });
  expect((await read()).version).toBe(1);
});
test('unsaved profile defaults are freshly verified, merged and saved without resetting profile choices', async () => {
  await pg.query('DELETE FROM offer_rulesets WHERE user_id=$1', [userId]);
  const initial = initialRulesetFromProfile({ pref_shared: false, max_deadhead_mi: 7 }).config;
  const result = await savePatch({ expectedHash: hashRuleset(initial) }, { expected_version: null });
  expect(result.version).toBe(1);
  expect(result.config.global.pickup_limits.max_miles).toBe(7);
  expect(result.config.share).toEqual(initial.share);
});
test('unsaved no-op does not create saved rules or fabricate a revision', async () => {
  await pg.query('DELETE FROM offer_rulesets WHERE user_id=$1', [userId]);
  const initial = initialRulesetFromProfile({ pref_shared: false, max_deadhead_mi: 7 }).config;
  const result = await savePatch({ expectedHash: hashRuleset(initial), transform: patch(initial.global.require_verified) }, { expected_version: null });
  expect(result).toMatchObject({ version: null, hash: hashRuleset(initial), changed: false, changes: [] });
  expect(await read()).toBeUndefined();
});
test('profile-default changes and corrupt saved hashes reject tuning', async () => {
  await expect(savePatch({ expectedHash: 'stale' })).rejects.toMatchObject({ status: 409 });
  await pg.query('UPDATE offer_rulesets SET config_hash=$1 WHERE user_id=$2', ['corrupt', userId]);
  await expect(savePatch()).rejects.toMatchObject({ status: 422 });
  expect((await read()).version).toBe(1);
});
test.each([{ userId }, { ...auth, isAgent: true }, { ...auth, sessionId: otherId }])('missing, agent or replaced sessions cannot write', async identity => {
  await expect(savePatch({}, undefined, identity)).rejects.toMatchObject({ status: 401 });
  expect((await read()).version).toBe(1);
});
test('cancellation while building the locked patch rolls back and returns no saved receipt', async () => {
  const controller = new AbortController();
  await expect(savePatch({ signal: controller.signal, transform: config => { const result = patch()(config); controller.abort(); return result; } })).rejects.toThrow();
  expect(await read()).toEqual({ config: baseline, version: 1, config_hash: baselineHash });
});
test('strict full-config and partial validation reject before persistence', async () => {
  await expect(saveOfferRules(auth, { config: {}, expected_version: 1 })).rejects.toMatchObject({ status: 422 });
  await expect(saveOfferRules(auth, { config: baseline })).rejects.toMatchObject({ status: 400 });
  await expect(saveOfferRules(auth, { config: baseline, expected_version: '1' })).rejects.toMatchObject({ status: 400 });
  await expect(savePatch({ transform: config => applyCoachRulesPatch(config, { reason: 'bad', changes: [{ path: 'global.rating_floor', value: 9 }] }) })).rejects.toThrow();
  expect((await read()).version).toBe(1);
});
