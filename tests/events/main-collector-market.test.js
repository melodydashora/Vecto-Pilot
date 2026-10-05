import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { markets, market_cities, venue_catalog, discovered_events, rankings, ranking_candidates } from '../../shared/schema.js';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actualDb;
const db = new Proxy({}, { get: (_target, name) => actualDb[name].bind(actualDb) });
const log = new Proxy({}, { get: () => jest.fn() });
const callModel = jest.fn(), lookupVenue = jest.fn(), searchPlaceWithTextSearch = jest.fn(), findOrCreateVenue = jest.fn();
const saved = [];
const planner = jest.fn();
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => ({
 MainRunAdmissionError: class extends Error {}, assertMainRunForSnapshot: async () => ({ status: 'running' }),
 withCurrentMainRun: async (_id, write) => db.transaction(tx => write(tx, { user_id: '00000000-0000-4000-8000-000000000002' })),
}));
jest.unstable_mockModule('../../server/lib/strategy/strategy-source-store.js', () => ({ assertCurrentStrategySource: async () => ({ strategy: { strategy_for_now: 'Fixture strategy' }, briefing: { generation_token: 'fixture' } }), mergeVenueCacheMetrics: value => value }));
jest.unstable_mockModule('../../server/lib/strategy/tactical-planner.js', () => ({ generateTacticalPlan: planner }));
jest.unstable_mockModule('../../server/lib/venue/venue-enrichment.js', () => ({ enrichVenues: async () => [{ name: venue.venue_name, placeId: venue.place_id, placeVerified: true, lat: venue.lat, lng: venue.lng, timezone: venue.timezone, address: venue.formatted_address, city: venue.city, state: venue.state, country: venue.country, distanceMiles: 0, driveTimeMinutes: 0 }] }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ venuesLog: log, createWorkflowLogger: () => log, briefingLog: log, matrixLog: log, eventsLog: log, locationLog: log, triadLog: log, OP: {}, tagLog: jest.fn() }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/briefing/shared/get-market-for-location.js', () => ({ getMarketForLocation: async () => 'Border Metro' }));
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({ CHANNELS: { EVENTS: 'events' }, errorMarker: error => ({ _generationFailed: true, error: error.message }), writeSectionAndNotify: async (_id, value) => saved.push(JSON.parse(JSON.stringify(value))) }));
jest.unstable_mockModule('../../server/lib/briefing/cleanup-events.js', () => ({ deactivatePastEvents: async () => 0, collapseDuplicateEventSpans: async () => 0, clearOrphanedEventVenueTags: async () => 0, mergeIntoOverlappingActiveSpan: async () => null, discoveryReactivationFields: () => ({}), resolveEventWriteHash: async (_tx, _event, hash) => hash, withEventVenueLock: async (_id, write) => write(db) }));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ lookupVenue, findOrCreateVenue, isPlannerGradeVenue: v => ({ ok: !!(v.place_id && v.formatted_address && v.timezone), missing: [] }), upsertVenue: async () => venue }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch }));
jest.unstable_mockModule('../../server/lib/events/pipeline/geocodeEvent.js', () => ({ geocodeEventAddress: async () => null }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-validator.js', () => ({ validateVenueAddress: () => ({ valid: true }) }));
const { discoverEvents } = await import('../../server/lib/briefing/pipelines/events.js');
const strategyUtils = await import('../../server/lib/strategy/strategy-utils.js');
const { filterFreshEvents } = strategyUtils;
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({ ...strategyUtils, updatePhase: jest.fn() }));
const { generateEnhancedSmartBlocks } = await import('../../server/lib/venue/enhanced-smart-blocks.js');
const { formatBriefingForPrompt } = await import('../../server/lib/briefing/filter-for-planner.js');
const snapshot = { city: 'Border City', state: 'AA', country: 'US', timezone: 'America/Chicago', lat: 0, lng: 0 };
const now = new Date('2026-09-30T04:30:00Z'); // Sep29 Chicago; Sep30 New York
const venueId = '00000000-0000-4000-8000-000000000001';
const venue = { venue_id: venueId, place_id: 'verified-provider-id', venue_name: 'River Hall', city: 'Across River', state: 'BB', country: 'US', formatted_address: '1 River Street', lat: 0, lng: 0, timezone: 'America/New_York' };
const event = { title: 'Concert at the river', venue_name: 'River Hall', address: '1 River Street', city: 'Across River', state: 'BB', event_start_date: '2026-09-30', event_end_date: '2026-09-30', event_start_time: '00:15', event_end_time: '01:30', category: 'concert', expected_attendance: 'high', is_active: true };
beforeAll(async () => {
 pg = new PGlite(); actualDb = drizzle(pg);
 for (const table of [markets, market_cities, venue_catalog, discovered_events, rankings, ranking_candidates]) {
  const config = getTableConfig(table);
  await pg.exec('CREATE TABLE ' + config.name + ' (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType()).join(', ') + ')');
 }
 await pg.exec('CREATE UNIQUE INDEX event_hash_fixture ON discovered_events(event_hash); ALTER TABLE discovered_events ALTER COLUMN is_active SET DEFAULT true');
}, 30000);
afterAll(async () => { jest.useRealTimers(); await pg?.close(); });
beforeEach(async () => {
 jest.useRealTimers(); jest.clearAllMocks(); saved.length = 0;
 await pg.exec('TRUNCATE markets, market_cities, venue_catalog, discovered_events, rankings, ranking_candidates');
 await actualDb.insert(markets).values({ market_slug: 'border', market_name: 'Border Metro', primary_city: 'Border City', state: 'Alpha', state_abbr: 'AA', country_code: 'US', timezone: 'America/Chicago', is_active: true });
 await actualDb.insert(market_cities).values([{ market_slug: 'border', city: 'Border City', state: 'Alpha', state_abbr: 'AA', country_code: 'US' }, { market_slug: 'border', city: 'Across River', state: 'Beta', state_abbr: 'BB', country_code: 'US' }]);
 await actualDb.insert(venue_catalog).values(venue);
 planner.mockResolvedValue({ recommended_venues: [{ name: venue.venue_name }] });
 process.env.GEMINI_API_KEY = 'mock-only';
 callModel.mockResolvedValue({ ok: true, output: '[]' }); lookupVenue.mockResolvedValue(null);
 searchPlaceWithTextSearch.mockResolvedValue({ placeId: venue.place_id, displayName: venue.venue_name, formattedAddress: venue.formatted_address, lat: 0, lng: 0, parsed: { city: venue.city, state: venue.state, country: 'US' } });
 findOrCreateVenue.mockResolvedValue(venue);
 jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'performance'] }); jest.setSystemTime(now);
});
async function run() { return discoverEvents({ snapshot, snapshotId: 'fixture' }); }
test('MAIN excludes unrelated state matches before limiting and persists cross-state metro venue instants for Strategist', async () => {
 const unrelatedVenueId = '00000000-0000-4000-8000-000000000055';
 await actualDb.insert(venue_catalog).values({ ...venue, venue_id: unrelatedVenueId, place_id: 'another-place', city: 'Unrelated City', state: 'AA' });
 await actualDb.insert(discovered_events).values(Array.from({ length: 55 }, (_, i) => ({ ...event, title: 'Unrelated ' + i, city: 'Unrelated City', state: 'AA', venue_id: unrelatedVenueId, event_start_date: '2026-09-29', event_end_date: '2026-09-29' })));
 await actualDb.insert(discovered_events).values({ ...event, venue_id: venueId });
 const result = await run(); expect(result.events.items).toHaveLength(1);
 const persisted = saved.at(-1).events;
 expect(persisted[0]).toMatchObject({ title: event.title, impact: 'high', latitude: 0, longitude: 0, timezone: 'America/New_York', start_time_iso: '2026-09-30T04:15:00.000Z', end_time_iso: '2026-09-30T05:30:00.000Z' });
 expect(filterFreshEvents(persisted, now, snapshot.timezone)).toEqual(persisted);
});
test('discovery waits for venue-local timezone before excluding a next-calendar-day current event', async () => {
 callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...event, venue: event.venue_name, place_id: 'misleading-model-hint' }]) });
 const result = await run(); expect(result.events.items).toHaveLength(1);
 expect(lookupVenue).toHaveBeenCalledWith(expect.objectContaining({ venueName: 'River Hall', country: 'US' }));
 expect(lookupVenue.mock.calls[0][0].placeId).toBeUndefined();
 expect(findOrCreateVenue).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'verified-provider-id', country: 'US', city: 'Across River', latitude: 0 }), 'briefing_discovery');
 const stored = await actualDb.select().from(discovered_events);
 expect(stored[0]).toMatchObject({ city: 'Across River', state: 'BB', venue_id: venueId, expected_attendance: 'high' });
 expect(filterFreshEvents(saved.at(-1).events, now, snapshot.timezone)).toHaveLength(1);
});
test('unknown provider country rejects the candidate without inventing the snapshot country or writing verified events', async () => {
 callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...event, event_start_date: '2026-09-29', event_end_date: '2026-09-29', venue: event.venue_name }]) });
 searchPlaceWithTextSearch.mockResolvedValueOnce({ placeId: venue.place_id, formattedAddress: venue.formatted_address, lat: 0, lng: 0, parsed: { city: venue.city, state: venue.state } });
 const result = await run();
 expect(result.events.items).toEqual([]);
 expect(result.events.candidates).toMatchObject({ discovered: 1, accepted: 0, rejected: 1,
  rejected_candidates: [expect.objectContaining({ stage: 'venue_resolution', reason: 'venue_unverified', detail: expect.stringMatching(/country null.*ISO-2 code US/) })] });
 expect(findOrCreateVenue).not.toHaveBeenCalled();
 expect(await actualDb.select().from(discovered_events)).toEqual([]);
 expect(saved.at(-1).events._generationFailed).toBeUndefined();
 expect(saved.at(-1).events.reason).toContain('1 of 1 discovered event candidates was rejected');
});
test('a mismatched catalog place ID cannot certify or store model event evidence', async () => {
 callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...event, venue: event.venue_name, place_id: 'misleading-model-hint' }]) });
 findOrCreateVenue.mockResolvedValueOnce({ ...venue, place_id: 'another-establishment' });
 const result = await run();
 expect(result.events.items).toEqual([]);
 expect(result.events.candidates).toMatchObject({ discovered: 1, accepted: 0, rejected: 1,
  rejected_candidates: [expect.objectContaining({ stage: 'venue_resolution', reason: 'venue_unverified', detail: expect.stringMatching(/catalog place_id differs/) })] });
 expect(await actualDb.select().from(discovered_events)).toEqual([]);
 expect(saved.at(-1).events._generationFailed).toBeUndefined();
});
test('saved venue timezone uncertainty stays explicit rather than verified empty', async () => {
 await actualDb.insert(discovered_events).values({ ...event, venue_id: venueId });
 await pg.exec('UPDATE venue_catalog SET timezone = NULL');
 const result = await run();
 expect(result.events.items).toEqual([]);
 expect(result.events.candidates).toMatchObject({ saved_excluded: 1, accepted: 0, rejected: 0 });
 expect(saved.at(-1).events._generationFailed).toBeUndefined();
 expect(saved.at(-1).events.reason).toContain('1 saved event was excluded because its venue-local schedule could not be resolved');
 expect(await actualDb.select().from(discovered_events)).toEqual([expect.objectContaining({ venue_id: venueId, title: event.title })]);
});

