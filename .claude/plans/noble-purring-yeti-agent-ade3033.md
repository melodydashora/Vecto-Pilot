# Venue Architecture Consolidation Plan

**Created:** 2026-01-05
**Status:** Planning Complete
**Author:** Claude Opus 4.5 (Architecture Planning Agent)

---

## Executive Summary

This plan consolidates three venue-related tables (`venue_catalog`, `venue_cache`, `nearby_venues`) into a single unified `venue_catalog` table. The goal is to eliminate data duplication, simplify the codebase, and create a single source of truth for all venue data.

---

## 1. Current State Analysis

### 1.1 Tables to Consolidate

| Table | Lines in schema.js | Purpose | Key Fields |
|-------|-------------------|---------|------------|
| `venue_catalog` | 226-256 | Master venue table (seed + validated) | place_id, venue_name, address, lat, lng, category, district, business_hours |
| `venue_cache` | 318-368 | Event venue deduplication cache | id, place_id, normalized_name, city, state, lat, lng, coord_key (4-decimal), venue_type |
| `nearby_venues` | 639-679 | Snapshot-scoped bar/restaurant discovery | snapshot_id (FK), name, venue_type, address, lat, lng, is_open, hours_today |

### 1.2 Current Foreign Key Relationships

```
discovered_events.venue_id → venue_cache.id (ON DELETE SET NULL)
nearby_venues.snapshot_id → snapshots.snapshot_id (ON DELETE CASCADE)
venue_metrics.venue_id → venue_catalog.venue_id
llm_venue_suggestions.venue_id_created → venue_catalog.venue_id
```

### 1.3 Files Currently Using These Tables

**venue_cache:**
- `/home/runner/workspace/server/lib/venue/venue-cache.js` (lines 6, 67-68, 83-88, 100-103, 187-212, 226-266, 277-281, 291-298, 314-328, 344-382)
- `/home/runner/workspace/server/scripts/sync-events.mjs` (line 22, 116-140)
- `/home/runner/workspace/shared/schema.js` (line 579 - FK in discovered_events)

**nearby_venues:**
- `/home/runner/workspace/server/lib/venue/venue-intelligence.js` (lines 7, 493-542)

**venue_catalog:**
- `/home/runner/workspace/server/lib/venue/district-detection.js` (lines 17, 201-218, 227-236)
- `/home/runner/workspace/server/lib/ai/coach-dal.js` (line 12)
- `/home/runner/workspace/server/scripts/seed-dfw-venues.js`
- `/home/runner/workspace/server/api/feedback/actions.js`
- `/home/runner/workspace/server/api/health/diagnostics.js`

---

## 2. Target Schema Design

### 2.1 Enhanced venue_catalog Table

