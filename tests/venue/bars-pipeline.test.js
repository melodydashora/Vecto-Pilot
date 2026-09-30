import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
const cached = jest.fn(), promote = jest.fn(), model = jest.fn(), updates = [];
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { update: () => ({ set: value => ({ where: async () => { updates.push(value); } }) }) } }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ barsLog: log, placesLog: log, venuesLog: log, aiLog: log, matrixLog: log, createWorkflowLogger: () => log }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ getVenuesByType: cached, enrichVenueFromPlaceId: jest.fn(), upsertVenue: promote }));
process.env.GOOGLE_MAPS_API_KEY = 'fixture-only';
const { discoverNearbyVenues, mapGooglePlacesToVenues, persistVenuesToDatabase, getTrafficIntelligence } = await import('../../server/lib/venue/venue-intelligence.js');
const originalFetch = global.fetch;
const args = { lat: 1, lng: 1, city: 'Viewer City', state: 'AB', radiusMiles: 25, timezone: 'America/Chicago' };
const place = extra => ({ id: 'place-one', displayName: { text: 'Fixture Lounge' }, formattedAddress: '1 Lounge Road', businessStatus: 'OPERATIONAL',
 priceLevel: 'PRICE_LEVEL_EXPENSIVE', rating: 4.8, primaryType: 'bar', types: ['bar'], location: { latitude: 1.001, longitude: 1 },
 timeZone: { id: 'Asia/Tokyo' }, addressComponents: [{ types: ['locality'], longText: 'Provider City' }, { types: ['administrative_area_level_1'], shortText: 'AB' }, { types: ['country'], shortText: 'CA' }],
 currentOpeningHours: { openNow: true, nextCloseTime: new Date(Date.now() + 30000).toISOString() },
 regularOpeningHours: { weekdayDescriptions: ['Monday: Open 24 hours'] }, ...extra });
beforeEach(() => { jest.clearAllMocks(); updates.length = 0; cached.mockResolvedValue([]); promote.mockImplementation(async value => ({ venue_id: 'catalog-one', place_id: value.placeId })); model.mockResolvedValue({ ok: true, output: '{"1":"P"}' }); global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ places: [place()] }) })); });
afterEach(() => { global.fetch = originalFetch; });
test('missing price stays unknown instead of becoming moderate', () => {
 expect(mapGooglePlacesToVenues([place({ priceLevel: undefined })], args.timezone)[0]).toMatchObject({ expense_level: null, expense_rank: null });
});
test('provider open observation and close timestamp use venue facts, not viewer timezone or array-order periods', () => {
 const mapped = mapGooglePlacesToVenues([place()], args.timezone)[0];
 expect(mapped).toMatchObject({ isOpen: true, closing_soon: true, minutes_until_close: 1, timezone: 'Asia/Tokyo', city: 'Provider City', country: 'CA' });
});
test.each(['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'])('closed business %s never becomes closed-go-anyway staging', async businessStatus => {
 global.fetch.mockResolvedValue({ ok: true, json: async () => ({ places: [place({ businessStatus })] }) });
 expect((await discoverNearbyVenues(args)).venues).toEqual([]);
});
test('provider failures reject instead of successful empty discovery', async () => {
 global.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'Fixture outage' });
 await expect(discoverNearbyVenues(args)).rejects.toThrow();
});
test('cache failure does not trigger duplicate paid discovery', async () => {
 cached.mockRejectedValue(new Error('Fixture DB outage')); await expect(discoverNearbyVenues(args)).rejects.toThrow(); expect(global.fetch).not.toHaveBeenCalled();
});
test.each(['not-json', '{"1":"nonsense"}', '{}'])('invalid classifier %s cannot become verified recommendations', async output => {
 model.mockResolvedValue({ ok: true, output }); await expect(discoverNearbyVenues(args)).rejects.toThrow(); expect(promote).not.toHaveBeenCalled();
});
test('simultaneous same-area requests share Google/classifier/persistence and retain provider locality', async () => {
 const [a, b] = await Promise.all([discoverNearbyVenues(args), discoverNearbyVenues(args)]);
 expect(global.fetch).toHaveBeenCalledTimes(1); expect(model).toHaveBeenCalledTimes(1); expect(promote).toHaveBeenCalledTimes(1);
 expect(a.venues).toHaveLength(1); expect(b).toEqual(a);
 expect(promote.mock.calls[0][0]).toMatchObject({ placeId: 'place-one', city: 'Provider City', country: 'CA', timezone: 'Asia/Tokyo' });
});
test('out of range coordinates do not enter markers', () => {
 expect(mapGooglePlacesToVenues([place({ location: { latitude: 91, longitude: 1 } })], args.timezone)).toEqual([]);
});
test('identity persistence refuses another catalog place at identical coordinates', async () => {
 promote.mockResolvedValue({ venue_id: 'wrong', place_id: 'other' });
 await persistVenuesToDatabase(mapGooglePlacesToVenues([place()], args.timezone), args);
 expect(updates).toHaveLength(0);
});
test('traffic model failure is unavailable, not medium congestion', async () => {
 model.mockResolvedValue({ ok: false, error: 'Fixture outage' });
 await expect(getTrafficIntelligence(args)).rejects.toThrow();
});
const rows = fetchedAt => Array.from({ length: 5 }, (_, i) => ({ place_id: `cached-${i}`, venue_name: `Cached Lounge ${i}`, formatted_address: '1 Fixture St', lat: 1, lng: 1,
 timezone: 'Asia/Tokyo', city: 'Provider City', country: 'CA', expense_rank: 3, google_rating: 4.8, venue_quality_tier: 'premium', category: 'bar', updated_at: new Date(),
 business_hours: { _fetchedAt: fetchedAt, openNow: false, weekdayDescriptions: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `${day}: Open 24 hours`) } }));
test('fresh catalog hours are reevaluated in venue timezone without replaying old openNow', async () => {
 cached.mockResolvedValue(rows(new Date().toISOString())); const result = await discoverNearbyVenues(args);
 expect(result.venues).toHaveLength(5); expect(result.venues.every(venue => venue.isOpen === true)).toBe(true); expect(global.fetch).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled();
});
test.each([undefined, new Date(0).toISOString()])('catalog row updated today does not make old or unproven provider hours fresh (%s)', async timestamp => {
 cached.mockResolvedValue(rows(timestamp)); await discoverNearbyVenues(args); expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('persisted provider hours carry their own freshness receipt', async () => {
 await discoverNearbyVenues(args); expect(Date.parse(promote.mock.calls[0][0].hours._fetchedAt)).toBeGreaterThan(Date.now() - 10000);
});
