import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { normalizeEvent, normalizeTime, normalizeDate } from '../../server/lib/events/pipeline/normalizeEvent.js';
import { validateEvent, needsReadTimeValidation } from '../../server/lib/events/pipeline/validateEvent.js';
import { buildHashInput, generateEventHash } from '../../server/lib/events/pipeline/hashEvent.js';
import { deduplicateEventsSemantic } from '../../server/lib/events/pipeline/deduplicateEventsSemantic.js';
import { matchVenuesToEvents, getVenueEventKey } from '../../server/lib/venue/event-matcher.js';
import { parseStructuredHoursFullWeek } from '../../server/lib/venue/hours/parsers/structured-hours.js';
import { getOpenStatus } from '../../server/lib/venue/hours/evaluator.js';

const base = {
  title: 'Synthetic concert', venue_name: 'Synthetic hall', address: '1 Example Street',
  city: 'Synthetic City', state: 'Synthetic State', category: 'concert',
  event_start_date: '2026-09-13', event_end_date: '2026-09-13',
  event_start_time: '19:00', event_end_time: '22:00',
};

describe('event timing remains sourced and valid across normalize -> validate', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-13T12:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  test.each(['99:99', '24:00', '19:60', '7:99 PM', '0 AM', '13 PM'])('rejects out-of-range time %s', time => {
    expect(normalizeTime(time)).toBeNull();
    expect(validateEvent({ ...base, event_start_time: time }, { timezone: 'Etc/UTC' }).valid).toBe(false);
    expect(validateEvent({ ...base, event_end_time: time }, { timezone: 'Etc/UTC' }).valid).toBe(false);
  });
  test.each(['TBD', 'Unknown', 'All Day', '', undefined])('does not invent timing for %s', time => {
    const normalized = normalizeEvent({ ...base, event_start_time: time, event_end_time: time });
    expect(normalized.event_start_time).toBeNull();
    expect(normalized.event_end_time).toBeNull();
    expect(validateEvent(normalized, { timezone: 'Etc/UTC' }).valid).toBe(false);
  });
  test('does not invent an end time from a known start and category', () => {
    const normalized = normalizeEvent({ ...base, event_end_time: undefined });
    expect(normalized.event_start_time).toBe('19:00');
    expect(normalized.event_end_time).toBeNull();
    expect(validateEvent(normalized, { timezone: 'Etc/UTC' }).reason).toBe('missing_end_time');
  });
  test.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-09-00'])('rejects impossible date %s', date => {
    expect(normalizeDate(date)).toBeNull();
    expect(validateEvent({ ...base, event_start_date: date }, { timezone: 'Etc/UTC' }).valid).toBe(false);
    expect(validateEvent({ ...base, event_end_date: date }, { timezone: 'Etc/UTC' }).valid).toBe(false);
  });
  test('normalizes real 12h times and overnight end date without inventing hours', () => {
    const normalized = normalizeEvent({ ...base, event_start_time: '11 PM', event_end_time: '2 AM', event_end_date: undefined });
    expect(normalized).toMatchObject({ event_start_time: '23:00', event_end_time: '02:00', event_end_date: '2026-09-14' });
    expect(validateEvent(normalized, { timezone: 'Etc/UTC' }).valid).toBe(true);
  });
  test('invalid explicit end date cannot become a default single-day span', () => {
    const normalized = normalizeEvent({ ...base, event_end_date: '2026-02-30' });
    expect(validateEvent(normalized, { timezone: 'Etc/UTC' }).reason).toBe('invalid_end_date');
  });
  test('named dates cannot silently roll into another calendar day', () => {
    expect(normalizeDate('February 30, 2026')).toBeNull();
    expect(normalizeDate('15 January 2026')).toBe('2026-01-15');
  });
  test('earlier schema markers require revalidation', () => expect(needsReadTimeValidation(6)).toBe(true));
});

