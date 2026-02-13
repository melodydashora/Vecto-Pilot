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
| S-002 | `server/api/strategy/blocks-fast.js:162-217` | Advisory locks use session-level (can leak) | Now uses `pg_try_advisory_xact_lock` inside `db.transaction()` with two-phase locking | ✅ FIXED |
| S-003 | `server/api/strategy/blocks-fast.js:352` | Error message says "consolidated" | Changed to "Waiting for immediate strategy to complete" | ✅ FIXED |
| S-004 | `server/lib/strategy/status-constants.js` | Status enum drift | Created canonical `STRATEGY_STATUS` enum with all valid values | ✅ FIXED |
| S-005 | `server/api/strategy/blocks-fast.js:276` | `mapCandidatesToBlocks` missing snake_case tolerance | Added full snake/camel fallback chain for `isOpen` | ✅ FIXED |
| S-006 | `server/api/strategy/blocks-fast.js:570-615` | No staleness check for `pending_blocks` status | Added 30-minute staleness detection - resets stale strategy, triad_job, briefing | ✅ FIXED |

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

**Impact of S-006:**
- Previous session failure left `status='pending_blocks'` but no ranking
- New requests saw `isStrategyComplete()` = true and served stale data
- `triad_jobs` row existed → `onConflictDoNothing()` returned null
- TRIAD pipeline never ran → UI showed cached events/strategy from hours/days ago

