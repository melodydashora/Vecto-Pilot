#!/usr/bin/env node
// server/scripts/test-multi-day-query.mjs
//
// Verifies the multi-day-inclusive read predicate at briefing-service.js:1545-1553
// (Step 2a) returns events whose [start, end] window overlaps [today, horizon],
// regardless of whether they started before today.
//
// Spec §4.6 / §5.4: a 4-day festival running through today must appear on day 2
// of the festival, not just day 1. The pre-fix predicate failed this case.
//
// Strategy: insert two ephemeral fixture rows into discovered_events with
// is_active = true, run BOTH the old predicate and the new predicate, compare.
// Cleanup is unconditional via DELETE on the test event_hashes.
//
// Run: node server/scripts/test-multi-day-query.mjs

import { db } from '../db/drizzle.js';
import { discovered_events } from '../../shared/schema.js';
import { sql, eq, and, gte, lte, isNotNull, inArray } from 'drizzle-orm';

const TEST_HASH_PREFIX = 'test-multi-day-2026-04-28-';
const HASH_MULTI = TEST_HASH_PREFIX + 'multi-day';
const HASH_SINGLE = TEST_HASH_PREFIX + 'single-day';

// Use real "today" so is_active=true rows are coherent with the query horizon
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'UTC' });
const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'UTC' });
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'UTC' });
const horizon = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'UTC' });

let failures = 0;
function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function cleanup() {
  await db.delete(discovered_events).where(
    inArray(discovered_events.event_hash, [HASH_MULTI, HASH_SINGLE])
  );
}

try {
  // Pre-cleanup in case a prior aborted run left fixtures behind.
  await cleanup();

  // Multi-day fixture: started yesterday, ends tomorrow. Active-today by
  // overlap semantics; missed by old forward-only-on-start predicate.
  await db.insert(discovered_events).values({
    title: '[FIXTURE] Multi-day festival',
    venue_name: 'Test Venue Multi-day',
    address: '1 Test St',
    city: 'Test City',
    state: 'XX',
    event_start_date: yesterday,
    event_start_time: '08:00',
    event_end_date: tomorrow,
    event_end_time: '22:00',
    category: 'festival',
    expected_attendance: 'high',
    event_hash: HASH_MULTI,
    is_active: true,
    schema_version: 5,
  });

  // Single-day fixture: starts today, ends today. Both predicates should return it.
  await db.insert(discovered_events).values({
    title: '[FIXTURE] Single-day concert',
    venue_name: 'Test Venue Single-day',
    address: '2 Test St',
    city: 'Test City',
    state: 'XX',
    event_start_date: today,
    event_start_time: '19:00',
    event_end_date: today,
    event_end_time: '22:00',
    category: 'concert',
    expected_attendance: 'medium',
    event_hash: HASH_SINGLE,
    is_active: true,
    schema_version: 5,
  });

  console.log(`\nFixtures: today=${today}, yesterday=${yesterday}, tomorrow=${tomorrow}, horizon=${horizon}`);

  // ─── OLD predicate (pre-Step 2a): forward-only on event_start_date ─────────
  const oldRows = await db.select({
    event_hash: discovered_events.event_hash,
    title: discovered_events.title,
  })
    .from(discovered_events)
    .where(and(
      eq(discovered_events.state, 'XX'),
      gte(discovered_events.event_start_date, today),       // ← OLD bug
      lte(discovered_events.event_start_date, horizon),     // ← OLD bug
      eq(discovered_events.is_active, true),
      isNotNull(discovered_events.event_start_time),
      isNotNull(discovered_events.event_end_time)
    ));
  const oldHashes = oldRows.map(r => r.event_hash);
  console.log(`\nOLD predicate returned ${oldRows.length} rows: ${oldRows.map(r => r.title).join(', ') || '(none)'}`);

  check(
    'OLD predicate returns single-day fixture',
    oldHashes.includes(HASH_SINGLE)
  );
  check(
    'OLD predicate MISSES multi-day fixture (proves bug)',
    !oldHashes.includes(HASH_MULTI),
    'event_start_date=yesterday < today, fails gte filter'
  );

  // ─── NEW predicate (post-Step 2a): overlap semantics ───────────────────────
  const newRows = await db.select({
    event_hash: discovered_events.event_hash,
    title: discovered_events.title,
  })
    .from(discovered_events)
    .where(and(
      eq(discovered_events.state, 'XX'),
      lte(discovered_events.event_start_date, horizon),     // ← NEW: started by horizon
      gte(discovered_events.event_end_date, today),         // ← NEW: ends after today
      eq(discovered_events.is_active, true),
      isNotNull(discovered_events.event_start_time),
      isNotNull(discovered_events.event_end_time)
    ));
  const newHashes = newRows.map(r => r.event_hash);
  console.log(`\nNEW predicate returned ${newRows.length} rows: ${newRows.map(r => r.title).join(', ') || '(none)'}`);

  check(
    'NEW predicate returns single-day fixture (no regression)',
    newHashes.includes(HASH_SINGLE)
  );
  check(
    'NEW predicate INCLUDES multi-day fixture (proves fix)',
    newHashes.includes(HASH_MULTI),
    'event overlaps [today, horizon] window'
  );

  // ─── Edge: event ENDED before today → excluded by NEW predicate ────────────
  // (already covered by deactivatePastEvents in production; double-check here)
  const HASH_EXPIRED = TEST_HASH_PREFIX + 'expired';
  await db.insert(discovered_events).values({
    title: '[FIXTURE] Expired (ended yesterday)',
    venue_name: 'Test Venue Expired',
    address: '3 Test St',
    city: 'Test City',
    state: 'XX',
    event_start_date: yesterday,
    event_start_time: '19:00',
    event_end_date: yesterday,           // ended yesterday
    event_end_time: '22:00',
    category: 'concert',
    expected_attendance: 'low',
    event_hash: HASH_EXPIRED,
    is_active: true,                      // pretend deactivation hasn't run yet
    schema_version: 5,
  });

  const newRows2 = await db.select({ event_hash: discovered_events.event_hash })
    .from(discovered_events)
    .where(and(
      eq(discovered_events.state, 'XX'),
      lte(discovered_events.event_start_date, horizon),
      gte(discovered_events.event_end_date, today),
      eq(discovered_events.is_active, true),
      isNotNull(discovered_events.event_start_time),
      isNotNull(discovered_events.event_end_time)
    ));
  const newHashes2 = newRows2.map(r => r.event_hash);
  check(
    'NEW predicate excludes events whose end_date < today (defense-in-depth)',
    !newHashes2.includes(HASH_EXPIRED)
  );

  await db.delete(discovered_events).where(eq(discovered_events.event_hash, HASH_EXPIRED));
} catch (err) {
  console.error(`\nTest error: ${err.message}`);
  failures++;
} finally {
  await cleanup();
  console.log(`\n${failures === 0 ? '✓ All tests passed' : `✗ ${failures} test(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