describe('event identity preserves non-Latin text without changing ASCII keys', () => {
  test('different Japanese events have distinct stored identities and remain separate semantically', () => {
    const a = { ...base, title: '春祭り', venue_name: '音楽会館', city: '東京' };
    const b = { ...a, title: '秋音楽会' };
    expect(generateEventHash(a)).not.toBe(generateEventHash(b));
    expect(buildHashInput(a)).toContain('春祭り');
    expect(deduplicateEventsSemantic([a, b], { log: false }).deduplicated).toHaveLength(2);
  });
  test('canonical Unicode representations share the same identity', () => {
    expect(generateEventHash({ ...base, title: 'Caf\u00e9 music' })).toBe(generateEventHash({ ...base, title: 'Cafe\u0301 music' }));
  });
  test('known ASCII hash inputs remain byte-for-byte compatible', () => {
    expect(buildHashInput({ ...base, title: 'Live Music: The Band (Special Edition)', venue_name: 'Example Hall' }))
      .toBe('the band|example hall|example street|synthetic city|2026-09-13');
  });
});

describe('venue-event matching respects authoritative identity', () => {
  const event = { ...base, title: 'Synthetic concert elsewhere', vc_venue_name: 'Same Name', vc_place_id: 'place-b', venue_id: 'venue-b' };
  test('different place IDs do not match even with the same name or lower-priority venue ID', () => {
    const venue = { name: 'Same Name', placeId: 'place-a', venue_id: 'venue-b' };
    expect(matchVenuesToEvents([venue], [event]).size).toBe(0);
  });
  test('different venue IDs do not match by name when place IDs are absent', () => {
    expect(matchVenuesToEvents([{ name: 'Same Name', venue_id: 'venue-a' }], [{ ...event, vc_place_id: null }]).size).toBe(0);
  });
  test('same authoritative place matches despite name spelling differences', () => {
    const venue = { name: 'Other Display Name', placeId: 'place-b' };
    expect(matchVenuesToEvents([venue], [event]).get(getVenueEventKey(venue))).toHaveLength(1);
  });
  test('two same-name locations retain separate result buckets', () => {
    const a = { name: 'Same Name', placeId: 'place-a' };
    const b = { name: 'Same Name', placeId: 'place-b' };
    const events = [{ ...event, title: 'Event A', vc_place_id: 'place-a' }, { ...event, title: 'Event B' }];
    const matches = matchVenuesToEvents([a, b], events);
    expect(matches.get(getVenueEventKey(a)).map(e => e.title)).toEqual(['Event A']);
    expect(matches.get(getVenueEventKey(b)).map(e => e.title)).toEqual(['Event B']);
  });
  test('legacy missing identity retains the existing name-match behavior', () => {
    const venue = { name: 'Same Name' };
    expect(matchVenuesToEvents([venue], [{ ...event, vc_place_id: null, venue_id: null }]).get(getVenueEventKey(venue))).toHaveLength(1);
  });
});

describe('next 24-hour opening countdown', () => {
  test('Monday 20:00 to Tuesday midnight is four hours, not one full day', () => {
    const { schedule } = parseStructuredHoursFullWeek({ monday: { closed: true }, tuesday: { open_24h: true } });
    expect(getOpenStatus(schedule, 'Etc/UTC', new Date('2026-09-14T20:00:00Z')).minutes_until_open).toBe(240);
  });
  test('counts multiple days and wraps the week', () => {
    const { schedule } = parseStructuredHoursFullWeek({ saturday: { closed: true }, sunday: { closed: true }, monday: { open_24h: true } });
    expect(getOpenStatus(schedule, 'Etc/UTC', new Date('2026-09-12T20:00:00Z')).minutes_until_open).toBe(1680);
  });
});


describe('explicit performance schedules survive semantic deduplication', () => {
 test('different known starts within two hours and different ends remain source variants', () => {
  for (const variant of [{ event_start_time: '20:00' }, { event_end_time: '23:00' }, { event_start_time: null }]) {
   expect(deduplicateEventsSemantic([base, { ...base, ...variant }], { log: false }).deduplicated).toHaveLength(2);
  }
 });
 test('identical complete schedules still deduplicate title variants', () => {
  expect(deduplicateEventsSemantic([base, { ...base, title: base.title + ' Live' }], { log: false }).deduplicated).toHaveLength(1);
 });
});


describe('provider place identifiers remain bounded opaque hints', () => {
  test('preserves a non-ChIJ identifier without promoting it to provider evidence', () => {
    expect(normalizeEvent({ ...base, place_id: 'provider-opaque:one' }).place_id).toBe('provider-opaque:one');
  });
  test.each(['', 'unknown', 'N/A', 'a'.repeat(256), 'white space', 'control\u0000value', 123])('rejects absent/malformed hint %j', place_id => {
    expect(normalizeEvent({ ...base, place_id }).place_id).toBeNull();
  });
});
