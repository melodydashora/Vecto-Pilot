# Documentation Discrepancies Queue

**Status:** BLOCKING QUEUE
**Protocol:** Items here must be resolved within 24 hours
**Rule:** Trust CODE over DOCS when they contradict

---

## How to Use This File

1. When you find docs that contradict code, add an entry below
2. Trust the CODE (not docs) until resolved
3. Fix the docs within 24 hours
4. Remove the entry after fixing
5. Log the fix in `docs/reviewed-queue/CHANGES.md`

---

## Active Discrepancies

### CRITICAL (P0 - Breaks AI Coach)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-005 | `server/api/coach/schema.js:23` | `snapshots.key_columns` claims PK is `id` | Actual PK is `snapshot_id` | PENDING |
| D-006 | `server/api/coach/schema.js:28` | `strategies` claims `immediate_strategy` | Actual column is `strategy_for_now` | PENDING |
| D-007 | `server/api/coach/schema.js:33` | `briefings` claims `traffic`, `weather` | Actual: `traffic_conditions`, `weather_current`, `weather_forecast` | PENDING |
| D-008 | `server/api/coach/schema.js:43` | `venue_catalog` claims `opening_hours` | Actual column is `business_hours` | PENDING |

### HIGH PRIORITY

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-001 | `SYSTEM_MAP.md:392` | Claims users table has "GPS coordinates, location" | Users table has NO location fields (session tracking only) | PENDING |
| D-002 | `docs/architecture/authentication.md:56` | References "users: last location" | Users table has no location data | PENDING |
| D-003 | `LESSONS_LEARNED.md:702` | "Users table = source of truth for resolved location" | Snapshots table is location authority | PENDING |
| D-009 | `docs/DATA_FLOW_MAP.json:454` | Lists `venue_cache` as active table | Table deleted (renamed to `venue_catalog`) | PENDING |
| D-010 | `docs/DATA_FLOW_MAP.json:233` | Lists `nearby_venues` as active table | Table deleted from schema | PENDING |

### MEDIUM PRIORITY

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-004 | Multiple files | Country field uses 'USA' not ISO 'US' | Should use ISO 3166-1 alpha-2 codes | PENDING |
| D-011 | `server/api/location/location.js:161` | `pickAddressParts()` stores country as `c.long_name` | Should store `c.short_name` (ISO code) | PENDING |
| D-012 | `server/lib/venue/venue-utils.js:31` | Default country is `'USA'` (alpha-3) | Should be `'US'` (ISO 3166-1 alpha-2) | PENDING |

---

## Schema Inconsistencies (Migration Needed)

### Country Field Audit

**Tables using `country` (legacy, string format):**

| Table | Column | Default | Actual Values | Issue |
|-------|--------|---------|---------------|-------|
| `snapshots` | `country` | (none) | Full names from `pickAddressParts()` | Gets "United States" from `c.long_name` |
| `coords_cache` | `country` | (none) | Full names from geocoding | Gets "United States" from `c.long_name` |
| `venue_catalog` | `country` | `'USA'` | Alpha-3 default | Schema comment says "Country code" but uses alpha-3 |
| `driver_profiles` | `country` | `'US'` | Alpha-2 | Correct format but column named `country` not `country_code` |

**Root Cause:** `server/api/location/location.js:161` uses `c.long_name` instead of `c.short_name`:
```javascript
// Current (WRONG):
if (types.includes("country")) country = c.long_name;  // "United States"

// Should be:
if (types.includes("country")) country_code = c.short_name;  // "US"
```

**Tables using `country_code` (correct, ISO format):**

| Table | Column | Default | Status |
|-------|--------|---------|--------|
| `airports` | `country_code` | 'US' | ✅ Correct |
| `market_information` | `country_code` | - | ✅ Correct |
| `platform_markets` | `country_code` | 'US' | ✅ Correct |

### Migration Plan

**Phase 1: Add country_code columns**
```sql
ALTER TABLE snapshots ADD COLUMN country_code CHAR(2);
ALTER TABLE coords_cache ADD COLUMN country_code CHAR(2);
ALTER TABLE venue_catalog ADD COLUMN country_code CHAR(2);
```

**Phase 2: Backfill data**
```sql
UPDATE snapshots SET country_code = CASE
  WHEN country IN ('USA', 'United States', 'US') THEN 'US'
  WHEN country = 'Canada' THEN 'CA'
  WHEN country IN ('UK', 'United Kingdom') THEN 'GB'
  ELSE UPPER(LEFT(country, 2))
END;
-- Repeat for other tables
```

**Phase 3: Update code**
- Update all reads to use `country_code`
- Update all writes to populate `country_code`
- Add validation for ISO format

**Phase 4: Deprecate legacy columns**
- Mark `country` columns as deprecated
- Plan removal in future migration

---

## Resolved Discrepancies

| ID | Resolved | Location | Resolution |
|----|----------|----------|------------|
| D-000 | 2026-01-10 | `README.md:150`, `docs/architecture/database-schema.md:7`, `server/api/location/snapshot.js:67`, `server/api/location/README.md:44`, `server/lib/ai/coach-dal.js:82` | Fixed 5 docs claiming users table had location data |

---

## Adding New Discrepancies

```markdown
| D-XXX | `file:line` | [Brief issue description] | [What the code actually does] | PENDING |
```

After fixing:
1. Change status to RESOLVED
2. Move to Resolved section with date
3. Log in `docs/reviewed-queue/CHANGES.md`
