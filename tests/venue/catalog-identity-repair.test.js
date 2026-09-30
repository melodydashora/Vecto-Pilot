// tests/venue/catalog-identity-repair.test.js
// 2026-09-29 (Claude): legacy venue_catalog rows (long country name, no timezone) were
// returned unchanged on a place_id hit, so every consumer that requires an ISO-2 country
// and a venue timezone rejected them forever. These tests run the real catalog SQL in
// PGlite. Provider and timezone adapters are fakes; fixtures are synthetic except the
// literal legacy country value, which is the data shape under repair.
import { jest, beforeAll, beforeEach, afterEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { venue_catalog } from '../../shared/schema.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const dialect = new PgDialect();
let pg, orm;
// PGlite has no advisory locks; record them, run everything else for real.
const wrap = client => new Proxy(client, { get(target, name) {
  if (name === 'execute') return query => dialect.sqlToQuery(query).sql.includes('pg_advisory_xact_lock')
    ? Promise.resolve({ rows: [] }) : target.execute(query);
  return typeof target[name] === 'function' ? target[name].bind(target) : target[name];
} });
const db = new Proxy({}, { get(_target, name) {
  if (name === 'transaction') return write => orm.transaction(tx => write(wrap(tx)));
  return wrap(orm)[name];
} });
const log = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
const timezoneFromCoords = jest.fn();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({
  resolveTimezoneFromMarket: async () => null, resolveTimezoneFromCoords: timezoneFromCoords,
}));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ createWorkflowLogger: () => log }));
process.env.GOOGLE_MAPS_API_KEY = 'fixture-only';
const { findOrCreateVenue, lookupVenue, repairVenueIdentity } = await import('../../server/lib/venue/venue-cache.js');
const originalFetch = global.fetch;

const STORED = { lat: 1.123456, lng: 2.123456 };
const legacy = extra => ({ venue_name: 'Fixture Hall', normalized_name: 'fixture hall', place_id: 'provider-legacy',
  address: '123 Fixture Street, Fixture City, XX', formatted_address: '123 Fixture Street, Fixture City, XX',
  city: 'Fixture City', state: 'XX', country: 'United States', timezone: null, lat: STORED.lat, lng: STORED.lng,
  coord_key: '1.123456_2.123456', category: 'venue', discovery_source: 'fixture',
  // Fully enriched, so the unrelated background Details backfill stays idle.
  phone_number: 'fixture phone', google_rating: 4.5, business_hours: { weekdayDescriptions: [] }, ...extra });
const hit = extra => ({ venue: 'Fixture Hall', city: 'Fixture City', state: 'XX', country: 'US', placeId: 'provider-legacy',
  // The caller's point differs on purpose: the repair must use the stored one.
  latitude: 3.123456, longitude: 4.123456, ...extra });
const details = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const country = code => details({ id: 'provider-legacy', addressComponents: [{ types: ['country', 'political'], longText: 'Fixture Country', shortText: code }] });
const stored = async () => (await pg.query('SELECT * FROM venue_catalog ORDER BY venue_name')).rows;
const messages = fn => fn.mock.calls.map(call => call.filter(part => typeof part === 'string').join(' '));