```javascript
export const venue_catalog = pgTable("venue_catalog", {
  // === IDENTITY ===
  venue_id: uuid("venue_id").primaryKey().defaultRandom(),
  place_id: text("place_id").unique(),
  venue_name: varchar('venue_name', { length: 500 }).notNull(),
  normalized_name: text("normalized_name").notNull(), // NEW: lowercase, alphanumeric for fuzzy matching
  
  // === GRANULAR ADDRESS (NEW) ===
  address_1: text("address_1"),           // NEW: Street address line 1
  address_2: text("address_2"),           // NEW: Street address line 2 (suite, unit)
  city: text("city"),
  state: text("state"),
  zip: text("zip"),                       // NEW: ZIP/postal code
  country: text("country").default('USA'), // NEW: Country code
  formatted_address: text("formatted_address"), // NEW: Full Google-formatted address
  
  // === LEGACY ADDRESS (kept for backward compat during migration) ===
  address: varchar('address', { length: 500 }), // Will be deprecated after migration
  
  // === COORDINATES ===
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  coord_key: text("coord_key"),           // NEW: 6-decimal precision "33.123456_-96.123456"
  
  // === CATEGORIZATION ===
  category: text("category").notNull(),   // Primary identity: 'bar', 'restaurant', 'arena', 'stadium', etc.
  venue_types: jsonb("venue_types").default(sql`'[]'`), // NEW: Tags like ['bar', 'event_host', 'restaurant']
  
  // === MARKET LINKAGE (NEW) ===
  market_slug: text("market_slug"),       // NEW: FK to markets.market_slug
  
  // === DISTRICT DATA (existing) ===
  district: text("district"),
  district_slug: text("district_slug"),
  district_centroid_lat: doublePrecision("district_centroid_lat"),
  district_centroid_lng: doublePrecision("district_centroid_lng"),
  
  // === BUSINESS HOURS ===
  business_hours: jsonb("business_hours"),
  ai_estimated_hours: text("ai_estimated_hours"),
  hours_source: text("hours_source"),     // NEW: 'google_places', 'manual', 'inferred'
  
  // === CAPACITY (NEW from venue_cache) ===
  capacity_estimate: integer("capacity_estimate"),
  
  // === METADATA ===
  dayparts: text("dayparts").array(),
  staging_notes: jsonb("staging_notes"),
  metro: text("metro"),
  
  // === BUSINESS STATUS ===
  last_known_status: text("last_known_status").default('unknown'),
  status_checked_at: timestamp("status_checked_at", { withTimezone: true }),
  consecutive_closed_checks: integer("consecutive_closed_checks").default(0),
  auto_suppressed: boolean("auto_suppressed").default(false),
  suppression_reason: text("suppression_reason"),
  
  // === SOURCE TRACKING ===
  discovery_source: text("discovery_source").notNull().default('seed'),
  source_model: text("source_model"),     // NEW: Which AI model discovered this venue
  validated_at: timestamp("validated_at", { withTimezone: true }),
  suggestion_metadata: jsonb("suggestion_metadata"),
  
  // === CACHE MANAGEMENT (NEW from venue_cache) ===
  access_count: integer("access_count").notNull().default(0),
  last_accessed_at: timestamp("last_accessed_at", { withTimezone: true }),
  
  // === TIMESTAMPS ===
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Indexes for fast lookup
  idxPlaceId: sql`create unique index if not exists idx_venue_catalog_place_id on ${table} (place_id) where place_id is not null`,
  idxCoordKey: sql`create index if not exists idx_venue_catalog_coord_key on ${table} (coord_key) where coord_key is not null`,
  idxCityState: sql`create index if not exists idx_venue_catalog_city_state on ${table} (city, state)`,
  idxNormalizedName: sql`create index if not exists idx_venue_catalog_normalized_name on ${table} (normalized_name)`,
  idxMarketSlug: sql`create index if not exists idx_venue_catalog_market_slug on ${table} (market_slug)`,
  idxCategory: sql`create index if not exists idx_venue_catalog_category on ${table} (category)`,
  // Unique constraint: one venue per normalized name + city + state
  uniqueVenue: sql`create unique index if not exists idx_venue_catalog_unique_venue on ${table} (normalized_name, city, state) where normalized_name is not null`,
}));
```

### 2.2 Updated discovered_events FK

```javascript
// Change from:
venue_id: uuid("venue_id").references(() => venue_cache.id, { onDelete: 'set null' }),

// To:
venue_id: uuid("venue_id").references(() => venue_catalog.venue_id, { onDelete: 'set null' }),
```

---

## 3. Implementation Phases

### Phase 1: Schema Extension (Non-Breaking)

**Goal:** Add new columns to venue_catalog without breaking existing functionality.

**Files to Modify:**
1. `/home/runner/workspace/shared/schema.js` (lines 226-256)

**Changes:**
```sql
-- Add new columns to venue_catalog
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS address_1 TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS address_2 TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'USA';
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS formatted_address TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS coord_key TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS venue_types JSONB DEFAULT '[]';
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS market_slug TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS hours_source TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS capacity_estimate INTEGER;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS source_model TEXT;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE venue_catalog ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_venue_catalog_coord_key ON venue_catalog (coord_key) WHERE coord_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_venue_catalog_normalized_name ON venue_catalog (normalized_name);
CREATE INDEX IF NOT EXISTS idx_venue_catalog_market_slug ON venue_catalog (market_slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_catalog_unique_venue ON venue_catalog (normalized_name, city, state) WHERE normalized_name IS NOT NULL;
```

