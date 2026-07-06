// tests/dayparts.test.js
// 2026-07-06: shared/dayparts.js — the single time-context adapter for server
// AND client (client re-exports via @shared). Covers the three bugs fixed today:
//   1. Midnight h24 bug: `hour12: false` formats midnight as "24" on Node <= 21
//      (V8 h24 hourCycle), which the old code classified as 'evening'.
//   2. Silent fallbacks: NaN/invalid hours used to classify as 'evening';
//      missing timezone used to silently mean device/UTC time.
//   3. Label semantics: 12:00-2:59 PM was keyed 'late_morning_noon' and
//      labeled "late morning" — wrong for drivers and for LLM prompts.

import { describe, it, expect } from '@jest/globals';
import {
  DAY_PART_KEYS,
  DAY_PART_LABELS,
  LEGACY_DAY_PART_KEYS,
  normalizeDayPartKey,
  dayPartLabel,
  getDayPartKey,
  getLocalHour,
  getLocalDow,
  getLocalDateString,
  getLocalIso,
  classifyDayPart,
} from '../shared/dayparts.js';
import * as serverShim from '../server/lib/location/daypart.js';

describe('getDayPartKey boundaries', () => {
  const expected = {
    0: 'overnight', 1: 'overnight', 2: 'overnight', 3: 'overnight', 4: 'overnight',
    5: 'morning', 6: 'morning', 7: 'morning', 8: 'morning', 9: 'morning', 10: 'morning', 11: 'morning',
    12: 'early_afternoon', 13: 'early_afternoon', 14: 'early_afternoon',
    15: 'late_afternoon', 16: 'late_afternoon',
    17: 'early_evening', 18: 'early_evening', 19: 'early_evening', 20: 'early_evening',
    21: 'evening', 22: 'evening', 23: 'evening',
  };

  it('classifies all 24 hours into the canonical taxonomy', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(getDayPartKey(hour)).toBe(expected[hour]);
    }
  });

  it('throws on out-of-range and non-integer hours (no silent evening)', () => {
    // The old unguarded if/else chain classified all of these as 'evening'.
    for (const bad of [24, -1, 1.5, NaN, Infinity, '12', null, undefined]) {
      expect(() => getDayPartKey(bad)).toThrow();
    }
  });
});

describe('taxonomy + labels', () => {
  it('every canonical key has a label and appears in DAY_PART_KEYS', () => {
    expect(Object.keys(DAY_PART_LABELS).sort()).toEqual([...DAY_PART_KEYS].sort());
  });

  it('labels are semantically correct for the midday buckets', () => {
    expect(DAY_PART_LABELS.early_afternoon).toBe('early afternoon');
    expect(DAY_PART_LABELS.late_afternoon).toBe('late afternoon');
  });

  it('normalizes legacy stored keys to canonical ones', () => {
    expect(normalizeDayPartKey('late_morning_noon')).toBe('early_afternoon');
    expect(normalizeDayPartKey('afternoon')).toBe('late_afternoon');
    expect(normalizeDayPartKey('late_evening')).toBe('evening');
    for (const key of DAY_PART_KEYS) {
      expect(normalizeDayPartKey(key)).toBe(key);
    }
  });

  it('returns null (never a guess) for unknown/missing keys', () => {
    expect(normalizeDayPartKey('night')).toBeNull(); // old getSnapshotTimeContext shadow fallback
    expect(normalizeDayPartKey('')).toBeNull();
    expect(normalizeDayPartKey(null)).toBeNull();
    expect(normalizeDayPartKey(undefined)).toBeNull();
    expect(normalizeDayPartKey('garbage')).toBeNull();
  });

  it('dayPartLabel resolves legacy keys to the corrected human labels', () => {
    expect(dayPartLabel('late_morning_noon')).toBe('early afternoon'); // was "late morning"
    expect(dayPartLabel('afternoon')).toBe('late afternoon');
    expect(dayPartLabel('unknown')).toBeNull();
  });
});

