// Actual setup/Continue routes with synthetic query results and write spies. No
// database connection, persistence write, GPS, geocoding or model call is made.
import { beforeEach, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { users, driver_profiles, driver_vehicles, offer_rulesets, main_run_admissions } from '../../shared/schema.js';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';
import { hashRuleset } from '../../server/lib/offers/ruleset-hash.js';

const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const config = migrateRuleset(null);
const configHash = hashRuleset(config);
let profile;
let rules;
const insert = jest.fn(table => {
  if (table !== main_run_admissions) throw new Error('Unexpected settings write');
  return { values: values => ({ returning: async () => [{ ...values, status: 'awaiting_snapshot', created_at: new Date() }] }) };
});
const update = jest.fn(table => {
  if (table !== users) throw new Error('Unexpected settings write');
  return { set: () => ({ where: async () => [] }) };
});
const tx = {
  execute: jest.fn(async () => ({ rows: [] })),
  insert, update,
  select: () => ({ from: table => {
    const query = {
      where: () => query,
      for: () => query,
      limit: async () => {
        if (table === users) return [{ user_id: userId, session_id: sessionId, current_main_run_id: null,
          session_start_at: new Date(), last_active_at: new Date() }];
        if (table === driver_profiles) return [profile];
        if (table === driver_vehicles) return [{ id: 'synthetic-car', year: 2024, make: 'Fixture', model: 'Car', seatbelts: 5 }];
        if (table === offer_rulesets) return rules ? [rules] : [];
        if (table === main_run_admissions) return [];
        throw new Error('Unexpected table read');
      },
    };
    return query;
  } }),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { transaction: callback => callback(tx) } }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => {
  req.auth = { userId, sessionId }; next();
} }));
const { default: router } = await import('../../server/api/strategy/main-runs.js');
const app = express();
app.use(express.json());
app.use('/runs', router);
const continueRequest = () => request(app).post('/runs/continue').send({
  requestId: '00000000-0000-4000-8000-000000000003', expectedSettingsRevision: 3,
  expectedRulesVersion: 7, expectedRulesHash: configHash, expectedRunId: null,
});

beforeEach(() => {
  profile = {
    id: 'synthetic-profile', user_id: userId, settings_revision: 3,
    phone: 'synthetic-phone', address_1: 'synthetic-address', city: 'Fixture', state_territory: 'TX',
    country: 'US', market: 'Fixture', terms_accepted: true, rideshare_platforms: ['uber'],
    selected_services: ['economy'], elig_economy: true, elig_comfort: true,
  };
  rules = { version: 7, config, config_hash: configHash };
  insert.mockClear(); update.mockClear();
});

test('a fully saved setup is ready without a preference or rules edit', async () => {
  const result = await request(app).get('/runs/setup').expect(200);
  expect(result.body).toMatchObject({ ready: true, missingFields: [], settingsRevision: 3,
    rulesVersion: 7, rulesHash: configHash, rules: config, profile: { selectedServices: ['economy'] } });
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('legacy null selection permits unchanged saved setup and stays null in the admitted receipt', async () => {
  profile.selected_services = null;
  const result = await request(app).get('/runs/setup').expect(200);
  expect(result.body).toMatchObject({ ready: true, missingFields: [],
    rulesVersion: 7, rulesHash: configHash, rules: config,
    profile: { selectedServices: null, eligEconomy: true, eligComfort: true } });
  const continued = await continueRequest().expect(201);
  expect(continued.body.configuration).toMatchObject({ profile: { selected_services: null },
    rules: { config, version: 7, hash: configHash } });
  expect(profile.selected_services).toBeNull();
  expect(rules.config).toBe(config);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledTimes(1);
});

test.each([[], ['unknown'], ['economy', 'economy'], ['luxury_suv'], 'economy'].map(value => [value]))(
  'explicit invalid or ineligible selection %j remains blocked', async selectedServices => {
    profile.selected_services = selectedServices;
    const result = await request(app).get('/runs/setup').expect(200);
    expect(result.body).toMatchObject({ ready: false, missingFields: ['profile.selectedServices'] });
    const continued = await continueRequest().expect(409);
    expect(continued.body).toMatchObject({ error: 'setup_incomplete', missingFields: ['profile.selectedServices'] });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  },
);

test('legacy null selection cannot bypass genuinely missing saved rules', async () => {
  profile.selected_services = null;
  rules = null;
  const result = await request(app).get('/runs/setup').expect(200);
  expect(result.body.ready).toBe(false);
  expect(result.body.missingFields).toEqual(expect.arrayContaining(['offerRules', 'profile.selectedServices']));
  await continueRequest().expect(409);
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('genuinely missing saved rules is reported separately from service selection', async () => {
  rules = null;
  const result = await request(app).get('/runs/setup').expect(200);
  expect(result.body).toMatchObject({ ready: false, missingFields: ['offerRules'], rulesVersion: null,
    rulesHash: null, profile: { selectedServices: ['economy'] } });
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test.each(['profile', 'rules'])('legacy null cannot bypass invalid saved %s', async invalidPart => {
  profile.selected_services = null;
  if (invalidPart === 'profile') profile.phone = '';
  else rules.config_hash = 'invalid-hash';
  const result = await request(app).get('/runs/setup').expect(200);
  expect(result.body.ready).toBe(false);
  expect(result.body.missingFields).toContain(invalidPart === 'profile' ? 'profile.phone' : 'offerRules.invalid');
  await continueRequest().expect(409);
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