**Test Cases:**
- Verify existing venue_catalog queries still work
- Verify new columns accept data correctly
- Verify indexes are created

---

### Phase 2: Utility Functions

**Goal:** Create shared address parsing and coord_key generation functions.

**New File:** `/home/runner/workspace/server/lib/venue/venue-utils.js`

```javascript
/**
 * VENUE UTILITIES
 * Shared functions for address parsing, normalization, and coord_key generation
 */

/**
 * Normalize a venue name for consistent matching.
 * Removes common prefixes/suffixes, lowercases, strips punctuation.
 * @param {string} name - Raw venue name
 * @returns {string} Normalized name for matching
 */
export function normalizeVenueName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')           // Remove leading "The"
    .replace(/&/g, ' and ')            // AT&T → AT and T → att
    .replace(/[^\w\s]/g, '')           // Remove punctuation
    .replace(/\s+/g, ' ')              // Collapse whitespace
    .trim();
}

/**
 * Generate a 6-decimal coord_key from lat/lng for exact location matching.
 * Format: "33.123456_-96.123456" (~11cm precision)
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string|null} Coordinate key or null if invalid
 */
export function generateCoordKey6(lat, lng) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;
  return `${lat.toFixed(6)}_${lng.toFixed(6)}`;
}

/**
 * Parse Google address_components into granular fields.
 * @param {Array} components - Google Geocoding API address_components
 * @returns {Object} Parsed address fields
 */
export function parseAddressComponents(components) {
  if (!components || !Array.isArray(components)) {
    return { streetNumber: null, streetName: null, city: null, state: null, zipCode: null, country: null };
  }
  
  const getComponent = (type) => {
    const comp = components.find(c => c.types.includes(type));
    return comp ? comp.long_name : null;
  };
  
  const getComponentShort = (type) => {
    const comp = components.find(c => c.types.includes(type));
    return comp ? comp.short_name : null;
  };
  
  return {
    streetNumber: getComponent('street_number'),
    streetName: getComponent('route'),
    city: getComponent('locality') || getComponent('sublocality') || getComponent('administrative_area_level_2'),
    state: getComponent('administrative_area_level_1'),
    stateCode: getComponentShort('administrative_area_level_1'),
    zipCode: getComponent('postal_code'),
    country: getComponent('country'),
    countryCode: getComponentShort('country')
  };
}

/**
 * Build address_1 from street number and name.
 * @param {string} streetNumber
 * @param {string} streetName
 * @returns {string|null} Combined address line 1
 */
export function buildAddress1(streetNumber, streetName) {
  if (!streetNumber && !streetName) return null;
  if (!streetNumber) return streetName;
  if (!streetName) return streetNumber;
  return `${streetNumber} ${streetName}`;
}

/**
 * Infer venue_types array from category and venue name.
 * @param {string} category - Primary category
 * @param {string} venueName - Venue name for hints
 * @returns {Array<string>} Array of venue type tags
 */
export function inferVenueTypes(category, venueName = '') {
  const types = new Set();
  const lower = (venueName || '').toLowerCase();
  
  // Add primary category
  if (category) types.add(category);
  
  // Infer additional types from name
  if (/stadium|arena|amphitheatre|amphitheater/.test(lower)) types.add('event_host');
  if (/bar|pub|tavern|lounge/.test(lower)) types.add('bar');
  if (/restaurant|grill|steakhouse|kitchen|bistro/.test(lower)) types.add('restaurant');
  if (/hotel|resort|inn/.test(lower)) types.add('hotel');
  if (/theater|theatre|playhouse/.test(lower)) types.add('theater');
  if (/club|nightclub/.test(lower)) types.add('nightclub');
  if (/convention|expo/.test(lower)) types.add('convention_center');
  
  return Array.from(types);
}

/**
 * Parse a formatted address string into components (fallback when API components unavailable).
 * @param {string} formattedAddress - Full address string like "123 Main St, Dallas, TX 75001, USA"
 * @returns {Object} Parsed fields (best effort)
 */
export function parseFormattedAddress(formattedAddress) {
  if (!formattedAddress) {
    return { address_1: null, city: null, state: null, zip: null, country: null };
  }
  
  // Split by comma
  const parts = formattedAddress.split(',').map(p => p.trim());
  
  let address_1 = null;
  let city = null;
  let state = null;
  let zip = null;
  let country = null;
  
  // Typical format: "123 Main St, Dallas, TX 75001, USA"
  if (parts.length >= 1) address_1 = parts[0];
  if (parts.length >= 2) city = parts[1];
  if (parts.length >= 3) {
    // "TX 75001" or just "TX"
    const stateZipMatch = parts[2].match(/^([A-Z]{2})\s*(\d{5})?/);
    if (stateZipMatch) {
      state = stateZipMatch[1];
      zip = stateZipMatch[2] || null;
    } else {
      state = parts[2];
    }
  }
  if (parts.length >= 4) country = parts[3];
  
  return { address_1, city, state, zip, country };
}
```

