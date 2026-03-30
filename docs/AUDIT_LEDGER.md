# Venue Pipeline Audit Ledger

**Created:** 2026-01-10
**Priority:** P0 CRITICAL
**Status:** ACTIVE - All issues require immediate resolution

---

## Executive Summary

The venue data pipeline has **two critical breakpoints** causing:
1. Venues created without Google Place IDs
2. Place ID cache miskeyed (stores coords, not place_id)
3. Silent write failures masking data loss
4. Duplicate venues from fuzzy matching

**Root Cause:** Event ETL (`sync-events.mjs`) doesn't use the canonical resolver (`venue-address-resolver.js`).

---

## Breakpoint 1: Event ETL Drops place_id

### Location
- **File:** `server/scripts/sync-events.mjs:51-75`
- **Function:** `geocodeAddress()`

### The Bug
```javascript
// CURRENT (BROKEN) - Lines 66-68
if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };  // DROPS place_id and formatted_address!
}
```

### What's Available But Dropped
The Google Geocoding API response contains:
```javascript
data.results[0].place_id          // "ChIJ..." - DROPPED
data.results[0].formatted_address  // Full address - DROPPED
data.results[0].address_components // Parsed address - DROPPED
```

### Downstream Impact
1. `geocodeMissingCoordinates()` only gets `{lat, lng}`
2. `findOrCreateVenue()` is called without `placeId`
3. Venues created with `place_id: null`
4. Events flagged with `_no_place_id = true` (line 177)

### Fix Required
```javascript
// FIXED
if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    place_id: result.place_id,              // CAPTURE
    formatted_address: result.formatted_address,  // CAPTURE
    address_components: result.address_components // CAPTURE
  };
}
```

---

## Breakpoint 2: places_cache Uses Wrong Key

### Location
- **Schema:** `shared/schema.js:339`
- **Usage:** `server/lib/venue/venue-enrichment.js:362, 373, 502, 508`

### The Bug
Schema defines:
```javascript
export const places_cache = pgTable("places_cache", {
  place_id: text("place_id").primaryKey(),  // Implies Google Place ID
  ...
});
```

But code uses it as:
```javascript
// Line 362 - Query by coordsKey
.where(eq(places_cache.place_id, coordsKey))

// Line 502 - Insert with coordsKey
.values({ place_id: coordsKey, ... })
```

### Semantic Mismatch
| Expected | Actual | Format |
|----------|--------|--------|
| Google Place ID | Coordinate key | `"33.123456_-96.123456"` |
| `"ChIJ..."` | `"lat_lng"` | Wrong type |

### Downstream Impact
1. Cache lookups fail when searching by actual Place ID
2. Code expecting Place ID gets coordinate string
3. Confusion when debugging venue issues

### Fix Required (D-013)
```sql
-- Rename column for semantic accuracy
ALTER TABLE places_cache RENAME COLUMN place_id TO coords_key;
```

---

## Breakpoint 3: Silent Write Failures

### Location
- **File:** `server/lib/venue/venue-cache.js:176-211`
- **Function:** `insertVenue()`

### The Bug
```javascript
const [inserted] = await db
  .insert(venue_catalog)
  .values({ ... })
  .onConflictDoNothing()  // On conflict, returns empty array
  .returning();           // inserted = undefined

return inserted;  // Returns undefined to caller!
```

### Downstream Impact
1. Caller assumes venue exists after insert
2. `findOrCreateVenue()` returns `undefined`
3. Event linking fails silently
4. Data appears to "not land"

### Fix Required
```javascript
// Option A: Use onConflictDoUpdate
.onConflictDoUpdate({
  target: venue_catalog.coord_key,
  set: { access_count: sql`access_count + 1`, updated_at: new Date() }
})
.returning();

// Option B: Re-select on conflict
const [inserted] = await db.insert(...).onConflictDoNothing().returning();
if (!inserted) {
  // Re-select by conflict key
  const [existing] = await db.select().from(venue_catalog).where(...);
  return existing;
}
```

---

## Breakpoint 4: Fuzzy Matching Violates Standard

### Location
- **File:** `server/lib/venue/venue-cache.js:97-135`
- **Function:** `lookupVenueFuzzy()`

### The Bug
The standard says:
> "venue identification should be place_id-first (not name similarity)"
> — `server/lib/venue/venue-enrichment.js` comment

But `findOrCreateVenue()` calls `lookupVenueFuzzy()` which does:
```javascript
// ILIKE matching - creates duplicate venues
.where(and(
  or(
    ilike(venue_catalog.normalized_name, `%${normalized}%`),
    sql`${normalized} LIKE '%' || ${venue_catalog.normalized_name} || '%'`
  ),
  ilike(venue_catalog.city, city),
  eq(venue_catalog.state, state.toUpperCase())
))
```

### Downstream Impact
1. Multiple venues created for same location
2. ChIJ vs Ei ID confusion (4 iFLY records for 1 venue)
3. Inconsistent event linking

