import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

// Exercise the real discovery/orchestration boundary with no providers or DB.
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, matrixLog: log, eventsLog: log, OP: {} }));
const callModel = jest.fn();
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/briefing/shared/get-market-for-location.js', () => ({ getMarketForLocation: async () => 'Test Market' }));
const writes = [];
const errorMarker = error => ({ _generationFailed: true, error: error.message });
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  CHANNELS: {}, errorMarker, writeSectionAndNotify: async (_id, value) => writes.push(value),
}));
const readEvents = jest.fn();
const insertEvent = jest.fn();
const chain = { from: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain, limit: readEvents };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {
  select: () => chain,
  insert: () => ({ values: () => ({ onConflictDoUpdate: insertEvent }) }),
} }));
jest.unstable_mockModule('../../server/lib/briefing/cleanup-events.js', () => ({
  deactivatePastEvents: async () => 0, collapseDuplicateEventSpans: async () => 0,
  clearOrphanedEventVenueTags: async () => 0, mergeIntoOverlappingActiveSpan: async () => null,
}));
const actualNormalization = await import('../../server/lib/events/pipeline/normalizeEvent.js');
const actualValidation = await import('../../server/lib/events/pipeline/validateEvent.js');
const validateEventsHard = jest.fn();
const normalizeEvent = jest.fn();
jest.unstable_mockModule('../../server/lib/events/pipeline/validateEvent.js', () => ({ validateEventsHard, VALIDATION_SCHEMA_VERSION: 1 }));
jest.unstable_mockModule('../../server/lib/events/pipeline/normalizeEvent.js', () => ({ ...actualNormalization, normalizeEvent }));
jest.unstable_mockModule('../../server/lib/events/pipeline/hashEvent.js', () => ({ generateEventHash: () => 'test-hash' }));
jest.unstable_mockModule('../../server/lib/events/pipeline/deduplicateEventsSemantic.js', () => ({ deduplicateEventsSemantic: events => ({ deduplicated: events, removed: [], mergeLog: [] }) }));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ findOrCreateVenue: async () => null, lookupVenue: async () => null }));
jest.unstable_mockModule('../../server/lib/events/pipeline/geocodeEvent.js', () => ({ geocodeEventAddress: async () => null }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch: async () => null }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-validator.js', () => ({ validateVenueAddress: () => ({ valid: true }) }));
const { discoverEvents } = await import('../../server/lib/briefing/pipelines/events.js');
const args = { snapshotId: 'test-snapshot', snapshot: { city: 'Test City', state: 'Test State', timezone: 'Etc/UTC', market: 'Test Market', lat: 1, lng: 1 } };
const cachedEvent = { title: 'Previously found concert', venue_name: 'Test venue', event_start_date: '2026-09-10', event_end_date: '2026-09-10', event_start_time: '7:00 PM', event_end_time: '10:00 PM', category: 'concert' };
const realTimers = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };

beforeEach(() => {
  jest.clearAllMocks(); writes.length = 0;
  process.env.GEMINI_API_KEY = 'test-key';
  callModel.mockResolvedValue({ ok: true, output: '[]' });
  readEvents.mockResolvedValue([cachedEvent]);
  insertEvent.mockResolvedValue(undefined);
  validateEventsHard.mockImplementation(events => ({ valid: events, invalid: [], stats: {} }));
  normalizeEvent.mockImplementation(event => ({ ...event, venue_name: event.venue }));
});
afterEach(() => {
  jest.useRealTimers();
  // Node 26's VM globals need their original descriptors restored after fake timers.
  Object.assign(global, realTimers);
});

