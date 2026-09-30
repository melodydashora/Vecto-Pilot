// Events pipeline resilience and truthful failure.
//
// One candidate that cannot be verified is rejected ALONE, with a logged and
// specific reason. The section succeeds with the verified events and carries
// truthful candidate counts. The section fails only when discovery itself
// failed or when persistence/read really failed.
//
// Real code under test: events.js, market-event-reader.js (SQL in PGlite),
// normalizeEvent, validateEvent, hashEvent, both dedup stages and
// briefing-readiness. Mocked at their exported interface: the Briefer call,
// venue-cache, the venue identity provider, and the event write lock.
//
// Fixtures are synthetic (state XX, invented names, coordinates 1.x). The only
// real values are the IANA zone, because these tests exercise venue-local
// schedules, and the ISO country code that the legacy rows fail to match.
import { jest, beforeAll, beforeEach, afterAll, test, expect, describe } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { markets, market_cities, venue_catalog, discovered_events } from '../../shared/schema.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actualDb;
const db = new Proxy({}, { get: (_target, name) => actualDb[name].bind(actualDb) });

const warn = jest.fn(), error = jest.fn();
const quiet = jest.fn();
const log = new Proxy({}, { get: (_target, name) => name === 'warn' ? warn : name === 'error' ? error : quiet });
const callModel = jest.fn(), lookupVenue = jest.fn(), findOrCreateVenue = jest.fn();
const searchPlaceWithTextSearch = jest.fn(), geocodeEventAddress = jest.fn();
const saved = [];

jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  venuesLog: log, createWorkflowLogger: () => log, briefingLog: log, matrixLog: log, eventsLog: log,
  locationLog: log, triadLog: log, OP: {}, tagLog: jest.fn(), chainLog: jest.fn(),
}));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({
  MainRunAdmissionError: class extends Error {}, assertMainRunForSnapshot: async () => ({ status: 'running' }),
  withCurrentMainRun: async (_id, write) => write(db, {}),
}));
jest.unstable_mockModule('../../server/lib/strategy/strategy-source-store.js', () => ({
  assertCurrentStrategySource: async () => ({}), mergeVenueCacheMetrics: value => value,
}));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/briefing/shared/get-market-for-location.js', () => ({
  getMarketForLocation: async () => 'Synthetic Metro',
}));
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  CHANNELS: { EVENTS: 'events' },
  errorMarker: err => ({ _generationFailed: true, error: err.message }),
  writeSectionAndNotify: async (_id, value) => saved.push(JSON.parse(JSON.stringify(value))),
}));
jest.unstable_mockModule('../../server/lib/briefing/cleanup-events.js', () => ({
  deactivatePastEvents: async () => 0, collapseDuplicateEventSpans: async () => 0,
  clearOrphanedEventVenueTags: async () => 0, mergeIntoOverlappingActiveSpan: async () => null,
  discoveryReactivationFields: () => ({}), resolveEventWriteHash: async (_tx, _event, hash) => hash,
  withEventVenueLock: async (_id, write) => write(db),
}));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ lookupVenue, findOrCreateVenue }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch }));
jest.unstable_mockModule('../../server/lib/events/pipeline/geocodeEvent.js', () => ({ geocodeEventAddress }));

const { discoverEvents } = await import('../../server/lib/briefing/pipelines/events.js');
const { briefingSectionIssue } = await import('../../server/lib/briefing/briefing-readiness.js');

