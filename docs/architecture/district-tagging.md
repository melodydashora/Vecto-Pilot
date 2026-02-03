# District Tagging for Venue Matching

**Created:** 2025-12-29
**Status:** Implemented
**Purpose:** Improve Places API matching accuracy when LLM coordinates are imprecise

## Problem Statement

GPT-5.2 provides approximate venue coordinates that may be 50-150m off from the actual location. When the Places API searches at these imprecise coordinates, it often finds the wrong business.

**Example:**
- GPT-5.2 says "Target Venue" at coords that are 100m from actual location
- Places API searches at imprecise coords and finds a different nearby business
- Without district context, we can't disambiguate which venue is correct

## Solution: District Tagging

Add district/neighborhood metadata to venues, enabling text-based fallback searches:
- **Coord-based search fails** → Fall back to text search: `"venue_name district city state"`
- **District clustering** → Group venues within shopping centers/districts
- **Deduplication** → Prevent recommending 5 venues all from same district

## Database Schema

### venue_catalog (new columns)
```sql
district text                      -- Human-readable: "Legacy West", "Deep Ellum"
district_slug text                 -- Normalized: "legacy-west", "deep-ellum"
district_centroid_lat double       -- Center of district (calculated)
district_centroid_lng double       -- Center of district (calculated)
```

### ranking_candidates (new column)
```sql
district text                      -- District from GPT-5.2 output
```

## Code Changes

### 1. Migration File
`migrations/20251229_district_tagging.sql`
- Adds district columns to venue_catalog and ranking_candidates
- Creates indexes for efficient lookups

### 2. Schema Update
`shared/schema.js`
- Added district fields to venue_catalog (lines 234-239)
- Added district field to ranking_candidates (line 196-197)

### 3. District Detection Logic
`server/lib/venue/district-detection.js`
- `calculateDistanceMeters()` - Haversine formula for distance
- `normalizeDistrictSlug()` - "Legacy West" → "legacy-west"
- `calculateCentroid()` - Find center of venue cluster
- `detectDistrictClusters()` - Group venues by district
- `extractDistrictFromVenueName()` - Parse "Venue (District)" patterns
- `deduplicateByDistrict()` - Max N venues per district
- `validateVenueDistrict()` - Flag venues >1km from district center

### 4. Text Search Fallback
`server/lib/venue/venue-enrichment.js`
- `searchPlaceByText()` - Text-based Places API search
- `getPlaceDetailsWithFallback()` - Coord search → text search chain
- Fallback triggered when name match < 20%

### 5. LLM Prompt Update
`server/lib/strategy/tactical-planner.js`
- Added `district` field to Zod schema
- Updated prompt to request district names
- Updated JSON example format

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. GPT-5.2 TACTICAL PLANNER                                    │
│     Input: Strategy + snapshot                                   │
│     Output: Venues with coords, category, district, pro_tips    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. VENUE ENRICHMENT (Places API)                               │
│     Step 1: searchNearby(lat, lng) → Find venue at coords       │
│     Step 2: If name match < 20%:                                │
│             searchText("venue_name district city state")         │
│     Step 3: Store with district_slug in venue_catalog           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. SMART BLOCKS                                                 │
│     - Deduplicate by district (max 2 per district)              │
│     - Display district tag in UI                                │
└─────────────────────────────────────────────────────────────────┘
```

---

# Workflow Test Strategy

## Pre-Requisites

1. Run the migration:
   ```bash
   psql $DATABASE_URL -f migrations/20251229_district_tagging.sql
   ```

2. Push schema changes:
   ```bash
   npx drizzle-kit push
   ```

## Test Cases

### Test 1: LLM District Output
**Goal:** Verify GPT-5.2 includes district in venue recommendations

**Steps:**
1. Trigger a strategy generation for any metro area
2. Check server logs for tactical planner output:
   ```
   🏢 [VENUES 1/4 - Tactical Planner] ✅ 5 venues in 12345ms:
      1. "Venue Name" @ District Name (dining) at xx.xxxx,-xx.xxxx
      2. "Another Venue" @ Another District (nightlife) at xx.xxxx,-xx.xxxx
   ```
3. **Pass Criteria:** District appears in log after `@` symbol for venues in known districts

**Log Location:** Server console or `npm run dev` output

### Test 2: Text Search Fallback
**Goal:** Verify fallback triggers when coord search fails

**Steps:**
1. Use a venue where coord-based search returns wrong name
2. Check logs for fallback sequence:
   ```
   🏢 [VENUE "Target Venue"] Coord search returned "Wrong Business" (12% match)
   🏢 [VENUE "Target Venue"] Falling back to text search: "Target Venue District City State"
   🏢 [VENUE "Target Venue"] Text search found: "Target Venue" (95% match)
   ```
3. **Pass Criteria:** Text search triggered, correct venue found

### Test 3: District Storage in Database
**Goal:** Verify district fields are persisted correctly

**SQL Query:**
```sql
SELECT
  name,
  district,
  district_slug,
  district_centroid_lat,
  district_centroid_lng
