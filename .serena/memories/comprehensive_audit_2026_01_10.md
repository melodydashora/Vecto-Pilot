# Comprehensive Codebase Audit - 2026-01-10

## Executive Summary

This audit documents **critical inconsistencies** that cause "missing data" symptoms, broken joins, 
and AI coach hallucinations. Issues are categorized by severity and include specific fix locations.

---

## CRITICAL: Country Field Inconsistency (3 Incompatible Representations)

### Current State

| Table/Function | Column | Default/Value | Format |
|----------------|--------|---------------|--------|
| `pickAddressParts()` | country | `c.long_name` | Full name ("United States") |
| `venue_catalog` | country | `'USA'` | Alpha-3 (non-standard) |
| `driver_profiles` | country | `'US'` | Alpha-2 (correct) |
| `airports` | country_code | `'US'` | Alpha-2 (correct) |
| `platform_markets` | country_code | `'US'` | Alpha-2 (correct) |
| `coords_cache` | country | (no default) | Full name from geocode |
| `snapshots` | country | (no default) | Full name from location.js |

### Source Code Locations

```
server/api/location/location.js:161
  if (types.includes("country")) country = c.long_name;  // ← PROBLEM: stores "United States"

shared/schema.js:262
  country: text("country").default('USA'),  // ← PROBLEM: alpha-3, not ISO

server/lib/venue/venue-utils.js:31
  country: 'USA'  // ← Default in parseAddressComponents()

shared/schema.js:901
  country: text("country").notNull().default('US'),  // ← Correct (driver_profiles)
```

### Impact

- Broken joins: `WHERE country = 'US'` won't match `'USA'` or `'United States'`
- Ambiguous logs: Can't tell if `country='US'` means ISO code or state abbreviation
- Data quality: ~3 different values for "same" country

### Fix Plan

**Phase 1: Add country_code columns (non-breaking)**
```sql
ALTER TABLE coords_cache ADD COLUMN country_code VARCHAR(2);
ALTER TABLE snapshots ADD COLUMN country_code VARCHAR(2);
ALTER TABLE venue_catalog ADD COLUMN country_code VARCHAR(2) DEFAULT 'US';
```

**Phase 2: Update location.js pickAddressParts()**
```javascript
// Change from:
if (types.includes("country")) country = c.long_name;

// To:
if (types.includes("country")) {
  country_code = c.short_name;  // 'US' (ISO 3166-1 alpha-2)
  country_name = c.long_name;   // 'United States' (for display)
}
```

**Phase 3: Backfill existing data**
```sql
UPDATE coords_cache SET country_code = CASE
  WHEN country IN ('USA', 'United States', 'US') THEN 'US'
  WHEN country IN ('Canada', 'CA') THEN 'CA'
  WHEN country IN ('UK', 'United Kingdom', 'GB') THEN 'GB'
  ELSE UPPER(LEFT(country, 2))
END;
```

---

## CRITICAL: Coach Schema Metadata Mismatches

### Problem

The AI Coach is prompted with **wrong column names**, causing it to reference non-existent columns.
This is in `server/api/coach/schema.js`.

### Verified Mismatches

| Table | Coach Metadata Says | Actual Schema | Status |
|-------|---------------------|---------------|--------|
| snapshots | `id` | `snapshot_id` (PK) | ❌ WRONG |
| strategies | `immediate_strategy` | `strategy_for_now` | ❌ WRONG |
| briefings | `traffic` | `traffic_conditions` | ❌ WRONG |
| briefings | `weather` | `weather_current`, `weather_forecast` | ❌ WRONG |
| venue_catalog | `opening_hours` | `business_hours` | ❌ WRONG |

### Source Code Locations

