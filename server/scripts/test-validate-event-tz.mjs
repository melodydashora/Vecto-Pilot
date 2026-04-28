#!/usr/bin/env node
// server/scripts/test-validate-event-tz.mjs
//
// Verifies validateEvent's Rule 13 (today/yesterday check) is timezone-aware
// via context.timezone, while preserving UTC backwards-compat for legacy callers.
//
// Spec §9.2: global-app correctness — Pacific/Honolulu / Asia/Tokyo drivers near
// midnight UTC must not have their local-today events rejected as "not_today".
//
// Run: node server/scripts/test-validate-event-tz.mjs

import {
  validateEvent,
  VALIDATION_SCHEMA_VERSION,
} from '../lib/events/pipeline/validateEvent.js';

let failures = 0;
function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log(`\nschema_version: ${VALIDATION_SCHEMA_VERSION}`);
check('schema version is 5 (tz-aware Rule 13)', VALIDATION_SCHEMA_VERSION === 5);

// Base event that passes Rules 1-12; only Rule 13 is variable across tests.
// state='XX' is ISO-reserved for "unknown" — neutral test value, not a real region.
const baseEvent = {
  title: 'Test Concert',
  venue_name: 'Test Venue',
  address: '123 Main St',
  city: 'Test City',
  state: 'XX',
  event_start_time: '23:30',
  event_end_time: '01:30',
  category: 'concert',
  expected_attendance: 'high',
};

// Diagnostic: do HST and UTC dates currently differ?
const utcToday = new Date().toISOString().split('T')[0];
const hstToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' });
const jstToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
console.log(`\nDate-rollover diagnostic — UTC: ${utcToday}, HST: ${hstToday}, JST: ${jstToday}\n`);

// ─── Test 1: HST event with timezone context — always valid ───────────────────
const hstEvent = { ...baseEvent, event_start_date: hstToday, event_end_date: hstToday };
const hstWithCtx = validateEvent(hstEvent, { timezone: 'Pacific/Honolulu' });
check(
  'HST today event valid with timezone=Pacific/Honolulu',
  hstWithCtx.valid,
  hstWithCtx.reason || ''
);

// ─── Test 2: deterministic bug-exposure via mocked clock ──────────────────────
// The bug manifests for AHEAD timezones (UTC+9 to UTC+14) when their local-today
// equals UTC-tomorrow. We mock Date.now to a fixed UTC instant where Pacific/Kiritimati
// (UTC+14) has rolled into a date that is UTC-tomorrow — exactly the case where
// the legacy UTC fallback rejects a valid local-today event as "not_today".
//
// Mocked instant: 2026-04-28T15:00:00Z
//   UTC today     = 2026-04-28
//   UTC yesterday = 2026-04-27
//   Kiritimati local = 2026-04-29 05:00 (UTC+14 already past midnight)
// → Event with event_start_date='2026-04-29' should be:
//     • REJECTED without context (UTC fallback: 04-29 is neither today nor yesterday)
//     • ACCEPTED with context.timezone='Pacific/Kiritimati' (it IS today there)

const RealDate = Date;
const MOCK_UTC_MS = RealDate.UTC(2026, 3, 28, 15, 0, 0); // April=3 zero-indexed
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(MOCK_UTC_MS);
    else super(...args);
  }
  static now() { return MOCK_UTC_MS; }
}
global.Date = MockDate;

try {
  const kiritimatiEvent = {
    ...baseEvent,
    event_start_date: '2026-04-29',
    event_end_date: '2026-04-29',
  };

  const noCtxResult = validateEvent(kiritimatiEvent);
  check(
    'Kiritimati local-today (UTC-tomorrow) REJECTED without context — proves pre-fix bug',
    !noCtxResult.valid && noCtxResult.reason === 'not_today'
  );

  const ctxResult = validateEvent(kiritimatiEvent, { timezone: 'Pacific/Kiritimati' });
  check(
    'Same event ACCEPTED with timezone=Pacific/Kiritimati — fix works',
    ctxResult.valid,
    ctxResult.reason || ''
  );
} finally {
  global.Date = RealDate;
}

// ─── Test 3: JST event with timezone context — always valid ────────────────────
const jstEvent = { ...baseEvent, event_start_date: jstToday, event_end_date: jstToday };
const jstWithCtx = validateEvent(jstEvent, { timezone: 'Asia/Tokyo' });
check(
  'JST today event valid with timezone=Asia/Tokyo',
  jstWithCtx.valid,
  jstWithCtx.reason || ''
);

// ─── Test 4: backwards-compat — legacy caller with no context still passes UTC today ─
const utcEvent = { ...baseEvent, event_start_date: utcToday, event_end_date: utcToday };
const utcResult = validateEvent(utcEvent);
check(
  'Legacy caller (no context, no timezone) accepts UTC today',
  utcResult.valid,
  utcResult.reason || ''
);

// ─── Test 5: future-dated event still rejected with context ───────────────────
const future = new Date(Date.now() + 7 * 86400000)
  .toLocaleDateString('en-CA', { timeZone: 'UTC' });
const futureEvent = { ...baseEvent, event_start_date: future, event_end_date: future };
const futureResult = validateEvent(futureEvent, { timezone: 'UTC' });
check(
  'Future-dated event (7 days out) rejected with timezone context',
  !futureResult.valid && futureResult.reason === 'not_today'
);

// ─── Test 6: yesterday allowed in context tz (cross-midnight late-night event) ─
const hstYesterday = new Date(Date.now() - 86400000)
  .toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' });
const yEvent = { ...baseEvent, event_start_date: hstYesterday, event_end_date: hstYesterday };
const yResult = validateEvent(yEvent, { timezone: 'Pacific/Honolulu' });
check(
  'HST yesterday event allowed (late-night events past midnight)',
  yResult.valid,
  yResult.reason || ''
);

// ─── Test 7: events 2+ days old rejected (window is today/yesterday only) ─────
const tooOld = new Date(Date.now() - 3 * 86400000)
  .toLocaleDateString('en-CA', { timeZone: 'UTC' });
const oldEvent = { ...baseEvent, event_start_date: tooOld, event_end_date: tooOld };
const oldResult = validateEvent(oldEvent, { timezone: 'UTC' });
check(
  'Event 3 days old rejected with timezone context',
  !oldResult.valid && oldResult.reason === 'not_today'
);

console.log(`\n${failures === 0 ? '✓ All tests passed' : `✗ ${failures} test(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
