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
const eventOverlapsDisplayDays = jest.fn();
jest.unstable_mockModule('../../server/lib/events/market-event-reader.js', () => ({
 readMarketEvents: async () => ({ rows: await readEvents(), unresolvedCount: 0 }),
 toBriefingEvent: row => row.event ? { ...row.event, timezone: row.venue.timezone } : { ...row, timezone: 'Etc/UTC' },
 eventOverlapsDisplayDays,
}));
const insertEvent = jest.fn();
const chain = { from: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain, limit: readEvents };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {
  select: () => chain,
  insert: () => ({ values: () => ({ onConflictDoUpdate: insertEvent }) }),
} }));
jest.unstable_mockModule('../../server/lib/briefing/cleanup-events.js', () => ({
  deactivatePastEvents: async () => 0, collapseDuplicateEventSpans: async () => 0,
  clearOrphanedEventVenueTags: async () => 0, mergeIntoOverlappingActiveSpan: async () => null, discoveryReactivationFields: () => ({}), resolveEventWriteHash: async (_tx, _event, hash) => hash, withEventVenueLock: async (_id, write) => write((await import('../../server/db/drizzle.js')).db),
}));
const actualNormalization = await import('../../server/lib/events/pipeline/normalizeEvent.js');
const actualValidation = await import('../../server/lib/events/pipeline/validateEvent.js');
const validateEventsHard = jest.fn();
const normalizeEvent = jest.fn();
jest.unstable_mockModule('../../server/lib/events/pipeline/validateEvent.js', () => ({ validateEventsHard, VALIDATION_SCHEMA_VERSION: 1 }));
jest.unstable_mockModule('../../server/lib/events/pipeline/normalizeEvent.js', () => ({ ...actualNormalization, normalizeEvent }));
jest.unstable_mockModule('../../server/lib/events/pipeline/hashEvent.js', () => ({ generateEventHash: () => 'test-hash' }));
jest.unstable_mockModule('../../server/lib/events/pipeline/deduplicateEventsSemantic.js', () => ({ deduplicateEventsSemantic: events => ({ deduplicated: events, removed: [], mergeLog: [] }) }));
const lookupVenue = jest.fn(), findOrCreateVenue = jest.fn(), geocodeEventAddress = jest.fn(), searchPlaceWithTextSearch = jest.fn();
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ findOrCreateVenue, lookupVenue }));
jest.unstable_mockModule('../../server/lib/events/pipeline/geocodeEvent.js', () => ({ geocodeEventAddress }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-validator.js', () => ({ validateVenueAddress: () => ({ valid: true }) }));
const { discoverEvents } = await import('../../server/lib/briefing/pipelines/events.js');
const args = { snapshotId: 'test-snapshot', snapshot: { country: 'US', city: 'Test City', state: 'Test State', timezone: 'Etc/UTC', market: 'Test Market', lat: 1, lng: 1 } };
const cachedEvent = { title: 'Previously found concert', venue_name: 'Test venue', event_start_date: '2026-09-10', event_end_date: '2026-09-10', event_start_time: '7:00 PM', event_end_time: '10:00 PM', category: 'concert' };
const realTimers = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };

beforeEach(() => {
  jest.clearAllMocks(); writes.length = 0;
  process.env.GEMINI_API_KEY = 'test-key';
  callModel.mockResolvedValue({ ok: true, output: '[]' });
  readEvents.mockResolvedValue([cachedEvent]);
  insertEvent.mockResolvedValue(undefined);
  eventOverlapsDisplayDays.mockReturnValue(true);
  lookupVenue.mockResolvedValue({ venue_id: 'fixture-id', place_id: 'fixture-provider-id', venue_name: 'Test venue', formatted_address: '123 Test Road', city: 'Test City', state: 'Test State', country: 'US', lat: 0, lng: 0, timezone: 'Etc/UTC' });
  findOrCreateVenue.mockResolvedValue(null); geocodeEventAddress.mockResolvedValue(null); searchPlaceWithTextSearch.mockResolvedValue(null);
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
// 2026-09-29 contract change: a candidate that cannot be verified is rejected
// alone and counted. It no longer fails the section, the Briefing and Strategy.
// What these two tests protected is kept: nothing is inferred and nothing is stored.
test('a candidate missing source dates or times is rejected alone before normalization can invent defaults', async () => {
  callModel.mockResolvedValueOnce({ ok: true, output: '[{"title":"Synthetic concert","venue":"Synthetic hall"}]' });
  const result = await discoverEvents(args);
  expect(normalizeEvent).not.toHaveBeenCalled(); expect(lookupVenue).not.toHaveBeenCalled(); expect(insertEvent).not.toHaveBeenCalled();
  expect(result.events.candidates).toMatchObject({ discovered: 1, accepted: 0, rejected: 1 });
  expect(result.events.candidates.rejected_candidates).toEqual([{ title: 'Synthetic concert', venue: 'Synthetic hall', stage: 'discovery',
    reason: 'missing_required_fields', detail: 'source omitted event_start_date, event_end_date, event_start_time, event_end_time' }]);
  expect(result.reason).toContain('missing_required_fields: 1');
  expect(writes.at(-1).events._generationFailed).toBeUndefined();
});
test('real validation rejection of malformed source dates rejects that candidate alone and stores nothing', async () => {
  normalizeEvent.mockImplementationOnce(actualNormalization.normalizeEvent);
  validateEventsHard.mockImplementationOnce(actualValidation.validateEventsHard);
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: 'Test venue', event_start_date: 'invalid', event_end_date: 'invalid' }]) });
  const result = await discoverEvents(args);
  expect(lookupVenue).not.toHaveBeenCalled(); expect(insertEvent).not.toHaveBeenCalled();
  expect(result.events.candidates.rejections).toEqual([{ reason: 'missing_start_date', count: 1 }]);
  expect(result.events.candidates.rejected_candidates[0]).toMatchObject({ stage: 'validation', title: cachedEvent.title });
  expect(writes.at(-1).events._generationFailed).toBeUndefined();
});
test('one malformed candidate does not stop a valid candidate in the same response from being stored', async () => {
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([
    { title: 'Synthetic concert', venue: 'Synthetic hall' },
    { ...cachedEvent, venue: cachedEvent.venue_name, address: '123 Test Road' },
  ]) });
  const result = await discoverEvents(args);
  expect(insertEvent).toHaveBeenCalledTimes(1);
  expect(result.events.candidates).toMatchObject({ discovered: 2, accepted: 1, rejected: 1 });
});
test('real date-window exclusion remains a successful explained empty result', async () => {
  eventOverlapsDisplayDays.mockReturnValueOnce(false);
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


test('raw category merge preserves same-title matinee and evening before canonical storage', async () => {
 callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([
  { ...cachedEvent, venue: cachedEvent.venue_name, address: '1 Fixture St', event_start_time: '14:00', event_end_time: '17:00' },
  { ...cachedEvent, venue: cachedEvent.venue_name, address: '1 Fixture St', event_start_time: '19:00', event_end_time: '22:00' },
 ]) });
 await discoverEvents(args); expect(insertEvent).toHaveBeenCalledTimes(2);
});


