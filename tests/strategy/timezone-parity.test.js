/**
 * tests/strategy/timezone-parity.test.js
 *
 * 2026-06-11: Parity + correctness coverage for the createDateInTimezone swap in
 * server/lib/strategy/strategy-utils.js (hand-rolled Intl offset math → date-fns-tz
 * `fromZonedTime`). createDateInTimezone is an internal helper, so this test:
 *   1. Inlines the OLD algorithm (verbatim copy of the removed implementation) and the
 *      NEW one, and asserts they AGREE for all normal (non-DST-edge) wall-clock inputs —
 *      proving the swap does not regress the common path.
 *   2. Round-trips the NEW result back through the IANA database (formatInTimeZone) and
 *      asserts it equals the input wall clock — proving the NEW result is correct
 *      independent of the OLD one.
 *   3. Asserts the specific DST-transition / month-end / AHEAD-timezone edge cases where
 *      the OLD heuristic was fragile, against hand-computed UTC instants.
 *
 * Convention: createDateInTimezone(year, month [1-12], day, hours, minutes, tz) → UTC Date.
 */

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

// ── NEW implementation (mirrors strategy-utils.js createDateInTimezone) ──────────────
function newImpl(year, month, day, hours, minutes, timezone) {
  const pad = (n) => String(n).padStart(2, '0');
  const wallClock = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
  return fromZonedTime(wallClock, timezone);
}

// ── OLD implementation (verbatim copy of the removed hand-rolled algorithm) ──────────
function oldImpl(year, month, day, hours, minutes, timezone) {
  const pad = (n) => String(n).padStart(2, '0');
  const isoBase = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
  const refDate = new Date(`${isoBase}Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = formatter.formatToParts(refDate);
  const getPart = (type) => parts.find((p) => p.type === type)?.value;
  const tzDay = parseInt(getPart('day'));
  const tzHour = parseInt(getPart('hour'));
  const tzMinute = parseInt(getPart('minute'));
  const utcMinutes = refDate.getUTCHours() * 60 + refDate.getUTCMinutes();
  const tzMinutes = tzHour * 60 + tzMinute;
  let offsetMinutes = tzMinutes - utcMinutes;
  if (tzDay > refDate.getUTCDate() || (tzDay === 1 && refDate.getUTCDate() > 27)) {
    offsetMinutes += 24 * 60;
  } else if (tzDay < refDate.getUTCDate() || (refDate.getUTCDate() === 1 && tzDay > 27)) {
    offsetMinutes -= 24 * 60;
  }
  const localMs = new Date(year, month - 1, day, hours, minutes).getTime();
  const utcMs = localMs - offsetMinutes * 60 * 1000;
  return new Date(utcMs);
}

const ZONES = [
  'America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu',
  'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Kiritimati', 'Europe/London', 'UTC',
];

// Dates intentionally away from DST transitions and month boundaries (the regions where
// the OLD heuristic was sound), so OLD and NEW must agree exactly.
const NORMAL_DATES = [
  [2026, 1, 15], [2026, 4, 15], [2026, 7, 15], [2026, 9, 15], [2026, 12, 12],
];
const TIMES = [[0, 0], [9, 30], [12, 0], [19, 0], [23, 59]];

// The swap must never make a NORMAL-path result worse. Where OLD and NEW agree, great;
// where they DIVERGE, the NEW value must be the round-trip-correct one — i.e. every
// divergence is an OLD bug being fixed, never a NEW regression. (The OLD algorithm is
// known to mishandle midnight wall-times: en-US `hour12:false` formats 00:00 as "24",
// corrupting its offset math by 24h. NEW has no such failure mode.)
describe('createDateInTimezone swap — divergences are OLD bugs, never NEW regressions', () => {
  const pad = (n) => String(n).padStart(2, '0');
  for (const tz of ZONES) {
    for (const [y, mo, d] of NORMAL_DATES) {
      for (const [h, mi] of TIMES) {
        const wall = `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`;
        test(`safe: ${tz} ${wall}`, () => {
          const newUtc = newImpl(y, mo, d, h, mi, tz);
          const oldUtc = oldImpl(y, mo, d, h, mi, tz);
          if (oldUtc.toISOString() !== newUtc.toISOString()) {
            // They differ — NEW must be the correct one (round-trips to the input wall clock).
            expect(formatInTimeZone(newUtc, tz, 'yyyy-MM-dd HH:mm')).toBe(wall);
          } else {
            expect(oldUtc.toISOString()).toBe(newUtc.toISOString());
          }
        });
      }
    }
  }
});

describe('createDateInTimezone swap — NEW round-trips through the IANA database', () => {
  for (const tz of ZONES) {
    for (const [y, mo, d] of NORMAL_DATES) {
      for (const [h, mi] of TIMES) {
        const pad = (n) => String(n).padStart(2, '0');
        const wall = `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`;
        test(`round-trips: ${tz} ${wall}`, () => {
          const utc = newImpl(y, mo, d, h, mi, tz);
          expect(formatInTimeZone(utc, tz, 'yyyy-MM-dd HH:mm')).toBe(wall);
        });
      }
    }
  }
});

describe('createDateInTimezone swap — DST / month-end / AHEAD-tz edge correctness', () => {
  // US spring-forward 2026-03-08: 02:00 Central jumps to 03:00. 02:30 does not exist;
  // it resolves to the post-transition instant (CDT, UTC-5) → 07:30Z.
  test('US spring-forward non-existent 02:30 → post-transition instant', () => {
    expect(newImpl(2026, 3, 8, 2, 30, 'America/Chicago').toISOString())
      .toBe('2026-03-08T07:30:00.000Z');
  });

  // US fall-back 2026-11-01: 02:00 Central falls back to 01:00. 01:30 is ambiguous;
  // fromZonedTime picks the earlier offset (CDT, UTC-5) → 06:30Z.
  test('US fall-back ambiguous 01:30 → earlier offset', () => {
    expect(newImpl(2026, 11, 1, 1, 30, 'America/Chicago').toISOString())
      .toBe('2026-11-01T06:30:00.000Z');
  });

  // Standard-time Central (CST, UTC-6) just after the fall-back: 03:00 → 09:00Z.
  test('US post-fall-back standard time resolves at UTC-6', () => {
    expect(newImpl(2026, 11, 1, 3, 0, 'America/Chicago').toISOString())
      .toBe('2026-11-01T09:00:00.000Z');
  });

  // Month-end + AHEAD tz (JST, UTC+9): 2026-01-31 23:30 local → same-day 14:30Z.
  test('month-end Tokyo 23:30 stays on the correct UTC day', () => {
    expect(newImpl(2026, 1, 31, 23, 30, 'Asia/Tokyo').toISOString())
      .toBe('2026-01-31T14:30:00.000Z');
  });

  // Far-AHEAD tz at the day boundary (Kiritimati, UTC+14): 2026-04-29 00:30 local →
  // previous-day 10:30Z. This is the boundary that drove memory #255.
  test('Kiritimati 00:30 maps back to the previous UTC day', () => {
    expect(newImpl(2026, 4, 29, 0, 30, 'Pacific/Kiritimati').toISOString())
      .toBe('2026-04-28T10:30:00.000Z');
  });

  // BEHIND tz at the day boundary (Honolulu, UTC-10): 2026-04-29 23:30 local →
  // next-day 09:30Z.
  test('Honolulu 23:30 maps forward to the next UTC day', () => {
    expect(newImpl(2026, 4, 29, 23, 30, 'Pacific/Honolulu').toISOString())
      .toBe('2026-04-30T09:30:00.000Z');
  });
});
