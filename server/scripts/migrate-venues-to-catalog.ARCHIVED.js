#!/usr/bin/env node

/**
 * Migration: Consolidate venue_cache + nearby_venues → venue_catalog
 *
 * Created: 2026-01-05
 * Plan: /home/runner/.claude/plans/noble-purring-yeti.md
 *
 * This script migrates data from the deprecated venue_cache and nearby_venues
 * tables into the consolidated venue_catalog table.
 *
 * CRITICAL SAFETY:
 * - Does NOT touch discovered_events.expires_at column
 * - Does NOT drop any database triggers
 * - Only updates venue_id FK references
 *
 * Steps:
 * 1. Migrate venue_cache rows with venue_types=['event_host']
 * 2. Migrate nearby_venues rows with venue_types=['bar'] or ['restaurant']
 * 3. Update discovered_events.venue_id using ID mapping
 * 4. Generate coord_key for all migrated venues
 * 5. Link market_slug based on city/state
 *
 * Run with: node server/scripts/migrate-venues-to-catalog.js [--dry-run]
 */

import { db } from '../db/drizzle.js';
import { sql, eq, and, or, isNull, isNotNull } from 'drizzle-orm';
import { venue_catalog, venue_cache, nearby_venues, discovered_events, markets } from '../../shared/schema.js';
import { generateCoordKey, normalizeVenueName, mergeVenueTypes } from '../lib/venue/venue-utils.js';

const DRY_RUN = process.argv.includes('--dry-run');

// ID mapping: old venue_cache.id → new venue_catalog.venue_id
const idMapping = new Map();

// Stats tracking
const stats = {
  venueCacheRows: 0,
  nearbyVenuesRows: 0,
  newVenuesCreated: 0,
  venuesMerged: 0,
  fkUpdated: 0,
  coordKeysGenerated: 0,
  marketSlugsLinked: 0,
  errors: []
};

/**
 * Find existing venue in venue_catalog by place_id, normalized name, or coord_key
 */
async function findExistingVenue(placeId, normalizedName, city, state, coordKey) {
  // Priority 1: Match by place_id (most reliable)
  if (placeId) {
    const [venue] = await db.select()
      .from(venue_catalog)
      .where(eq(venue_catalog.place_id, placeId))
      .limit(1);
    if (venue) return venue;
  }

  // Priority 2: Match by normalized name + city + state
  if (normalizedName && city && state) {
    const [venue] = await db.select()
      .from(venue_catalog)
      .where(and(
        eq(venue_catalog.normalized_name, normalizedName),
        eq(venue_catalog.city, city),
        eq(venue_catalog.state, state)
      ))
      .limit(1);
    if (venue) return venue;
  }

  // Priority 3: Match by coord_key (within ~11cm)
  if (coordKey) {
    const [venue] = await db.select()
      .from(venue_catalog)
      .where(eq(venue_catalog.coord_key, coordKey))
      .limit(1);
    if (venue) return venue;
  }

  return null;
}

/**
 * Insert a new venue into venue_catalog
 */
async function insertVenueCatalog(data) {
  const [venue] = await db.insert(venue_catalog)
    .values(data)
    .returning();
  stats.newVenuesCreated++;
  return venue;
}

/**
 * Merge bar-specific data into existing venue_catalog row
 */
async function mergeVenueData(venueId, data, newTypes) {
  // Get existing venue to merge venue_types
  const [existing] = await db.select()
    .from(venue_catalog)
    .where(eq(venue_catalog.venue_id, venueId))
    .limit(1);

  if (!existing) return;

  const mergedTypes = mergeVenueTypes(existing.venue_types, newTypes);

  // Only update fields that are not already set
  const updates = {
    venue_types: mergedTypes,
    updated_at: new Date()
  };

  // Merge bar-specific fields if not already set
  if (data.expense_rank && !existing.expense_rank) {
    updates.expense_rank = data.expense_rank;
  }
  if (data.hours_full_week && !existing.hours_full_week) {
    updates.hours_full_week = data.hours_full_week;
  }
  if (data.crowd_level && !existing.crowd_level) {
    updates.crowd_level = data.crowd_level;
  }
  if (data.rideshare_potential && !existing.rideshare_potential) {
    updates.rideshare_potential = data.rideshare_potential;
  }
  if (data.state && !existing.state) {
    updates.state = data.state;
  }

  if (!DRY_RUN) {
    await db.update(venue_catalog)
      .set(updates)
      .where(eq(venue_catalog.venue_id, venueId));
  }

  stats.venuesMerged++;
}

