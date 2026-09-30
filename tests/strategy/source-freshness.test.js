import { jest, test, expect } from '@jest/globals';
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ triadLog: {}, OP: {}, tagLog: jest.fn() }));
const { filterFreshEvents, isNewsFresh, getEventStartTime, getEventEndTime } = await import('../../server/lib/strategy/strategy-utils.js');
const event = { event_start_date: '2026-09-29', event_end_date: '2026-09-29', event_start_time: '19:00', event_end_time: '23:00' };

test('malformed event clocks cannot roll into another day or imply an all-day event', () => {
  expect(filterFreshEvents([{ ...event, event_start_time: '25:00', event_end_time: '26:61' }], new Date('2026-09-29T20:00:00Z'), 'Etc/UTC')).toEqual([]);
});
test('local event and news clocks require the supplied IANA timezone', () => {
  expect(() => filterFreshEvents([event], new Date('2026-09-29T20:00:00Z'))).toThrow(/timezone|timeZone/i);
  expect(() => isNewsFresh({ date: '2026-09-29' }, new Date('2026-09-29T20:00:00Z'))).toThrow(/timezone|timeZone/i);
});
test('news cutoff uses the driver-local calendar day on both sides of UTC midnight', () => {
  expect(isNewsFresh({ published_date: '2026-09-25T08:00:00Z' }, new Date('2026-09-29T01:00:00Z'), 'America/Los_Angeles')).toBe(true);
  expect(isNewsFresh({ published_date: '2026-09-26T01:00:00Z' }, new Date('2026-09-29T16:00:00Z'), 'Asia/Tokyo')).toBe(false);
});
test('future news timestamps and future local dates cannot be called fresh', () => {
  const now = new Date('2026-09-29T23:30:00Z');
  expect(isNewsFresh({ date: '2026-10-01' }, now, 'Asia/Tokyo')).toBe(false);
  expect(isNewsFresh({ published_date: '2026-09-29T23:31:00Z' }, now, 'America/Los_Angeles')).toBe(false);
});
test('split and naive ISO wall clocks use IANA offsets while explicit offsets retain their instant', () => {
  expect(getEventStartTime(event, 'America/Los_Angeles').toISOString()).toBe('2026-09-30T02:00:00.000Z');
  expect(getEventStartTime({ startsAt: '2026-09-29T19:00:00' }, 'America/Los_Angeles').toISOString()).toBe('2026-09-30T02:00:00.000Z');
  expect(getEventStartTime({ startsAt: '2026-09-29T19:00:00+09:00' }).toISOString()).toBe('2026-09-29T10:00:00.000Z');
});
test('multi-day and overnight ends retain their actual local calendar span', () => {
  expect(getEventEndTime({ ...event, event_start_date: '2026-09-28', event_end_date: '2026-10-01' }, 'America/Los_Angeles').toISOString()).toBe('2026-10-02T06:00:00.000Z');
  expect(getEventEndTime({ ...event, event_end_date: undefined, event_end_time: '02:00' }, 'America/Los_Angeles').toISOString()).toBe('2026-09-30T09:00:00.000Z');
});
test('explicit all-day spans use local midnight through the end of the declared day', () => {
  const allDay = { event_start_date: '2026-09-29', event_end_date: '2026-09-30', all_day: true };
  expect(getEventStartTime(allDay, 'Asia/Tokyo').toISOString()).toBe('2026-09-28T15:00:00.000Z');
  expect(getEventEndTime(allDay, 'Asia/Tokyo').toISOString()).toBe('2026-09-30T14:59:59.999Z');
  expect(getEventStartTime({ event_start_date: '2026-09-29', event_start_time: 'TBD' }, 'Asia/Tokyo')).toBeNull();
});
test('invalid calendars and clocks never become a different valid timestamp', () => {
  expect(getEventStartTime({ ...event, event_start_date: '2026-02-30' }, 'Etc/UTC')).toBeNull();
  expect(getEventEndTime({ ...event, event_end_time: '25:61' }, 'Etc/UTC')).toBeNull();
  expect(isNewsFresh({ date: '2026-02-30' }, new Date('2026-03-02T00:00:00Z'), 'Etc/UTC')).toBe(false);
});

test('an explicit malformed end cannot be replaced with an invented end of day or duration', () => {
  expect(filterFreshEvents([{ ...event, event_end_time: 'TBD' }], new Date('2026-09-29T20:00:00Z'), 'Etc/UTC')).toEqual([]);
});
