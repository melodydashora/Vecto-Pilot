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

### STRATEGY PIPELINE (P0 - Audit 2026-01-10)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| S-001 | `migrations/20260110_fix_strategy_now_notify.sql` | SSE trigger only fires for `consolidated_strategy` | New migration fires for both `strategy_for_now` AND `consolidated_strategy` | ✅ FIXED |
| S-002 | `server/api/strategy/blocks-fast.js:66-93` | Advisory locks use session-level (can leak) | Comment says `pg_advisory_xact_lock` but code uses `pg_advisory_lock` | DOCUMENTED |
| S-003 | `server/api/strategy/blocks-fast.js:352` | Error message says "consolidated" | Changed to "Waiting for immediate strategy to complete" | ✅ FIXED |
| S-004 | `server/lib/strategy/status-constants.js` | Status enum drift | Created canonical `STRATEGY_STATUS` enum with all valid values | ✅ FIXED |
| S-005 | `server/api/strategy/blocks-fast.js:276` | `mapCandidatesToBlocks` missing snake_case tolerance | Added full snake/camel fallback chain for `isOpen` | ✅ FIXED |

**Audit Source:** `.serena/memories/strategy-pipeline-audit-2026-01-10.md`

**Impact of S-001:**
- SSE `strategy_ready` event NEVER fires for the main use case (immediate strategy)
- UI falls back to 2-second polling loop
- Causes unnecessary server load

**Fix for S-001:**
```sql
-- Current (broken): fires only for daily strategy
IF NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL THEN

-- Fixed: fires for immediate strategy
IF NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL THEN
```

### CRITICAL (P0 - Schema/Code Mismatch)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-020 | `shared/schema.js:592` | Index references `event_date` column | Fixed: now uses `event_start_date` | ✅ FIXED |
| D-021 | `client/src/contexts/co-pilot-context.tsx:494` | Client checks `status === 'complete'` | Removed deprecated check, uses `'ok' \|\| 'pending_blocks'` | ✅ FIXED |
| D-022 | `client/src/pages/co-pilot/StrategyPage.tsx:869` | Same `status === 'complete'` check | Removed deprecated check, uses `'ok' \|\| 'pending_blocks'` | ✅ FIXED |

### HIGH PRIORITY (P1 - UI Casing Drift)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-023 | `client/src/contexts/co-pilot-context.tsx:517` | Enrichment used `closed_venue_reasoning` | Now uses `closedVenueReasoning` to match types | ✅ FIXED |
| D-024 | `client/src/contexts/co-pilot-context.tsx:443` | queryFn returned `path_taken` | Now returns `pathTaken` with `path_taken` fallback | ✅ FIXED |
| D-025 | `client/src/pages/co-pilot/MapPage.tsx:82` | Duplicate bars fetch with `city: 'Unknown'` | Removed - now uses shared `barsData` from `useCoPilot()` | ✅ FIXED |
| D-026 | `client/src/pages/co-pilot/MapPage.tsx:137` | Used `estimatedEarnings` only | Added fallback: `estimatedEarningsPerRide ?? estimatedEarnings` | ✅ FIXED |
| D-027 | `server/api/strategy/blocks-fast.js` | Response used `strategy_for_now` | All response paths now use `strategyForNow` (camelCase) | ✅ FIXED |

**Impact of D-023/D-024:**
- UI fields were silently undefined when server returned camelCase
- Types expect camelCase, code was checking snake_case

**Impact of D-025:**
- Duplicate API call with different queryKey (no cache sharing)
- Violated NO FALLBACKS rule: `city: 'Unknown'` could pollute DB

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
| D-019 | `server/lib/venue/hours/evaluator.js` | Overnight hours "day rollover" bug | Fixed: now checks yesterday's spillover + today's main shift separately | ✅ FIXED |
| D-001 | `SYSTEM_MAP.md:392` | Claims users table has "GPS coordinates, location" | Changed to "session tracking, auth - NO location data" | ✅ FIXED |
| D-002 | `docs/architecture/authentication.md:56` | References "users: last location" | Changed to "Session tracking (device_id, NO location)" | ✅ FIXED |
| D-003 | `LESSONS_LEARNED.md:702` | "Users table = source of truth for resolved location" | Changed to "Snapshots table = source of truth" | ✅ FIXED |
| D-009 | `docs/DATA_FLOW_MAP.json:454` | Lists `venue_cache` as active table | Removed deleted table entry | ✅ FIXED |
| D-010 | `docs/DATA_FLOW_MAP.json:233` | Lists `nearby_venues` as active table | Removed deleted table entry | ✅ FIXED |
| D-013 | `places_cache.coords_key` in schema.js:341 | Column renamed to `coords_key` | Stores coordinate keys (lat_lng format) with correct semantic naming | ✅ FIXED |
| D-014 | `server/lib/venue/hours/` | Consolidated isOpen via canonical hours module | All 3 functions now wrap `getOpenStatus()` from canonical module | ✅ FIXED |
| D-017 | `client/src/hooks/useBarsQuery.ts:96` | Log uses `toFixed(4)` for coordinates | Changed to `toFixed(6)` with comment | ✅ FIXED |
| D-018 | `server/lib/venue/venue-intelligence.js:18-72` | Now uses canonical hours module | Uses `getOpenStatus()`, Google `openNow` only for debug logging | ✅ FIXED |

