import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { venue_catalog, coords_cache } from '../../shared/schema.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const dialect = new PgDialect();
let pg, orm, beforeCatalogInsert;
const lockCalls = [];
// PGlite serializes transactions and does not implement advisory locks. All
// catalog/migration SQL runs for real; the transaction lock is recorded here.
// This suite does not claim multi-connection PostgreSQL concurrency evidence.
const wrap = client => new Proxy(client, { get(target, name) {
  if (name === 'execute') return query => {
    const compiled = dialect.sqlToQuery(query);
    if (compiled.sql.includes('pg_advisory_xact_lock')) {
      lockCalls.push(compiled); return Promise.resolve({ rows: [] });
    }
    return target.execute(query);
  };
  return typeof target[name] === 'function' ? target[name].bind(target) : target[name];
} });
const db = new Proxy({}, { get(_target, name) {
  if (name === 'transaction') return write => orm.transaction(tx => write(wrap(tx)));
  if (name === 'insert') return table => ({ values: input => {
    const query = orm.insert(table).values(input);
    // The hook inserts a competing real SQL row immediately before the tested
    // INSERT executes, after any application-side lookup already saw no row.
    const gated = statement => ({ returning: async () => {
      const gate = beforeCatalogInsert; beforeCatalogInsert = null;
      if (gate) await gate(input);
      return statement.returning();
    } });
    return { onConflictDoUpdate: options => gated(query.onConflictDoUpdate(options)),
      onConflictDoNothing: options => gated(query.onConflictDoNothing(options)), returning: () => gated(query).returning() };
  } });
  return wrap(orm)[name];
} });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const timezoneFromCoords = jest.fn(async () => 'Etc/UTC');
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({
  resolveTimezoneFromMarket: async () => null, resolveTimezoneFromCoords: timezoneFromCoords,
}));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ createWorkflowLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }));
process.env.GOOGLE_MAPS_API_KEY = 'fixture-only';
const { lookupVenue, lookupVenueFuzzy, insertVenue, upsertVenue, findOrCreateVenue, enrichVenueFromPlaceId } = await import('../../server/lib/venue/venue-cache.js');
const { resolveVenueAddress, resolveVenueAddressesBatch } = await import('../../server/lib/venue/venue-address-resolver.js');
const originalFetch = global.fetch;
const fixture = extra => ({ venueName: 'Fixture Hall', placeId: 'provider-hall', address: '123 Fixture Street, Fixture City, AA',
  formattedAddress: '123 Fixture Street, Fixture City, AA', city: 'Fixture City', state: 'AA', country: 'CA',
  lat: 1.2345678901234, lng: 2.3456789012345, source: 'fixture', ...extra });
const raw = data => ({ venue_name: data.venueName, normalized_name: data.venueName.toLowerCase(),
  place_id: data.placeId, address: data.address, formatted_address: data.formattedAddress, city: data.city,
  state: data.state, country: data.country, lat: data.lat, lng: data.lng,
  coord_key: `${data.lat.toFixed(6)}_${data.lng.toFixed(6)}`, category: 'venue', discovery_source: 'fixture' });
