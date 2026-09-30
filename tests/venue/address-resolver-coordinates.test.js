import { jest, test, expect, afterEach } from '@jest/globals';
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ createWorkflowLogger: () => ({ debug: jest.fn(), warn: jest.fn() }) }));
process.env.GOOGLE_MAPS_API_KEY = 'fixture-only';
const { searchPlaceWithTextSearch } = await import('../../server/lib/venue/venue-address-resolver.js');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
test('Text Search preserves complete provider coordinates and caller cancellation', async () => {
 const point = { latitude: 32.782698100000005, longitude: -96.80214578901234 };
 global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ places: [{ id: 'fixture-id', displayName: { text: 'Fixture' }, location: point, formattedAddress: '1 Fixture St' }] }) }));
 const controller = new AbortController();
 expect(await searchPlaceWithTextSearch(32.78, -96.8, 'Fixture', { signal: controller.signal })).toMatchObject({ lat: point.latitude, lng: point.longitude });
 expect(global.fetch.mock.calls[0][1].signal).toBe(controller.signal);
});
test.each([undefined, { latitude: 91, longitude: 0 }, { latitude: '', longitude: 0 }])('unusable provider location %j has no substitute coordinates', async location => {
 global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ places: [{ id: 'fixture-id', location }] }) }));
 expect(await searchPlaceWithTextSearch(0, 0, 'Fixture')).toBeNull();
});
