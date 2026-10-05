import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { markets, market_cities, venue_catalog, discovered_events } from '../../shared/schema.js';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actualDb;
const db = new Proxy({}, { get: (_target, name) => actualDb[name].bind(actualDb) });
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ locationLog: log, triadLog: log, OP: {}, tagLog: jest.fn() }));
const { readMarketEvents, eventInSnapshotMarket, venueInSnapshotMarket, toBriefingEvent, eventOverlapsDisplayDays } = await import('../../server/lib/events/market-event-reader.js');
beforeAll(async () => {
  pg = new PGlite(); actualDb = drizzle(pg);
  for (const table of [markets, market_cities, venue_catalog, discovered_events]) {
    const config = getTableConfig(table);
    await pg.exec('CREATE TABLE ' + config.name + ' (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType()).join(', ') + ')');
  }
}, 30000);
afterAll(async () => { await pg?.close(); });
const snapshot = { city: 'Border City', state: 'AA', country: 'US', timezone: 'Etc/UTC' };
beforeEach(async () => {
  await pg.exec('TRUNCATE markets, market_cities, venue_catalog, discovered_events');
  await actualDb.insert(markets).values({ market_slug: 'border', market_name: 'Border Metro', primary_city: 'Border City', state: 'Alpha', state_abbr: 'AA', country_code: 'US', is_active: true });
  await actualDb.insert(market_cities).values([
    { market_slug: 'border', market_name: 'Old Name', city: 'Border City', state: 'Alpha', state_abbr: 'AA', country_code: 'US' },
    { market_slug: 'border', market_name: 'Old Name', city: 'Across River', state: 'Beta', state_abbr: 'BB', country_code: 'US' },
  ]);
});
async function event(index, values = {}) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  await actualDb.insert(venue_catalog).values({ venue_id: id, venue_name: 'Fixture', country: values.country || 'US', lat: 0, lng: 0, timezone: 'America/Los_Angeles' });
  await actualDb.insert(discovered_events).values({ id, venue_id: id, title: 'Fixture', city: 'Across River', state: 'BB', category: 'concert', is_active: true,
    event_start_date: '2026-09-28', event_end_date: '2026-09-30', event_start_time: '18:00', event_end_time: '20:00', ...values, country: undefined });
  return id;
}
test('one scoped query includes ongoing cross-state metro events but excludes same names in another country and unrelated state', async () => {
  const included = await event(1, { expected_attendance: 'high' });
  await event(2, { country: 'CA', expected_attendance: 'high' });
  await event(3, { state: 'CC', expected_attendance: 'high' });
  const result = await readMarketEvents(snapshot, { today: '2026-09-29', highValueOtherCities: true });
  expect(result.marketName).toBe('Border Metro'); expect(result.rows.map(r => r.event.id)).toEqual([included]);
  expect(await eventInSnapshotMarket(included, snapshot)).toBe(true);
  expect(await eventInSnapshotMarket('00000000-0000-4000-8000-000000000002', snapshot)).toBe(false);
});
test('a concert category alone is not a high-impact market draw and selection never deletes saved events', async () => {
  const high = await event(1, { expected_attendance: 'high' });
  const low = await event(2, { expected_attendance: 'low' });
  const unknown = await event(3);
  const medium = await event(4, { expected_attendance: 'medium' });
  const marketDraws = await readMarketEvents(snapshot, { today: '2026-09-29', highValueOtherCities: true });
  expect(marketDraws.rows.map(row => row.event.id)).toEqual([high]);
  const general = await readMarketEvents(snapshot, { today: '2026-09-29' });
  expect(general.rows.map(row => row.event.id).sort()).toEqual([high, low, unknown, medium].sort());
  expect(toBriefingEvent(general.rows.find(row => row.event.id === low)).impact).toBe('low');
  expect((await pg.query('SELECT count(*)::int AS n FROM discovered_events')).rows[0].n).toBe(4);
});
test('progressive venue scope matches the canonical cross-state metro without inserting an event', async () => {
  await actualDb.insert(market_cities).values({ market_slug: 'other-metro', market_name: 'Other Metro',
    city: 'Other City', state: 'Alpha', state_abbr: 'AA', country_code: 'US' });
  const cases = [
    [{ city: 'Across River', state: 'BB', country: 'US' }, true],
    [{ city: 'across river', state: 'Beta', country: 'us' }, true],
    [{ city: 'Border City', state: 'AA', country: 'US' }, true],
    [{ city: 'Other City', state: 'AA', country: 'US' }, false],
    [{ city: 'Across River', state: 'CC', country: 'US' }, false],
    [{ city: 'Across River', state: 'BB', country: 'CA' }, false],
    [{ city: 'Across River', state: 'BB', country: null }, false],
  ];
  for (const [venue, expected] of cases) expect(await venueInSnapshotMarket(venue, snapshot)).toBe(expected);
  expect((await pg.query('SELECT count(*)::int AS n FROM discovered_events')).rows[0].n).toBe(0);
  expect((await pg.query('SELECT count(*)::int AS n FROM venue_catalog')).rows[0].n).toBe(0);
});
test('unmapped localities require exact city, state and country before progressive publication', async () => {
  const localSnapshot = { ...snapshot, city: 'Unmapped Locality', state: 'ZZ' };
  expect(await venueInSnapshotMarket({ city: 'unmapped locality', state: 'zz', country: 'us' }, localSnapshot)).toBe(true);
  expect(await venueInSnapshotMarket({ city: 'Unmapped Locality', state: 'YY', country: 'US' }, localSnapshot)).toBe(false);
  expect(await venueInSnapshotMarket({ city: 'Unmapped Locality', state: 'ZZ', country: 'CA' }, localSnapshot)).toBe(false);
  expect(await venueInSnapshotMarket({ city: 'Across River', state: 'BB', country: 'US' }, localSnapshot)).toBe(false);
  expect((await pg.query('SELECT count(*)::int AS n FROM discovered_events')).rows[0].n).toBe(0);
});
test('moderation requires the same country/market even for an inactive event and never guesses missing country', async () => {
  const id = await event(1, { is_active: false });
  expect(await eventInSnapshotMarket(id, snapshot)).toBe(true);
  expect(await eventInSnapshotMarket(id, { ...snapshot, country: 'CA' })).toBe(false);
  await expect(readMarketEvents({ ...snapshot, country: null }, { today: '2026-09-29' })).rejects.toThrow('incomplete');
});
test('projection preserves zero coordinates and interprets times in the verified venue zone', async () => {
  await event(1); const { rows } = await readMarketEvents(snapshot, { today: '2026-09-29' });
  const mapped = toBriefingEvent(rows[0]); expect(mapped.latitude).toBe(0); expect(mapped.longitude).toBe(0);
  expect(mapped.start_time_iso).toBe('2026-09-29T01:00:00.000Z');
  expect(mapped.end_time_iso).toBe('2026-10-01T03:00:00.000Z');
  expect(toBriefingEvent({ ...rows[0], venue: { ...rows[0].venue, timezone: null } }).start_time_iso).toBe('');
});

test('viewer-day selection includes an active venue whose local calendar is already tomorrow', async () => {
  const id = await event(1, { event_start_date: '2026-09-30', event_end_date: '2026-09-30', event_start_time: '00:15', event_end_time: '01:30' });
  await pg.exec("UPDATE venue_catalog SET timezone = 'America/New_York'");
  const viewer = { ...snapshot, timezone: 'America/Chicago' };
  const result = await readMarketEvents(viewer, { today: '2026-09-29' });
  expect(result.rows.map(r => r.event.id)).toEqual([id]);
  const projected = toBriefingEvent(result.rows[0]);
  expect(eventOverlapsDisplayDays(projected, '2026-09-29', '2026-09-29', viewer.timezone)).toBe(true);
  expect(projected.impact).toBeNull();
});
test('unresolved venue timezone is reported instead of becoming verified absence', async () => {
  await event(1); await pg.exec('UPDATE venue_catalog SET timezone = NULL');
  const result = await readMarketEvents(snapshot, { today: '2026-09-29' });
  expect(result.rows).toEqual([]); expect(result.unresolvedCount).toBe(1);
});
