// tests/venue/google-places-coordinates.test.js
// 2026-09-11 (todo #64): a Google Places result without a `location` used to flow through
// the bars pipeline as lat/lng undefined and crash the client's AdvancedMarkerElement
// (route error screen). The mapper must emit only venues with finite coordinates and say
// loudly which place it dropped. Synthetic Places payloads only; no provider, DB or logger.
import { jest, describe, test, beforeEach, expect } from '@jest/globals';

const warn = jest.fn();
const quiet = new Proxy({}, { get: (_, key) => (key === 'warn' ? warn : jest.fn()) });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  barsLog: quiet, placesLog: quiet, venuesLog: quiet, aiLog: quiet, matrixLog: quiet,
  eventsLog: quiet, dbLog: quiet, OP: {}, createWorkflowLogger: () => quiet,
}));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({
  callModel: jest.fn(async () => { throw new Error('Unexpected model dispatch'); }),
}));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({
  getVenuesByType: jest.fn(), upsertVenue: jest.fn(),
}));
jest.unstable_mockModule('../../server/db/connection-manager.js', () => ({
  getPool: () => { throw new Error('Venue tests must not open a pool'); },
}));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));

const { mapGooglePlacesToVenues } = await import('../../server/lib/venue/venue-intelligence.js');

const place = (id, extra) => ({
  id, displayName: { text: `Venue ${id}` }, formattedAddress: `${id} Test St`, priceLevel: 'PRICE_LEVEL_MODERATE',
  primaryType: 'bar', rating: 4.7, types: ['bar'], ...extra,
});

beforeEach(() => warn.mockClear());

describe('mapGooglePlacesToVenues coordinate guard', () => {
  test('keeps only places with finite numeric coordinates and warns per dropped place', () => {
    const venues = mapGooglePlacesToVenues([
      place('ok', { location: { latitude: 32.780001, longitude: -96.800002 } }),
      place('missing', {}),                                               // no location at all
      place('nan', { location: { latitude: 'abc', longitude: -96.8 } }),  // non-numeric
      place('partial', { location: { latitude: 32.78 } }),                // one axis only
    ], 'America/Chicago');

    expect(venues).toHaveLength(1);
    expect(venues[0]).toMatchObject({ place_id: 'ok', lat: 32.780001, lng: -96.800002, type: 'bar' });
    expect(Number.isFinite(venues[0].lat) && Number.isFinite(venues[0].lng)).toBe(true);

    const dropped = warn.mock.calls.map(c => String(c[1])).filter(m => m.includes('dropped'));
    expect(dropped).toHaveLength(3);
    expect(dropped.join('\n')).toContain('(missing)');
    expect(dropped.join('\n')).toContain('(nan)');
    expect(dropped.join('\n')).toContain('(partial)');
  });

  test('never substitutes coordinates: an empty or missing list maps to no venues', () => {
    expect(mapGooglePlacesToVenues([], 'America/Chicago')).toEqual([]);
    expect(mapGooglePlacesToVenues(undefined, 'America/Chicago')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
