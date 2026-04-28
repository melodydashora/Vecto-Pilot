#!/usr/bin/env node
// server/scripts/test-smart-blocks-multi-day.mjs
//
// Step 2b verification: invoke fetchTodayDiscoveredEventsWithVenue with a
// multi-day fixture in place, confirm it's returned. Pre-fix this function
// used `eq(event_start_date, eventDate)` and missed any event whose first day
// was yesterday or earlier. Spec §4.9 / §5.4.
//
// Run: node server/scripts/test-smart-blocks-multi-day.mjs

import { db } from '../db/drizzle.js';
import { discovered_events, venue_catalog } from '../../shared/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { fetchTodayDiscoveredEventsWithVenue } from '../lib/venue/enhanced-smart-blocks.js';

const TEST_HASH_PREFIX = 'test-smart-blocks-2026-04-28-';
const HASH_MULTI_PG = TEST_HASH_PREFIX + 'multi-day-pg';        // planner-grade
const HASH_SINGLE_PG = TEST_HASH_PREFIX + 'single-day-pg';      // planner-grade
const HASH_OOS = TEST_HASH_PREFIX + 'out-of-state';             // wrong state
const HASH_ORPHAN = TEST_HASH_PREFIX + 'orphan';                // no venue_id

// Synthetic planner-grade venue_catalog row. All seven gate fields populated.
// Coords near (0, 0) so a driver at Null Island sees it as a near candidate.
const TEST_VENUE_ID = randomUUID();
const TEST_PLACE_ID = `ChIJ_TEST_${TEST_VENUE_ID.slice(0, 8)}`;
const TEST_COORD_KEY = `${TEST_VENUE_ID.slice(0, 8)}_test`;     // unique key, won't collide

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'UTC' });
const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'UTC' });
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'UTC' });

let failures = 0;
function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function cleanup() {
  // Delete events first (FK to venue_catalog), then the venue.
  await db.delete(discovered_events).where(
    inArray(discovered_events.event_hash, [HASH_MULTI_PG, HASH_SINGLE_PG, HASH_OOS, HASH_ORPHAN])
  );
  await db.delete(venue_catalog).where(eq(venue_catalog.venue_id, TEST_VENUE_ID));
}

