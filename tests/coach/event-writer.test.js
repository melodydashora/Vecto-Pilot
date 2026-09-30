import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
const stored = [], locks = [], hashes = [];
const tx = { insert: () => ({ values: values => ({ onConflictDoUpdate: () => ({ returning: async () => { stored.push(values); return [{ id: 'fixture-event', ...values }]; } }) }) }) };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../../server/lib/briefing/cleanup-events.js', () => ({
 withEventVenueLock: async (venue, write) => { locks.push(venue); return write(tx); },
 resolveEventWriteHash: async (executor, event, hash) => { expect(executor).toBe(tx); hashes.push({ event, hash }); return 'resolved-variant'; },
}));
const { RideshareCoachDAL } = await import('../../server/lib/ai/rideshare-coach-dal.js');
const { validateAction } = await import('../../server/api/rideshare-coach/validate.js');
const dal = new RideshareCoachDAL();
const event = extra => ({ title: 'Fixture concert', venue_name: 'Fixture Hall', address: '1 Fixture St', city: 'Fixture City', state: 'AA', timezone: 'UTC',
 event_start_date: '2026-09-29', event_start_time: '23:00', event_end_time: '02:00', category: 'concert', ...extra });
beforeEach(() => { stored.length = locks.length = hashes.length = 0; jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-29T18:00:00Z')); });
afterEach(() => jest.useRealTimers());
test.each([{ event_end_time: undefined }, { event_start_time: '99:99' }, { event_end_date: '2026-02-30' }, { timezone: null }])('bad or missing evidence %j cannot become stored current-version data', async values => {
 expect(await dal.addEvent(event(values))).toBeNull(); expect(stored).toEqual([]);
});
test('overnight input preserves real clocks, rolls the end date and uses the shared write receipt', async () => {
 const saved = await dal.addEvent(event()); expect(saved).toMatchObject({ event_start_time: '23:00', event_end_time: '02:00', event_end_date: '2026-09-30', event_hash: 'resolved-variant', expected_attendance: null, is_verified: false, venue_id: null });
 expect(hashes[0].event.city).toBe('Fixture City'); expect(locks).toEqual([null]);
});
test('future driver-reported schedules remain unverified rather than stamped as current discovery', async () => {
 expect(await dal.addEvent(event({ event_start_date: '2026-10-01', event_end_date: '2026-10-04' }))).toMatchObject({ event_end_date: '2026-10-04', schema_version: 0, is_verified: false });
});
test('action validation requires both clocks, keeps supplied end date and does not infer attendance', () => {
 expect(validateAction('ADD_EVENT', event({ event_start_time: undefined })).ok).toBe(false);
 const valid = validateAction('ADD_EVENT', event({ event_end_date: '2026-10-04' })); expect(valid.ok).toBe(true); expect(valid.data.event_end_date).toBe('2026-10-04'); expect(valid.data.expected_attendance).toBeUndefined();
});
