import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
const matrix = jest.fn(), single = jest.fn();
const forbidden = jest.fn(() => { throw new Error('Unexpected alternate identity/cache lookup'); });
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/lib/external/routes-api.js', () => ({ getRouteMatrix: matrix, getRouteWithTraffic: single }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { select: forbidden, update: forbidden, insert: forbidden } }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ resolveVenueAddressesBatch: forbidden }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ venuesLog: log, OP: {}, createWorkflowLogger: () => log }));
const { enrichVenues, searchPlaceByText } = await import('../../server/lib/venue/venue-enrichment.js');
const originalFetch = global.fetch;
const place = { place_id: 'place-one', google_name: 'Fixture Hall', google_lat: 1.001, google_lng: 1, business_status: 'OPERATIONAL', formatted_address: '1 Hall Street', city: 'Fixture City', state: 'AB', country: 'CA', businessHours: null, allHours: [], matchMethod: 'text_search' };
const venue = () => ({ name: 'Fixture Hall', lat: place.google_lat, lng: place.google_lng, place_id: place.place_id, resolved_place: { ...place } });
const snapshot = { timezone: 'America/Toronto', country: 'CA', city: 'Fixture City', state: 'AB' };
const route = { originIndex: 0, destinationIndex: 0, routeAvailable: true, distanceMeters: 1000, durationSeconds: 120, trafficDelaySeconds: null };
beforeEach(() => { jest.clearAllMocks(); process.env.GOOGLE_MAPS_API_KEY = 'fixture-key'; global.fetch = jest.fn(() => { throw new Error('Unexpected provider call'); }); matrix.mockResolvedValue([route]); single.mockRejectedValue(new Error('No route')); });
afterEach(() => { global.fetch = originalFetch; });
test('resolved Google identity provides address, country and route coordinates without rediscovery', async () => {
  const result = await enrichVenues([venue()], { lat: 1, lng: 1 }, snapshot);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ placeId: place.place_id, address: place.formatted_address, country: 'CA', driveTimeMinutes: 2, trafficDelayMinutes: null });
  expect(matrix).toHaveBeenCalledWith([{ lat: 1, lng: 1 }], [{ lat: 1.001, lng: 1 }]);
  expect(forbidden).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
});
test('known failed route is omitted, never retried or published as zero minutes', async () => {
  matrix.mockResolvedValue([{ ...route, routeAvailable: false, condition: 'ROUTE_NOT_FOUND', distanceMeters: null, durationSeconds: null }]);
  expect(await enrichVenues([venue()], { lat: 1, lng: 1 }, snapshot)).toEqual([]);
  expect(single).not.toHaveBeenCalled();
});
test('missing matrix cell uses validated singleton fallback, preserving measured zero', async () => {
  matrix.mockResolvedValue([]); single.mockResolvedValue({ distanceMeters: 0, durationSeconds: 0, trafficDelaySeconds: null });
  const result = await enrichVenues([venue()], { lat: 1, lng: 1 }, snapshot);
  expect(result[0]).toMatchObject({ distanceMeters: 0, driveTimeMinutes: 0, distanceSource: 'google_routes' });
});
test('aliases with the same place ID route and publish once', async () => {
  const result = await enrichVenues([venue(), { ...venue(), name: 'Alias Hall' }], { lat: 1, lng: 1 }, snapshot);
  expect(result).toHaveLength(1); expect(matrix.mock.calls[0][1]).toHaveLength(1);
});
test('catalog identity refresh requests its exact ID, then routes returned coordinates', async () => {
  const cached = venue(); cached.resolved_place.matchMethod = 'cache_hit';
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'place-one', displayName: { text: 'Fixture Hall' }, formattedAddress: '2 New Hall Street', businessStatus: 'OPERATIONAL', timeZone: { id: 'America/Toronto' }, location: { latitude: 1.002, longitude: 1 }, addressComponents: [{ types: ['country'], shortText: 'CA' }] }) });
  const result = await enrichVenues([cached], { lat: 1, lng: 1 }, snapshot);
  expect(global.fetch.mock.calls[0][0]).toBe('https://places.googleapis.com/v1/places/place-one');
  expect(matrix.mock.calls[0][1]).toEqual([{ lat: 1.002, lng: 1 }]);
  expect(result[0].address).toBe('2 New Hall Street');
  expect(result[0].timezone).toBe('America/Toronto');
});
test.each(['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'])('closed venue %s is not recommended', async business_status => {
  const item = venue(); item.resolved_place.business_status = business_status;
  expect(await enrichVenues([item], { lat: 1, lng: 1 }, snapshot)).toEqual([]);
  expect(matrix).not.toHaveBeenCalled();
});
test('text resolution rejects unrelated Google results', async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ places: [{ id: 'other', displayName: { text: 'Unrelated Cinema' }, formattedAddress: '3 Road', location: { latitude: 1, longitude: 1 } }] }) });
  expect(await searchPlaceByText('Fixture Hall', null, 'City', 'AB', snapshot.timezone)).toBeNull();
});