FROM venue_catalog
WHERE district IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;
```

**Pass Criteria:**
- `district` has human-readable name ("Legacy West")
- `district_slug` is normalized ("legacy-west")
- Centroid coords are calculated for clustered venues

### Test 4: Ranking Candidates District
**Goal:** Verify district is stored per-recommendation

**SQL Query:**
```sql
SELECT
  name,
  district,
  snapshot_id
FROM ranking_candidates
WHERE district IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

**Pass Criteria:** District from GPT-5.2 is stored in ranking_candidates

### Test 5: District Deduplication
**Goal:** Verify max N venues per district

**Steps:**
1. Request venues in an area with many options in same district
2. Check smart blocks output
3. **Pass Criteria:** No more than 2 venues from same district in results

**Log to check:**
```
[district-dedup] Skipping "Venue Name" - already 2 venues from "District Name"
[district-dedup] Kept 5 venues, skipped 3 duplicates
```

### Test 6: District Centroid Calculation
**Goal:** Verify cluster detection works

**Steps:**
1. Insert 3+ venues with same district name within 500m
2. Run district detection
3. Check centroid is calculated

**Code Test:**
```javascript
import { detectDistrictClusters, calculateCentroid } from './district-detection.js';

const venues = [
  { name: "Venue A", district: "Example District", lat: 40.7500, lng: -73.9800 },
  { name: "Venue B", district: "Example District", lat: 40.7505, lng: -73.9795 },
  { name: "Venue C", district: "Example District", lat: 40.7498, lng: -73.9805 },
];

const clusters = detectDistrictClusters(venues);
console.log(clusters.get('example-district'));
// Expected: { name: "Example District", centroid: { lat: ~40.7501, lng: ~-73.9800 }, ... }
```

### Test 7: End-to-End UI Flow
**Goal:** Verify district appears in UI

**Steps:**
1. Load the app at `/co-pilot/strategy`
2. Trigger a strategy refresh
3. Open smart blocks section
4. **Pass Criteria:** District badge/tag visible on venue cards

## Debugging Commands

### Check Migration Status
```sql
-- Verify columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'venue_catalog'
AND column_name LIKE 'district%';
```

### Check Recent Venues with District
```sql
SELECT
  name,
  district,
  city,
  state,
  created_at
FROM venue_catalog
WHERE district IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

### Check Fallback Usage
Search server logs for:
```
grep "Falling back to text search" logs/
grep "Text search found" logs/
```

## Known Limitations

1. **District Optional:** GPT-5.2 may not always provide district (standalone venues)
2. **Centroid Delay:** Centroids only calculated after 3+ venues in same district
3. **Text Search Cost:** Text search uses additional Places API quota

## Rollback Plan

If issues arise:
```sql
-- Remove columns (non-destructive, data already has nulls)
ALTER TABLE venue_catalog DROP COLUMN IF EXISTS district;
ALTER TABLE venue_catalog DROP COLUMN IF EXISTS district_slug;
ALTER TABLE venue_catalog DROP COLUMN IF EXISTS district_centroid_lat;
ALTER TABLE venue_catalog DROP COLUMN IF EXISTS district_centroid_lng;
ALTER TABLE ranking_candidates DROP COLUMN IF EXISTS district;
```

## Related Files

| File | Purpose |
|------|---------|
| `migrations/20251229_district_tagging.sql` | Schema migration |
| `shared/schema.js` | Drizzle ORM schema |
| `server/lib/venue/district-detection.js` | District detection logic |
| `server/lib/venue/venue-enrichment.js` | Places API + text search |
| `server/lib/strategy/tactical-planner.js` | LLM prompt with district |