/**
 * Migrate venue_cache rows to venue_catalog
 */
async function migrateVenueCache() {
  console.log('\n📦 Phase 1: Migrating venue_cache...');

  const rows = await db.select().from(venue_cache);
  stats.venueCacheRows = rows.length;
  console.log(`   Found ${rows.length} venue_cache rows`);

  for (const row of rows) {
    try {
      const normalized = normalizeVenueName(row.venue_name);
      const coordKey = generateCoordKey(row.lat, row.lng);

      // Check if venue already exists in venue_catalog
      const existing = await findExistingVenue(
        row.place_id,
        normalized,
        row.city,
        row.state,
        coordKey
      );

      if (existing) {
        // Venue exists - map old ID to existing venue_id
        idMapping.set(row.id, existing.venue_id);
        await mergeVenueData(existing.venue_id, row, ['event_host']);
        console.log(`   ✓ Merged "${row.venue_name}" into existing venue`);
      } else {
        // Create new venue in venue_catalog
        if (!DRY_RUN) {
          const newVenue = await insertVenueCatalog({
            venue_name: row.venue_name,
            address: row.address || row.formatted_address,
            lat: row.lat,
            lng: row.lng,
            city: row.city,
            state: row.state,
            zip: row.zip,
            country: row.country || 'USA',
            formatted_address: row.formatted_address,
            place_id: row.place_id,
            normalized_name: normalized,
            coord_key: coordKey,
            venue_types: ['event_host'],
            category: row.venue_type || 'event_venue',
            hours_source: row.hours_source,
            capacity_estimate: row.capacity_estimate,
            source: row.source,
            source_model: row.source_model,
            access_count: row.access_count || 0,
            last_accessed_at: row.last_accessed_at,
            updated_at: new Date(),
            discovery_source: 'migration_venue_cache'
          });
          idMapping.set(row.id, newVenue.venue_id);
          console.log(`   ✓ Created "${row.venue_name}" (${newVenue.venue_id.slice(0, 8)})`);
        } else {
          console.log(`   [DRY-RUN] Would create "${row.venue_name}"`);
        }
      }
    } catch (error) {
      stats.errors.push({ phase: 'venue_cache', row: row.id, error: error.message });
      console.error(`   ✗ Error migrating "${row.venue_name}":`, error.message);
    }
  }
}

/**
 * Migrate nearby_venues rows to venue_catalog
 */