beforeAll(async () => {
  pg = new PGlite(); orm = drizzle(pg);
  const config = getTableConfig(venue_catalog);
  await pg.exec('CREATE TABLE venue_catalog (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType() +
    (c.name === 'venue_id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : '')).join(', ') +
    ', CONSTRAINT venue_catalog_place_id_unique UNIQUE(place_id))');
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE venue_catalog');
  jest.clearAllMocks(); jest.restoreAllMocks();
  timezoneFromCoords.mockReset(); timezoneFromCoords.mockResolvedValue('Etc/UTC');
  global.fetch = jest.fn(async () => country('US'));
});
afterEach(() => { jest.useRealTimers(); });
afterAll(async () => { global.fetch = originalFetch; await pg?.close(); });

test('a legacy row hit by place_id is repaired from the provider country and its stored coordinates, and the repair is saved', async () => {
  await orm.insert(venue_catalog).values(legacy());
  const result = await findOrCreateVenue(hit(), 'fixture');
  expect(result).toMatchObject({ place_id: 'provider-legacy', country: 'US', timezone: 'Etc/UTC' });
  expect(await stored()).toEqual([expect.objectContaining({ country: 'US', timezone: 'Etc/UTC', lat: STORED.lat, lng: STORED.lng })]);
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
  expect(timezoneFromCoords.mock.calls[0].slice(0, 2)).toEqual([STORED.lat, STORED.lng]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(String(global.fetch.mock.calls[0][0])).toBe('https://places.googleapis.com/v1/places/provider-legacy');
  expect(messages(log.info).join('\n')).toMatch(/VENUE_IDENTITY_REPAIR/);
});

test('a failed repair returns the row unrepaired, logs the stage and the cause, and guesses nothing', async () => {
  await orm.insert(venue_catalog).values(legacy());
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'fixture outage', json: async () => ({}) }));
  timezoneFromCoords.mockResolvedValue(null);
  const result = await findOrCreateVenue(hit(), 'fixture');
  expect(result).toMatchObject({ place_id: 'provider-legacy', country: 'United States', timezone: null });
  expect(await stored()).toEqual([expect.objectContaining({ country: 'United States', timezone: null })]);
  const warned = messages(log.warn).join('\n');
  expect(warned).toMatch(/VENUE_IDENTITY_REPAIR/);
  expect(warned).toMatch(/503/);
  expect(warned).toMatch(/timezone/i);
});

test('what was verified is saved even when the other half of the repair fails', async () => {
  await orm.insert(venue_catalog).values(legacy());
  timezoneFromCoords.mockResolvedValue(null);
  const result = await findOrCreateVenue(hit(), 'fixture');
  expect(result).toMatchObject({ country: 'US', timezone: null });
  expect(await stored()).toEqual([expect.objectContaining({ country: 'US', timezone: null })]);
  expect(messages(log.warn).join('\n')).toMatch(/VENUE_IDENTITY_REPAIR.*timezone/is);
});

test('an invalid provider country or timezone is never stored', async () => {
  await orm.insert(venue_catalog).values(legacy());
  global.fetch = jest.fn(async () => details({ id: 'provider-legacy', addressComponents: [{ types: ['country'], longText: 'Fixture Country' }] }));
  timezoneFromCoords.mockResolvedValue('Not/AZone');
  const result = await findOrCreateVenue(hit(), 'fixture');
  expect(result).toMatchObject({ country: 'United States', timezone: null });
  expect(await stored()).toEqual([expect.objectContaining({ country: 'United States', timezone: null })]);
});

test('a provider answer for a different identity cannot repair this row', async () => {
  await orm.insert(venue_catalog).values(legacy());
  global.fetch = jest.fn(async () => details({ id: 'provider-other', addressComponents: [{ types: ['country'], shortText: 'US' }] }));
  const result = await findOrCreateVenue(hit(), 'fixture');
  expect(result).toMatchObject({ country: 'United States', timezone: 'Etc/UTC' });
  expect(messages(log.warn).join('\n')).toMatch(/VENUE_IDENTITY_REPAIR.*different identity/is);
});

