import { jest, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// Import the real router only after its database and external transports are
// replaced. This normal-project test cannot open the workspace DATABASE_URL.
let profile;
let vehicles;
const dialect = new PgDialect();
function vehicleMatches(row, condition) {
  const query = dialect.sqlToQuery(condition);
  const comparisons = [...query.sql.matchAll(/"driver_vehicles"\."([^"]+)"\s*=\s*\$(\d+)/g)];
  if (!comparisons.length) throw new Error('Unsupported vehicle fixture query');
  return comparisons.every(([, column, parameter]) => row[column] === query.params[Number(parameter) - 1]);
}
const writes = [];
const readOrder = [];
const marketLookup = jest.fn(async () => [{ market_anchor: 'Auto market' }]);
const db = {
  query: { driver_profiles: { findFirst: async () => { readOrder.push('profile'); return profile; } },
    driver_vehicles: { findFirst: async ({ where }) => { readOrder.push('vehicle'); return vehicles.find(row => vehicleMatches(row, where)) ?? null; } } },
  transaction: async callback => { readOrder.push('transaction'); const result = await callback(db); readOrder.push('commit'); return result; },
  execute: async () => ({ rows: [] }),
  update: table => ({ set: values => ({ where: () => ({ returning: async () => {
    writes.push({ table: getTableName(table), values }); Object.assign(profile, values); return [profile];
  } }) }) }),
  select: () => ({ from: table => ({ where: () => {
    const query = { for: mode => { readOrder.push(`lock:${getTableName(table)}:${mode}`); return query; }, limit: async () => {
      const name = getTableName(table);
      if (name === 'driver_profiles') return [profile];
      if (name === 'driver_vehicles') return [];
      if (name === 'users') return [{ user_id: 'fixture-owner', session_id: 'fixture-session', session_start_at: new Date(), last_active_at: new Date() }];
      return marketLookup();
    } }; return query;
  } }) }),
};
const geocodeAddress = jest.fn();
const invalidateUser = jest.fn();
const forbidden = jest.fn(async () => { throw new Error('Unexpected external transport'); });
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/offers/ruleset-store.js', () => ({ invalidateUser }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'fixture-owner', sessionId: 'fixture-session' }; next(); },
}));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ matrixLog: log }));
jest.unstable_mockModule('../../server/lib/location/geocode.js', () => ({ geocodeAddress }));
jest.unstable_mockModule('../../server/lib/location/address-validation.js', () => ({ validateAddress: forbidden }));
jest.unstable_mockModule('../../server/lib/markets/ensure-market.js', () => ({ ensureMarket: forbidden }));
jest.unstable_mockModule('../../server/lib/auth/oauth/google-oauth.js', () => ({
  getGoogleAuthUrl: forbidden, exchangeGoogleCode: forbidden, verifyGoogleIdToken: forbidden, generateState: forbidden,
}));
jest.unstable_mockModule('../../server/lib/auth/email.js', () => ({
  sendPasswordResetEmail: forbidden, sendEmailVerification: forbidden, sendWelcomeEmail: forbidden, isEmailConfigured: () => false,
}));
jest.unstable_mockModule('../../server/lib/auth/sms.js', () => ({
  sendPasswordResetSMS: forbidden, isSmsConfigured: () => false,
  validatePhoneNumber: phone => ({ valid: true, formatted: phone }),
}));
jest.unstable_mockModule('../../server/lib/auth/identity-policy.js', () => ({ isUniqueViolation: () => false, resolveGoogleIdentity: forbidden }));
jest.unstable_mockModule('../../server/lib/jwt.js', () => ({ signJWT: forbidden }));
const { default: router } = await import('../../server/api/auth/auth.js');
const app = express().use(express.json()).use('/api/auth', router);
const save = body => request(app).put('/api/auth/profile').send({ expectedSettingsRevision: profile.settings_revision, ...body });