### Fix Required
Use `resolveVenueAddress()` instead which:
1. Checks by `coord_key` first (exact)
2. Calls Places API (New) with 50m location bias
3. Uses authoritative `placeId` from Google

---

## The Two ID Problem

### Valid Place IDs (ChIJ...)
```
ChIJfTlLXrk8TIYRi7jESAUBky8  ← Valid Google Place ID
ChIJRe6hj5g8TIYR7iVoY-6KhME  ← Valid, different listing
ChIJdcNokKE8TIYRFg-wDSZNlGM  ← Valid, duplicate listing
```

### Synthetic IDs (Ei...)
```
Eig1ODgyIFN0YXRlIEh3eSAxMjEsIFBsYW5vLCBUWCA3NTAyNCwgVVNBIhsS...
↓ Decodes to:
"10882 State Hwy 121, Plano, TX 75024, USA"
```

**CRITICAL:** This Ei ID points to **Plano** but the venue record claims **Frisco**!

### Rules
| ID Type | Prefix | Use for API? | Trust Level |
|---------|--------|--------------|-------------|
| Valid Place ID | `ChIJ...` | ✅ YES | HIGH |
| Synthetic ID | `Ei...` | ❌ NEVER | NONE |
| No ID | `null` | ❌ N/A | Needs resolution |

---

## The Missing Wiring

### Canonical Resolver Exists
`server/lib/venue/venue-address-resolver.js` has correct logic:
1. Check `venue_catalog` by `coord_key` (line 51-82)
2. Call Places API (New) with 50m bias (line 85-118)
3. Use `placeId` from response (line 93, 112)
4. Upsert with all fields (line 89-101)

### But Event ETL Doesn't Use It
`sync-events.mjs` does:
1. `geocodeAddress()` → drops place_id
2. `findOrCreateVenue()` → fuzzy match, no place_id
3. Result: venues without place_id

---

## Cleanup Plan

### Phase 0: Documentation (This File) ✅ COMPLETE
- [x] Create AUDIT_LEDGER.md
- [x] Update LEXICON.md with canonical modules (Venue Identity System section)

### Phase 1: Fix ID Contract ✅ COMPLETE (2026-01-10)
- [x] Rename `places_cache.place_id` → `coords_key` (D-013)
- [x] Update `venue-enrichment.js` to use `coords_key`
- [x] Migration file: `server/db/migrations/2026-01-10-d013-places-cache-rename.sql`

### Phase 2: Wire Places API into Event ETL ✅ COMPLETE (2026-01-10)
- [x] Modify `geocodeAddress()` to return full result (place_id, formatted_address)
- [x] Update `geocodeMissingCoordinates()` to capture geocoded data
- [x] Update `findOrCreateVenue()` to use place_id-first lookup strategy
- [x] Fuzzy matching now last resort, backfills place_id when found

### Phase 3: Stop Silent Failures ✅ COMPLETE (2026-01-10)
- [x] Change `insertVenue()` to `onConflictDoUpdate` with coord_key target
- [x] On conflict: update access_count, backfill place_id/formatted_address
- [x] Always returns a record (no more undefined on conflict)

### Phase 4: Data Cleanup ✅ SCRIPT CREATED (2026-01-10)
- [x] Created `scripts/venue-data-cleanup.js`
- [ ] Run `node scripts/venue-data-cleanup.js --analyze` to audit
- [ ] Run `node scripts/venue-data-cleanup.js --execute` to clean
- [ ] Re-run event sync to populate proper ChIJ* IDs

---

## Audit Queries

```sql
-- Venues missing place_id
SELECT COUNT(*) FROM venue_catalog WHERE place_id IS NULL;

-- Venues with synthetic Ei* IDs
SELECT COUNT(*) FROM venue_catalog WHERE place_id LIKE 'Ei%';

-- Events linked to venues without place_id
SELECT COUNT(*) FROM discovered_events
WHERE venue_id IS NOT NULL
AND venue_id IN (SELECT venue_id FROM venue_catalog WHERE place_id IS NULL);

-- places_cache rows keyed by coords (current bug)
SELECT COUNT(*) FROM places_cache WHERE place_id LIKE '%_%';

-- Duplicate venues (same normalized_name + city + state)
SELECT normalized_name, city, state, COUNT(*) as cnt
FROM venue_catalog
GROUP BY normalized_name, city, state
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 20;
```

---

## Related Files

| File | Role | Status |
|------|------|--------|
| `server/scripts/sync-events.mjs` | Event ETL | BROKEN (drops place_id) |
| `server/lib/venue/venue-cache.js` | Venue CRUD | BROKEN (fuzzy match, silent fail) |
| `server/lib/venue/venue-address-resolver.js` | Canonical resolver | CORRECT (not wired in) |
| `server/lib/venue/venue-enrichment.js` | Places cache | BROKEN (wrong key) |
| `shared/schema.js:339` | places_cache schema | BROKEN (semantic mismatch) |

---

*This ledger tracks all venue pipeline issues. Update status as fixes are applied.*
