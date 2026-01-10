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
| D-005 | `server/api/coach/schema.js:23` | `snapshots.key_columns` claims PK is `id` | Actual PK is `snapshot_id` | ✅ FIXED |
| D-006 | `server/api/coach/schema.js:28` | `strategies` claims `immediate_strategy` | Actual column is `strategy_for_now` | ✅ FIXED |
| D-007 | `server/api/coach/schema.js:33` | `briefings` claims `traffic`, `weather` | Actual: `traffic_conditions`, `weather_current`, `weather_forecast` | ✅ FIXED |
| D-008 | `server/api/coach/schema.js:43` | `venue_catalog` claims `opening_hours` | Actual column is `business_hours` | ✅ FIXED |
| D-015 | `server/api/coach/schema.js` | Coach metadata uses wrong table names | Table names were already correct (false alarm) | ✅ VERIFIED |
| D-016 | `server/lib/briefing/briefing-service.js:349` | Direct `anthropic.messages.create()` call | Replaced with `callModel('BRIEFING_TRAFFIC')` | ✅ FIXED |

### HIGH PRIORITY

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-001 | `SYSTEM_MAP.md:392` | Claims users table has "GPS coordinates, location" | Changed to "session tracking, auth - NO location data" | ✅ FIXED |
| D-002 | `docs/architecture/authentication.md:56` | References "users: last location" | Changed to "Session tracking (device_id, NO location)" | ✅ FIXED |
| D-003 | `LESSONS_LEARNED.md:702` | "Users table = source of truth for resolved location" | Changed to "Snapshots table = source of truth" | ✅ FIXED |
| D-009 | `docs/DATA_FLOW_MAP.json:454` | Lists `venue_cache` as active table | Removed deleted table entry | ✅ FIXED |
| D-010 | `docs/DATA_FLOW_MAP.json:233` | Lists `nearby_venues` as active table | Removed deleted table entry | ✅ FIXED |
| D-013 | `server/lib/venue/venue-enrichment.js:600` | `places_cache.place_id` column stores `coordsKey` | Semantic mismatch: column named `place_id` contains `"lat_lng"` format, not Google place_id | PENDING |
| D-014 | `venue-hours.js:24`, `venue-enrichment.js:293`, `venue-utils.js:133` | 3 duplicate isOpen functions with different signatures | Complex: Functions serve different input formats (structured JSON vs text). Needs separate refactoring plan | ⚠️ DEFERRED |
| D-017 | `client/src/hooks/useBarsQuery.ts:96` | Log uses `toFixed(4)` for coordinates | Changed to `toFixed(6)` with comment | ✅ FIXED |
| D-018 | `server/lib/venue/venue-intelligence.js` | Trusts Google `openNow` directly | Should use unified venue-hours.js logic for consistency | PENDING |

### MEDIUM PRIORITY

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-004 | Multiple files | Country field uses 'USA' not ISO 'US' | Should use ISO 3166-1 alpha-2 codes | PENDING |
| D-011 | `server/api/location/location.js:161` | `pickAddressParts()` stores country as `c.long_name` | Should store `c.short_name` (ISO code) | PENDING |
| D-012 | `server/lib/venue/venue-utils.js:31` | Default country is `'USA'` (alpha-3) | Should be `'US'` (ISO 3166-1 alpha-2) | PENDING |

---

## 4-Phase Hardening Plan

**Added:** 2026-01-10
**Status:** ACTIVE - All findings HIGH priority per CLAUDE.md Rule 9

### Phase 0: Stop Truth Drift (IMMEDIATE) ✅ COMPLETE
- [x] **D-005 to D-008, D-015:** Fix coach schema metadata to match `shared/schema.js`
- [x] **D-009, D-010:** Regenerate `DATA_FLOW_MAP.json` with correct table names
- [x] **D-001 to D-003:** Fix docs claiming users table has location data

### Phase 1: Unify Duplicate Venue Hours Logic ⚠️ DEFERRED
- [ ] **D-014:** Consolidate 3 duplicate isOpen functions into single source of truth
  - `venue-hours.js:24` - `isOpenNow(hoursFullWeek, timezone, checkTime)` - Structured JSON
  - `venue-enrichment.js:293` - `calculateIsOpen(weekdayTexts, timezone)` - Google Places text
  - `venue-utils.js:133` - `calculateIsOpen(hoursFullWeek, timezone)` - Text in structured keys
  - **Note:** These serve different data formats. Consolidation requires format converter layer.
- [ ] **D-018:** Update venue-intelligence.js to use unified logic

### Phase 2: Enforce Adapter-Only AI Calls + ULTRATHINK ✅ COMPLETE
- [x] **D-016:** Replace direct `anthropic.messages.create()` in briefing-service.js with `callModel()`
- [ ] Add CI check: no direct SDK calls outside adapters
- [ ] Verify all LLM calls use lowest temperature + highest thinking level

### Phase 3: ISO DB Naming + Standards (Partial)
- [ ] **D-004, D-011, D-012:** Implement country_code migration (see Migration Plan below)
- [ ] **D-013:** Rename `places_cache.place_id` column to `coords_key` (semantic accuracy)
- [x] **D-017:** Fix toFixed(4) to toFixed(6) in useBarsQuery.ts

### Phase 4: Schema Defect Resolution
- [ ] Run full schema validation against shared/schema.js
- [ ] Audit all column naming for semantic accuracy
- [ ] Generate fresh schema documentation

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
| D-001 | 2026-01-10 | `SYSTEM_MAP.md:392` | Changed "GPS coordinates, location" → "session tracking, auth - NO location data" |
| D-002 | 2026-01-10 | `docs/architecture/authentication.md:56` | Changed "last location" → "Session tracking (device_id, NO location)" |
| D-003 | 2026-01-10 | `LESSONS_LEARNED.md:702` | Changed "Users table = source of truth" → "Snapshots table = source of truth" |
| D-005 | 2026-01-10 | `server/api/coach/schema.js:23` | Fixed snapshots PK: `id` → `snapshot_id` |
| D-006 | 2026-01-10 | `server/api/coach/schema.js:28` | Fixed strategies column: `immediate_strategy` → `strategy_for_now` |
| D-007 | 2026-01-10 | `server/api/coach/schema.js:33` | Fixed briefings columns: `traffic`, `weather` → `traffic_conditions`, `weather_current`, `weather_forecast` |
| D-008 | 2026-01-10 | `server/api/coach/schema.js:43` | Fixed venue_catalog column: `opening_hours` → `business_hours` |
| D-009 | 2026-01-10 | `docs/DATA_FLOW_MAP.json` | Removed deleted table `venue_cache` |
| D-010 | 2026-01-10 | `docs/DATA_FLOW_MAP.json` | Removed deleted table `nearby_venues` |
| D-016 | 2026-01-10 | `server/lib/briefing/briefing-service.js:349` | Replaced direct `anthropic.messages.create()` with `callModel('BRIEFING_TRAFFIC')` |
| D-017 | 2026-01-10 | `client/src/hooks/useBarsQuery.ts:96` | Fixed `toFixed(4)` → `toFixed(6)` for GPS precision |

---

## Adding New Discrepancies

```markdown
| D-XXX | `file:line` | [Brief issue description] | [What the code actually does] | PENDING |
```

After fixing:
1. Change status to RESOLVED
2. Move to Resolved section with date
3. Log in `docs/reviewed-queue/CHANGES.md`