**Test Cases:**
- `normalizeVenueName("The Rustic")` returns `"rustic"`
- `generateCoordKey6(33.123456, -96.654321)` returns `"33.123456_-96.654321"`
- `parseAddressComponents([...])` correctly extracts all fields
- `inferVenueTypes('bar', 'The Rustic Bar & Grill')` returns `['bar', 'restaurant']`

---

### Phase 3: Migration Script

**Goal:** Create a migration script to move data from venue_cache and nearby_venues into venue_catalog.

**New File:** `/home/runner/workspace/server/scripts/migrate-venues.js`

```javascript
/**
 * VENUE MIGRATION SCRIPT
 * 
 * Migrates data from venue_cache and nearby_venues into venue_catalog.
 * Creates ID mapping for discovered_events FK update.
 * 
 * Usage: node server/scripts/migrate-venues.js [--dry-run]
 */

import 'dotenv/config';
import { db } from '../db/drizzle.js';
import { venue_catalog, venue_cache, nearby_venues, discovered_events } from '../../shared/schema.js';
import { eq, sql, isNull, and } from 'drizzle-orm';
import { normalizeVenueName, generateCoordKey6, inferVenueTypes, parseFormattedAddress } from '../lib/venue/venue-utils.js';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * ID MAPPING TABLE (in-memory during migration)
 * Maps old venue_cache.id → new venue_catalog.venue_id
 */
const idMapping = new Map();

/**
 * Step 1: Migrate venue_cache rows to venue_catalog
 */
async function migrateVenueCache() {
  console.log('\n[Step 1] Migrating venue_cache → venue_catalog...');
  
  const cacheRows = await db.select().from(venue_cache);
  console.log(`  Found ${cacheRows.length} rows in venue_cache`);
  
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const row of cacheRows) {
    try {
      // Check if venue already exists in catalog (by place_id or normalized_name+city+state)
      const normalized = normalizeVenueName(row.venue_name);
      
      let existing = null;
      if (row.place_id) {
        [existing] = await db.select().from(venue_catalog)
          .where(eq(venue_catalog.place_id, row.place_id))
          .limit(1);
      }
      
      if (!existing && normalized && row.city && row.state) {
        [existing] = await db.select().from(venue_catalog)
          .where(and(
            eq(venue_catalog.normalized_name, normalized),
            eq(venue_catalog.city, row.city),
            eq(venue_catalog.state, row.state)
          ))
          .limit(1);
      }
      
      if (existing) {
        // Map old ID to existing venue_id
        idMapping.set(row.id, existing.venue_id);
        skipped++;
        continue;
      }
      
      // Parse address into granular fields
      const parsedAddress = parseFormattedAddress(row.formatted_address);
      
      // Create new venue_catalog entry
      const venueData = {
        place_id: row.place_id,
        venue_name: row.venue_name,
        normalized_name: normalized,
        address_1: parsedAddress.address_1 || row.address,
        address_2: null,
        city: row.city,
        state: row.state,
        zip: row.zip || parsedAddress.zip,
        country: row.country || 'USA',
        formatted_address: row.formatted_address,
        address: row.formatted_address || row.address, // Legacy field
        lat: row.lat,
        lng: row.lng,
        coord_key: generateCoordKey6(row.lat, row.lng),
        category: row.venue_type || 'venue',
        venue_types: inferVenueTypes(row.venue_type, row.venue_name),
        business_hours: row.hours,
        hours_source: row.hours_source,
        capacity_estimate: row.capacity_estimate,
        discovery_source: row.source || 'venue_cache_migration',
        source_model: row.source_model,
        access_count: row.access_count || 0,
        last_accessed_at: row.last_accessed_at,
        created_at: row.cached_at || new Date(),
        updated_at: new Date()
      };
      
      if (!DRY_RUN) {
        const [inserted] = await db.insert(venue_catalog)
          .values(venueData)
          .onConflictDoNothing()
          .returning();
        
        if (inserted) {
          idMapping.set(row.id, inserted.venue_id);
          migrated++;
        } else {
          skipped++;
        }
      } else {
        console.log(`  [DRY RUN] Would insert: ${row.venue_name} (${row.city}, ${row.state})`);
        migrated++;
      }
    } catch (err) {
      console.error(`  Error migrating ${row.venue_name}: ${err.message}`);
      errors++;
    }
  }
  
  console.log(`  Results: ${migrated} migrated, ${skipped} skipped (already exist), ${errors} errors`);
  return { migrated, skipped, errors };
}

/**
 * Step 2: Migrate nearby_venues rows to venue_catalog (deduplicated)
 */
async function migrateNearbyVenues() {
  console.log('\n[Step 2] Migrating nearby_venues → venue_catalog (deduplicated)...');
  
  // Get unique venues by name + city + state (nearby_venues has duplicates per snapshot)
  const uniqueVenues = await db.execute(sql`
    SELECT DISTINCT ON (LOWER(name), city, state)
      name, venue_type, address, lat, lng, city, state,
      hours_today, hours_full_week, expense_level, phone
    FROM nearby_venues
    WHERE city IS NOT NULL AND state IS NOT NULL
    ORDER BY LOWER(name), city, state, created_at DESC
  `);
  
  console.log(`  Found ${uniqueVenues.rows.length} unique venues in nearby_venues`);
  
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const row of uniqueVenues.rows) {
    try {
      const normalized = normalizeVenueName(row.name);
      
      // Check if already exists
      const [existing] = await db.select().from(venue_catalog)
        .where(and(
          eq(venue_catalog.normalized_name, normalized),
          eq(venue_catalog.city, row.city),
          eq(venue_catalog.state, row.state)
        ))
        .limit(1);
      
      if (existing) {
        skipped++;
        continue;
      }
      
      // Map venue_type to category and venue_types array
      const venueType = row.venue_type || 'bar';
      const category = venueType === 'bar_restaurant' ? 'bar' : venueType;
      const venueTypes = venueType === 'bar_restaurant' ? ['bar', 'restaurant'] : [venueType];
      
      const venueData = {
        venue_name: row.name,
        normalized_name: normalized,
        address_1: row.address,
        city: row.city,
        state: row.state,
        address: row.address, // Legacy field
        lat: row.lat,
        lng: row.lng,
        coord_key: generateCoordKey6(row.lat, row.lng),
        category: category,
        venue_types: venueTypes,
        business_hours: row.hours_full_week,
        discovery_source: 'nearby_venues_migration',
        created_at: new Date(),
        updated_at: new Date()
      };
      
      if (!DRY_RUN) {
        const [inserted] = await db.insert(venue_catalog)
          .values(venueData)
          .onConflictDoNothing()
          .returning();
        
        if (inserted) migrated++;
        else skipped++;
      } else {
        console.log(`  [DRY RUN] Would insert: ${row.name} (${row.city}, ${row.state})`);
        migrated++;
      }
    } catch (err) {
      console.error(`  Error migrating ${row.name}: ${err.message}`);
      errors++;
    }
  }
  
  console.log(`  Results: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
  return { migrated, skipped, errors };
}