test('category deadline aborts the actual provider signal and discards late successful output', async () => {
  jest.useFakeTimers();
  let finish, providerSignal;
  callModel.mockImplementationOnce((_role, options) => {
    providerSignal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const rejected = expect(discoverEvents(args)).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(90000); await rejected;
  expect(providerSignal?.aborted).toBe(true);
  finish({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: cachedEvent.venue_name }]) });
  await jest.advanceTimersByTimeAsync(0);
  expect(normalizeEvent).not.toHaveBeenCalled(); expect(insertEvent).not.toHaveBeenCalled();
  expect(readEvents).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('caller cancellation aborts both running category requests and never publishes late results', async () => {
  jest.useFakeTimers(); const controller = new AbortController();
  const signals = [], completions = [];
  callModel.mockImplementation((_role, options) => { signals.push(options.signal); return new Promise(resolve => completions.push(resolve)); });
  const rejected = expect(discoverEvents({ ...args, signal: controller.signal })).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(0); controller.abort(new Error('caller cancelled'));
  await jest.advanceTimersByTimeAsync(90000); await rejected;
  expect(signals).toHaveLength(2); expect(signals.every(signal => signal?.aborted)).toBe(true);
  completions.forEach(resolve => resolve({ ok: true, output: '[]' })); await jest.advanceTimersByTimeAsync(0);
  expect(readEvents).not.toHaveBeenCalled(); expect(writes).toHaveLength(1); expect(writes[0].events._generationFailed).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
// 2026-09-29 contract change: a venue lookup that exceeds its deadline rejects
// that candidate (venue_lookup_timeout). The run no longer fails. The protections
// these two tests pinned are unchanged: the provider signal is aborted, no
// fallback or write starts from a late result, and no timer is left behind.
test('venue deadline cancels Places, rejects that candidate, and cannot start fallback or persistence from late results', async () => {
  jest.useFakeTimers(); lookupVenue.mockResolvedValueOnce(null);
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: cachedEvent.venue_name }]) });
  let finish, providerSignal;
  searchPlaceWithTextSearch.mockImplementationOnce((_lat, _lng, _query, options) => { providerSignal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  const settled = discoverEvents(args);
  await jest.advanceTimersByTimeAsync(15000); const result = await settled;
  expect(result.events.candidates.rejections).toEqual([{ reason: 'venue_lookup_timeout', count: 1 }]);
  expect(writes.at(-1).events._generationFailed).toBeUndefined();
  expect(providerSignal?.aborted).toBe(true);
  finish(null); await jest.advanceTimersByTimeAsync(0);
  expect(geocodeEventAddress).not.toHaveBeenCalled(); expect(findOrCreateVenue).not.toHaveBeenCalled();
  expect(insertEvent).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('venue fallback receives the same cancellation signal and ignores a late geocode response', async () => {
  jest.useFakeTimers(); lookupVenue.mockResolvedValueOnce(null);
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: cachedEvent.venue_name }]) });
  let finish, providerSignal;
  geocodeEventAddress.mockImplementationOnce((_address, _city, _state, options) => { providerSignal = options?.signal; return new Promise(resolve => { finish = resolve; }); });
  const settled = discoverEvents(args);
  await jest.advanceTimersByTimeAsync(15000); const result = await settled;
  expect(result.events.candidates.rejections).toEqual([{ reason: 'venue_lookup_timeout', count: 1 }]);
  expect(providerSignal).toBe(searchPlaceWithTextSearch.mock.calls[0][3].signal); expect(providerSignal?.aborted).toBe(true);
  finish({ place_id: 'fixture-id', lat: 0, lng: 0 }); await jest.advanceTimersByTimeAsync(0);
  expect(findOrCreateVenue).not.toHaveBeenCalled(); expect(insertEvent).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test('a timed out venue lookup does not abort the batch: the next candidate is still stored', async () => {
  jest.useFakeTimers(); lookupVenue.mockResolvedValueOnce(null);
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([
    { ...cachedEvent, title: 'Synthetic early show', venue: 'Synthetic slow venue', event_start_time: '2:00 PM', event_end_time: '4:00 PM' },
    { ...cachedEvent, title: 'Synthetic late show', venue: cachedEvent.venue_name, address: '123 Test Road' },
  ]) });
  searchPlaceWithTextSearch.mockImplementationOnce(() => new Promise(() => {}));
  const settled = discoverEvents(args);
  await jest.advanceTimersByTimeAsync(15000); const result = await settled;
  expect(result.events.candidates).toMatchObject({ discovered: 2, accepted: 1, rejected: 1 });
  expect(result.events.candidates.rejected_candidates[0]).toMatchObject({ title: 'Synthetic early show', reason: 'venue_lookup_timeout' });
  expect(insertEvent).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('a schedule that cannot be resolved in the venue timezone rejects that candidate alone', async () => {
  eventOverlapsDisplayDays.mockReturnValueOnce(null);
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([
    { ...cachedEvent, title: 'Synthetic unresolved show', venue: cachedEvent.venue_name, event_start_time: '2:00 PM', event_end_time: '4:00 PM' },
    { ...cachedEvent, title: 'Synthetic resolved show', venue: cachedEvent.venue_name },
  ]) });
  const result = await discoverEvents(args);
  expect(result.events.candidates.rejected_candidates).toEqual([expect.objectContaining({
    title: 'Synthetic unresolved show', stage: 'schedule', reason: 'schedule_inconsistent' })]);
  expect(insertEvent).toHaveBeenCalledTimes(1); expect(writes.at(-1).events._generationFailed).toBeUndefined();
});
test('caller cancellation during a write is reported as cancellation, not as a persistence failure', async () => {
  const controller = new AbortController();
  callModel.mockResolvedValueOnce({ ok: true, output: JSON.stringify([{ ...cachedEvent, venue: cachedEvent.venue_name }]) });
  insertEvent.mockImplementationOnce(async () => { controller.abort(new Error('caller cancelled')); throw new Error('connection closed'); });
  await expect(discoverEvents({ ...args, signal: controller.signal })).rejects.toThrow('caller cancelled');
  expect(readEvents).not.toHaveBeenCalled(); expect(writes.at(-1).events._generationFailed).toBe(true);
});
test('caller cancellation during the saved read is reported as cancellation, not as a database read failure', async () => {
  const controller = new AbortController();
  readEvents.mockImplementationOnce(async () => { controller.abort(new Error('caller cancelled')); throw new Error('connection closed'); });
  await expect(discoverEvents({ ...args, signal: controller.signal })).rejects.toThrow('caller cancelled');
  expect(writes.at(-1).events._generationFailed).toBe(true);
});
test('already cancelled discovery starts no model or venue work', async () => {
  const controller = new AbortController(); controller.abort(new Error('already cancelled'));
  await expect(discoverEvents({ ...args, signal: controller.signal })).rejects.toThrow('already cancelled');
  expect(callModel).not.toHaveBeenCalled(); expect(lookupVenue).not.toHaveBeenCalled(); expect(readEvents).not.toHaveBeenCalled();
});


test('discovery request preserves precise GPS and the driver-day versus venue-clock boundary', async () => {
 await discoverEvents({ ...args, snapshot: { ...args.snapshot, lat: 41.123456789, lng: -87.123456789, timezone: 'America/Chicago', local_iso: '2001-01-01T23:59:00' } });
 const prompt = callModel.mock.calls[0][1].user;
 expect(prompt).toContain('(41.123456789, -87.123456789)');
 expect(prompt).toContain('driver day is defined by America/Chicago');
 expect(prompt).toContain('country US');
 expect(prompt).not.toContain('2001-01-01');
 expect(prompt).toContain(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }));
 expect(prompt).toContain("venue's own timezone");
 expect(prompt).toContain('Never invent it or assume a prefix');
 expect(prompt).not.toContain('starts with "ChIJ"');
 expect(prompt).toContain('an event that ends after midnight MUST carry the next calendar day as its event_end_date');
});