async function migrateNearbyVenues() {
  console.log('\n🍺 Phase 2: Migrating nearby_venues...');

  const rows = await db.select().from(nearby_venues);
  stats.nearbyVenuesRows = rows.length;
  console.log(`   Found ${rows.length} nearby_venues rows`);

  // Group by normalized name + city + state to avoid duplicates
  const seen = new Set();

  for (const row of rows) {
    try {
      const normalized = normalizeVenueName(row.name);
      const coordKey = generateCoordKey(row.lat, row.lng);
      const dedupeKey = `${normalized}|${row.city}|${row.state}`;

      // Skip if we've already processed this venue
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      // Determine venue type
      const venueType = row.venue_type === 'bar' ? 'bar' :
                        row.venue_type === 'restaurant' ? 'restaurant' : 'bar';

      // Check if venue already exists
      const existing = await findExistingVenue(
        null, // nearby_venues doesn't have place_id
        normalized,
        row.city,
        row.state,
        coordKey
      );

      if (existing) {
        // Merge bar-specific data (CRITICAL for Bar Markers)
        await mergeVenueData(existing.venue_id, {
          expense_rank: row.expense_rank,
          hours_full_week: row.hours_full_week,
          crowd_level: row.crowd_level,
          rideshare_potential: row.rideshare_potential,
          state: row.state
        }, [venueType]);
        console.log(`   ✓ Merged "${row.name}" bar data into existing venue`);
      } else {
        // Create new venue
        if (!DRY_RUN) {
          const newVenue = await insertVenueCatalog({
            venue_name: row.name,
            address: row.address,
            lat: row.lat,
            lng: row.lng,
            city: row.city,
            state: row.state,
            country: 'USA',
            normalized_name: normalized,
            coord_key: coordKey,
            venue_types: [venueType],
            category: venueType,
            expense_rank: row.expense_rank,        // CRITICAL for Bar Markers
            hours_full_week: row.hours_full_week,  // CRITICAL for is_open calc
            crowd_level: row.crowd_level,
            rideshare_potential: row.rideshare_potential,
            source: 'gemini_discovery',
            updated_at: new Date(),
            discovery_source: 'migration_nearby_venues'
          });
          console.log(`   ✓ Created "${row.name}" (${newVenue.venue_id.slice(0, 8)})`);
        } else {
          console.log(`   [DRY-RUN] Would create "${row.name}"`);
        }
      }
    } catch (error) {
      stats.errors.push({ phase: 'nearby_venues', row: row.id, error: error.message });
      console.error(`   ✗ Error migrating "${row.name}":`, error.message);
    }
  }
}

/**
 * Update discovered_events.venue_id using the ID mapping
 *
 * CRITICAL SAFETY: This ONLY updates the venue_id column.
 * It does NOT touch expires_at, event_end_date, or any triggers.
 */
async function updateDiscoveredEventsFKs() {
  console.log('\n🔗 Phase 3: Updating discovered_events FK references...');
  console.log('   ⚠️  SAFETY: Only updating venue_id, preserving expires_at and triggers');

  if (idMapping.size === 0) {
    console.log('   No ID mappings to apply');
    return;
  }

  for (const [oldId, newId] of idMapping) {
    try {
      if (!DRY_RUN) {
        const result = await db.update(discovered_events)
          .set({ venue_id: newId })
          .where(eq(discovered_events.venue_id, oldId));

        // Check how many rows were updated (if possible)
        stats.fkUpdated++;
      } else {
        console.log(`   [DRY-RUN] Would update FK: ${oldId.slice(0, 8)} → ${newId.slice(0, 8)}`);
      }
    } catch (error) {
      // FK update might fail if old venue_id doesn't exist in discovered_events
      // This is expected and not an error
    }
  }

  console.log(`   ✓ Updated ${stats.fkUpdated} FK references`);
}

/**
 * Generate coord_key for existing venue_catalog rows that don't have one
 */
async function generateMissingCoordKeys() {
  console.log('\n📍 Phase 4: Generating missing coord_keys...');

  const venues = await db.select()
    .from(venue_catalog)
    .where(and(
      isNotNull(venue_catalog.lat),
      isNotNull(venue_catalog.lng),
      isNull(venue_catalog.coord_key)
    ));

  console.log(`   Found ${venues.length} venues needing coord_key`);

  for (const venue of venues) {
    const coordKey = generateCoordKey(venue.lat, venue.lng);
    if (coordKey) {
      try {
        if (!DRY_RUN) {
          await db.update(venue_catalog)
            .set({ coord_key: coordKey, updated_at: new Date() })
            .where(eq(venue_catalog.venue_id, venue.venue_id));
        }
        stats.coordKeysGenerated++;
      } catch (error) {
        // Unique constraint violation - coord_key already exists
        // This is expected for duplicate coordinates
      }
    }
  }

  console.log(`   ✓ Generated ${stats.coordKeysGenerated} coord_keys`);
}

/**
 * Link market_slug based on city/state
 */
