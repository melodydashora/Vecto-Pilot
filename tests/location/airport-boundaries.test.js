import { jest, test, expect } from '@jest/globals';
const read = jest.fn();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { select: () => ({ from: read }) } }));
// Fixed measurements isolate the radius selection from the separately shared geo math.
jest.unstable_mockModule('../../server/lib/location/geo.js', () => ({ haversineDistanceMiles: (_a, _b, lat) => lat }));
const { findNearbyAirports } = await import('../../server/lib/location/airports.js');
test('invalid input and invalid options never read the catalog', async () => {
  for (const args of [[91, 0], [0, 181], [0, 0, { radiusMiles: NaN }], [0, 0, { limit: -1 }]]) {
    await expect(findNearbyAirports(...args)).rejects.toThrow();
  }
  expect(read).not.toHaveBeenCalled();
});
test('radius uses unrounded measurements and discards malformed catalog coordinates', async () => {
  read.mockResolvedValue([{ iata: 'OUT', lat: 50.04, lng: 0 }, { iata: 'IN', lat: 49.96, lng: 0 }, { iata: 'BAD', lat: 0, lng: null }]);
  expect((await findNearbyAirports(0, 0)).map(row => row.iata)).toEqual(['IN']);
});
test('a measured zero distance remains eligible at zero radius', async () => {
  read.mockResolvedValue([{ iata: 'AT', lat: 0, lng: 0 }]);
  expect((await findNearbyAirports(0, 0, { radiusMiles: 0 }))[0].distance_miles).toBe(0);
});
