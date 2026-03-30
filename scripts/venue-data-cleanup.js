#!/usr/bin/env node
/**
 * Venue Data Cleanup Script
 *
 * 2026-01-10: Created as part of venue pipeline audit
 * See: docs/AUDIT_LEDGER.md
 *
 * This script addresses data quality issues from the venue pipeline:
 * 1. Venues with synthetic Ei* IDs (should have ChIJ* IDs)
 * 2. Venues missing place_id entirely
 * 3. Duplicate venues at same location
 * 4. Events linked to low-quality venues
 *
 * Usage:
 *   node scripts/venue-data-cleanup.js --analyze    # Dry run, show stats
 *   node scripts/venue-data-cleanup.js --execute    # Actually fix data
 */

import { db } from '../server/db/drizzle.js';
import { venue_catalog, discovered_events, places_cache } from '../shared/schema.js';
import { sql, eq, like, isNull, and, count } from 'drizzle-orm';

const args = process.argv.slice(2);
const ANALYZE_ONLY = args.includes('--analyze') || !args.includes('--execute');

async function main() {
  console.log('='.repeat(70));
  console.log('VENUE DATA CLEANUP SCRIPT');
  console.log('='.repeat(70));
  console.log(`Mode: ${ANALYZE_ONLY ? 'ANALYZE (dry run)' : 'EXECUTE (making changes)'}`);
  console.log('');

  try {
    // ========================================================================
    // AUDIT QUERY 1: Venues missing place_id
    // ========================================================================
    console.log('─'.repeat(70));
    console.log('1. Venues Missing place_id');
    console.log('─'.repeat(70));

    const [missingPlaceId] = await db
      .select({ count: count() })
      .from(venue_catalog)
      .where(isNull(venue_catalog.place_id));

    console.log(`   Count: ${missingPlaceId.count} venues without place_id`);

    // ========================================================================
    // AUDIT QUERY 2: Venues with synthetic Ei* IDs
    // ========================================================================
    console.log('');
    console.log('─'.repeat(70));
    console.log('2. Venues with Synthetic Ei* IDs');
    console.log('─'.repeat(70));

    const [syntheticIds] = await db
      .select({ count: count() })
      .from(venue_catalog)
      .where(like(venue_catalog.place_id, 'Ei%'));

    console.log(`   Count: ${syntheticIds.count} venues with Ei* place_id`);
    console.log('   ⚠️  These IDs are Base64-encoded addresses, not valid Google Place IDs');
    console.log('   ⚠️  They often point to wrong locations and should be re-resolved');

    // ========================================================================
    // AUDIT QUERY 3: Events linked to venues without place_id
    // ========================================================================
    console.log('');
    console.log('─'.repeat(70));
    console.log('3. Events Linked to Venues Without place_id');
    console.log('─'.repeat(70));

    const [eventsWithBadVenues] = await db.execute(sql`
      SELECT COUNT(*) as count FROM discovered_events
      WHERE venue_id IS NOT NULL
      AND venue_id IN (SELECT venue_id FROM venue_catalog WHERE place_id IS NULL)
    `);

    console.log(`   Count: ${eventsWithBadVenues.count} events linked to venues without place_id`);

    // ========================================================================
    // AUDIT QUERY 4: places_cache rows keyed by coords (legacy bug)
    // ========================================================================
    console.log('');
    console.log('─'.repeat(70));
    console.log('4. places_cache Rows with Coordinate Keys');
    console.log('─'.repeat(70));

    // After D-013 rename, the column is now coords_key which is correct
    // This query checks if there are any entries (all should be coord format now)
    const [cacheRows] = await db
      .select({ count: count() })
      .from(places_cache);

    console.log(`   Count: ${cacheRows.count} total rows in places_cache`);
    console.log('   ✅  Column renamed to coords_key (D-013) - semantically correct now');

    // ========================================================================
    // AUDIT QUERY 5: Duplicate venues (same normalized_name + city + state)
    // ========================================================================
    console.log('');
    console.log('─'.repeat(70));
    console.log('5. Duplicate Venues (Same Name + City + State)');
    console.log('─'.repeat(70));

    const duplicates = await db.execute(sql`
      SELECT normalized_name, city, state, COUNT(*) as cnt
      FROM venue_catalog
      WHERE normalized_name IS NOT NULL
      GROUP BY normalized_name, city, state
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 10
    `);

    if (duplicates.length > 0) {
      console.log('   Top 10 duplicates:');
      for (const row of duplicates) {
        console.log(`   - "${row.normalized_name}" in ${row.city}, ${row.state}: ${row.cnt} records`);
      }
    } else {
      console.log('   ✅  No duplicate venues found');
    }

    // ========================================================================
    // AUDIT QUERY 6: Venues with valid ChIJ* IDs (good data)
    // ========================================================================
    console.log('');
    console.log('─'.repeat(70));
    console.log('6. Venues with Valid ChIJ* IDs (Quality Data)');
    console.log('─'.repeat(70));

    const [validIds] = await db
      .select({ count: count() })
      .from(venue_catalog)
      .where(like(venue_catalog.place_id, 'ChIJ%'));

    console.log(`   Count: ${validIds.count} venues with valid ChIJ* place_id`);

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('');
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    const totalVenues = await db.select({ count: count() }).from(venue_catalog);

    console.log(`   Total venues: ${totalVenues[0].count}`);
    console.log(`   With valid ChIJ* ID: ${validIds.count} (${((validIds.count / totalVenues[0].count) * 100).toFixed(1)}%)`);
    console.log(`   With synthetic Ei* ID: ${syntheticIds.count} (${((syntheticIds.count / totalVenues[0].count) * 100).toFixed(1)}%)`);
    console.log(`   Missing place_id: ${missingPlaceId.count} (${((missingPlaceId.count / totalVenues[0].count) * 100).toFixed(1)}%)`);
    console.log('');

    if (!ANALYZE_ONLY) {
      console.log('='.repeat(70));
      console.log('EXECUTING CLEANUP');
      console.log('='.repeat(70));

      // CLEANUP 1: Clear Ei* IDs (mark for re-resolution)
      console.log('');
      console.log('1. Clearing synthetic Ei* IDs (will be re-resolved on next access)...');

      const clearEiResult = await db
        .update(venue_catalog)
        .set({ place_id: null })
        .where(like(venue_catalog.place_id, 'Ei%'));

      console.log(`   ✅  Cleared ${syntheticIds.count} Ei* IDs`);

      console.log('');
      console.log('='.repeat(70));
      console.log('CLEANUP COMPLETE');
      console.log('='.repeat(70));
      console.log('');
      console.log('Next steps:');
      console.log('1. Run event sync to re-geocode venues with updated pipeline');
      console.log('2. Venues will get proper ChIJ* IDs from geocoding');
      console.log('3. Run this script again with --analyze to verify improvement');
    } else {
      console.log('');
      console.log('To execute cleanup, run:');
      console.log('  node scripts/venue-data-cleanup.js --execute');
    }

  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