describe('getLocalHour — GPS timezone required, h23-safe', () => {
  // 2026-07-06T05:30:00Z = 12:30 AM America/Chicago (CDT, UTC-5).
  // On this repo's Node 20, the old `hour12: false` pattern returns "24" here.
  const midnightChicago = new Date(Date.UTC(2026, 6, 6, 5, 30, 0));

  it('returns 0 (not 24) during the midnight hour', () => {
    expect(getLocalHour(midnightChicago, 'America/Chicago')).toBe(0);
  });

  it('classifies the midnight hour as overnight (was: evening)', () => {
    expect(classifyDayPart(midnightChicago, 'America/Chicago')).toEqual({
      key: 'overnight',
      label: 'overnight',
      hour: 0,
    });
  });

  it('handles ordinary hours across timezones', () => {
    // Same instant, three markets — the Indiana scenario.
    const t = new Date(Date.UTC(2026, 6, 6, 18, 5, 0)); // 6:05 PM UTC
    expect(getLocalHour(t, 'America/Chicago')).toBe(13);        // 1 PM CDT
    expect(getLocalHour(t, 'America/Indiana/Indianapolis')).toBe(14); // 2 PM EDT
    expect(getLocalHour(t, 'America/Los_Angeles')).toBe(11);    // 11 AM PDT
  });

  it('throws when the timezone is missing — no device/UTC fallback', () => {
    for (const bad of [undefined, null, '', 0]) {
      expect(() => getLocalHour(midnightChicago, bad)).toThrow(/timeZone is required/);
    }
    expect(() => classifyDayPart(midnightChicago)).toThrow(/timeZone is required/);
  });
});

describe('getLocalDow / getLocalDateString / getLocalIso', () => {
  // 2026-07-06T03:00:00Z = Sunday 2026-07-05 10:00 PM America/Chicago
  const lateSundayChicago = new Date(Date.UTC(2026, 6, 6, 3, 0, 0));

  it('derives day-of-week in the driver timezone, not UTC', () => {
    expect(getLocalDow(lateSundayChicago, 'America/Chicago')).toBe(0); // Sunday
    expect(getLocalDow(lateSundayChicago, 'UTC')).toBe(1); // already Monday in UTC
  });

  it('derives the local calendar date across the date line', () => {
    expect(getLocalDateString(lateSundayChicago, 'America/Chicago')).toBe('2026-07-05');
    expect(getLocalDateString(lateSundayChicago, 'UTC')).toBe('2026-07-06');
  });

  it('produces a naive local wall-clock ISO (snapshots.local_iso convention)', () => {
    const t = new Date(Date.UTC(2026, 6, 6, 5, 30, 15));
    expect(getLocalIso(t, 'America/Chicago')).toBe('2026-07-06T00:30:15');
    expect(getLocalIso(t, 'UTC')).toBe('2026-07-06T05:30:15');
  });

  it('throws when the timezone is missing', () => {
    expect(() => getLocalDow(lateSundayChicago)).toThrow(/timeZone is required/);
    expect(() => getLocalIso(lateSundayChicago)).toThrow(/timeZone is required/);
    expect(() => getLocalDateString(lateSundayChicago)).toThrow(/timeZone is required/);
  });
});

describe('server shim parity', () => {
  it('server/lib/location/daypart.js re-exports the identical adapter functions', () => {
    // Identity, not equivalence — there must be exactly ONE implementation.
    expect(serverShim.getDayPartKey).toBe(getDayPartKey);
    expect(serverShim.classifyDayPart).toBe(classifyDayPart);
    expect(serverShim.getLocalHour).toBe(getLocalHour);
    expect(serverShim.getLocalDow).toBe(getLocalDow);
    expect(serverShim.normalizeDayPartKey).toBe(normalizeDayPartKey);
    expect(serverShim.dayPartLabel).toBe(dayPartLabel);
    expect(serverShim.DAY_PART_LABELS).toBe(DAY_PART_LABELS);
    expect(serverShim.LEGACY_DAY_PART_KEYS).toBe(LEGACY_DAY_PART_KEYS);
  });
});
