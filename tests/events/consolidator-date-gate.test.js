// tests/events/consolidator-date-gate.test.js
//
// todo #29 — event-date-gate must be end-date aware (multi-day-inclusive).
// Prod 2026-08-06 22:36: [event-date-gate] dropped "Suffs" (started 08-04, still
// running) because the gate compared event_start_date to today with strict
// equality. The DB read path was made multi-day-inclusive on 2026-04-28
// (briefing/pipelines/events.js: start <= horizon AND end >= today); this suite
// pins the strategist-side gate to the same predicate:
//   active today ⇔ event_start_date <= today AND event_end_date >= today.
//
// Date-only cases use explicit ±1-day offsets so outcomes are stable at any
// clock time. Time-window cases only assert outcomes that are identical on
// both sides of a midnight boundary (see inline notes).

import { describe, test, expect } from '@jest/globals';
import { filterEventsToTimeWindow } from '../../server/lib/ai/providers/consolidator.js';

process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC';

const TZ = 'America/Chicago';
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD in the driver timezone, offset by whole days from now. */
function localDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * DAY_MS)
    .toLocaleDateString('en-CA', { timeZone: TZ });
}

function titles(result) {
  return result.map(e => e.title);
}

describe('filterEventsToTimeWindow — end-date-aware date gate (todo #29)', () => {
  test('includes an ACTIVE multi-day event that started before today (the "Suffs" case)', () => {
    const events = [{
      title: 'Suffs',
      event_start_date: localDate(-2),
      event_end_date: localDate(+3),
      event_start_time: '19:00',
    }];
    expect(titles(filterEventsToTimeWindow(events, TZ))).toEqual(['Suffs']);
  });

  test('includes a multi-day event on its final day (started yesterday, ends today)', () => {
    const events = [{
      title: 'Beer Week',
      event_start_date: localDate(-1),
      event_end_date: localDate(0),
      event_start_time: '10:00',
    }];
    expect(titles(filterEventsToTimeWindow(events, TZ))).toEqual(['Beer Week']);
  });

  test('drops an event that ended before today', () => {
    const events = [{
      title: 'Last Weekend Festival',
      event_start_date: localDate(-3),
      event_end_date: localDate(-1),
      event_start_time: '12:00',
    }];
    expect(filterEventsToTimeWindow(events, TZ)).toEqual([]);
  });

  test('drops an event that starts after today', () => {
    const events = [{
      title: 'Next Week Concert',
      event_start_date: localDate(+2),
      event_end_date: localDate(+2),
      event_start_time: '20:00',
    }];
    expect(filterEventsToTimeWindow(events, TZ)).toEqual([]);
  });

  test('single-day event with no end date: yesterday is dropped (end defaults to start)', () => {
    // Mirrors the read path, where a NULL/absent end date can never satisfy
    // end >= today — a dateless-end event from yesterday is over.
    const events = [{
      title: 'Yesterday One-Off',
      event_start_date: localDate(-1),
      event_start_time: '18:00',
    }];
    expect(filterEventsToTimeWindow(events, TZ)).toEqual([]);
  });

  test('event starting today at the current minute passes date gate and time window', () => {
    // Start time = now (UTC clock, TZ pinned above): now's date is always
    // today, and now is inside the [now-1h, now+6h] window — stable outcome.
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const today = now.toISOString().split('T')[0];
    const events = [{
      title: 'Tonight Show',
      event_start_date: today,
      event_end_date: today,
      event_start_time: `${hh}:${mm}`,
    }];
    // timezone omitted → todayLocal falls back to UTC, matching the UTC-built fields
    expect(titles(filterEventsToTimeWindow(events, undefined))).toEqual(['Tonight Show']);
  });

  test('event ~8h out is dropped (by time window; by date gate if past midnight)', () => {
    // Either the start timestamp exceeds now+6h (same UTC day) or its date is
    // tomorrow (crossed midnight) — both paths exclude it, so the assertion is
    // stable at any clock time.
    const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mm = String(t.getUTCMinutes()).padStart(2, '0');
    const date = t.toISOString().split('T')[0];
    const events = [{
      title: 'Too Far Out',
      event_start_date: date,
      event_end_date: date,
      event_start_time: `${hh}:${mm}`,
    }];
    expect(filterEventsToTimeWindow(events, undefined)).toEqual([]);
  });

  test('event with no date fields at all falls through to inclusion (no info ≠ drop)', () => {
    const events = [{ title: 'Dateless' }];
    expect(titles(filterEventsToTimeWindow(events, TZ))).toEqual(['Dateless']);
  });

  test('non-array input returns empty array', () => {
    expect(filterEventsToTimeWindow(null, TZ)).toEqual([]);
    expect(filterEventsToTimeWindow(undefined, TZ)).toEqual([]);
  });
});