// 2026-09-29 20:00 in the driver's zone.
const now = new Date('2026-09-30T01:00:00Z');
const today = '2026-09-29';
const snapshot = { city: 'Synthetic City', state: 'XX', country: 'US', timezone: 'America/Chicago',
  market: 'Synthetic Metro', lat: 1.123456, lng: 1.123456 };

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogRow = (n, name, overrides = {}) => ({
  venue_id: uuid(n), place_id: `synthetic-place-${n}`, venue_name: name, normalized_name: name.toLowerCase(),
  address: `${n} Synthetic Way, Synthetic City, XX`, formatted_address: `${n} Synthetic Way, Synthetic City, XX`,
  city: 'Synthetic City', state: 'XX', country: 'US', lat: 1.223456, lng: 1.323456,
  timezone: 'America/Chicago', ...overrides,
});
const venues = {
  alpha: catalogRow(1, 'Synthetic Hall Alpha'),
  // Legacy shape: written by the older address parser and never given a zone.
  legacy: catalogRow(2, 'Legacy Room Beta', { country: 'United States', timezone: null }),
  gamma: catalogRow(3, 'Synthetic Bar Gamma'),
  delta: catalogRow(4, 'Synthetic Park Delta'),
};
const candidate = (title, venue, values = {}) => ({
  title, venue: venue.venue_name, place_id: null, address: venue.formatted_address, category: 'concert',
  event_start_date: today, event_start_time: '7:00 PM', event_end_time: '10:00 PM', event_end_date: today,
  impact: null, ...values,
});
const alphaEvent = candidate('Alpha Quartet Recital', venues.alpha);
const legacyEvent = candidate('Beta Improv Showcase', venues.legacy, { category: 'comedy', event_start_time: '8:00 PM' });
// Same-date overnight: ends 01:00 but repeats the start date as its end date.
const overnightEvent = candidate('Gamma Karaoke Social', venues.gamma, { category: 'nightlife', event_start_time: '9:00 PM', event_end_time: '1:00 AM' });
const deltaEvent = candidate('Delta Harvest Fair', venues.delta, { category: 'festival', event_start_time: '6:00 PM', event_end_time: '11:00 PM' });

const discovered = items => callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify(items) });
const run = signal => discoverEvents({ snapshot, snapshotId: 'synthetic-snapshot', signal });
const stored = () => actualDb.select().from(discovered_events);
const titles = rows => rows.map(row => row.title).sort();
const logged = (fn, ...needles) => fn.mock.calls.some(call => needles.every(needle =>
  call.some(arg => String(arg?.message ?? arg).includes(needle))));
const reasonCounts = summary => Object.fromEntries(summary.rejections.map(entry => [entry.reason, entry.count]));

