import { describe, test, expect, jest, beforeEach, afterAll } from '@jest/globals';
const callModel = jest.fn();
const writeSectionAndNotify = jest.fn();
const finalRead = jest.fn();
jest.unstable_mockModule('../../server/lib/events/market-event-reader.js', () => ({
 readMarketEvents: async () => ({ rows: await finalRead(), unresolvedCount: 0 }),
 toBriefingEvent: row => row, eventOverlapsDisplayDays: () => true,
}));
const query = { from() { return this; }, leftJoin() { return this; }, where() { return this; }, orderBy() { return this; }, limit: finalRead };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { select: () => query } }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  writeSectionAndNotify, CHANNELS: { EVENTS: 'events' },
  errorMarker: err => ({ _generationFailed: true, error: err.message }),
}));
jest.unstable_mockModule('../../server/lib/briefing/cleanup-events.js', () => ({
  deactivatePastEvents: jest.fn(), collapseDuplicateEventSpans: jest.fn(), clearOrphanedEventVenueTags: jest.fn(), mergeIntoOverlappingActiveSpan: jest.fn(), discoveryReactivationFields: () => ({}), resolveEventWriteHash: async (_tx, _event, hash) => hash, withEventVenueLock: async (_id, write) => write((await import('../../server/db/drizzle.js')).db),
}));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({ findOrCreateVenue: jest.fn(), lookupVenue: jest.fn() }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ searchPlaceWithTextSearch: jest.fn() }));
const { discoverEvents, deduplicateEvents } = await import('../../server/lib/briefing/pipelines/events.js');
const originalKey = process.env.GEMINI_API_KEY;
const snapshot = { country: 'US', city: 'Synthetic City', state: 'Synthetic State', market: 'Synthetic Market', timezone: 'Etc/UTC', lat: 1, lng: 1 };
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'synthetic-provider-mocked';
  callModel.mockResolvedValue({ ok: true, output: '[]' });
  finalRead.mockReset(); writeSectionAndNotify.mockReset();
});
afterAll(() => { if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; });

describe('event discovery failure contract', () => {
  // DB-failure case intentionally omitted: pinned by tests/briefing/briefing-events-failures.test.js.
  test('successful empty discovery remains an explained empty result', async () => {
    finalRead.mockResolvedValue([]);
    const result = await discoverEvents({ snapshot, snapshotId: 'synthetic' });
    expect(result.events.items).toEqual([]);
    expect(result.events.reason).toBeTruthy();
    expect(result.events._generationFailed).toBeUndefined();
    expect(callModel.mock.calls[0][1].user).toContain('Never estimate missing start/end times');
  });
  test('the live hash-dedupe stage preserves distinct non-Latin events', () => {
    const a = { title: '春祭り', address: '1 Example Street', event_start_time: '19:00' };
    const b = { ...a, title: '秋音楽会' };
    expect(deduplicateEvents([a, b])).toHaveLength(2);
  });
});