beforeEach(() => {
  vehicles = [];
  profile = { id: 'fixture-profile', user_id: 'fixture-owner', settings_revision: 1, address_1: '10 Test Street', address_2: null,
    city: 'Test City', state_territory: 'TX', zip_code: '75001', country: 'US', market: 'Chosen market',
    home_lat: 33.123456, home_lng: -96.123456, home_timezone: 'America/Chicago' };
  writes.length = 0;
  readOrder.length = 0;
  jest.clearAllMocks();
  geocodeAddress.mockResolvedValue({ lat: 34.123456, lng: -97.123456, formattedAddress: 'Changed address', timezone: 'America/Chicago' });
});

test('/me reads the profile and vehicle while its owner SHARE lock holds the saved revision stable', async () => {
  const result = await request(app).get('/api/auth/me');
  expect(result.status).toBe(200);
  expect(result.body.settingsRevision).toBe(1);
  expect(readOrder).toEqual(['transaction', 'lock:users:share', 'profile', 'vehicle', 'commit']);
  expect(writes).toHaveLength(0);
});

test('/me hydrates only the active primary vehicle used by saved setup', async () => {
  vehicles = [
    { id: 'retired', driver_profile_id: profile.id, is_primary: true, is_active: false, year: 2020 },
    { id: 'other-owner', driver_profile_id: 'another-profile', is_primary: true, is_active: true, year: 2021 },
    { id: 'secondary', driver_profile_id: profile.id, is_primary: false, is_active: true, year: 2022 },
    { id: 'current', driver_profile_id: profile.id, is_primary: true, is_active: true, year: 2026 },
  ];
  const result = await request(app).get('/api/auth/me');
  expect(result.status).toBe(200);
  expect(result.body.vehicle).toMatchObject({ id: 'current', year: 2026 });
  vehicles.pop();
  const retiredOnly = await request(app).get('/api/auth/me');
  expect(retiredOnly.status).toBe(200);
  expect(retiredOnly.body.vehicle).toBeNull();
  expect(writes).toHaveLength(0);
});

test('unchanged full Settings address skips geocoding and market replacement while saving false/private/unknown values', async () => {
  const result = await save({ nickname: 'Saved Settings', address1: '10 Test Street', address2: '', city: 'Test City',
    stateTerritory: 'TX', zipCode: '75001', country: 'US', market: 'Chosen market',
    eligEconomy: false, attrElectric: false, prefShared: false, ridesharePlatforms: ['uber', 'private', 'unknown-service'] });
  expect(result.status).toBe(200);
  expect(geocodeAddress).not.toHaveBeenCalled();
  expect(marketLookup).not.toHaveBeenCalled();
  expect(profile).toMatchObject({ market: 'Chosen market', elig_economy: false, attr_electric: false, pref_shared: false,
    driver_nickname: 'Saved Settings', rideshare_platforms: ['uber', 'private', 'unknown-service'], home_lat: 33.123456 });
  expect(forbidden).not.toHaveBeenCalled();
});

test('partial non-address update leaves stored location untouched', async () => {
  expect((await save({ nickname: 'Other name' })).status).toBe(200);
  expect(geocodeAddress).not.toHaveBeenCalled();
  expect(marketLookup).not.toHaveBeenCalled();
  expect(writes[0].values).not.toHaveProperty('home_lat');
});

test('trimmed equivalence and null/empty optional fields skip geocoding', async () => {
  profile.zip_code = null;
  expect((await save({ address1: ' 10 Test Street ', address2: null, city: ' Test City ', zipCode: ' ', country: ' US ' })).status).toBe(200);
  expect(geocodeAddress).not.toHaveBeenCalled();
  expect(marketLookup).not.toHaveBeenCalled();
});

test.each([
  ['address1', '20 Changed Street'], ['address2', 'Suite 2'], ['city', 'Changed City'],
  ['stateTerritory', 'OK'], ['zipCode', '73001'], ['country', 'CA'],
])('actual partial %s change geocodes the complete address and saves returned coordinates', async (field, value) => {
  expect((await save({ [field]: value })).status).toBe(200);
  expect(geocodeAddress).toHaveBeenCalledTimes(1);
  expect(geocodeAddress).toHaveBeenCalledWith({ address1: '10 Test Street', address2: undefined, city: 'Test City',
    stateTerritory: 'TX', zipCode: '75001', country: 'US', [field]: value });
  expect(marketLookup).toHaveBeenCalledTimes(1);
  expect(profile).toMatchObject({ home_lat: 34.123456, home_lng: -97.123456 });
});