const rows = async () => (await pg.query('SELECT * FROM venue_catalog ORDER BY place_id NULLS LAST, venue_name')).rows;
beforeAll(async () => {
  pg = new PGlite(); orm = drizzle(pg);
  const config = getTableConfig(venue_catalog);
  await pg.exec('CREATE TABLE venue_catalog (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType() +
    (c.name === 'venue_id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : '')).join(', ') +
    ', CONSTRAINT venue_catalog_place_id_unique UNIQUE(place_id))');
  await pg.exec('CREATE TABLE coords_cache(coord_key text PRIMARY KEY)');
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE venue_catalog, coords_cache; ALTER TABLE venue_catalog DROP CONSTRAINT IF EXISTS venue_catalog_coord_key_unique');
  lockCalls.length = 0;
  beforeCatalogInsert = null;
  timezoneFromCoords.mockReset();
  timezoneFromCoords.mockResolvedValue('Etc/UTC');
  global.fetch = jest.fn(async () => { throw new Error('Unexpected provider request'); });
});
afterAll(async () => { global.fetch = originalFetch; await pg?.close(); });

test('migration permits two Google identities at one point and keeps both identity/cache uniqueness contracts', async () => {
  await pg.exec('ALTER TABLE venue_catalog ADD CONSTRAINT venue_catalog_coord_key_unique UNIQUE(coord_key)');
  await orm.insert(venue_catalog).values(raw(fixture()));
  await expect(orm.insert(venue_catalog).values(raw(fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar' })))).rejects.toMatchObject({ cause: { code: '23505' } });
  const migration = await readFile(new URL('../../migrations/20260929_venue_catalog_colocated_identity.sql', import.meta.url), 'utf8');
  await pg.exec(migration); await pg.exec(migration);
  await orm.insert(venue_catalog).values(raw(fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar' })));
  expect(await rows()).toHaveLength(2);
  await expect(orm.insert(venue_catalog).values(raw(fixture({ lat: 3 })))).rejects.toMatchObject({ cause: { code: '23505' } });
  await pg.exec("INSERT INTO coords_cache VALUES ('same-point')");
  await expect(pg.exec("INSERT INTO coords_cache VALUES ('same-point')")).rejects.toMatchObject({ code: '23505' });
  const config = getTableConfig(venue_catalog);
  expect(config.columns.find(c => c.name === 'coord_key').isUnique).toBe(false);
  expect(config.columns.find(c => c.name === 'place_id').isUnique).toBe(true);
  expect(config.indexes.find(i => i.config.name === 'idx_venue_catalog_coord_key').config.unique).toBe(false);
  expect(getTableConfig(coords_cache).columns.find(c => c.name === 'coord_key').isUnique).toBe(true);
});
test('concurrent explicit inserts preserve distinct colocated identities and repeat identity returns one row', async () => {
  const [a, b, repeated] = await Promise.all([
    insertVenue(fixture()), insertVenue(fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar' })), insertVenue(fixture()),
  ]);
  expect(a.venue_id).toBe(repeated.venue_id); expect(a.venue_id).not.toBe(b.venue_id);
  expect((await rows()).map(r => r.place_id)).toEqual(['provider-bar', 'provider-hall']);
});
test('same provider ID can move to coordinates already occupied by another provider without replacing either', async () => {
  const a = await insertVenue(fixture({ lat: 3 }));
  const b = await insertVenue(fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar' }));
  const moved = await upsertVenue(fixture(), { isEventVenue: true, recordStatus: 'verified' });
  expect(moved.venue_id).toBe(a.venue_id); expect(moved.lat).toBe(fixture().lat);
  expect(await lookupVenue({ placeId: 'provider-bar' })).toMatchObject({ venue_id: b.venue_id, venue_name: 'Fixture Bar' });
  expect(await rows()).toHaveLength(2);
});
test('simultaneous promotions merge roles/status atomically and missing fields preserve known identity facts', async () => {
  await insertVenue(fixture({ country: null }));
  await Promise.all([
    upsertVenue(fixture({ country: 'ca', venueTypes: ['bar'] }), { isBar: true, recordStatus: 'verified' }),
    upsertVenue(fixture({ country: undefined, venueTypes: ['event_host'] }), { isEventVenue: true, recordStatus: 'enriched' }),
  ]);
  const [row] = await rows();
  expect(row).toMatchObject({ country: 'CA', is_bar: true, is_event_venue: true, record_status: 'verified' });
  expect(row.venue_types).toEqual(expect.arrayContaining(['bar', 'event_host']));
});
test('coordinate-only reads fail closed on colocated identities, including valid zero coordinates', async () => {
  await orm.insert(venue_catalog).values([raw(fixture({ lat: 0, lng: 0 })), raw(fixture({ lat: 0, lng: 0, placeId: 'provider-bar', venueName: 'Fixture Bar' }))]);
  expect(await lookupVenue({ lat: 0, lng: 0 })).toBeNull();
  expect(await lookupVenue({ lat: 0, lng: 0, venueName: 'Fixture Bar' })).toMatchObject({ place_id: 'provider-bar' });
});
test('name and coordinate evidence are combined; a different co-located name is never a fallback', async () => {
  await orm.insert(venue_catalog).values([raw(fixture()), raw(fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar' }))]);
  expect(await lookupVenue({ ...fixture(), venueName: 'Missing Shop', placeId: undefined })).toBeNull();
  expect(await lookupVenue({ ...fixture(), venueName: 'Fixture Bar', placeId: undefined })).toMatchObject({ place_id: 'provider-bar' });
});
test('same-name identities remain ambiguous and exact names are scoped to known country', async () => {
  await orm.insert(venue_catalog).values([raw(fixture()), raw(fixture({ placeId: 'provider-other', country: 'US' }))]);
  const criteria = { venueName: 'Fixture Hall', city: 'Fixture City', state: 'AA' };
  expect(await lookupVenue(criteria)).toBeNull();
  expect(await lookupVenue({ ...criteria, country: 'CA' })).toMatchObject({ place_id: 'provider-hall' });
});
test('fuzzy names cannot select the first provider or cross to a different city', async () => {
  await orm.insert(venue_catalog).values([raw(fixture()), raw(fixture({ placeId: 'provider-other', venueName: 'Fixture Hall Annex' }))]);
  const criteria = { venueName: 'Fixture', city: 'Fixture City', state: 'AA', country: 'CA' };
  expect(await lookupVenueFuzzy(criteria)).toBeNull();
  expect(await lookupVenueFuzzy({ ...criteria, venueName: 'Hall', city: 'Other City' })).toBeNull();
  expect(await lookupVenueFuzzy({ ...criteria, placeId: 'missing-id' })).toBeNull();
});
test('unknown-ID stubs deduplicate only identical evidence without acquiring a colocated provider identity', async () => {
  await insertVenue(fixture());
  const stub = fixture({ placeId: undefined, venueName: 'Unknown Shop' });
  const [a, b] = await Promise.all([insertVenue(stub), insertVenue(stub)]);
  expect(a.venue_id).toBe(b.venue_id); expect(a.place_id).toBeNull();
  await insertVenue({ ...stub, address: '123 Fixture Street Suite 2' });
  expect(await rows()).toHaveLength(3); expect(lockCalls).toHaveLength(3);
});
test('ambiguous legacy unidentified rows are left separate and unidentified insert without location has no fabricated identity', async () => {
  const unknown = fixture({ placeId: undefined });
  await orm.insert(venue_catalog).values([raw(unknown), raw(unknown)]);
  expect(await insertVenue(unknown)).toBeNull();
  expect(await insertVenue({ ...unknown, lat: undefined })).toBeNull();
  expect(await rows()).toHaveLength(2);
});
test('unidentified upsert cannot rewrite a known provider identity', async () => {
  const existing = await insertVenue(fixture());
  const result = await upsertVenue(fixture({ placeId: undefined, address: 'Model-generated address' }));
  expect(result.venue_id).toBe(existing.venue_id);
  expect((await rows())[0].address).toBe(fixture().address);
});
test('event venue linking uses the name at a shared point', async () => {
  await orm.insert(venue_catalog).values([raw(fixture()), raw(fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar' }))]);
  const result = await findOrCreateVenue({ venue: 'Fixture Bar', city: 'Fixture City', state: 'AA', country: 'CA', latitude: fixture().lat, longitude: fixture().lng }, 'fixture');
  expect(result.place_id).toBe('provider-bar');
});
test('overlapping repairs of an unidentified stub cannot overwrite or return the other provider identity', async () => {
  await orm.insert(venue_catalog).values(raw(fixture({ placeId: undefined, address: 'Fixture City, AA', formattedAddress: 'Fixture City, AA' })));
  const pending = [];
  let releaseBoth;
  const bothStarted = new Promise(resolve => { releaseBoth = resolve; });
  global.fetch = jest.fn(url => String(url).endsWith(':searchText') ? new Promise(resolve => {
    pending.push(resolve); if (pending.length === 2) releaseBoth();
  }) : Promise.resolve({ ok: true, json: async () => ({}) }));
  const data = { venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', country: 'CA', latitude: fixture().lat, longitude: fixture().lng };
  const first = findOrCreateVenue(data, 'fixture'), second = findOrCreateVenue(data, 'fixture');
  await bothStarted;
  const response = placeId => ({ ok: true, json: async () => ({ places: [{ id: placeId, displayName: { text: 'Fixture Hall' },
    location: { latitude: fixture().lat, longitude: fixture().lng }, formattedAddress: fixture().address,
    // This race is address/ID promotion; complete provider country isolates it
    // from the independently tested missing-country Details repair.
    addressComponents: [{ types: ['country'], shortText: 'CA' }],
  }] }) });
  pending[0](response('provider-first')); const a = await first;
  pending[1](response('provider-second')); const b = await second;
  expect(a.place_id).toBe('provider-first'); expect(b.place_id).toBe('provider-second');
  expect(a.venue_id).not.toBe(b.venue_id);
  expect((await rows()).map(r => r.place_id)).toEqual(['provider-first', 'provider-second']);
});
test('repair of a stub that resolves to an already cataloged ID returns that canonical row', async () => {
  const canonical = await insertVenue(fixture({ lat: 3 }));
  const stub = fixture({ placeId: undefined, address: 'Fixture City, AA', formattedAddress: 'Fixture City, AA' });
  await orm.insert(venue_catalog).values(raw(stub));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ places: [{
    id: 'provider-hall', displayName: { text: 'Fixture Hall' }, location: { latitude: fixture().lat, longitude: fixture().lng },
    formattedAddress: fixture().address, addressComponents: [],
  }] }) }));
  const result = await findOrCreateVenue({ venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', country: 'CA', latitude: fixture().lat, longitude: fixture().lng }, 'fixture');
  expect(result.venue_id).toBe(canonical.venue_id);
  expect(result.place_id).toBe('provider-hall');
  const catalog = await rows();
  expect(catalog).toHaveLength(2); expect(catalog.filter(row => row.place_id === null)).toHaveLength(1);
});

test('a late same-ID address repair cannot replace fresher catalog coordinates or pair them with a different timezone', async () => {
  const old = await insertVenue(fixture({ address: 'Fixture City, AA', formattedAddress: 'Fixture City, AA', timezone: 'Etc/UTC' }));
  const current = { address: '987 Current Street, Current City, BB', lat: 5.123456789, lng: 6.123456789 };
  global.fetch = jest.fn(async url => {
    if (!String(url).endsWith(':searchText')) return { ok: true, json: async () => ({}) };
    await pg.exec("UPDATE venue_catalog SET address = '987 Current Street, Current City, BB', formatted_address = '987 Current Street, Current City, BB', city = 'Current City', state = 'BB', country = 'US', lat = 5.123456789, lng = 6.123456789, coord_key = '5.123457_6.123457', timezone = 'America/Chicago' WHERE place_id = 'provider-hall'");
    return { ok: true, json: async () => ({ places: [{ id: 'provider-hall', displayName: { text: 'Fixture Hall' },
      location: { latitude: fixture().lat, longitude: fixture().lng }, formattedAddress: fixture().address,
      addressComponents: [{ types: ['country'], shortText: 'CA' }],
    }] }) };
  });
  const result = await findOrCreateVenue({ venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', country: 'CA',
    placeId: 'provider-hall', latitude: fixture().lat, longitude: fixture().lng }, 'fixture');
  expect(result).toMatchObject({ venue_id: old.venue_id, place_id: 'provider-hall', address: current.address,
    country: 'US', timezone: 'America/Chicago', lat: current.lat, lng: current.lng });
  expect(await rows()).toEqual([expect.objectContaining({ address: current.address, country: 'US', timezone: 'America/Chicago',
    lat: current.lat, lng: current.lng, coord_key: '5.123457_6.123457' })]);
});

test('same-ID address repair at a changed provider point resolves timezone from that new point', async () => {
  const old = await insertVenue(fixture({ address: 'Fixture City, AA', formattedAddress: 'Fixture City, AA', timezone: 'America/Toronto', marketSlug: 'fixture-old' }));
  global.fetch = jest.fn(async url => String(url).endsWith(':searchText') ? { ok: true, json: async () => ({ places: [{
    id: 'provider-hall', displayName: { text: 'Fixture Hall' }, location: { latitude: 5, longitude: 6 },
    formattedAddress: '987 Current Street, Current City, BB', addressComponents: [{ types: ['country'], shortText: 'US' }],
  }] }) } : { ok: true, json: async () => ({}) });
  const result = await findOrCreateVenue({ venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', country: 'CA',
    placeId: 'provider-hall', latitude: fixture().lat, longitude: fixture().lng }, 'fixture');
  expect(result).toMatchObject({ venue_id: old.venue_id, place_id: 'provider-hall', lat: 5, lng: 6,
    country: 'US', timezone: 'Etc/UTC', market_slug: null });
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
  expect(timezoneFromCoords.mock.calls[0].slice(0, 2)).toEqual([5, 6]);
  expect(await rows()).toEqual([expect.objectContaining({ lat: 5, lng: 6, timezone: 'Etc/UTC', market_slug: null })]);
});

test('a newly created venue repairs timezone immediately when its corrected address moves the provider point', async () => {
  timezoneFromCoords.mockResolvedValueOnce('America/Toronto').mockResolvedValueOnce('America/Chicago');
  global.fetch = jest.fn(async url => String(url).endsWith(':searchText') ? { ok: true, json: async () => ({ places: [{
    id: 'provider-hall', displayName: { text: 'Fixture Hall' }, location: { latitude: 5, longitude: 6 },
    formattedAddress: '987 Current Street, Current City, BB', addressComponents: [{ types: ['country'], shortText: 'US' }],
  }] }) } : { ok: true, json: async () => ({}) });

  const result = await findOrCreateVenue({ venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', country: 'CA',
    placeId: 'provider-hall', latitude: fixture().lat, longitude: fixture().lng,
    address: 'Fixture City, AA', formattedAddress: 'Fixture City, AA' }, 'fixture');

  expect(result).toMatchObject({ place_id: 'provider-hall', lat: 5, lng: 6, country: 'US', timezone: 'America/Chicago' });
  expect(timezoneFromCoords).toHaveBeenCalledTimes(2);
  expect(timezoneFromCoords.mock.calls.map(call => call.slice(0, 2))).toEqual([[fixture().lat, fixture().lng], [5, 6]]);
  expect(await rows()).toEqual([expect.objectContaining({ venue_id: result.venue_id, lat: 5, lng: 6,
    country: 'US', timezone: 'America/Chicago' })]);
});

test('valid-address creation does not immediately retry a failed initial timezone lookup', async () => {
  timezoneFromCoords.mockRejectedValueOnce(new Error('fixture timezone unavailable'));
  const result = await findOrCreateVenue({ venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', country: 'CA',
    latitude: fixture().lat, longitude: fixture().lng, address: fixture().address,
    formattedAddress: fixture().formattedAddress }, 'fixture');

  expect(result).toMatchObject({ lat: fixture().lat, lng: fixture().lng, country: 'CA', timezone: null });
  expect(timezoneFromCoords).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(await rows()).toEqual([expect.objectContaining({ venue_id: result.venue_id, timezone: null })]);
});

test('the losing repair insert cannot overwrite an ID winner appearing after its canonical lookup', async () => {
  const [stub] = await orm.insert(venue_catalog).values({ ...raw(fixture({ placeId: undefined,
    address: 'Fixture City, AA', formattedAddress: 'Fixture City, AA' })), timezone: 'Etc/UTC' }).returning();
  const insertedWinner = [];
  global.fetch = jest.fn(async url => {
    if (!String(url).endsWith(':searchText')) return { ok: true, json: async () => ({}) };
    await pg.exec("UPDATE venue_catalog SET place_id = 'provider-promoted-other' WHERE place_id IS NULL");
    beforeCatalogInsert = async input => {
      expect(input.place_id).toBe('provider-racing');
      const [winner] = await orm.insert(venue_catalog).values({ ...raw(fixture({ placeId: 'provider-racing',
        address: '987 Winner Street', formattedAddress: '987 Winner Street', country: 'US', lat: 5, lng: 6 })),
        timezone: 'America/Chicago' }).returning();
      insertedWinner.push(winner);
    };
    return { ok: true, json: async () => ({ places: [{ id: 'provider-racing', displayName: { text: 'Fixture Hall' },
      location: { latitude: fixture().lat, longitude: fixture().lng }, formattedAddress: fixture().address,
      addressComponents: [{ types: ['country'], shortText: 'CA' }],
    }] }) };
  });
  const result = await findOrCreateVenue({ venue: 'Fixture Hall', city: 'Fixture City', state: 'AA', country: 'CA',
    latitude: fixture().lat, longitude: fixture().lng }, 'fixture');
  expect(insertedWinner).toHaveLength(1);
  expect(result).toMatchObject({ venue_id: insertedWinner[0].venue_id, place_id: 'provider-racing',
    address: '987 Winner Street', country: 'US', lat: 5, lng: 6, timezone: 'America/Chicago' });
  expect(await lookupVenue({ placeId: 'provider-promoted-other' })).toMatchObject({ venue_id: stub.venue_id });
  expect(await rows()).toHaveLength(2);
});

test('normal provider-ID upsert invalidates old point-dependent facts when no fresh authority accompanies changed coordinates', async () => {
  const first = await insertVenue(fixture({ timezone: 'America/Toronto', marketSlug: 'fixture-old' }));
  const moved = await insertVenue(fixture({ lat: 5, lng: 6, country: undefined, timezone: undefined, marketSlug: undefined }));
  expect(moved).toMatchObject({ venue_id: first.venue_id, lat: 5, lng: 6, timezone: null, country: null, market_slug: null });
  expect(await rows()).toEqual([expect.objectContaining({ timezone: null, country: null, market_slug: null })]);
});

test('same-point upsert preserves known location facts while a moved point accepts freshly supplied facts', async () => {
  await insertVenue(fixture({ timezone: 'America/Toronto', marketSlug: 'fixture-old' }));
  expect(await insertVenue(fixture({ country: undefined })))
    .toMatchObject({ country: 'CA', timezone: 'America/Toronto', market_slug: 'fixture-old' });
  expect(await insertVenue(fixture({ lat: 5, lng: 6, country: 'US', timezone: 'America/Chicago', marketSlug: 'fixture-new' })))
    .toMatchObject({ lat: 5, lng: 6, country: 'US', timezone: 'America/Chicago', market_slug: 'fixture-new' });
});

test('the actual address-provider cache write cannot mix a new point with the old saved timezone', async () => {
  await insertVenue(fixture({ timezone: 'America/Toronto', marketSlug: 'fixture-old' }));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ places: [{ id: 'provider-hall',
    displayName: { text: 'Fixture Hall' }, location: { latitude: 0, longitude: 0 },
    formattedAddress: '987 Current Street', addressComponents: [],
  }] }) }));
  expect(await resolveVenueAddress(fixture().lat, fixture().lng, 'Fixture Hall', { skipCache: true }))
    .toMatchObject({ place_id: 'provider-hall', lat: 0, lng: 0 });
  expect(await lookupVenue({ placeId: 'provider-hall' }))
    .toMatchObject({ lat: 0, lng: 0, timezone: null, country: null, market_slug: null });
});
test('late Details enrichment is bound to both catalog and provider identities', async () => {
  const a = await insertVenue(fixture());
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ nationalPhoneNumber: 'fixture phone' }) }));
  await enrichVenueFromPlaceId(a.venue_id, 'provider-other');
  expect((await rows())[0].phone_number).toBeNull();
  await enrichVenueFromPlaceId(a.venue_id, 'provider-hall');
  expect((await rows())[0].phone_number).toBe('fixture phone');
});
test('address cache honors requested venue name at a shared point', async () => {
  await orm.insert(venue_catalog).values([raw(fixture()), raw(fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar', address: '123 Fixture Street Suite 2', formattedAddress: '123 Fixture Street Suite 2' }))]);
  const result = await resolveVenueAddress(fixture().lat, fixture().lng, 'Fixture Bar');
  expect(result.place_id).toBe('provider-bar'); expect(result.address).toContain('Suite 2');
  expect(global.fetch).not.toHaveBeenCalled();
});
test('address batch keeps every colocated input while preserving legacy keys for unique points', async () => {
  const a = fixture(), b = fixture({ placeId: 'provider-bar', venueName: 'Fixture Bar' }), c = fixture({ placeId: 'provider-away', venueName: 'Away Venue', lat: 0, lng: 0 });
  await orm.insert(venue_catalog).values([raw(a), raw(b), raw(c)]);
  const results = await resolveVenueAddressesBatch([a, b, c].map(v => ({ lat: v.lat, lng: v.lng, name: v.venueName })));
  expect(Object.values(results).map(r => r.place_id)).toEqual(['provider-hall', 'provider-bar', 'provider-away']);
  expect(results['0,0'].place_id).toBe('provider-away');
  expect(results[`${a.lat},${a.lng}#0`].place_id).toBe('provider-hall');
  expect(results[`${a.lat},${a.lng}#1`].place_id).toBe('provider-bar');
});
test('a fresh address provider result creates a second identity at precisely the same point', async () => {
  await insertVenue(fixture());
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ places: [{
    id: 'provider-bar', displayName: { text: 'Fixture Bar' }, location: { latitude: fixture().lat, longitude: fixture().lng },
    formattedAddress: '123 Fixture Street Suite 2', addressComponents: [],
  }] }) }));
  const result = await resolveVenueAddress(fixture().lat, fixture().lng, 'Fixture Bar', { skipCache: true });
  expect(result.place_id).toBe('provider-bar'); expect(await rows()).toHaveLength(2);
  expect(await lookupVenue({ placeId: 'provider-hall' })).toMatchObject({ address: fixture().address });
  expect(await lookupVenue({ placeId: 'provider-bar' })).toMatchObject({ address: '123 Fixture Street Suite 2', lat: fixture().lat });
});
test('address provider cache writes use actual provider identity and point, preserving an adjacent venue', async () => {
  await orm.insert(venue_catalog).values(raw(fixture()));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ places: [{
    id: 'provider-bar', displayName: { text: 'Fixture Bar' }, location: { latitude: 0, longitude: 0 },
    formattedAddress: '123 Fixture Street Suite 2', addressComponents: [],
  }] }) }));
  const resolved = await resolveVenueAddress(fixture().lat, fixture().lng, 'Fixture Bar', { skipCache: true });
  expect(resolved).toMatchObject({ place_id: 'provider-bar', lat: 0, lng: 0 });
  expect(await lookupVenue({ placeId: 'provider-hall' })).toMatchObject({ venue_name: 'Fixture Hall', address: fixture().address });
  expect(await lookupVenue({ placeId: 'provider-bar' })).toMatchObject({ normalized_name: 'fixture bar', coord_key: '0.000000_0.000000', country: null });
  expect(await rows()).toHaveLength(2);
});