/**
 * Step 3: Update discovered_events.venue_id to point to venue_catalog
 */
async function updateDiscoveredEventsFKs() {
  console.log('\n[Step 3] Updating discovered_events.venue_id foreign keys...');
  
  // Get events that have venue_id pointing to venue_cache
  const eventsWithVenue = await db.select({
    id: discovered_events.id,
    venue_id: discovered_events.venue_id
  }).from(discovered_events).where(sql`venue_id IS NOT NULL`);
  
  console.log(`  Found ${eventsWithVenue.length} events with venue_id`);
  
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  
  for (const event of eventsWithVenue) {
    const newVenueId = idMapping.get(event.venue_id);
    
    if (!newVenueId) {
      notFound++;
      continue;
    }
    
    if (!DRY_RUN) {
      try {
        await db.update(discovered_events)
          .set({ venue_id: newVenueId })
          .where(eq(discovered_events.id, event.id));
        updated++;
      } catch (err) {
        console.error(`  Error updating event ${event.id}: ${err.message}`);
        errors++;
      }
    } else {
      console.log(`  [DRY RUN] Would update event ${event.id}: ${event.venue_id} → ${newVenueId}`);
      updated++;
    }
  }
  
  console.log(`  Results: ${updated} updated, ${notFound} venue mappings not found, ${errors} errors`);
  return { updated, notFound, errors };
}