test('simultaneous hits on one venue share a single provider round', async () => {
  await orm.insert(venue_catalog).values(legacy());
  const results = await Promise.all([findOrCreateVenue(hit(), 'fixture'), findOrCreateVenue(hit(), 'fixture'), findOrCreateVenue(hit(), 'fixture')]);
  expect(results.map(row => [row.country, row.timezone])).toEqual([['US', 'Etc/UTC'], ['US', 'Etc/UTC'], ['US', 'Etc/UTC']]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
  // Once saved, later hits need no provider at all.
  await findOrCreateVenue(hit(), 'fixture');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
});

test('a failed repair is not retried for the same venue until the retry window has passed', async () => {
  await orm.insert(venue_catalog).values(legacy());
  const clock = jest.spyOn(Date, 'now');
  const start = 1_800_000_000_000;
  clock.mockReturnValue(start);
  global.fetch = jest.fn(async () => { throw new Error('fixture network failure'); });
  timezoneFromCoords.mockResolvedValue(null);
  for (let attempt = 0; attempt < 5; attempt++) await findOrCreateVenue(hit(), 'fixture');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
  expect(messages(log.warn).join('\n')).toMatch(/fixture network failure/);

  global.fetch = jest.fn(async () => country('US'));
  timezoneFromCoords.mockResolvedValue('Etc/UTC');
  clock.mockReturnValue(start + 60 * 60 * 1000);
  const recovered = await findOrCreateVenue(hit(), 'fixture');
  expect(recovered).toMatchObject({ country: 'US', timezone: 'Etc/UTC' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a venue stored without a timezone because its first lookup failed is repaired on the next hit', async () => {
  timezoneFromCoords.mockResolvedValueOnce(null);
  const created = await findOrCreateVenue(hit({ placeId: 'provider-new', formattedAddress: '9 Fixture Street, Fixture City, XX',
    address: '9 Fixture Street, Fixture City, XX', latitude: STORED.lat, longitude: STORED.lng }), 'fixture');
  expect(created).toMatchObject({ place_id: 'provider-new', country: 'US', timezone: null });
  expect(messages(log.warn).join('\n')).toMatch(/VENUE_CREATE.*timezone/is);
  // Drain the fire-and-forget Details backfill started for the new row.
  await new Promise(resolve => setImmediate(resolve));
  global.fetch.mockClear();

  const next = await findOrCreateVenue(hit({ placeId: 'provider-new', latitude: STORED.lat, longitude: STORED.lng }), 'fixture');
  expect(next).toMatchObject({ venue_id: created.venue_id, timezone: 'Etc/UTC' });
  expect((await stored())[0]).toMatchObject({ timezone: 'Etc/UTC' });
});

test('the guarded update never overwrites a value another writer saved while the provider was answering', async () => {
  await orm.insert(venue_catalog).values(legacy());
  global.fetch = jest.fn(async () => {
    await pg.exec("UPDATE venue_catalog SET country = 'CA', timezone = 'America/Toronto' WHERE place_id = 'provider-legacy'");
    return country('US');
  });
  const result = await findOrCreateVenue(hit(), 'fixture');
  expect(result).toMatchObject({ country: 'CA', timezone: 'America/Toronto' });
  expect(await stored()).toEqual([expect.objectContaining({ country: 'CA', timezone: 'America/Toronto' })]);
});

test('each missing fact is guarded independently, so a concurrent country winner does not block timezone repair', async () => {
  await orm.insert(venue_catalog).values(legacy());
  global.fetch = jest.fn(async () => {
    await pg.exec("UPDATE venue_catalog SET country = 'CA' WHERE place_id = 'provider-legacy'");
    return country('US');
  });
  expect(await findOrCreateVenue(hit(), 'fixture')).toMatchObject({ country: 'CA', timezone: 'Etc/UTC' });
  expect(await stored()).toEqual([expect.objectContaining({ country: 'CA', timezone: 'Etc/UTC' })]);
});

test('a changed stored point prevents stale coordinate-bound repair and returns the current same-ID row', async () => {
  await orm.insert(venue_catalog).values(legacy());
  global.fetch = jest.fn(async () => {
    await pg.exec("UPDATE venue_catalog SET lat = 5, lng = 6 WHERE place_id = 'provider-legacy'");
    return country('US');
  });
  expect(await findOrCreateVenue(hit(), 'fixture')).toMatchObject({ country: 'United States', timezone: null, lat: 5, lng: 6 });
  expect(timezoneFromCoords.mock.calls[0].slice(0, 2)).toEqual([STORED.lat, STORED.lng]);
  expect(await stored()).toEqual([expect.objectContaining({ country: 'United States', timezone: null, lat: 5, lng: 6 })]);
});

test('a changed provider identity prevents all stale identity writes', async () => {
  const [row] = await orm.insert(venue_catalog).values(legacy()).returning();
  global.fetch = jest.fn(async () => {
    await pg.exec("UPDATE venue_catalog SET place_id = 'provider-other', country = NULL WHERE place_id = 'provider-legacy'");
    return country('US');
  });
  expect(await repairVenueIdentity(row)).toMatchObject({ place_id: 'provider-legacy', country: 'United States', timezone: null });
  expect(await stored()).toEqual([expect.objectContaining({ place_id: 'provider-other', country: null, timezone: null })]);
});

test('invalid stored coordinates never use caller coordinates for timezone repair', async () => {
  await orm.insert(venue_catalog).values(legacy({ lat: null, lng: null }));
  expect(await findOrCreateVenue(hit(), 'fixture')).toMatchObject({ country: 'US', timezone: null, lat: null, lng: null });
  expect(timezoneFromCoords).not.toHaveBeenCalled();
  expect(messages(log.warn).join('\n')).toMatch(/timezone.*stored coordinates/is);
});

test('a partial repair shares the same retry window for its still-missing fact', async () => {
  await orm.insert(venue_catalog).values(legacy());
  timezoneFromCoords.mockResolvedValue(null);
  expect(await findOrCreateVenue(hit(), 'fixture')).toMatchObject({ country: 'US', timezone: null });
  expect(await findOrCreateVenue(hit(), 'fixture')).toMatchObject({ country: 'US', timezone: null });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
});

test('missing timezone alone is repaired without an unnecessary country-provider request', async () => {
  await orm.insert(venue_catalog).values(legacy({ country: 'US' }));
  expect(await findOrCreateVenue(hit(), 'fixture')).toMatchObject({ country: 'US', timezone: 'Etc/UTC' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
});

test('repair deadlines abort both adapters, settle shared callers and prevent late facts from being saved', async () => {
  const [row] = await orm.insert(venue_catalog).values(legacy()).returning();
  jest.useFakeTimers();
  let resolveDetails, resolveTimezone, detailsSignal, timezoneSignal;
  const delayedDetails = new Promise(resolve => { resolveDetails = resolve; });
  const delayedTimezone = new Promise(resolve => { resolveTimezone = resolve; });
  global.fetch = jest.fn((_url, options) => { detailsSignal = options.signal; return delayedDetails; });
  timezoneFromCoords.mockImplementation((_lat, _lng, options) => { timezoneSignal = options.signal; return delayedTimezone; });
  const first = repairVenueIdentity(row), second = repairVenueIdentity(row);
  await jest.advanceTimersByTimeAsync(15000);
  expect(await Promise.all([first, second])).toEqual([expect.objectContaining({ country: 'United States', timezone: null }),
    expect.objectContaining({ country: 'United States', timezone: null })]);
  expect(detailsSignal.aborted).toBe(true); expect(timezoneSignal.aborted).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(1); expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
  resolveDetails(country('US')); resolveTimezone('Etc/UTC');
  await Promise.resolve(); await Promise.resolve();
  expect(await stored()).toEqual([expect.objectContaining({ country: 'United States', timezone: null })]);
  expect(messages(log.warn).join('\n')).toMatch(/timed out/);
  expect(jest.getTimerCount()).toBe(0);
});

test('a row without a provider identity gets its timezone from stored coordinates but never a guessed country', async () => {
  const [row] = await orm.insert(venue_catalog).values(legacy({ place_id: null, country: null })).returning();
  const result = await repairVenueIdentity(row);
  expect(result).toMatchObject({ venue_id: row.venue_id, country: null, timezone: 'Etc/UTC' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(messages(log.warn).join('\n')).toMatch(/VENUE_IDENTITY_REPAIR.*country/is);
});

test('a complete row is returned as stored with no provider work', async () => {
  await orm.insert(venue_catalog).values(legacy({ country: 'US', timezone: 'Etc/UTC' }));
  const result = await findOrCreateVenue(hit(), 'fixture');
  expect(result).toMatchObject({ country: 'US', timezone: 'Etc/UTC' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(timezoneFromCoords).not.toHaveBeenCalled();
  expect(await lookupVenue({ placeId: 'provider-legacy' })).toMatchObject({ country: 'US' });
});
