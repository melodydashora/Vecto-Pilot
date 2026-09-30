import { beforeEach, expect, jest, test } from '@jest/globals';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';

const execute = jest.fn();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { execute } }));
const { resolveRuleset, _clearCache, hashRuleset, invalidateUser } = await import('../../server/lib/offers/ruleset-store.js');

beforeEach(() => { execute.mockReset(); _clearCache(); });

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

test('profile-save cache invalidation refreshes service selection even when saved rules have not changed', async () => {
  const config = migrateRuleset(null), configHash = hashRuleset(config);
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'synthetic-owner', selected_services: ['economy'], config, version: 7, config_hash: configHash }] });
  const before = await resolveRuleset('synthetic-shortcut');
  expect(before.selectedServices).toEqual(['economy']);
  expect(await resolveRuleset('synthetic-shortcut')).toBe(before);
  expect(execute).toHaveBeenCalledTimes(1);
  // The profile API calls this after its successful owner-locked transaction.
  invalidateUser('synthetic-owner');
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'synthetic-owner', selected_services: ['comfort'], config, version: 7, config_hash: configHash }] });
  const after = await resolveRuleset('synthetic-shortcut');
  expect(after).toMatchObject({ selectedServices: ['comfort'], selectionVerified: true, version: before.version, hash: before.hash });
  expect(execute).toHaveBeenCalledTimes(2);
});

test('malformed persisted selection fails visibly rather than silently disabling service enforcement', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    execute.mockResolvedValue({ rows: [{ user_id: 'synthetic-owner', selected_services: ['unrecognized-service'], config: null, version: null }] });
    expect(await resolveRuleset('synthetic-shortcut')).toMatchObject({ ruleset: null, status: 'rules_unavailable', selectionVerified: false });
    expect(errorLog).toHaveBeenCalled();
  } finally { errorLog.mockRestore(); }
});
