import { jest, beforeEach, test, expect } from '@jest/globals';

const lookupMarket = jest.fn(async () => ({ market_slug: 'fixture-market' }));
const values = jest.fn();
const db = {
  transaction: async write => write(db),
  execute: async () => ({ rows: [] }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  insert: () => ({ values: value => {
    values(value);
    return { returning: async () => [value], onConflictDoUpdate: () => ({ returning: async () => [value] }) };
  } }),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({
  resolveTimezoneFromMarket: lookupMarket, resolveTimezoneFromCoords: async () => 'UTC',
}));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch: jest.fn() }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ createWorkflowLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }));
const { findOrCreateVenue, insertVenue } = await import('../../server/lib/venue/venue-cache.js');
const { parseAddressComponents } = await import('../../server/lib/venue/venue-utils.js');
beforeEach(() => jest.clearAllMocks());

test('event venue country reaches the scoped market lookup and persisted row', async () => {
  await findOrCreateVenue({ venue: 'Fixture Venue', city: 'Fixture City', state: 'AA', country: 'ca',
    latitude: 1, longitude: 2, address: 'Fixture Address' }, 'fixture-provider');
  expect(lookupMarket).toHaveBeenCalledWith('Fixture City', 'AA', 'ca');
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ country: 'CA', market_slug: 'fixture-market', timezone: 'UTC' }));
});
test.each([undefined, null, '', 'Canada', true])('unknown or malformed country %s is stored as null, never US', async country => {
  await insertVenue({ venueName: 'Fixture Venue', city: 'Fixture City', state: 'AA', country, lat: 1, lng: 2 });
  expect(values.mock.calls[0][0].country).toBeNull();
});
test('Google country short code reaches storage instead of the long display name', () => {
  expect(parseAddressComponents([{ types: ['country'], longText: 'Canada', shortText: 'CA' }]).country).toBe('CA');
  expect(parseAddressComponents([{ types: ['country'], long_name: 'Australia', short_name: 'AU' }]).country).toBe('AU');
});
test.each([null, [], [{ types: ['country'], longText: 'Canada' }]])('missing country evidence stays unknown: %j', components => {
  expect(parseAddressComponents(components).country).toBeNull();
});
