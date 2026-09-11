import { jest, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { getTableName } from 'drizzle-orm';

// Import the real router only after its database and external transports are
// replaced. This normal-project test cannot open the workspace DATABASE_URL.
let profile;
const writes = [];
const marketLookup = jest.fn(async () => [{ market_anchor: 'Auto market' }]);
const db = {
  query: { driver_profiles: { findFirst: async () => profile } },
  update: table => ({ set: values => ({ where: async () => {
    writes.push({ table: getTableName(table), values });
    Object.assign(profile, values);
  } }) }),
  select: () => ({ from: () => ({ where: () => ({ limit: marketLookup }) }) }),
};
const geocodeAddress = jest.fn();
const forbidden = jest.fn(async () => { throw new Error('Unexpected external transport'); });
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'fixture-owner' }; next(); },
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
const save = body => request(app).put('/api/auth/profile').send(body);

beforeEach(() => {
  profile = { id: 'fixture-profile', user_id: 'fixture-owner', address_1: '10 Test Street', address_2: null,
    city: 'Test City', state_territory: 'TX', zip_code: '75001', country: 'US', market: 'Chosen market',
    home_lat: 33.123456, home_lng: -96.123456, home_timezone: 'America/Chicago' };
  writes.length = 0;
  jest.clearAllMocks();
  geocodeAddress.mockResolvedValue({ lat: 34.123456, lng: -97.123456, formattedAddress: 'Changed address', timezone: 'America/Chicago' });
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

test('geocoding failure remains nonfatal for a genuine address change', async () => {
  geocodeAddress.mockRejectedValue(new Error('Synthetic provider unavailable'));
  expect((await save({ city: 'Changed City' })).status).toBe(200);
  expect(profile.city).toBe('Changed City');
  expect(profile.home_lat).toBe(33.123456);
});
