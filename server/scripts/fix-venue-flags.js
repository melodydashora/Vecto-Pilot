#!/usr/bin/env node
/**
 * fix-venue-flags.js - Progressive Enrichment Backfill Script
 *
 * 2026-01-14: Created for Progressive Enrichment Architecture
 *
 * Purpose: Classify existing venues in venue_catalog with proper flags:
 *   - is_bar: true for venues with bar-related types or expense_rank
 *   - is_event_venue: true for venues with linked discovered_events
 *   - record_status: 'stub', 'enriched', or 'verified' based on data completeness
 *
 * Usage:
 *   node server/scripts/fix-venue-flags.js           # Dry run (shows what would change)
 *   node server/scripts/fix-venue-flags.js --apply   # Apply changes
 *
 * Safety:
 *   - Uses "Best Write Wins" logic (OR for booleans, MAX for status)
 *   - Never overwrites existing true flags or higher status
 *   - Can be run multiple times safely (idempotent)
 */

import 'dotenv/config';
import { db } from '../db/drizzle.js';
import { venue_catalog, discovered_events } from '../../shared/schema.js';
import { eq, sql, isNotNull, or, and, gt } from 'drizzle-orm';

// Bar-related venue types that indicate is_bar=true
const BAR_TYPES = ['bar', 'nightclub', 'wine_bar', 'cocktail_bar', 'pub', 'lounge', 'tavern', 'brewery'];