beforeAll(async () => {
  pg = new PGlite(); actualDb = drizzle(pg);
  for (const table of [markets, market_cities, venue_catalog, discovered_events]) {
    const config = getTableConfig(table);
    await pg.exec('CREATE TABLE ' + config.name + ' (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType()).join(', ') + ')');
  }
  await pg.exec(`CREATE UNIQUE INDEX event_hash_fixture ON discovered_events(event_hash);
    ALTER TABLE discovered_events ALTER COLUMN is_active SET DEFAULT true;
    ALTER TABLE discovered_events ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
}, 30000);
afterAll(async () => { jest.useRealTimers(); await pg?.close(); });

beforeEach(async () => {
  jest.useRealTimers(); jest.clearAllMocks(); saved.length = 0;
  await pg.exec('DROP INDEX IF EXISTS event_hash_fixture; TRUNCATE markets, market_cities, venue_catalog, discovered_events; CREATE UNIQUE INDEX event_hash_fixture ON discovered_events(event_hash)');
  await actualDb.insert(markets).values({ market_slug: 'synthetic', market_name: 'Synthetic Metro', primary_city: 'Synthetic City',
    state: 'Synthetic State', state_abbr: 'XX', country_code: 'US', timezone: 'America/Chicago', is_active: true });
  await actualDb.insert(market_cities).values({ market_slug: 'synthetic', city: 'Synthetic City', state: 'Synthetic State', state_abbr: 'XX', country_code: 'US' });
  await actualDb.insert(venue_catalog).values(Object.values(venues));
  process.env.GEMINI_API_KEY = 'mock-only';
  callModel.mockResolvedValue({ ok: true, output: '[]' });
  // The name lookup filters on the ISO-2 country, so a legacy row is never a name hit.
  lookupVenue.mockResolvedValue(null);
  geocodeEventAddress.mockResolvedValue(null);
  const byName = name => Object.values(venues).find(venue => name.includes(venue.venue_name));
  searchPlaceWithTextSearch.mockImplementation(async (_lat, _lng, query) => {
    const venue = byName(query);
    return venue ? { placeId: venue.place_id, displayName: venue.venue_name, formattedAddress: venue.formatted_address,
      lat: venue.lat, lng: venue.lng, parsed: { city: venue.city, state: venue.state, country: 'US' } } : null;
  });
  // A place_id hit returns the catalog row exactly as it is stored.
  findOrCreateVenue.mockImplementation(async data => Object.values(venues).find(venue => venue.place_id === data.placeId) || null);
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'performance'] });
  jest.setSystemTime(now);
});

describe('defect 1: a legacy catalog row rejects its own candidate, not the section', () => {
  test('country "United States" with no timezone is rejected alone and the verified candidates are stored', async () => {
    discovered([alphaEvent, legacyEvent, deltaEvent]);
    const result = await run();

    expect(titles(await stored())).toEqual([alphaEvent.title, deltaEvent.title]);
    expect(titles(result.events.items)).toEqual([alphaEvent.title, deltaEvent.title]);
    expect(result.events._generationFailed).toBeUndefined();
    expect(saved.at(-1).events._generationFailed).toBeUndefined();

    const summary = result.events.candidates;
    expect(summary).toMatchObject({ discovered: 3, accepted: 2, rejected: 1, outside_window: 0, duplicates: 0 });
    expect(reasonCounts(summary)).toEqual({ venue_unverified: 1 });
    expect(summary.rejected_candidates).toEqual([expect.objectContaining({
      title: legacyEvent.title, venue: venues.legacy.venue_name, reason: 'venue_unverified', stage: 'venue_resolution' })]);
    expect(result.reason).toContain('1 of 3');
    expect(result.reason).toContain('venue_unverified');
  });

  test('the rejection is logged with its stage and the specific catalog fields that failed', async () => {
    discovered([legacyEvent]);
    await run();
    expect(logged(warn, 'venue_resolution', 'venue_unverified', venues.legacy.venue_name, 'United States', 'timezone')).toBe(true);
  });
});

describe('defect 2: a same-date overnight schedule rejects its own candidate', () => {
  test('21:00 to 01:00 with the start date repeated as the end date is rejected alone; nothing is repaired', async () => {
    discovered([alphaEvent, overnightEvent, deltaEvent]);
    const result = await run();

    expect(titles(await stored())).toEqual([alphaEvent.title, deltaEvent.title]);
    expect(titles(result.events.items)).toEqual([alphaEvent.title, deltaEvent.title]);
    expect(saved.at(-1).events._generationFailed).toBeUndefined();
    expect(result.events.candidates).toMatchObject({ discovered: 3, accepted: 2, rejected: 1 });
    expect(reasonCounts(result.events.candidates)).toEqual({ schedule_inconsistent: 1 });
    // No invented end date reached storage under any title.
    expect((await stored()).some(row => row.title === overnightEvent.title)).toBe(false);
    expect(logged(warn, 'schedule', 'schedule_inconsistent', overnightEvent.title, '01:00', '21:00')).toBe(true);
  });

  test('an inconsistent schedule is rejected before any paid venue lookup', async () => {
    discovered([overnightEvent]);
    await run();
    expect(searchPlaceWithTextSearch).not.toHaveBeenCalled();
    expect(findOrCreateVenue).not.toHaveBeenCalled();
  });

  test('the same event with the next calendar day as its end date is accepted', async () => {
    discovered([{ ...overnightEvent, event_end_date: '2026-09-30' }]);
    const result = await run();
    expect(result.events.candidates).toMatchObject({ discovered: 1, accepted: 1, rejected: 0 });
    expect((await stored())[0]).toMatchObject({ event_start_date: today, event_end_date: '2026-09-30', event_start_time: '21:00', event_end_time: '01:00' });
  });

  test('the discovery request states that an event ending after midnight carries the next calendar day', async () => {
    await run();
    for (const [, request] of callModel.mock.calls) {
      expect(request.user).toContain('ends after midnight');
      expect(request.user).toContain('next calendar day');
    }
    expect(callModel).toHaveBeenCalledTimes(2);
  });
});

describe('defect 3: the failure label and the logged cause are truthful', () => {
  test('identity and schedule rejections never blame the database', async () => {
    discovered([legacyEvent, overnightEvent]);
    const result = await run();
    expect(result.reason).not.toMatch(/database|persist/i);
    expect(JSON.stringify(saved.at(-1))).not.toMatch(/database|persist|could not be saved/i);
    expect(error).not.toHaveBeenCalled();
  });

  test('a real persistence failure fails the section, is labelled persistence, and logs stage and cause', async () => {
    // Without its unique index the upsert cannot run: a genuine storage failure.
    await pg.exec('DROP INDEX event_hash_fixture');
    discovered([alphaEvent]);
    await expect(run()).rejects.toThrow('Events database persistence failed');
    expect(saved.at(-1).events._generationFailed).toBe(true);
    expect(await stored()).toEqual([]);
    expect(logged(error, 'persistence', alphaEvent.title, 'ON CONFLICT')).toBe(true);
  });

  test('one provider error during a venue lookup rejects that candidate with its cause and keeps the batch', async () => {
    discovered([alphaEvent, deltaEvent]);
    searchPlaceWithTextSearch.mockImplementationOnce(async () => { throw new Error('synthetic provider HTTP 503'); });
    const result = await run();
    expect(titles(await stored())).toEqual([deltaEvent.title]);
    expect(reasonCounts(result.events.candidates)).toEqual({ venue_lookup_failed: 1 });
    expect(logged(warn, 'venue_resolution', 'venue_lookup_failed', alphaEvent.title, 'synthetic provider HTTP 503')).toBe(true);
    expect(saved.at(-1).events._generationFailed).toBeUndefined();
  });

  test('a venue the identity provider cannot place is venue_unverified, not a database failure', async () => {
    discovered([candidate('Epsilon Pop-up Show', { venue_name: 'Unplaceable Synthetic Lot', formatted_address: '9 Synthetic Way' })]);
    const result = await run();
    expect(reasonCounts(result.events.candidates)).toEqual({ venue_unverified: 1 });
    expect(await stored()).toEqual([]);
    expect(findOrCreateVenue).not.toHaveBeenCalled();
  });
});

describe('truthful section state for the Briefing row', () => {
  test('when every candidate is rejected the section is an explained empty result with counts', async () => {
    discovered([legacyEvent, overnightEvent]);
    const result = await run();
    const section = saved.at(-1).events;
    expect(result.events.items).toEqual([]);
    expect(section.items).toEqual([]);
    expect(section.reason).toContain('2 of 2');
    expect(section.reason).toContain('venue_unverified: 1');
    expect(section.reason).toContain('schedule_inconsistent: 1');
    expect(section.reason).not.toMatch(/^No events found/);
    expect(section.candidates).toMatchObject({ discovered: 2, accepted: 0, rejected: 2 });
    // The saved section satisfies the real readiness contract: it has a reason.
    expect(briefingSectionIssue('events', section)).toBeNull();
  });

  test('candidate counts always add up', async () => {
    discovered([alphaEvent, { ...alphaEvent }, legacyEvent, overnightEvent,
      { ...deltaEvent, event_start_date: '2026-09-27', event_end_date: '2026-09-27' }]);
    const { candidates } = (await run()).events;
    expect(candidates).toMatchObject({ discovered: 5, accepted: 1, rejected: 2, outside_window: 1, duplicates: 1 });
    expect(candidates.accepted + candidates.rejected + candidates.outside_window + candidates.duplicates).toBe(candidates.discovered);
  });

  test('a candidate whose source omits its end time is rejected alone and no time is invented', async () => {
    const { event_end_time: _omitted, ...withoutEnd } = deltaEvent;
    discovered([alphaEvent, withoutEnd]);
    const result = await run();
    expect(titles(await stored())).toEqual([alphaEvent.title]);
    expect(reasonCounts(result.events.candidates)).toEqual({ missing_required_fields: 1 });
    expect(logged(warn, 'discovery', 'missing_required_fields', deltaEvent.title, 'event_end_time')).toBe(true);
  });
});

describe('saved read path: exclude and count, do not fail the market', () => {
  const savedEvent = (n, venue, values = {}) => ({ id: uuid(100 + n), venue_id: venue.venue_id, title: `Saved Synthetic Show ${n}`,
    venue_name: venue.venue_name, address: venue.formatted_address, city: 'Synthetic City', state: 'XX', category: 'concert',
    event_start_date: today, event_end_date: today, event_start_time: '19:00', event_end_time: '22:00',
    event_hash: `synthetic-hash-${n}`, is_active: true, schema_version: 7, ...values });

  test('a saved event at a venue with no timezone is excluded and counted; the rest of the market is returned', async () => {
    await pg.exec(`UPDATE venue_catalog SET timezone = NULL WHERE venue_id = '${venues.gamma.venue_id}'`);
    await actualDb.insert(discovered_events).values([savedEvent(1, venues.alpha), savedEvent(2, venues.gamma)]);
    const result = await run();
    expect(titles(result.events.items)).toEqual(['Saved Synthetic Show 1']);
    expect(result.events.candidates).toMatchObject({ saved_excluded: 1 });
    expect(result.reason).toContain('1 saved event');
    expect(saved.at(-1).events._generationFailed).toBeUndefined();
    expect(logged(warn, 'saved_read', '1 saved event')).toBe(true);
  });

  test('a saved same-date overnight schedule is excluded and counted rather than failing the read', async () => {
    await actualDb.insert(discovered_events).values([savedEvent(1, venues.alpha),
      savedEvent(2, venues.delta, { event_start_time: '21:00', event_end_time: '01:00' })]);
    const result = await run();
    expect(titles(result.events.items)).toEqual(['Saved Synthetic Show 1']);
    expect(result.events.candidates).toMatchObject({ saved_excluded: 1 });
  });

  test('when only unresolved saved rows exist the empty result says so', async () => {
    await pg.exec(`UPDATE venue_catalog SET timezone = NULL WHERE venue_id = '${venues.gamma.venue_id}'`);
    await actualDb.insert(discovered_events).values(savedEvent(2, venues.gamma));
    const result = await run();
    const section = saved.at(-1).events;
    expect(section.items).toEqual([]);
    // Both halves are true: the searches returned nothing, and a saved row exists
    // that could not be shown. The second half is what keeps this from reading
    // as a verified absence of events.
    expect(section.reason).toBe('No events found across all categories. 1 saved event was excluded because its venue-local schedule could not be resolved.');
    expect(section.candidates).toMatchObject({ discovered: 0, accepted: 0, rejected: 0, saved_excluded: 1 });
    expect(briefingSectionIssue('events', section)).toBeNull();
    expect(result.events._generationFailed).toBeUndefined();
  });

  test('a real read failure still fails the section and logs its cause', async () => {
    await pg.exec('ALTER TABLE discovered_events RENAME TO discovered_events_offline');
    try {
      await expect(run()).rejects.toThrow('Events database read failed');
      expect(saved.at(-1).events._generationFailed).toBe(true);
      expect(logged(error, 'saved_read', 'discovered_events')).toBe(true);
    } finally {
      await pg.exec('ALTER TABLE discovered_events_offline RENAME TO discovered_events');
    }
  });
});

describe('caller cancellation is not a candidate rejection', () => {
  test('cancelling during a venue lookup aborts the run and stores nothing', async () => {
    const controller = new AbortController();
    discovered([alphaEvent, deltaEvent]);
    searchPlaceWithTextSearch.mockImplementationOnce(async () => {
      controller.abort(new Error('caller cancelled'));
      throw new Error('synthetic transport aborted');
    });
    await expect(run(controller.signal)).rejects.toThrow('caller cancelled');
    expect(await stored()).toEqual([]);
    expect(saved.at(-1).events._generationFailed).toBe(true);
    expect(searchPlaceWithTextSearch).toHaveBeenCalledTimes(1);
  });
});
