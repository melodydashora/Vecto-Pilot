import { jest, beforeEach, test, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';
import { mainRunBoundary } from '../fixtures/main-run-boundary.js';
const snapshot = completeSnapshot();
const briefing = completeBriefing(snapshot.snapshot_id, { generation_token: 'generation-one' });
const strategy = 'Use verified local demand';
const rows = [], writes = [], promotions = [];
const log = new Proxy({}, { get: () => jest.fn() });
const db = {
 select: () => { let joined = false; const query = { from: () => query, leftJoin: () => { joined = true; return query; }, where: () => joined ? Promise.resolve(rows) : query, limit: async () => [] }; return query; },
 insert: table => ({ values: value => { writes.push({ table: getTableName(table), value }); return Promise.resolve(); } }),
 transaction: async fn => fn(db),
};
const admission = mainRunBoundary(db);
const model = jest.fn(() => { throw new Error('No extra verifier model call is authorized by saved evidence'); });
const enrichment = jest.fn();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/events/market-event-reader.js', () => ({
 readMarketEvents: async () => ({ rows: rows.map(event => ({ event, venue: {
  venue_name: event.vc_venue_name, place_id: event.vc_place_id, lat: event.vc_lat, lng: event.vc_lng,
  timezone: event.vc_timezone, city: event.city, state: event.state,
 } })), unresolvedCount: 0 }),
 toBriefingEvent: ({ event, venue }) => ({ ...event, timezone: venue.timezone }),
}));
jest.unstable_mockModule('../../server/lib/main-run-admission.js', () => admission.exports);
jest.unstable_mockModule('../../server/lib/strategy/strategy-source-store.js', () => ({ assertCurrentStrategySource: async () => ({ strategy: { strategy_for_now: strategy }, briefing }), mergeVenueCacheMetrics: value => value }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ venuesLog: log, triadLog: log, eventsLog: log, briefingLog: log, OP: {}, tagLog: jest.fn(), createWorkflowLogger: () => log }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/lib/strategy/tactical-planner.js', () => ({ generateTacticalPlan: async () => ({ recommended_venues: [{ name: 'Hall' }] }) }));
jest.unstable_mockModule('../../server/lib/venue/venue-enrichment.js', () => ({ enrichVenues: enrichment }));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ isPlannerGradeVenue: () => ({ ok: true }), upsertVenue: async value => { promotions.push(value); return { venue_id: 'catalog-one' }; } }));
const realUtils = await import('../../server/lib/strategy/strategy-utils.js');
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({ ...realUtils, updatePhase: jest.fn() }));
const { generateEnhancedSmartBlocks, isEventTimeRelevant } = await import('../../server/lib/venue/enhanced-smart-blocks.js');
const venue = { name: 'Hall', lat: snapshot.lat, lng: snapshot.lng, placeId: 'place-one', placeVerified: true,
  address: '1 Hall Street', city: 'Provider City', state: 'AB', country: 'CA', hoursFullWeek: { weekdayDescriptions: ['Monday: Open 24 hours'] },
  distanceMiles: '0.0', driveTimeMinutes: 0, rank: 1, distanceSource: 'google_route_matrix' };
const localDate = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: snapshot.timezone });
const event = overrides => ({ id: 'event-one', title: 'Verified ongoing multi-day show', vc_place_id: 'place-one', vc_venue_name: 'Hall', venue_name: 'Hall', venue_id: 'catalog-one',
  event_start_date: localDate(-1), event_end_date: localDate(1), event_start_time: '10:00', event_end_time: '23:00',
  vc_lat: snapshot.lat, vc_lng: snapshot.lng, state: snapshot.state, city: snapshot.city, vc_timezone: snapshot.timezone,
  category: 'concert', expected_attendance: 'high', ...overrides });
beforeEach(() => { jest.clearAllMocks(); rows.length = writes.length = promotions.length = 0; enrichment.mockResolvedValue([venue]); rows.push(event()); });
const run = () => generateEnhancedSmartBlocks({ snapshotId: snapshot.snapshot_id, immediateStrategy: strategy, briefing, snapshot, user_id: snapshot.user_id });
test('saved event identity and full calendar span reach candidate evidence without another model call', async () => {
  await run();
  const candidates = writes.find(write => write.table === 'ranking_candidates').value;
  expect(candidates[0].venue_events[0]).toMatchObject({ id: 'event-one', event_start_date: localDate(-1), event_end_date: localDate(1) });
  expect(candidates[0]).toMatchObject({ place_id: 'place-one' });
  expect(writes.find(write => write.table === 'rankings').value).not.toHaveProperty('extras');
  expect(model).not.toHaveBeenCalled();
  expect(candidates[0]).toMatchObject({ distance_miles: 0, drive_minutes: 0 });
  expect(promotions[0]).toMatchObject({ city: 'Provider City', state: 'AB', country: 'CA', hours: venue.hoursFullWeek });
});
test('no routable venues cannot publish an empty success ranking', async () => {
  enrichment.mockResolvedValue([]); await expect(run()).rejects.toThrow(/usable routes/); expect(writes).toHaveLength(0);
});
test('unknown timing or a different provider identity cannot become event evidence', async () => {
  rows.length = 0; rows.push(event({ event_start_time: 'TBD' }), event({ id: 'foreign-event', vc_place_id: 'place-other' }));
  await run();
  const candidates = writes.find(write => write.table === 'ranking_candidates').value;
  expect(candidates[0].venue_events).toEqual([]);
  expect(writes.find(write => write.table === 'rankings').value).not.toHaveProperty('extras');
});

test.each([
  [{ event_start_date: '2026-09-28', event_end_date: '2026-09-29', event_start_time: '23:00', event_end_time: '02:00' }, '2026-09-29T01:00:00Z', true],
  [{ event_start_date: '2026-09-30', event_end_date: '2026-09-30', event_start_time: '00:30', event_end_time: '02:00' }, '2026-09-29T23:30:00Z', true],
  [{ event_start_date: '2026-09-29', event_end_date: '2026-09-29', all_day: true }, '2026-09-29T20:00:00Z', true],
  [{ event_start_date: '2026-09-28', event_end_date: '2026-09-28', event_start_time: '12:00', event_end_time: '16:00' }, '2026-09-29T12:00:00Z', false],
  [{ event_start_date: '2026-09-29', event_end_date: '2026-09-29', event_start_time: '25:00', event_end_time: '26:00' }, '2026-09-29T12:00:00Z', false],
])('event badges use real local calendar spans: %j', (eventData, now, expected) => {
  expect(isEventTimeRelevant(eventData, 'Etc/UTC', new Date(now))).toBe(expected);
});