/**
 * Step 4: Verify migration integrity
 */
async function verifyMigration() {
  console.log('\n[Step 4] Verifying migration integrity...');
  
  // Check venue_catalog count
  const [catalogCount] = await db.execute(sql`SELECT COUNT(*) as count FROM venue_catalog`);
  console.log(`  venue_catalog: ${catalogCount.rows[0].count} rows`);
  
  // Check for events with orphaned venue_ids
  const orphanedEvents = await db.execute(sql`
    SELECT COUNT(*) as count FROM discovered_events de
    WHERE de.venue_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM venue_catalog vc WHERE vc.venue_id = de.venue_id)
  `);
  console.log(`  Orphaned events: ${orphanedEvents.rows[0].count}`);
  
  // Check for duplicate normalized names
  const duplicates = await db.execute(sql`
    SELECT normalized_name, city, state, COUNT(*) as count
    FROM venue_catalog
    WHERE normalized_name IS NOT NULL
    GROUP BY normalized_name, city, state
    HAVING COUNT(*) > 1
  `);
  console.log(`  Duplicate venue names: ${duplicates.rows.length}`);
  
  return {
    catalogCount: parseInt(catalogCount.rows[0].count),
    orphanedEvents: parseInt(orphanedEvents.rows[0].count),
    duplicates: duplicates.rows.length
  };
}

/**
 * Main migration runner
 */
async function runMigration() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VENUE ARCHITECTURE MIGRATION');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  const results = {
    venueCache: await migrateVenueCache(),
    nearbyVenues: await migrateNearbyVenues(),
    eventFKs: await updateDiscoveredEventsFKs(),
    verification: await verifyMigration()
  };
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  venue_cache → venue_catalog: ${results.venueCache.migrated} migrated, ${results.venueCache.skipped} skipped`);
  console.log(`  nearby_venues → venue_catalog: ${results.nearbyVenues.migrated} migrated, ${results.nearbyVenues.skipped} skipped`);
  console.log(`  discovered_events FK updates: ${results.eventFKs.updated} updated`);
  console.log(`  Final venue_catalog count: ${results.verification.catalogCount}`);
  console.log(`  Orphaned events: ${results.verification.orphanedEvents}`);
  console.log(`Completed: ${new Date().toISOString()}`);
  
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - No changes were made. Run without --dry-run to apply.');
  }
  
  return results;
}

// Run migration
runMigration().catch(console.error);
```

**Test Cases:**
- Run with `--dry-run` first to verify logic
- Verify ID mapping is created correctly
- Verify no data loss (count comparison)
- Verify FK updates work correctly

---

### Phase 4: API Refactor (venue-address-resolver.js)