### MEDIUM PRIORITY

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-004 | Multiple files | Country field uses 'USA' not ISO 'US' | All fixed: venue-utils.js (D-012), location.js (D-011) | ✅ FIXED |
| D-011 | `server/api/location/location.js:164` | `pickAddressParts()` country changed to `c.short_name` | Now returns ISO 3166-1 alpha-2 codes (US, CA, GB) | ✅ FIXED |
| D-012 | `server/lib/venue/venue-utils.js:37,74` | Default country was `'USA'` (alpha-3) | Changed to `'US'` (ISO 3166-1 alpha-2) | ✅ FIXED |

---

## 4-Phase Hardening Plan

**Added:** 2026-01-10
**Status:** ACTIVE - All findings HIGH priority per CLAUDE.md Rule 9

### Phase 0: Stop Truth Drift (IMMEDIATE) ✅ COMPLETE
- [x] **D-005 to D-008, D-015:** Fix coach schema metadata to match `shared/schema.js`
- [x] **D-009, D-010:** Regenerate `DATA_FLOW_MAP.json` with correct table names
- [x] **D-001 to D-003:** Fix docs claiming users table has location data

### Phase 1: Unify Duplicate Venue Hours Logic ✅ COMPLETE
- [x] **D-014:** Consolidated via canonical hours module (`server/lib/venue/hours/`)
  - `venue-hours.js` → uses `parseStructuredHoursFullWeek()` + `getOpenStatus()`
  - `venue-enrichment.js` → uses `parseGoogleWeekdayText()` + `getOpenStatus()`
  - `venue-utils.js` → uses `parseHoursTextMap()` + `getOpenStatus()`
  - **Architecture:** Parsers convert input formats → `getOpenStatus()` is single source of truth
- [x] **D-018:** venue-intelligence.js now uses canonical module (Google `openNow` only for debug)

### Phase 2: Enforce Adapter-Only AI Calls + ULTRATHINK ✅ COMPLETE
- [x] **D-016:** Replace direct `anthropic.messages.create()` in briefing-service.js with `callModel()`
- [ ] Add CI check: no direct SDK calls outside adapters
- [ ] Verify all LLM calls use lowest temperature + highest thinking level

### Phase 3: ISO DB Naming + Standards ✅ COMPLETE (Code Level)
- [x] **D-004, D-011, D-012:** Fixed country code to ISO alpha-2 format
  - `location.js:164` → now uses `c.short_name` for country (returns "US" not "United States")
  - `venue-utils.js:37,74` → default changed from `'USA'` to `'US'`
- [x] **D-013:** Renamed `places_cache.place_id` → `coords_key` (semantic accuracy)
- [x] **D-017:** Fix toFixed(4) to toFixed(6) in useBarsQuery.ts
- **Note:** DB migration for existing `country` columns still needed (see Migration Plan)

### Phase 4: Schema Defect Resolution
- [ ] Run full schema validation against shared/schema.js
- [ ] Audit all column naming for semantic accuracy
- [ ] Generate fresh schema documentation

---

## Schema Inconsistencies (Migration Needed)

### Country Field Audit ✅ CODE FIXED (DB Migration Optional)

**Root Cause Fixed (2026-01-10):**
```javascript
// server/api/location/location.js:164
// BEFORE: if (types.includes("country")) country = c.long_name;  // "United States"
// AFTER:  if (types.includes("country")) country = c.short_name; // "US"
```

New snapshots will now store ISO alpha-2 codes. Existing data has mixed formats:

| Table | Column | Existing Data | New Data |
|-------|--------|---------------|----------|
| `snapshots` | `country` | "United States" (old) | "US" (new) |
| `coords_cache` | `country` | "United States" (old) | "US" (new) |
| `venue_catalog` | `country` | "USA" (old default) | "US" (new) |

**Optional backfill migration:**
```sql
UPDATE snapshots SET country = 'US' WHERE country IN ('USA', 'United States');
UPDATE coords_cache SET country = 'US' WHERE country IN ('USA', 'United States');
UPDATE venue_catalog SET country = 'US' WHERE country IN ('USA', 'United States');
```