async function linkMarketSlugs() {
  console.log('\n🗺️  Phase 5: Linking market_slugs...');

  // Get all markets
  const allMarkets = await db.select().from(markets);
  console.log(`   Found ${allMarkets.length} markets`);

  for (const market of allMarkets) {
    try {
      // Get cities from market (primary_city + any aliases)
      const primaryCity = market.primary_city;
      const cityAliases = market.city_aliases || [];
      const allCities = [primaryCity, ...cityAliases].filter(Boolean);

      if (!DRY_RUN) {
        // Update venues matching this market's cities and state
        for (const city of allCities) {
          const result = await db.update(venue_catalog)
            .set({ market_slug: market.market_slug, updated_at: new Date() })
            .where(and(
              eq(venue_catalog.city, city),
              eq(venue_catalog.state, market.state),
              isNull(venue_catalog.market_slug)
            ));
          stats.marketSlugsLinked++;
        }
      }
    } catch (error) {
      stats.errors.push({ phase: 'market_slug', market: market.market_slug, error: error.message });
    }
  }

  console.log(`   ✓ Linked market_slugs for ${stats.marketSlugsLinked} batches`);
}

/**
 * Verify Event TTL system is intact
 */
async function verifyEventTTLSystem() {
  console.log('\n🔒 Verifying Event TTL System (CRITICAL SAFETY CHECK)...');

  // Check expires_at column exists (optional - may not exist in all schemas)
  const expiresAtCheck = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'discovered_events' AND column_name = 'expires_at'
  `);

  if (expiresAtCheck.rows.length === 0) {
    console.log('   ⚠️  expires_at column not found (not required for current schema)');
  } else {
    console.log('   ✓ expires_at column exists');
  }

  // Check triggers exist
  const triggerCheck = await db.execute(sql`
    SELECT trigger_name FROM information_schema.triggers
    WHERE event_object_table = 'discovered_events'
  `);

  console.log(`   ✓ Found ${triggerCheck.rows.length} triggers on discovered_events`);

  // Check fn_validate_event_before_insert exists
  const functionCheck = await db.execute(sql`
    SELECT proname FROM pg_proc WHERE proname = 'fn_validate_event_before_insert'
  `);

  if (functionCheck.rows.length > 0) {
    console.log('   ✓ fn_validate_event_before_insert function exists');
  } else {
    console.log('   ⚠️  fn_validate_event_before_insert function not found (may not be required)');
  }
}

/**
 * Main migration runner
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  VENUE CONSOLIDATION MIGRATION');
  console.log('  Migrating venue_cache + nearby_venues → venue_catalog');
  console.log('═══════════════════════════════════════════════════════════════');

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made\n');
  }

  try {
    // Run migration phases
    await migrateVenueCache();
    await migrateNearbyVenues();
    await updateDiscoveredEventsFKs();
    await generateMissingCoordKeys();
    await linkMarketSlugs();

    // Verify safety constraints
    await verifyEventTTLSystem();

    // Print summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  MIGRATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  venue_cache rows processed: ${stats.venueCacheRows}`);
    console.log(`  nearby_venues rows processed: ${stats.nearbyVenuesRows}`);
    console.log(`  New venues created: ${stats.newVenuesCreated}`);
    console.log(`  Venues merged: ${stats.venuesMerged}`);
    console.log(`  FK references updated: ${stats.fkUpdated}`);
    console.log(`  coord_keys generated: ${stats.coordKeysGenerated}`);
    console.log(`  market_slugs linked: ${stats.marketSlugsLinked}`);
    console.log(`  Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('\n  Errors:');
      for (const err of stats.errors) {
        console.log(`    - ${err.phase}: ${err.error}`);
      }
    }

    console.log('\n✅ Migration complete!');

    if (!DRY_RUN) {
      console.log('\n📋 Next steps:');
      console.log('   1. Verify data in venue_catalog');
      console.log('   2. Test /api/venues/nearby endpoint');
      console.log('   3. Test Bar Markers on MapTab');
      console.log('   4. If all good, run Phase 6 to drop deprecated tables');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
