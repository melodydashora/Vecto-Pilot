import { beforeEach, expect, jest, test } from '@jest/globals';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';

const execute = jest.fn();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { execute } }));
const { resolveRuleset, hashRuleset } = await import('../../server/lib/offers/ruleset-store.js');

beforeEach(() => { execute.mockReset(); });

test('token resolution carries the explicit saved service selection without rewriting economic rules', async () => {
  const config = migrateRuleset(null);
  config.tiers.premium.floor_per_mile = 2.35;
  const row = { user_id: 'synthetic-owner', selected_services: ['comfort', 'luxury_suv'],
    config, version: 7, config_hash: hashRuleset(config) };
  execute.mockResolvedValue({ rows: [row] });
  const resolved = await resolveRuleset('synthetic-shortcut');
  expect(resolved).toMatchObject({ selectedServices: ['comfort', 'luxury_suv'], selectionVerified: true,
    ruleset: config, version: 7, hash: row.config_hash });
});

test('missing legacy selections stay unknown instead of being inferred from eligibility', async () => {
  execute.mockResolvedValue({ rows: [{ user_id: 'synthetic-owner', selected_services: null,
    elig_economy: true, elig_luxury_suv: true, config: null, version: null }] });
  expect(await resolveRuleset('synthetic-shortcut')).toMatchObject({ selectedServices: null, selectionVerified: false });
});

test('each offer sees changed service selections even when saved rules have not changed', async () => {
  const config = migrateRuleset(null), configHash = hashRuleset(config);
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'synthetic-owner', selected_services: ['economy'], config, version: 7, config_hash: configHash }] });
  const before = await resolveRuleset('synthetic-shortcut');
  expect(before.selectedServices).toEqual(['economy']);
  expect(execute).toHaveBeenCalledTimes(1);
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'synthetic-owner', selected_services: ['comfort'], config, version: 7, config_hash: configHash }] });
  const after = await resolveRuleset('synthetic-shortcut');
  expect(after).toMatchObject({ selectedServices: ['comfort'], selectionVerified: true, version: before.version, hash: before.hash });
  expect(execute).toHaveBeenCalledTimes(2);
});

test('a save by another server is visible to the next offer while the earlier offer keeps its captured rules', async () => {
  const beforeConfig = migrateRuleset(null);
  const afterConfig = structuredClone(beforeConfig);
  afterConfig.global.pickup_limits = { max_miles: 3, max_minutes: 8 };
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'synthetic-owner', selected_services: ['economy'],
    config: beforeConfig, version: 7, config_hash: hashRuleset(beforeConfig) }] });
  const inFlight = await resolveRuleset('synthetic-shortcut');
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'synthetic-owner', selected_services: ['economy'],
    config: afterConfig, version: 8, config_hash: hashRuleset(afterConfig) }] });
  const next = await resolveRuleset('synthetic-shortcut');
  expect(next.version).toBe(8);
  expect(next.ruleset.global.pickup_limits.max_minutes).toBe(8);
  expect(next.hash).not.toBe(inFlight.hash);
  expect(inFlight.version).toBe(7);
  expect(inFlight.ruleset).toEqual(beforeConfig);
  expect(execute).toHaveBeenCalledTimes(2);
});

test('a previously resolved token cannot reuse old rules after revocation or a failed current read', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const config = migrateRuleset(null);
    execute.mockResolvedValueOnce({ rows: [{ user_id: 'synthetic-owner', selected_services: ['economy'],
      config, version: 1, config_hash: hashRuleset(config) }] });
    expect((await resolveRuleset('synthetic-shortcut')).status).toBe('saved');
    execute.mockResolvedValueOnce({ rows: [] });
    expect(await resolveRuleset('synthetic-shortcut')).toMatchObject({ status: 'invalid_token', ruleset: null });
    execute.mockRejectedValueOnce(new Error('Synthetic read failure'));
    expect(await resolveRuleset('synthetic-shortcut')).toMatchObject({ status: 'rules_unavailable', ruleset: null });
    expect(execute).toHaveBeenCalledTimes(3);
  } finally { log.mockRestore(); warn.mockRestore(); }
});

test('malformed persisted selection fails visibly rather than silently disabling service enforcement', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    execute.mockResolvedValue({ rows: [{ user_id: 'synthetic-owner', selected_services: ['unrecognized-service'], config: null, version: null }] });
    expect(await resolveRuleset('synthetic-shortcut')).toMatchObject({ ruleset: null, status: 'rules_unavailable', selectionVerified: false });
    expect(errorLog).toHaveBeenCalled();
  } finally { errorLog.mockRestore(); }
});