test('one failed category blocks cached events and writes a failure marker', async () => {
  callModel.mockResolvedValueOnce({ ok: false, error: 'provider HTTP 503' });
  await expect(discoverEvents(args)).rejects.toThrow('Event discovery incomplete');
  expect(readEvents).not.toHaveBeenCalled(); expect(writes.at(-1).events._generationFailed).toBe(true);
});
test('one timed out category blocks cached events even when the other succeeds', async () => {
  jest.useFakeTimers();
  callModel.mockImplementationOnce(() => new Promise(() => {}));
  const rejected = expect(discoverEvents(args)).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(90000);
  await rejected;
  expect(readEvents).not.toHaveBeenCalled(); expect(writes.at(-1).events._generationFailed).toBe(true);
});
test.each([
  { ok: false }, { ok: true, output: '{}' }, { ok: true, output: '[null]' },
])('failed or malformed category response cannot become a verified empty result: %j', async response => {
  callModel.mockResolvedValueOnce(response);
  await expect(discoverEvents(args)).rejects.toThrow('Event discovery incomplete');
  expect(readEvents).not.toHaveBeenCalled();
});
test('missing provider configuration cannot return cached success', async () => {
  delete process.env.GEMINI_API_KEY;
  await expect(discoverEvents(args)).rejects.toThrow('GEMINI_API_KEY');
  expect(callModel).not.toHaveBeenCalled(); expect(readEvents).not.toHaveBeenCalled();
});
test('missing coordinates cannot turn null into zero and search another location', async () => {
  await expect(discoverEvents({ ...args, snapshot: { ...args.snapshot, lat: null } })).rejects.toThrow('coordinates');
  expect(callModel).not.toHaveBeenCalled();
});
test('events database read failure propagates to a failed section', async () => {
  readEvents.mockRejectedValueOnce(new Error('connection lost'));
  await expect(discoverEvents(args)).rejects.toThrow('database read failed');
  expect(writes.at(-1).events._generationFailed).toBe(true);
});
test('events database persistence failure cannot be hidden by cached rows', async () => {
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: cachedEvent.venue_name, address: '123 Test Road' }]) });
  insertEvent.mockRejectedValueOnce(new Error('connection lost'));
  await expect(discoverEvents(args)).rejects.toThrow('database persistence failed');
  expect(readEvents).not.toHaveBeenCalled();
});
test('successful searches with no results retain an explained empty result', async () => {
  readEvents.mockResolvedValueOnce([]);
  const result = await discoverEvents(args);
  expect(result.events.items).toEqual([]); expect(result.reason).toContain('No events found');
  expect(writes.at(-1).events._generationFailed).toBeUndefined();
});
test('successful searches may return existing validated events', async () => {
  const result = await discoverEvents(args);
  expect(result.events.items).toHaveLength(1); expect(result.events.items[0].title).toBe(cachedEvent.title);
});
test('successful empty event searches preserve the model explanation', async () => {
  callModel.mockResolvedValue({ ok: true, output: '{"items":[],"reason":"No matching events are scheduled today"}' });
  readEvents.mockResolvedValueOnce([]);
  expect((await discoverEvents(args)).reason).toContain('No matching events are scheduled today');
});
test('missing source dates or times fail before normalization can invent defaults', async () => {
  callModel.mockResolvedValueOnce({ ok: true, output: '[{"title":"Synthetic concert","venue":"Synthetic hall"}]' });
  await expect(discoverEvents(args)).rejects.toThrow('missing title, venue, date or time');
  expect(normalizeEvent).not.toHaveBeenCalled(); expect(readEvents).not.toHaveBeenCalled();
});
test('real validation rejection of malformed source dates remains a failure despite cached rows', async () => {
  normalizeEvent.mockImplementationOnce(actualNormalization.normalizeEvent);
  validateEventsHard.mockImplementationOnce(actualValidation.validateEventsHard);
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: 'Test venue', event_start_date: 'invalid', event_end_date: 'invalid' }]) });
  await expect(discoverEvents(args)).rejects.toThrow('invalid required event fields');
  expect(readEvents).not.toHaveBeenCalled(); expect(writes.at(-1).events._generationFailed).toBe(true);
});
test('real date-window exclusion remains a successful explained empty result', async () => {
  normalizeEvent.mockImplementationOnce(actualNormalization.normalizeEvent);
  validateEventsHard.mockImplementationOnce(actualValidation.validateEventsHard);
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Etc/UTC' });
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: 'Test venue', event_start_date: tomorrow, event_end_date: tomorrow }]) });
  readEvents.mockResolvedValueOnce([]);
  const result = await discoverEvents(args);
  expect(result.events.items).toEqual([]); expect(result.reason).toContain('date window');
  expect(writes.at(-1).events._generationFailed).toBeUndefined();
});
test('when validation filters every cached event the empty result explains that exclusion', async () => {
  validateEventsHard.mockReturnValueOnce({ valid: [], invalid: [cachedEvent] });
  const result = await discoverEvents(args);
  expect(result.events.items).toEqual([]); expect(result.reason).toContain('validation');
});