---

### D-013: places_cache.place_id Column Rename ✅ COMPLETE

**Issue:** Column named `place_id` stored `coordsKey` format (e.g., "33.123456_-96.123456"), not Google Place IDs.

**Resolution (2026-01-10):**

| File | Change |
|------|--------|
| `shared/schema.js:341` | `place_id` → `coords_key` |
| `server/lib/venue/venue-enrichment.js` | 4 references updated |
| `scripts/create-all-tables.sql` | Column definition updated |
| `server/db/migrations/2026-01-10-d013-places-cache-rename.sql` | Migration file created |
| `docs/DATABASE_SCHEMA.md` | Documentation updated |
| `docs/architecture/strategy-framework.md` | Documentation updated |

**DB Migration Required:** Run `ALTER TABLE places_cache RENAME COLUMN place_id TO coords_key;` on live database

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
| D-012 | 2026-01-10 | `server/lib/venue/venue-utils.js:37,74` | Changed default country from `'USA'` → `'US'` (ISO alpha-2) |
| D-014 | 2026-01-10 | `server/lib/venue/hours/` | Created canonical hours module; all isOpen functions now wrap `getOpenStatus()` |
| D-018 | 2026-01-10 | `server/lib/venue/venue-intelligence.js` | Now uses canonical hours module; Google `openNow` only for debug comparison |
| D-004 | 2026-01-10 | Multiple files | Country field now uses ISO 3166-1 alpha-2 codes (US, CA, GB) |
| D-011 | 2026-01-10 | `server/api/location/location.js:164` | Changed `c.long_name` → `c.short_name` for country (ISO alpha-2) |
| D-013 | 2026-01-10 | `shared/schema.js`, `venue-enrichment.js`, SQL scripts | Renamed `places_cache.place_id` → `coords_key` for semantic accuracy |
| D-019 | 2026-01-10 | `server/lib/venue/hours/evaluator.js` | Fixed overnight hours day rollover bug: now checks yesterday's spillover + today's main shift |
| D-020 | 2026-01-10 | `shared/schema.js:592` | Fixed index column: `event_date` → `event_start_date` |
| D-021 | 2026-01-10 | `client/src/contexts/co-pilot-context.tsx:494` | Removed deprecated `'complete'` status check, uses `'ok' \|\| 'pending_blocks'` |
| D-022 | 2026-01-10 | `client/src/pages/co-pilot/StrategyPage.tsx:869` | Removed deprecated `'complete'` status check, uses `'ok' \|\| 'pending_blocks'` |
| D-023 | 2026-01-10 | `client/src/contexts/co-pilot-context.tsx:517` | Enrichment now uses `closedVenueReasoning` (camelCase) to match types |
| D-024 | 2026-01-10 | `client/src/contexts/co-pilot-context.tsx:443` | queryFn now returns `pathTaken` with `path_taken` fallback |
| D-025 | 2026-01-10 | `client/src/pages/co-pilot/MapPage.tsx` | Removed duplicate bars fetch, now uses shared `barsData` from `useCoPilot()` |
| D-026 | 2026-01-10 | `client/src/pages/co-pilot/MapPage.tsx:137` | Earnings field now uses `estimatedEarningsPerRide ?? estimatedEarnings` fallback |
| D-027 | 2026-01-10 | `server/api/strategy/blocks-fast.js` | All response paths now use `strategyForNow` (camelCase), client fallbacks removed |

---

## Known Technical Debt (Future Improvements)

These items are **documented and accepted** technical debt. They are NOT blocking deployment but should be addressed in future iterations.

| ID | Area | Issue | Current State | Future Recommendation |
|----|------|-------|---------------|----------------------|
| ARCH-001 | Session Architecture | Users table used for sessions with `onDelete: 'restrict'` | Intentional - prevents data loss when sessions expire (2026-01-05) | Split into separate `sessions` table to decouple session lifecycle from user data |
| ARCH-002 | Async Waterfall | `blocks-fast.js` runs strategy generation synchronously | HTTP request holds connection open (~35-50s) | Use true async: return 202 Accepted + poll/SSE for completion. Risk: mobile clients may timeout |

**Documentation:**
- ARCH-001: `shared/schema.js` comments, `LESSONS_LEARNED.md:1121`
- ARCH-002: `server/jobs/README.md:36`, `blocks-fast.js:556` comments

---

## Adding New Discrepancies

```markdown
| D-XXX | `file:line` | [Brief issue description] | [What the code actually does] | PENDING |
```

After fixing:
1. Change status to RESOLVED
2. Move to Resolved section with date
3. Log in `docs/reviewed-queue/CHANGES.md`