test.each([['address2', 'address_2'], ['zipCode', 'zip_code']])('clearing persisted optional %s is an address change', async (field, column) => {
  profile[column] = 'Existing value';
  expect((await save({ [field]: '' })).status).toBe(200);
  expect(geocodeAddress).toHaveBeenCalledTimes(1);
  expect(geocodeAddress.mock.calls[0][0][field]).toBeUndefined();
  expect(profile[column]).toBeNull();
});

test('geocoding failure saves the changed address without retaining coordinates from the old address', async () => {
  geocodeAddress.mockRejectedValue(new Error('Synthetic provider unavailable'));
  expect((await save({ city: 'Changed City' })).status).toBe(200);
  expect(profile.city).toBe('Changed City');
  expect(profile).toMatchObject({ home_lat: null, home_lng: null, home_timezone: null, home_formatted_address: null });
});

test('existing economics round-trip through profile PUT and GET with explicit zero and null', async () => {
  const result = await save({ fuelEconomyMpg: 31, earningsGoalDaily: 0, shiftHoursTarget: 7.5, maxDeadheadMi: 0 });
  expect(result.status).toBe(200);
  expect(profile).toMatchObject({ fuel_economy_mpg: 31, earnings_goal_daily: 0, shift_hours_target: 7.5, max_deadhead_mi: 0 });
  // PostgreSQL numeric values arrive as strings; the API has a numeric contract.
  profile.earnings_goal_daily = '0.00';
  profile.shift_hours_target = '7.5';
  const read = await request(app).get('/api/auth/me');
  expect(read.status).toBe(200);
  expect(read.body.profile).toMatchObject({ fuelEconomyMpg: 31, earningsGoalDaily: 0, shiftHoursTarget: 7.5, maxDeadheadMi: 0 });
  expect((await save({ fuelEconomyMpg: null })).status).toBe(200);
  expect(profile.fuel_economy_mpg).toBeNull();
  expect(profile.max_deadhead_mi).toBe(0);
  expect(geocodeAddress).not.toHaveBeenCalled();
});

test('saving service and empty-pickup preferences invalidates the offer projection before responding', async () => {
  const result = await save({ prefShared: false, maxDeadheadMi: 0 });
  expect(result.status).toBe(200);
  expect(profile).toMatchObject({ pref_shared: false, max_deadhead_mi: 0 });
  expect(invalidateUser).toHaveBeenCalledTimes(1);
  expect(invalidateUser).toHaveBeenCalledWith('fixture-owner');
});

test.each([
  ['fuelEconomyMpg', 0], ['fuelEconomyMpg', 25.5], ['earningsGoalDaily', -1],
  ['earningsGoalDaily', 0.001], ['earningsGoalDaily', '250'], ['earningsGoalDaily', true],
  ['shiftHoursTarget', 25], ['shiftHoursTarget', 7.55], ['maxDeadheadMi', 1.5], ['maxDeadheadMi', 501],
])('invalid %s=%s rejects the entire update before any write', async (field, value) => {
  const result = await save({ nickname: 'Must not save', [field]: value });
  expect(result.status).toBe(400);
  expect(result.body.error).toBe('INVALID_PREFERENCE');
  expect(writes).toHaveLength(0);
  expect(invalidateUser).not.toHaveBeenCalled();
});

// The market is an explicit work preference, not a geocoding side effect.
test('changing an address and explicitly choosing a market preserves the chosen market', async () => {
  expect((await save({ city: 'Changed City', market: 'Driver chosen market' })).status).toBe(200);
  expect(profile.market).toBe('Driver chosen market');
  expect(marketLookup).not.toHaveBeenCalled();
});

test('a successful provider response without valid coordinates cannot retain stale home context', async () => {
  geocodeAddress.mockResolvedValue({ lat: NaN, lng: 2, timezone: 'Etc/UTC' });
  expect((await save({ city: 'Changed City' })).status).toBe(200);
  expect(profile).toMatchObject({ home_lat: null, home_lng: null, home_timezone: null, home_formatted_address: null });
});
