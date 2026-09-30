import { jest, beforeEach, afterAll, test, expect } from '@jest/globals';
const selected = [], updates = [], inserts = [], conflicts = [];
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => selected.shift() || [] }) }) }),
  update: () => ({ set: value => { updates.push(value); return { where: () => { const result = Promise.resolve(); result.returning = async () => [{ venue_id: 'existing', ...value }]; return result; } }; } }),
  insert: () => ({ values: value => { inserts.push(value); return { onConflictDoUpdate: options => { conflicts.push(options); return { returning: async () => [{ venue_id: 'new', ...value }] }; } }; } }),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromMarket: async () => null, resolveTimezoneFromCoords: async () => 'Etc/UTC' }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch: jest.fn() }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ createWorkflowLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }));
const { lookupVenue, upsertVenue, insertVenue, findOrCreateVenue } = await import('../../server/lib/venue/venue-cache.js');
const originalFetch = global.fetch;
beforeEach(() => {
  selected.length = updates.length = inserts.length = conflicts.length = 0;
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
});
afterAll(() => { global.fetch = originalFetch; });
test('an explicit missing Google ID never matches another same-name branch', async () => {
  selected.push([], [{ venue_id: 'other', place_id: 'place-other', venue_name: 'Chain Hotel' }]);
  expect(await lookupVenue({ placeId: 'place-new', venueName: 'Chain Hotel', city: 'City', state: 'AA' })).toBeNull();
  expect(selected).toHaveLength(1);
});
test('promotion passes provider-resolved country and locality into the atomic identity writer', async () => {
  await upsertVenue({ placeId: 'place-one', venueName: 'Hall', city: 'New City', state: 'AB', country: 'ca', lat: 1, lng: 2 });
  expect(conflicts[0].set).toMatchObject({ city: 'New City', state: 'AB', country: 'CA' });
});
test('explicit Google identities use provider-ID conflict arbitration', async () => {
  await insertVenue({ placeId: 'place-new', venueName: 'Hall', city: 'City', state: 'AA', lat: 1, lng: 2 });
  expect(conflicts[0].target.name).toBe('place_id');
});
test('non-ChIJ provider ID is an exact identity in event linking too', async () => {
  selected.push([{ venue_id: 'existing', place_id: 'provider-id', venue_name: 'Hall', address: '123 Main Street, City, AA', formatted_address: '123 Main Street, City, AA', city: 'City', state: 'AA', lat: 1, lng: 2 }]);
  const result = await findOrCreateVenue({ venue: 'Hall', city: 'City', state: 'AA', latitude: 1, longitude: 2, placeId: 'provider-id' }, 'fixture');
  expect(result.venue_id).toBe('existing'); expect(inserts).toHaveLength(0);
});
