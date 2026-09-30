import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { venue_catalog, discovered_events } from '../../shared/schema.js';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actual;
const model = jest.fn(async () => ({ ok: true, output: '{"venues":[],"events":[]}' }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: new Proxy({}, { get: (_target, key) => actual[key].bind(actual) }) }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ findOrCreateVenue: jest.fn() }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch: jest.fn() }));
const { searchNearby } = await import('../../server/lib/concierge/concierge-service.js');
beforeAll(async () => {
  pg = new PGlite(); actual = drizzle(pg);
  for (const table of [venue_catalog, discovered_events]) {
    const config = getTableConfig(table);
    await pg.exec('CREATE TABLE ' + config.name + ' (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType()).join(', ') + ')');
  }
}, 30000);
beforeEach(async () => { model.mockClear(); await pg.exec('TRUNCATE venue_catalog, discovered_events'); });
afterAll(async () => { await pg?.close(); });
const venue = (n, lat, lng, timezone = 'Etc/UTC') => ({ venue_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, venue_name: 'Fixture venue ' + n,
  lat, lng, is_bar: true, timezone, city: 'Fixture City', state: 'AA' });

test.each([
  { lat: 0, lng: 179.99, otherLng: -179.99 },
  { lat: 0, lng: -179.99, otherLng: 179.99 },
  { lat: 89.99, lng: 179.99, otherLng: -90 },
  { lat: 89.8, lng: 0, otherLat: 89.85, otherLng: 45 },
])('actual nearby SQL crosses dateline/polar bounds at %j', async ({ lat, lng, otherLat = lat, otherLng }) => {
  await actual.insert(venue_catalog).values([1, 2, 3].map(n => venue(n, otherLat, otherLng)));
  const result = await searchNearby({ lat, lng, timezone: 'Etc/UTC' });
  expect(result.venues).toHaveLength(3); expect(model).not.toHaveBeenCalled();
});
test('event SQL and canonical validation use the venue date across a timezone/date boundary', async () => {
  const venueTimezone = 'Etc/GMT+12', viewerTimezone = 'Pacific/Kiritimati';
  await actual.insert(venue_catalog).values([1, 2, 3].map(n => venue(n, 0, -179.99, venueTimezone)));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: venueTimezone });
  await actual.insert(discovered_events).values({ venue_id: venue(1).venue_id, title: 'Fixture concert', venue_name: 'Fixture venue 1',
    address: 'Fixture Address', city: 'Fixture City', state: 'AA', event_start_date: today, event_end_date: today,
    event_start_time: '19:00', event_end_time: '22:00', category: 'concert', is_active: true });
  const result = await searchNearby({ lat: 0, lng: 179.99, timezone: viewerTimezone });
  expect(result.events).toHaveLength(1); expect(model).not.toHaveBeenCalled();
});
test.each([null, 'Not/A_Timezone'])('an unverified stored venue timezone %s never borrows the viewer timezone', async timezone => {
  await actual.insert(venue_catalog).values([1, 2, 3].map(n => venue(n, 0, 0.001, timezone)));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Etc/UTC' });
  await actual.insert(discovered_events).values({ venue_id: venue(1).venue_id, title: 'Fixture concert', venue_name: 'Fixture venue 1',
    address: 'Fixture Address', city: 'Fixture City', state: 'AA', event_start_date: today, event_end_date: today,
    event_start_time: '19:00', event_end_time: '22:00', category: 'concert', is_active: true });
  const result = await searchNearby({ lat: 0, lng: 0, timezone: 'Etc/UTC' });
  expect(result.events).toEqual([]); expect(model).not.toHaveBeenCalled();
});