try {
  await cleanup();

  // Synthetic state codes — XX is ISO-reserved for "unknown", YY is unassigned.
  // Using these guarantees the fixtures don't collide with any real region's data
  // and don't leak the developer's home location into test code (CLAUDE.md Rule 3).
  const TEST_STATE_PRIMARY = 'XX';
  const TEST_STATE_OTHER = 'YY';

  // Step 4: insert a planner-grade venue_catalog row (all seven gate fields populated).
  await db.insert(venue_catalog).values({
    venue_id: TEST_VENUE_ID,
    place_id: TEST_PLACE_ID,
    venue_name: 'Test Planner-Grade Venue',
    normalized_name: 'test planner grade venue',
    address: '999 Test Plaza',
    formatted_address: '999 Test Plaza, Test City, XX 99999',
    city: 'Test City',
    state: TEST_STATE_PRIMARY,
    zip: '99999',
    country: 'XX',
    lat: 0.01,
    lng: 0.01,
    coord_key: TEST_COORD_KEY,
    is_event_venue: true,
    record_status: 'verified',
    timezone: 'UTC',
  });

  // Multi-day fixture (planner-grade — linked to TEST_VENUE_ID, gate passes)
  await db.insert(discovered_events).values({
    title: '[FIXTURE-2b] Multi-day planner-grade',
    venue_name: 'Test Planner-Grade Venue', address: '999 Test Plaza',
    city: 'Test City', state: TEST_STATE_PRIMARY,
    venue_id: TEST_VENUE_ID,
    event_start_date: yesterday, event_start_time: '08:00',
    event_end_date: tomorrow,    event_end_time: '22:00',
    category: 'festival', expected_attendance: 'high',
    event_hash: HASH_MULTI_PG, is_active: true, schema_version: 5,
  });

  // Single-day fixture (planner-grade — linked to TEST_VENUE_ID, gate passes)
  await db.insert(discovered_events).values({
    title: '[FIXTURE-2b] Single-day planner-grade',
    venue_name: 'Test Planner-Grade Venue', address: '999 Test Plaza',
    city: 'Test City', state: TEST_STATE_PRIMARY,
    venue_id: TEST_VENUE_ID,
    event_start_date: today, event_start_time: '19:00',
    event_end_date: today,   event_end_time: '22:00',
    category: 'concert', expected_attendance: 'medium',
    event_hash: HASH_SINGLE_PG, is_active: true, schema_version: 5,
  });

  // Orphan fixture (primary state, NO venue_id — gate classifies as orphan)
  await db.insert(discovered_events).values({
    title: '[FIXTURE-2b] Orphan',
    venue_name: 'Test Orphan Venue', address: '1 Orphan St',
    city: 'Test City', state: TEST_STATE_PRIMARY,
    event_start_date: today, event_start_time: '20:00',
    event_end_date: today,   event_end_time: '23:00',
    category: 'concert', expected_attendance: 'low',
    event_hash: HASH_ORPHAN, is_active: true, schema_version: 5,
  });

  // Other-state fixture (excluded by state filter before gate)
  await db.insert(discovered_events).values({
    title: '[FIXTURE-2b] Multi-day other-state',
    venue_name: 'Test Venue OOS', address: '3 Test St', city: 'Test City',
    state: TEST_STATE_OTHER,
    event_start_date: yesterday, event_start_time: '08:00',
    event_end_date: tomorrow,    event_end_time: '22:00',
    category: 'festival', expected_attendance: 'high',
    event_hash: HASH_OOS, is_active: true, schema_version: 5,
  });

  console.log(`\nFixtures inserted. today=${today}, yesterday=${yesterday}, tomorrow=${tomorrow}`);

  // Call without driver coords → exercises Step 2b predicate + Step 4 gate, returns plannerReady.
  const rowsNoCoords = await fetchTodayDiscoveredEventsWithVenue(TEST_STATE_PRIMARY, today);
  const rowsArr = Array.isArray(rowsNoCoords) ? rowsNoCoords : (rowsNoCoords?.events || []);
  const titles = rowsArr.map(r => r.title);
  console.log(`\nfetchTodayDiscoveredEventsWithVenue('${TEST_STATE_PRIMARY}', '${today}') returned ${rowsArr.length} planner-ready rows`);

  check(
    'Multi-day planner-grade fixture returned (Steps 2b + 4)',
    titles.includes('[FIXTURE-2b] Multi-day planner-grade')
  );
  check(
    'Single-day planner-grade fixture returned (no regression)',
    titles.includes('[FIXTURE-2b] Single-day planner-grade')
  );
  check(
    'Other-state fixture excluded by state filter (before gate)',
    !titles.includes('[FIXTURE-2b] Multi-day other-state')
  );
  check(
    'Orphan fixture excluded by Step 4 planner-grade gate',
    !titles.includes('[FIXTURE-2b] Orphan')
  );

  // Call WITH driver coords → exercise distance/metro path on planner-ready set.
  // Test venue is at (0.01, 0.01), driver at (0, 0) → ~1mi distance, near bucket.
  const TEST_DRIVER_LAT = 0;
  const TEST_DRIVER_LNG = 0;
  const rowsCoords = await fetchTodayDiscoveredEventsWithVenue(
    TEST_STATE_PRIMARY, today, TEST_DRIVER_LAT, TEST_DRIVER_LNG, 60
  );
  const rowsCoordsArr = Array.isArray(rowsCoords) ? rowsCoords : (rowsCoords?.events || []);
  console.log(`\nfetchTodayDiscoveredEventsWithVenue with driver coords (Null Island) returned ${rowsCoordsArr.length} reachable rows`);
  check(
    'Function runs cleanly with driver coords (no exceptions)',
    Array.isArray(rowsCoords) || rowsCoords?.events != null
  );
  check(
    'Planner-grade fixtures appear in reachable bucket (driver near venue at 0,0)',
    rowsCoordsArr.some(r => r.title === '[FIXTURE-2b] Multi-day planner-grade') &&
    rowsCoordsArr.some(r => r.title === '[FIXTURE-2b] Single-day planner-grade')
  );
  check(
    'Orphan fixture excluded from reachable bucket (gate filtered before distance)',
    !rowsCoordsArr.some(r => r.title === '[FIXTURE-2b] Orphan')
  );
  // Distance annotation: planner-grade fixtures should have _distanceMiles ~1
  const pgFixture = rowsCoordsArr.find(r => r.title === '[FIXTURE-2b] Multi-day planner-grade');
  check(
    'Planner-grade fixture has _distanceMiles annotation (~1mi from driver)',
    pgFixture && pgFixture._distanceMiles != null && pgFixture._distanceMiles < 5,
    pgFixture ? `actual: ${pgFixture._distanceMiles?.toFixed(2)}mi` : 'fixture not found'
  );
} catch (err) {
  console.error(`\nTest error: ${err.message}\n${err.stack}`);
  failures++;
} finally {
  await cleanup();
  console.log(`\n${failures === 0 ? '✓ All tests passed' : `✗ ${failures} test(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