```
server/api/coach/schema.js:23
  key_columns: ["id", "user_id", ...]  // Should be "snapshot_id"

server/api/coach/schema.js:28
  key_columns: ["id", "snapshot_id", "consolidated_strategy", "immediate_strategy", ...]
  // Should be "strategy_for_now"

server/api/coach/schema.js:33
  key_columns: ["id", "snapshot_id", "events", "traffic", "news", "weather"]
  // Should be "traffic_conditions", "weather_current", "weather_forecast"

server/api/coach/schema.js:43
  key_columns: ["venue_id", "venue_name", "city", "expense_rank", "lat", "lng", "opening_hours"]
  // Should be "business_hours"
```

### Fix Required

Update `server/api/coach/schema.js` to match actual column names in `shared/schema.js`.

---

## HIGH: Deleted Tables Still in Documentation

### Problem

Tables that no longer exist in schema.js are still referenced in docs.

### Findings

| Table | Still In | Status in Schema |
|-------|----------|------------------|
| `venue_cache` | `docs/DATA_FLOW_MAP.json:454` | DELETED (renamed to venue_catalog) |
| `nearby_venues` | `docs/DATA_FLOW_MAP.json:233` | DELETED |

### Fix Required

Regenerate `docs/DATA_FLOW_MAP.json` or manually remove stale table entries.

---

## VERIFIED CORRECT: coords_cache Nullability

### Finding

The user suspected docs/migration disagreement on nullability.

**Actual State:**
- `shared/schema.js:660-664`: All fields (`city`, `state`, `country`, `timezone`) have `.notNull()`
- `docs/architecture/database-schema.md`: Correctly documents these as required
- **No discrepancy found** - both agree fields are NOT NULL

---

## VERIFIED CORRECT: GPS Precision

### Finding

GPS precision is correctly standardized at 6 decimals across the codebase.

**Verified Locations:**
- `server/api/location/snapshot.js`: `makeCoordsKey()` uses `toFixed(6)`
- `server/api/location/location.js`: `makeCoordsKey()` uses `toFixed(6)`
- `docs/architecture/constraints.md`: Documents 6-decimal precision

---

## MEDIUM: Duplicate Function Implementations

### Documented Previously

See `.serena/memories/refactor-audit-2026-01-10.md` for:
- 4 duplicate `makeCoordsKey()` functions
- 2 `calculateIsOpen()` implementations with different signatures
- 9 files bypassing LLM adapters

---

## Action Items Summary

### P0 (Immediate - breaks AI Coach)
1. Fix coach schema metadata in `server/api/coach/schema.js`
   - `snapshots.id` → `snapshot_id`
   - `strategies.immediate_strategy` → `strategy_for_now`
   - `briefings.traffic` → `traffic_conditions`
   - `briefings.weather` → `weather_current, weather_forecast`
   - `venue_catalog.opening_hours` → `business_hours`

### P1 (This Week - data quality)
2. Standardize country fields to ISO 3166-1 alpha-2
   - Update `pickAddressParts()` to use `short_name`
   - Add `country_code` columns for dual-write
   - Backfill existing data
   - Update venue-utils.js default from 'USA' to 'US'

### P2 (Cleanup)
3. Remove stale tables from `docs/DATA_FLOW_MAP.json`
4. Consolidate duplicate functions (see previous audit)

---

## Validation Tests

After fixes, validate:

```sql
-- Check country consistency
SELECT DISTINCT country FROM coords_cache;
SELECT DISTINCT country FROM snapshots;
SELECT DISTINCT country FROM venue_catalog;
-- All should return 2-letter ISO codes after migration

-- Check coach can query with correct column names
SELECT snapshot_id FROM snapshots LIMIT 1;  -- Not 'id'
SELECT strategy_for_now FROM strategies LIMIT 1;  -- Not 'immediate_strategy'
SELECT traffic_conditions FROM briefings LIMIT 1;  -- Not 'traffic'
```

---

## Audit Metadata

- **Performed:** 2026-01-10
- **Files Analyzed:** 15+
- **Critical Issues Found:** 2 (country inconsistency, coach metadata)
- **Previously Documented Issues:** See `refactor-audit-2026-01-10.md`