test('actual planner persists cross-state next-calendar-day event evidence and includes its zone in the prompt', async () => {
 await actualDb.insert(discovered_events).values({ ...event, venue_id: venueId, id: '00000000-0000-4000-8000-000000000003', schema_version: 0 });
 await generateEnhancedSmartBlocks({ snapshotId: '00000000-0000-4000-8000-000000000004', snapshot, immediateStrategy: 'Fixture strategy', briefing: { generation_token: 'fixture' } });
 const context = planner.mock.calls[0][0].briefingContext;
 expect(context.events).toHaveLength(1);
 expect(context.events[0]).toMatchObject({ _distanceMiles: 0, start_time_iso: '2026-09-30T04:15:00.000Z', timezone: 'America/New_York' });
 expect(formatBriefingForPrompt(context)).toContain('2026-09-30');
 expect(formatBriefingForPrompt(context)).toContain('America/New_York');
 const [candidate] = await actualDb.select().from(ranking_candidates);
 expect(candidate.venue_events[0]).toMatchObject({ id: '00000000-0000-4000-8000-000000000003', timezone: 'America/New_York', end_time_iso: '2026-09-30T05:30:00.000Z' });
 const [ranking] = await actualDb.select().from(rankings);
 expect(ranking.path_taken).toBe('enhanced-smart-blocks');
 expect(candidate.venue_events[0].start_time_iso).toBe('2026-09-30T04:15:00.000Z');
});