**Goal:** Update to use Google Places API (New) with tighter location bias.

**File to Modify:** `/home/runner/workspace/server/lib/venue/venue-address-resolver.js`

**Key Changes:**
1. Switch from legacy `maps.googleapis.com/maps/api/place/findplacefromtext` to `places.googleapis.com/v1/places:searchText`
2. Use 50m locationBias radius (tighter than current 150m)
3. Parse addressComponents into granular fields
4. Return data ready for venue_catalog insertion

```javascript
// Updated API call
const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types,places.businessStatus,places.currentOpeningHours'
  },
  body: JSON.stringify({
    textQuery: `${venueName} ${city} ${state}`,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 50.0  // Tighter radius for precision
      }
    },
    maxResultCount: 1
  })
});
```

---

### Phase 5: Code Refactor

**Goal:** Update all files to use venue_catalog instead of venue_cache/nearby_venues.

**Files to Modify:**

1. **`/home/runner/workspace/server/lib/venue/venue-cache.js`**
   - Change imports from `venue_cache` to `venue_catalog`
   - Update all column references (e.g., `venue_cache.id` → `venue_catalog.venue_id`)
   - Update `generateCoordKey` to use 6-decimal precision
   - Update `insertVenue` and `upsertVenue` to include new fields

2. **`/home/runner/workspace/server/lib/venue/venue-intelligence.js`**
   - Change `nearby_venues` imports to `venue_catalog`
   - Update `persistVenuesToDatabase` to insert into venue_catalog

3. **`/home/runner/workspace/server/scripts/sync-events.mjs`**
   - Update imports to use refactored venue-cache.js

4. **`/home/runner/workspace/shared/schema.js`**
   - Update `discovered_events.venue_id` FK to reference `venue_catalog.venue_id`

---

### Phase 6: Schema FK Update and Cleanup

**Goal:** Update the discovered_events FK and remove deprecated tables.

**SQL Script:**
```sql
-- Step 1: Alter FK constraint (requires dropping and recreating)
ALTER TABLE discovered_events
  DROP CONSTRAINT IF EXISTS discovered_events_venue_id_fkey;

ALTER TABLE discovered_events
  ADD CONSTRAINT discovered_events_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES venue_catalog(venue_id) ON DELETE SET NULL;

-- Step 2: Verify no orphaned references
SELECT COUNT(*) FROM discovered_events de
WHERE de.venue_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM venue_catalog vc WHERE vc.venue_id = de.venue_id);

-- Step 3: Drop deprecated tables (ONLY after verification)
-- DROP TABLE IF EXISTS venue_cache;
-- DROP TABLE IF EXISTS nearby_venues;
```

---

## 4. Rollback Strategy

### Pre-Migration Backup
```sql
-- Create backup tables before migration
CREATE TABLE venue_cache_backup AS SELECT * FROM venue_cache;
CREATE TABLE nearby_venues_backup AS SELECT * FROM nearby_venues;
CREATE TABLE discovered_events_backup AS SELECT * FROM discovered_events;
```

### Rollback Script
```sql
-- Restore venue_cache
DROP TABLE IF EXISTS venue_cache;
CREATE TABLE venue_cache AS SELECT * FROM venue_cache_backup;

-- Restore nearby_venues  
DROP TABLE IF EXISTS nearby_venues;
CREATE TABLE nearby_venues AS SELECT * FROM nearby_venues_backup;

-- Restore discovered_events
UPDATE discovered_events de
SET venue_id = (SELECT venue_id FROM discovered_events_backup deb WHERE deb.id = de.id);

-- Recreate original FK
ALTER TABLE discovered_events
  DROP CONSTRAINT IF EXISTS discovered_events_venue_id_fkey;
ALTER TABLE discovered_events
  ADD CONSTRAINT discovered_events_venue_id_fkey
  FOREIGN KEY (venue_id) REFERENCES venue_cache(id) ON DELETE SET NULL;
```

---

## 5. Critical Files for Implementation

### Files to Modify (with line numbers):