async function main() {
  const dryRun = !process.argv.includes('--apply');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Progressive Enrichment Backfill Script');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --apply to execute)' : 'APPLYING CHANGES'}`);
  console.log('');

  // Stats tracking
  const stats = {
    totalVenues: 0,
    barsSet: 0,
    eventVenuesSet: 0,
    statusUpgraded: 0
  };

  // ═══════════════════════════════════════════════════════════════
  // Phase 1: Mark bars (is_bar = true)
  // ═══════════════════════════════════════════════════════════════
  console.log('Phase 1: Identifying bars...');

  // Query 1a: Venues with expense_rank (bar marker feature uses this)
  const barsWithExpenseRank = await db
    .select({ venue_id: venue_catalog.venue_id, venue_name: venue_catalog.venue_name })
    .from(venue_catalog)
    .where(and(
      isNotNull(venue_catalog.expense_rank),
      gt(venue_catalog.expense_rank, 0),
      eq(venue_catalog.is_bar, false) // Only unset ones
    ));

  console.log(`  Found ${barsWithExpenseRank.length} venues with expense_rank (not yet marked as bars)`);

  // Query 1b: Venues with bar-related types in venue_types JSONB
  const barsWithTypes = await db
    .select({ venue_id: venue_catalog.venue_id, venue_name: venue_catalog.venue_name })
    .from(venue_catalog)
    .where(and(
      sql`venue_types ?| array[${sql.join(BAR_TYPES.map(t => sql`${t}`), sql`, `)}]`,
      eq(venue_catalog.is_bar, false) // Only unset ones
    ));

  console.log(`  Found ${barsWithTypes.length} venues with bar-related types (not yet marked as bars)`);

  // Combine unique venue IDs
  const barVenueIds = new Set([
    ...barsWithExpenseRank.map(v => v.venue_id),
    ...barsWithTypes.map(v => v.venue_id)
  ]);

  console.log(`  Total unique bars to mark: ${barVenueIds.size}`);

  if (!dryRun && barVenueIds.size > 0) {
    // Use batch update with ANY array
    const result = await db.execute(sql`
      UPDATE venue_catalog
      SET is_bar = true, updated_at = NOW()
      WHERE venue_id = ANY(${Array.from(barVenueIds)})
        AND is_bar = false
    `);
    console.log(`  ✅ Updated ${barVenueIds.size} venues to is_bar=true`);
    stats.barsSet = barVenueIds.size;
  } else if (dryRun && barVenueIds.size > 0) {
    console.log(`  [DRY RUN] Would set is_bar=true for ${barVenueIds.size} venues`);
    stats.barsSet = barVenueIds.size;
  }

  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: Mark event venues (is_event_venue = true)
  // ═══════════════════════════════════════════════════════════════
  console.log('Phase 2: Identifying event venues...');

  // Find venues with linked events that aren't yet marked
  const eventVenues = await db
    .selectDistinct({ venue_id: discovered_events.venue_id })
    .from(discovered_events)
    .where(isNotNull(discovered_events.venue_id));

  const eventVenueIds = eventVenues.map(v => v.venue_id).filter(Boolean);
  console.log(`  Found ${eventVenueIds.length} venues with linked events`);

  // Get the ones not already marked (skip if no event venues)
  let unmarkedEventVenues = [];
  if (eventVenueIds.length > 0) {
    unmarkedEventVenues = await db
      .select({ venue_id: venue_catalog.venue_id })
      .from(venue_catalog)
      .where(and(
        sql`venue_id = ANY(${eventVenueIds})`,
        eq(venue_catalog.is_event_venue, false)
      ));
  }

  console.log(`  Of those, ${unmarkedEventVenues.length} not yet marked as event venues`);

  if (!dryRun && unmarkedEventVenues.length > 0) {
    const idsToUpdate = unmarkedEventVenues.map(v => v.venue_id);
    await db.execute(sql`
      UPDATE venue_catalog
      SET is_event_venue = true, updated_at = NOW()
      WHERE venue_id = ANY(${idsToUpdate})
        AND is_event_venue = false
    `);
    console.log(`  ✅ Updated ${unmarkedEventVenues.length} venues to is_event_venue=true`);
    stats.eventVenuesSet = unmarkedEventVenues.length;
  } else if (dryRun && unmarkedEventVenues.length > 0) {
    console.log(`  [DRY RUN] Would set is_event_venue=true for ${unmarkedEventVenues.length} venues`);
    stats.eventVenuesSet = unmarkedEventVenues.length;
  }

  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // Phase 3: Upgrade record_status based on data completeness
  // ═══════════════════════════════════════════════════════════════
  console.log('Phase 3: Upgrading record_status...');

  // 3a: Venues with hours_full_week (bar markers) = verified
  const verifiedCandidates = await db
    .select({ venue_id: venue_catalog.venue_id })
    .from(venue_catalog)
    .where(and(
      isNotNull(venue_catalog.hours_full_week),
      or(
        eq(venue_catalog.record_status, 'stub'),
        eq(venue_catalog.record_status, 'enriched')
      )
    ));

  console.log(`  Found ${verifiedCandidates.length} venues with hours_full_week (candidates for 'verified')`);

  if (!dryRun && verifiedCandidates.length > 0) {
    const idsToUpdate = verifiedCandidates.map(v => v.venue_id);
    await db.execute(sql`
      UPDATE venue_catalog
      SET record_status = 'verified', updated_at = NOW()
      WHERE venue_id = ANY(${idsToUpdate})
        AND record_status IN ('stub', 'enriched')
    `);
    console.log(`  ✅ Upgraded ${verifiedCandidates.length} venues to record_status='verified'`);
    stats.statusUpgraded += verifiedCandidates.length;
  } else if (dryRun && verifiedCandidates.length > 0) {
    console.log(`  [DRY RUN] Would upgrade ${verifiedCandidates.length} venues to 'verified'`);
    stats.statusUpgraded += verifiedCandidates.length;
  }

  // 3b: Venues with place_id or expense_rank but no hours = enriched
  const enrichedCandidates = await db
    .select({ venue_id: venue_catalog.venue_id })
    .from(venue_catalog)
    .where(and(
      eq(venue_catalog.record_status, 'stub'),
      or(
        isNotNull(venue_catalog.place_id),
        and(isNotNull(venue_catalog.expense_rank), gt(venue_catalog.expense_rank, 0))
      )
    ));

  console.log(`  Found ${enrichedCandidates.length} stub venues with place_id/expense_rank (candidates for 'enriched')`);

  if (!dryRun && enrichedCandidates.length > 0) {
    const idsToUpdate = enrichedCandidates.map(v => v.venue_id);
    await db.execute(sql`
      UPDATE venue_catalog
      SET record_status = 'enriched', updated_at = NOW()
      WHERE venue_id = ANY(${idsToUpdate})
        AND record_status = 'stub'
    `);
    console.log(`  ✅ Upgraded ${enrichedCandidates.length} venues to record_status='enriched'`);
    stats.statusUpgraded += enrichedCandidates.length;
  } else if (dryRun && enrichedCandidates.length > 0) {
    console.log(`  [DRY RUN] Would upgrade ${enrichedCandidates.length} venues to 'enriched'`);
    stats.statusUpgraded += enrichedCandidates.length;
  }

  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Bars marked (is_bar=true):         ${stats.barsSet}`);
  console.log(`  Event venues marked:               ${stats.eventVenuesSet}`);
  console.log(`  Record status upgraded:            ${stats.statusUpgraded}`);
  console.log('');

  if (dryRun) {
    console.log('  ⚠️  DRY RUN - No changes were made');
    console.log('  Run with --apply to execute these changes');
  } else {
    console.log('  ✅ All changes applied successfully');
  }
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