**Fix for S-006:**
```javascript
// Check staleness (30 minutes threshold)
const strategyAge = Date.now() - new Date(existingStrategy.updated_at).getTime();
if (strategyAge > 30*60*1000 && (isStuckPendingBlocks || isStuckInProgress)) {
  // Reset: strategy status, delete triad_job, delete briefing
  // Fall through to run fresh pipeline
}
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
| D-028 | `server/lib/ai/model-registry.js` | Suboptimal LLM settings | Added thinkingLevel HIGH, lowered temperatures for consistency | ✅ FIXED |
| D-029 | `shared/schema.js:264` | `venue_catalog.country` default was `'USA'` | Fixed to `'US'` (ISO 3166-1 alpha-2) | ✅ FIXED |
| D-030a | `client/src/components/MapTab.tsx:84-94` | MapBar interface used snake_case | Updated to camelCase (`isOpen`, `expenseRank`, `closingSoon`, etc.) | ✅ FIXED |
| D-030b | `client/src/pages/co-pilot/MapPage.tsx:53-66` | MapBar mapped to snake_case | Eliminated mapping layer, uses camelCase directly | ✅ FIXED |
| D-030c | `server/validation/transformers.js:100` | `toApiVenue` missing tolerance | Added snake/camel tolerance for `isOpen`, `closedGoAnyway`, `closedReason` | ✅ FIXED |
| D-030d | `migrations/20260110_rename_event_columns.sql` | DB has `event_date` but schema expects `event_start_date` | Created migration to rename columns for symmetric naming | ✅ CREATED |
| D-031a | `server/lib/briefing/briefing-service.js:865` | `validateEventsHard` returns object, not array | Changed to destructure `{ valid: validatedEvents }` | ✅ FIXED |
| D-031b | `server/lib/briefing/briefing-service.js:813-843` | Event discovery prompt missing date/time requirements | Added STRICT requirements for `event_date`, `event_time`, `event_end_time` | ✅ FIXED |

**Impact of D-031a:**
- "validated is not iterable" error when looping over validateEventsHard result
- All discovered events failed to save to DB

**Impact of D-031b:**
- Gemini returned events without required date/time fields
- 100% validation failure rate (9→0 events, 44→29 events in logs)
- Events rejected for `missing_start_time`, `missing_end_time`

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
| D-032 | `CLAUDE.md:Rule 8` | AI Coach write access table names are wrong | Uses `venue_catalogue`, `market_information`, `user_notes` but actual tables are `venue_catalog`, `market_intelligence`, `user_intel_notes`; `school_event_intel` and `traffic_road_closures` don't exist (data is in `briefings` JSONB columns) | ✅ FIXED |
| D-004 | Multiple files | Country field uses 'USA' not ISO 'US' | All fixed: venue-utils.js (D-012), location.js (D-011) | ✅ FIXED |
| D-011 | `server/api/location/location.js:164` | `pickAddressParts()` country changed to `c.short_name` | Now returns ISO 3166-1 alpha-2 codes (US, CA, GB) | ✅ FIXED |
| D-012 | `server/lib/venue/venue-utils.js:37,74` | Default country was `'USA'` (alpha-3) | Changed to `'US'` (ISO 3166-1 alpha-2) | ✅ FIXED |

---

## COMPREHENSIVE AUDIT (2026-02-01)

**Audit Date:** 2026-02-01
**Conducted By:** Claude Code (5 parallel exploration agents)
**Fix Plan:** `docs/review-queue/FIX_PLAN_2026-02-01.md`
**Total Discrepancies:** 48

### CRITICAL (P0 - Must Fix Immediately)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-037 | `docs/architecture/database-schema.md` | 25 tables completely missing from documentation | Tables exist in `shared/schema.js`: agent_memory, assistant_memory, coach_conversations (partial), cross_thread_memory, eidolon_memory, eidolon_snapshots, llm_venue_suggestions, market_intelligence, places_cache, traffic_zones, travel_disruptions, triad_jobs, user_intel_notes, us_market_cities, vehicle_makes_cache, vehicle_models_cache, venue_events, venue_feedback, venue_metrics, app_feedback, block_jobs, connection_audit, http_idem, strategy_feedback, agent_changes | ✅ FIXED 2026-02-01 |
| D-038 | `docs/architecture/database-schema.md:73-86` | `strategies` table shows OLD columns that no longer exist | Table was refactored 2026-01-14 (LEAN). New columns: `status`, `phase`, `phase_started_at`, `error_message`, `strategy_for_now`, `consolidated_strategy`. OLD columns removed: `strategy`, `error_code`, `attempt`, `latency_ms`, `tokens`, `next_retry_at`, etc. | ✅ FIXED 2026-02-01 |
| D-039 | `ARCHITECTURE.md:38-216` | OmniPage/SignalTerminal feature extensively documented but NOT implemented | `intercepted_signals` DB table exists, but NO `/co-pilot/omni` route, NO `OmniPage.tsx`, NO `SignalTerminal.tsx`, NO `/api/hooks/analyze-offer` endpoint | ✅ FIXED 2026-02-01 (marked as PLANNED) |
| D-040 | `docs/architecture/api-reference.md` | Missing 2 entire API domains | `/api/coach/*` (14+ endpoints) and `/api/intelligence/*` (13+ endpoints) completely missing from centralized API reference | ✅ FIXED 2026-02-01 |
| D-041 | `CLAUDE.md:754-764` | 4 API folders undocumented in Server Structure | Missing: `server/api/coach/`, `server/api/intelligence/`, `server/api/platform/`, `server/api/vehicle/` | ✅ FIXED 2026-02-01 |

### HIGH PRIORITY (P1 - Fix Within 24 Hours)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-042 | `docs/architecture/ai-pipeline.md:12-15` | Model assignments are stale | Events: docs say "SerpAPI + GPT-5.2" → actual is Gemini 3 Pro. News: docs say "Dual-Model" → actual is single Gemini 3 Pro. Traffic: docs say "Gemini 3.0 Flash" → actual is Gemini 3 Pro | ✅ FIXED 2026-02-01 |
| D-043 | `docs/architecture/ai-pipeline.md:150` | Traffic fallback chain wrong | Docs: "TomTom → Claude → Gemini → Static". Actual: "TomTom → Gemini 3 Pro → Gemini 3 Flash → Static" (no Claude) | ✅ FIXED 2026-02-01 |
| D-044 | `client/src/components/README.md:17-18,43-44` | Component files documented that don't exist | Docs: `BarsTable.tsx`, `BarTab.tsx`. Actual: `BarsDataGrid.tsx`, `BarsMainTab.tsx` (renamed 2026-01-09) | ✅ FIXED 2026-02-01 |
| D-045 | Multiple files | `BarsPage.tsx` renamed to `VenueManagerPage.tsx` but docs not updated | Stale refs in: CLAUDE.md:806, ARCHITECTURE.md:378, client/src/pages/co-pilot/README.md:36, client/src/components/README.md:43-44 | ✅ FIXED 2026-02-01 |
| D-046 | `server/api/platform/README.md` | 3 endpoints undocumented | Missing: `GET /api/platform/countries-dropdown`, `GET /api/platform/regions-dropdown`, `GET /api/platform/markets-dropdown` | ✅ FIXED 2026-02-01 |
| D-047 | `server/api/coach/README.md` | 6 endpoints undocumented | Missing: `POST .../pin`, `POST .../restore`, `GET .../stats/summary`, `GET /schema`, `GET /schema/prompt`, `POST /validate/batch` | ✅ FIXED 2026-02-01 |
| D-048 | `server/api/location/README.md` | 5 endpoints undocumented | Missing: `GET /pollen`, `POST /news-briefing`, `GET /ip`, `PATCH /snapshot/:id/enrich`, `GET /snapshots/:id` | ✅ FIXED 2026-02-01 |
| D-049 | `server/api/venue/README.md` | 4 endpoints undocumented | Missing: `GET /traffic`, `GET /smart-blocks`, `GET /last-call`, `POST /venue/events` | ✅ FIXED 2026-02-01 |
| D-050 | `docs/architecture/database-schema.md:352` | `venue_catalog.country` default wrong in docs | Docs: `'USA'`. Code: `'US'` (ISO 3166-1 alpha-2, fixed in D-029) | ✅ FIXED 2026-02-01 (already correct after D-037) |

### MEDIUM PRIORITY (P2)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-051 | `docs/architecture/database-schema.md` | `venue_catalog` only 16 of 40+ columns documented | Missing 24+ columns including: place_id, category, dayparts, staging_notes, metro, district, ai_estimated_hours, business_hours, discovery_source, etc. | ✅ FIXED 2026-02-01 |
| D-052 | `docs/architecture/database-schema.md` | `coach_conversations` missing 8 columns | Missing: parent_message_id, content_type, sentiment, tokens_in, tokens_out, model_used, is_edited, is_regenerated | DEFERRED (table already documented in D-037) |
| D-053 | `docs/architecture/database-schema.md` | `driver_profiles` missing 10+ columns | Missing: zip_code, home_formatted_address, home_timezone, marketing_opt_in, terms_version, profile_complete, legacy uber_* fields | DEFERRED (low usage) |
| D-054 | `docs/architecture/database-schema.md` | `auth_credentials` missing 5 security columns | Missing: last_login_at, last_login_ip, password_changed_at, created_at, updated_at | DEFERRED (low usage) |
| D-055 | `CLAUDE.md:840-849` | Missing 7 routes from Co-Pilot Route Structure | Missing: /co-pilot/settings, /co-pilot/policy, /auth/sign-in, /auth/sign-up, /auth/forgot-password, /auth/reset-password, /auth/terms | ✅ FIXED 2026-02-01 |
| D-056 | `server/lib/README.md` | Missing `traffic/` module entry | `server/lib/traffic/` exists with TomTom integration but not listed in README | ✅ FIXED 2026-02-01 (added to CLAUDE.md) |
| D-057 | `docs/architecture/database-schema.md` | JSONB field schemas undocumented | No schema for: ranking_candidates.features, briefings.weather_current, briefings.traffic_conditions, etc. | ✅ FIXED 2026-02-01 |
| D-058 | `docs/architecture/database-schema.md` | 13 indexes defined for venue_catalog but only 5 documented | Missing: idx_normalized_name, idx_city_state, idx_market_slug, idx_venue_types (GIN), idx_expense_rank, idx_is_bar, idx_is_event_venue, idx_record_status | ✅ FIXED 2026-02-01 (in D-051) |

### LOW PRIORITY (P3)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-059 | `CLAUDE.md` | Intel components folder not mentioned in component overview | `/client/src/components/intel/` has 7 components but not listed in CLAUDE.md Client Structure | ✅ FIXED 2026-02-13 |
| D-060 | `docs/architecture/database-schema.md` | FK onDelete behaviors not documented | Relationships like `discovered_events.venue_id` have `onDelete: 'set null'` but docs don't specify | DEFERRED (requires full schema audit pass) |

### SECURITY (P0 - Auth Gaps Fixed 2026-02-12)

| ID | Location | Issue | Code Truth | Status |
|----|----------|-------|------------|--------|
| D-061 | `server/api/strategy/strategy.js` | No auth middleware | Added `router.use(requireAuth)` - all strategy routes now protected | ✅ FIXED 2026-02-12 |
| D-062 | `server/api/strategy/tactical-plan.js` | No auth middleware | Added `requireAuth` to POST route | ✅ FIXED 2026-02-12 |
| D-063 | `server/api/venue/venue-intelligence.js` | No auth middleware | Added `router.use(requireAuth)` - all venue routes now protected | ✅ FIXED 2026-02-12 |
| D-064 | `server/api/intelligence/index.js` | No auth middleware, POST/PUT/DELETE open | Added `router.use(requireAuth)` - all intelligence routes now protected | ✅ FIXED 2026-02-12 |
| D-065 | `server/api/research/vector-search.js` | No auth middleware, /upsert open for injection | Added `router.use(requireAuth)` - vector search now protected | ✅ FIXED 2026-02-12 |
| D-066 | `server/api/research/research.js` | No auth middleware, AI calls cost money | Added `router.use(requireAuth)` - research routes now protected | ✅ FIXED 2026-02-12 |
| D-067 | `server/api/location/location.js` | No auth middleware, 13 routes open | Added `router.use(requireAuth)` - all location routes now protected | ✅ FIXED 2026-02-12 |
| D-068 | `server/api/health/ml-health.js` | No auth middleware, exposes ML metrics and memory | Added `router.use(requireAuth)` - ML health now protected | ✅ FIXED 2026-02-12 |
| D-069 | `server/api/feedback/actions.js:31` | Used `optionalAuth` allowing anonymous access | Upgraded to `requireAuth` - anonymous users no longer exist | ✅ FIXED 2026-02-12 |
| D-070 | `server/middleware/README.md:71` | Says optionalAuth "is no longer used" | Updated to reflect optionalAuth exists but should not be used for new routes | ✅ FIXED 2026-02-12 |
| D-071 | `server/api/strategy/strategy-events.js` | SSE endpoints have no auth | Left open: EventSource API can't send auth headers; SSE only broadcasts notifications, not data | DEFERRED (by design) |
| D-072 | `server/api/health/health.js` | No auth middleware | Left open: standard for monitoring/health check endpoints | DEFERRED (by design) |
| D-073 | `server/api/health/job-metrics.js` | No auth middleware | Left open: standard for monitoring endpoints | DEFERRED (by design) |
| D-074 | `server/api/platform/index.js` | No auth middleware | Left open: public reference data (markets, cities, countries) | DEFERRED (by design) |
| D-075 | `server/api/vehicle/vehicle.js` | No auth middleware | Left open: public reference data (vehicle makes/models from NHTSA) | DEFERRED (by design) |
| D-076 | `server/api/hooks/analyze-offer.js` | No auth middleware | Left open: intentionally public for Siri Shortcuts integration | DEFERRED (by design) |

**Root Cause:** Express applies NO global auth middleware. Each route file must explicitly import and use `requireAuth`. 9 data-serving route files were missing auth entirely. The pattern should be: every new route file imports `requireAuth` unless explicitly designed as public.

---

**Impact Summary:**
- Developers searching for documented features (OmniPage) will find nothing
- Coach and Intelligence APIs invisible in centralized reference
- AI pipeline model assignments cause confusion about which models are actually used
- Database schema docs significantly outdated after 2026-01-14 LEAN refactoring
- Component renames make docs point to non-existent files

**Resolution:**
See `docs/review-queue/FIX_PLAN_2026-02-01.md` for detailed fix plan with exact edits.

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
- [x] **D-028:** Optimized LLM settings - lowered temperatures, added thinkingLevel HIGH for Gemini roles

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
| D-028 | 2026-01-10 | `server/lib/ai/model-registry.js` | Optimized LLM settings: STRATEGY_CORE temp 0.7→0.5, added thinkingLevel HIGH for 5 Gemini roles |
| D-029 | 2026-01-10 | `shared/schema.js:264` | Fixed `venue_catalog.country` default from `'USA'` to `'US'` (ISO alpha-2) |
| D-030a | 2026-01-10 | `client/src/components/MapTab.tsx` | Updated MapBar interface to camelCase: `isOpen`, `expenseRank`, `closingSoon`, `minutesUntilClose`, `placeId` |
| D-030b | 2026-01-10 | `client/src/pages/co-pilot/MapPage.tsx` | Eliminated snake_case mapping layer, MapBar now uses camelCase directly from useBarsQuery |
| D-030c | 2026-01-10 | `server/validation/transformers.js` | Added `closedGoAnyway`, `closedReason` with snake/camel tolerance; made `isOpen` tolerant |
| D-030d | 2026-01-10 | `migrations/20260110_rename_event_columns.sql` | Created migration: `event_date` → `event_start_date`, `event_time` → `event_start_time` |
| D-032 | 2026-01-14 | `CLAUDE.md:Rule 8` | Fixed AI Coach write access table names: `venue_catalogue`→`venue_catalog`, `market_information`→`market_intelligence`, `user_notes`→`user_intel_notes`; removed non-existent tables (`school_event_intel`, `traffic_road_closures`); added note about JSONB columns for traffic/school data |
| D-033 | 2026-01-15 | `scripts/db-detox.js:127-132,261,277` | Fixed SQL queries using legacy column names: `event_time`→`event_start_time`, `event_date`→`event_start_date` |
| D-034 | 2026-01-15 | `server/api/coach/schema.js:38` | Fixed key_columns array: `event_date`→`event_start_date`, `event_time`→`event_start_time` |
| D-035 | 2026-01-15 | `shared/README.md:49-50` | Updated discovered_events schema documentation to show current columns after D-030 migration |
| D-036 | 2026-01-15 | Multiple architecture docs | Updated `event_date`/`event_time` → `event_start_date`/`event_start_time` in: `ai-coach.md:82`, `Briefing.md:123-124`, `event-discovery.md:97-98,174-175`, `server/api/briefing/README.md:118-119` |
| D-061 | 2026-02-10 | `docs/DATABASE_SCHEMA.md` | Regenerated schema docs to include `uber_connections` and `oauth_states` (53 tables total) |
| D-062 | 2026-02-10 | `server/lib/ai/context/enhanced-context-base.js` | Fixed incorrect relative import paths causing Snapshot table failures |
| D-063 | 2026-02-10 | `server/lib/ai/adapters/index.js` | Integrated `HedgedRouter` for fallback execution (previously unused code) |
| D-077 | 2026-02-13 | `server/api/feedback/feedback.js:178` | Added `requireAuth` to GET /venue/summary — was previously unprotected |
| D-078 | 2026-02-13 | `server/api/venue/closed-venue-reasoning.js` | Refactored from direct `new OpenAI()` to `callModel('VENUE_REASONING')` via adapter |
| D-079 | 2026-02-13 | `server/api/feedback/feedback.js:64,235` | Removed `userId` body fallback — now uses `req.auth.userId` exclusively (IDOR fix) |
| D-059 | 2026-02-13 | `CLAUDE.md` | Added `intel/` components folder to Client Structure tree |
| D-080 | 2026-02-13 | `server/lib/strategy/planner-gpt5.js` | Migrated from direct `callOpenAI()` to `callModel('STRATEGY_TACTICAL')` |
| D-081 | 2026-02-13 | `server/lib/ai/providers/consolidator.js:230` | Migrated from direct `callOpenAI()` to `callModel('STRATEGY_TACTICAL')` |
| D-082 | 2026-02-13 | `server/lib/ai/providers/consolidator.js:880` | Migrated from direct `callAnthropic()` to `callModel('BRIEFING_FALLBACK')` |
| D-083 | 2026-02-13 | `server/lib/location/weather-traffic-validator.js` | Migrated both `callGemini()` calls to `callModel('UTIL_WEATHER_VALIDATOR')` and `callModel('UTIL_TRAFFIC_VALIDATOR')` |
| D-084 | 2026-02-13 | `server/api/venue/venue-events.js` | Migrated from direct `callGemini()` to `callModel('VENUE_EVENTS_SEARCH')` |
| D-085 | 2026-02-13 | `server/lib/venue/venue-intelligence.js:617` | Migrated from direct `callGemini()` to `callModel('VENUE_TRAFFIC')` |
| D-086 | 2026-02-13 | `server/lib/location/holiday-detector.js:215` | Migrated from direct `callGemini()` to `callModel('BRIEFING_HOLIDAY')` |
| D-087 | 2026-02-13 | `client/src/contexts/co-pilot-context.tsx:482` | Removed dead `data.timezone` fallback — blocks-fast never returns timezone |
| D-088 | 2026-02-13 | `server/api/location/snapshot.js:186,197` | Upgraded `console.warn` to `console.error` for briefing/strategy pipeline failures |
| D-089 | 2026-02-13 | `scripts/test-news-fetch.js:13` | Removed hardcoded Frisco/TX/America_Chicago defaults (NO FALLBACKS rule) |
| D-090 | 2026-02-13 | `server/api/auth/auth.js:1260` | Google OAuth stub replaced with real OAuth 2.0 Authorization Code flow |
| D-091 | 2026-02-13 | `server/api/auth/README.md:26-34` | Updated README: social login stubs → Google OAuth documentation |
| D-092 | 2026-02-13 | `CLAUDE.md:860-866` | Added Google/Uber callback routes to Auth Route Structure |
| D-093 | 2026-02-13 | `shared/schema.js:916` | Added `google_id` column to `driver_profiles` for Google OAuth identity linking |

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