| File | Lines | Changes |
|------|-------|---------|
| `/home/runner/workspace/shared/schema.js` | 226-256 | Add new columns to venue_catalog |
| `/home/runner/workspace/shared/schema.js` | 318-368 | Mark venue_cache as deprecated (comment) |
| `/home/runner/workspace/shared/schema.js` | 569-615 | Update discovered_events.venue_id FK |
| `/home/runner/workspace/shared/schema.js` | 639-679 | Mark nearby_venues as deprecated (comment) |
| `/home/runner/workspace/server/lib/venue/venue-cache.js` | 6, 42-45, 67-113, 183-268, 291-328, 344-382 | Refactor to use venue_catalog |
| `/home/runner/workspace/server/lib/venue/venue-address-resolver.js` | 14-96 | Switch to Places API (New) |
| `/home/runner/workspace/server/lib/venue/venue-intelligence.js` | 7, 493-542 | Update to use venue_catalog |
| `/home/runner/workspace/server/scripts/sync-events.mjs` | 22, 116-140 | Update imports |
| `/home/runner/workspace/server/lib/location/geocode.js` | 142-165 | Reuse address parsing (no changes needed) |

### New Files to Create:

| File | Purpose |
|------|---------|
| `/home/runner/workspace/server/lib/venue/venue-utils.js` | Shared utility functions |
| `/home/runner/workspace/server/scripts/migrate-venues.js` | Migration script |

---

## 6. Test Plan

### Unit Tests
1. `venue-utils.js` - All utility functions
2. `venue-cache.js` - CRUD operations with new schema
3. `venue-address-resolver.js` - Google Places API (New) integration

### Integration Tests
1. Event discovery → venue creation → event linking
2. Bar discovery → venue persistence
3. SmartBlocks venue enrichment

### Migration Tests
1. Dry-run migration
2. ID mapping verification
3. FK integrity check
4. Data count comparison

### Rollback Tests
1. Restore from backup
2. Verify original FK works
3. Verify no data loss

---

## 7. Dependencies and Sequencing

```
Phase 1 (Schema Extension)
    ↓
Phase 2 (Utility Functions)
    ↓
Phase 3 (Migration Script) → Run with --dry-run first
    ↓
Phase 4 (API Refactor)
    ↓
Phase 5 (Code Refactor)
    ↓
Phase 6 (FK Update and Cleanup)
```

**Critical Path:**
- Phase 1 must complete before Phase 3
- Phase 2 must complete before Phase 3
- Phase 3 must complete before Phase 5 and Phase 6
- Phase 5 must complete before Phase 6

---

## 8. Potential Challenges

1. **Data Duplication**: Same venue may exist in both venue_cache and nearby_venues with slightly different data. Resolution: Use normalized_name + city + state for deduplication, prefer venue_cache data (has place_id).

2. **Orphaned Events**: Some discovered_events may reference venue_cache IDs that fail to migrate. Resolution: Log these and manually fix or set venue_id to NULL.

3. **coord_key Precision Change**: venue_cache uses 4-decimal, venue_catalog will use 6-decimal. Resolution: Generate new coord_key during migration.

4. **Backward Compatibility**: Old code may still reference venue_cache. Resolution: Keep venue_cache as read-only during transition, remove after all code updated.

5. **Large Data Volume**: If venue_cache/nearby_venues have many rows, migration may be slow. Resolution: Batch processing with progress logging.

---

### Critical Files for Implementation

List of 5 files most critical for implementing this plan:

1. **`/home/runner/workspace/shared/schema.js`** - Core schema definition, must be modified first to add new columns and update FK
2. **`/home/runner/workspace/server/lib/venue/venue-cache.js`** - Primary venue operations file, needs complete refactor to use venue_catalog
3. **`/home/runner/workspace/server/lib/venue/venue-address-resolver.js`** - Google API integration, needs switch to Places API (New)
4. **`/home/runner/workspace/server/lib/venue/venue-intelligence.js`** - Bar discovery, needs update from nearby_venues to venue_catalog
5. **`/home/runner/workspace/server/scripts/sync-events.mjs`** - Event sync, depends on venue-cache.js refactor
