# Historical Change Log

This file consolidates all documented changes from the review-queue system. Organized in reverse chronological order (newest first). Used as persistent memory for the codebase evolution.

---

## 2026-01-10 (Comprehensive)

### Event Discovery Pipeline Hardening (Late Session)

**Commits:** `686d0ffe`, `ae98754d`, `14ea5780`, `22c63f4a`, `fbecce6a`, `8b8584d4`

**Summary:** Fixed critical event data quality issues causing stale/invalid events in briefings.

| Issue | Fix | Files |
|-------|-----|-------|
| S-006 Staleness detection | Fresh briefings now pass through (skip cache when briefing is recent) | `briefing-service.js`, `consolidator.js` |
| Stale barrel exports | Fixed index.js exports in `server/lib/external/` | `external/index.js` |
| Field name inconsistency | Canonical `event_start_date`/`event_start_time` throughout (no fallbacks) | `briefing-service.js`, `strategy-utils.js` |
| LLM date filter missing | Added strict date/time validation at LLM response source | `briefing-service.js` |
| Event discovery alignment | Aligned Prompt/Validation/Query for complete pipeline consistency | Multiple files |

### D-030: Transformation Layer Overhaul (Commit `3751e52a`)

**Complete UI data loss prevention:**

| Component | Fix |
|-----------|-----|
| `MapTab.tsx` | Fixed missing event data on map |
| `co-pilot-context.tsx` | Preserve events through state updates |
| `MapPage.tsx` | Cache events properly |
| `transformers.js` | Complete server response transformation |
| `hours/evaluator.js` | Fix overnight hours calculation |

### D-023 to D-029: Contract Normalization (Commits `dd3a6b6c`, `accdc8f5`, `28d875cb`, `91a3acc1`, `ffa4b2f2`)

**UI/API casing drift fixes:**

| ID | Issue | Resolution |
|----|-------|------------|
| D-023 to D-026 | UI components using wrong property casing | Standardized to camelCase |
| D-027 | Server response casing inconsistent | Added response normalizer |
| D-028 | LLM settings not optimized | Moved to model-registry.js |
| D-029 | venue_catalog.country default 'USA' | Changed to ISO 'US' |

### D-019 to D-022: Schema & Status Fixes (Commits `7b455047`, `28d875cb`)

| ID | Issue | Resolution |
|----|-------|------------|
| D-019 | Overnight hours broken (11PM-2AM shows closed) | Fixed hour wraparound logic |
| D-020 | Missing schema indexes | Added performance indexes |
| D-021 | Client status contract broken | Fixed status field mapping |
| D-022 | Strategy pipeline status issues | S-001 to S-005 audit complete |

### Strategy Pipeline Audit (S-001 to S-005)

**Findings from commit `7b455047`:**

| ID | Issue | Status |
|----|-------|--------|
| S-001 | Status constants scattered | Consolidated to `status-constants.js` |
| S-002 | Duplicate status checks | Removed redundancy |
| S-003 | Missing error states | Added proper error handling |
| S-004 | Status race conditions | Fixed with atomic updates |
| S-005 | Inconsistent status names | Standardized naming |

### Venue Pipeline Root Cause Fix (Commit `d487a47e`)

**CRITICAL data quality issues fixed:**

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Missing place data | `place_id` not propagated | Fixed data flow |
| Invalid coordinates | AI-generated coords used | Enforced Google API only |
| Duplicate venues | Hash collision | Improved hash function |

### D-014/D-018 Canonical Hours Module (Commits `e6b6171d`, `9fbd22ba`, `a9fc8f03`)

**Created unified hours evaluation system:**

```
server/lib/venue/hours/
├── index.js                    # Barrel export
├── evaluator.js                # getOpenStatus() - SINGLE SOURCE OF TRUTH
├── normalized-types.js         # Type definitions
├── README.md                   # Documentation
└── parsers/
    ├── google-weekday-text.js  # Google Places format
    ├── hours-text-map.js       # Text map format
    └── structured-hours.js     # JSON format
```

| ID | Issue | Resolution |
|----|-------|------------|
| D-014 | 3 duplicate isOpen functions | Consolidated to canonical module |
| D-018 | venue-intelligence trusts Google openNow | Uses canonical evaluator |
| D-012 | Default country 'USA' not ISO 'US' | Fixed in venue-utils.js |
| D-011 | location.js uses c.long_name for country | Changed to c.short_name |
| D-004 | Country field inconsistency | All use ISO alpha-2 codes |

### 4-Phase Hardening Plan (Commits `02b5e764`, `24925a47`, `bcd82ab8`)

**Infrastructure created:**

| File | Purpose |
|------|---------|
| `docs/architecture/standards.md` | Comprehensive standards document |
| `docs/preflight/standards.md` | Quick-reference card |
| `scripts/check-standards.js` | CI enforcement (6 checks) |
| `scripts/generate-schema-docs.js` | Auto-generates DATABASE_SCHEMA.md |
| `docs/DATABASE_SCHEMA.md` | Auto-generated schema docs (51 tables) |
| `docs/DOC_DISCREPANCIES.md` | Blocking queue for doc/code conflicts |
| `docs/AUDIT_LEDGER.md` | Audit tracking ledger |

**Memory Files Created:**
- `.serena/memories/comprehensive_audit_2026_01_10.md`
- `.serena/memories/refactor-audit-2026-01-10.md`
- `.serena/memories/architectural_fixes_roadmap_2026_01_10.md`
- `.serena/memories/hardening-4-phase-plan-2026-01-10.md`

### ETL Pipeline Refactoring (Commits `a60e3216`, `75785eae`, `47de0981`)

**New canonical modules in `server/lib/events/pipeline/`:**

| File | Purpose |
|------|---------|
| `types.js` | JSDoc type definitions |
| `normalizeEvent.js` | Canonical event normalization |
| `validateEvent.js` | Schema-versioned validation |
| `hashEvent.js` | Venue suffix stripping, time in hash |
| `README.md` | Pipeline documentation |

**Field Renaming (Symmetric Naming):**
- `event_date` → `event_start_date`
- `event_time` → `event_start_time`
- Creates symmetry with `event_end_date`/`event_end_time`

**Test Coverage:** 57/57 tests passing in `tests/events/pipeline.test.js`

---

## 2026-01-09 (Comprehensive)

### ETL Pipeline Foundation + Model-Agnostic Refactoring

**Commits (early session):** `1241d51f`, `65a26b7f`, `e00c031f`, `4c8c037c`, `a7d5589f`

**SSE Dual System Consolidation:**

| Before (Duplicate) | After (Single Source) |
|-------------------|----------------------|
| `/events` → EventEmitter SSE | Removed from routes.js |
| `/events/*` → DB NOTIFY SSE | Kept as canonical |
| `strategyEmitter.emit()` | Removed (DB NOTIFY canonical) |
| `blocksEmitter.emit()` | Removed (DB NOTIFY canonical) |

**storeEvents() Fixes:**
- Fixed insert counting with `xmax = 0` check
- Changed `ON CONFLICT DO NOTHING` → `DO UPDATE` for venue_id refresh
- Removed defensive 23505 catch (anti-pattern)
- Throws on unexpected duplicate key to surface root cause

### P0/P1 Security Audit (Commits `5ec01bf1`, `815c81a4`, `178a5d58`)

**Security Fixes (P0):**

| Issue | Fix | Files |
|-------|-----|-------|
| Timezone fallback | `/api/location/timezone` returns 502 on error | `location.js` |
| Auth bypass | Removed `user_id` query param impersonation | `location.js`, `location-context-clean.tsx` |
| Ownership leak | `blocks-fast` enforces snapshot ownership | `blocks-fast.js` |
| NULL bypass | Ownership middleware rejects NULL-owned snapshots | `require-snapshot-ownership.js` |

**Contract Fixes (P1):**

| Issue | Fix | Files |
|-------|-----|-------|
| Response fallbacks | Removed client-side fallbacks tolerating broken contract | `co-pilot-context.tsx` |
| Storage keys | Replaced hardcoded `'vectopilot_auth_token'` with constants | 5 client files |

**Schema Cleanup Phase 1 & 2:**

| Phase | Change |
|-------|--------|
| Phase 1 | Consolidated reads to canonical columns (`drive_minutes`, `distance_miles`) |
| Phase 2 | Stopped writing legacy columns (`drive_time_min`, `straight_line_km`) |
| Bug Fix | **25-mile filter was completely broken** - property name mismatch |

### Service Account Pattern (Commit `4013740e`)

- Implemented Service Account pattern for AI Agent authentication
- Updated auth middleware for service account support
- Strategy API changes for agent authentication

### Schema Consistency (Commit `be2f761d`)

- Standardized to camelCase property names
- Updated BarsDataGrid.tsx, auth-context.tsx, co-pilot-context.tsx
- Fixed strategy API response format

### Component Renames (Commit `cf3e0296`)

**Disambiguation to prevent AI confusion:**

| Before | After | Reason |
|--------|-------|--------|
| BarsTable.tsx | (kept) | Already disambiguated |
| BarTab.tsx | (kept) | Already disambiguated |
| (confusing names) | (clear names) | Prevent AI model confusion |

### API Response Schemas (Commit `12abe27b`)

- Added transformation layer for consistent camelCase responses
- Created `server/validation/response-schemas.js`
- Created `server/validation/transformers.js`

### Coordinate Precision Upgrade (Commit `bdf40e4f`)

- Upgraded from 4 decimals (~11m) to 6 decimals (~11cm)
- Critical for GPS-first policy
- Prevents cache collisions

### Database Detox Script (Commit in session)

**New `scripts/db-detox.js`:**
- 8-phase database cleanup
- Cleaned 582 duplicate venue rows
- FK-aware deduplication
- Supports `--analyze` and `--execute` modes

### Documentation Updates

**Files Updated:**
- `ARCHITECTURE.md` - Added server/lib/events/, tests/events/
- `server/lib/README.md` - Added events/ subfolder
- `server/README.md` - Added lib/events/ to structure
- `CLAUDE.md` - Added EVENTS workflow, folder map
- `docs/architecture/ai-pipeline.md` - Added Event ETL Pipeline section
- `LESSONS_LEARNED.md` - Added SSE consolidation, defensive catch anti-pattern

---

## 2026-01-10 (Previous Entry - Retained for Reference)

### D-014/D-018 Audit Verification + D-011 Fix (Session 2)

**Verified Fixes from commits `9fbd22ba` and `e6b6171d`:**

| ID | Issue | Resolution | Verified |
|----|-------|------------|----------|
| D-014 | 3 duplicate isOpen functions | Created canonical hours module (`server/lib/venue/hours/`) | ✅ |
| D-018 | venue-intelligence.js trusts Google openNow | Now uses canonical module; openNow only for debug | ✅ |
| D-012 | Default country 'USA' not ISO 'US' | Changed to 'US' in venue-utils.js:37,74 | ✅ |
| D-011 | location.js uses c.long_name for country | **FIXED THIS SESSION** - changed to c.short_name | ✅ |
| D-004 | Country field inconsistency | All components now use ISO alpha-2 codes | ✅ |

**Canonical Hours Module Architecture:**
```
server/lib/venue/hours/
├── index.js                    # Barrel export
├── evaluator.js                # getOpenStatus() - SINGLE SOURCE OF TRUTH
├── normalized-types.js         # Type definitions
├── README.md                   # Documentation
└── parsers/
    ├── google-weekday-text.js  # Google Places format
    ├── hours-text-map.js       # Text map format
    └── structured-hours.js     # JSON format
```

**Wrapper Pattern:**
- `venue-hours.js` → `parseStructuredHoursFullWeek()` + `getOpenStatus()`
- `venue-enrichment.js` → `parseGoogleWeekdayText()` + `getOpenStatus()`
- `venue-utils.js` → `parseHoursTextMap()` + `getOpenStatus()`

**Documentation Updated:**
- `docs/DOC_DISCREPANCIES.md` - Marked D-014, D-018, D-012, D-011, D-004 as FIXED
- Phase 1 and Phase 3 marked COMPLETE in 4-Phase Hardening Plan
- `.serena/memories/d014_d018_audit_verification_2026_01_10.md` - Audit findings stored

**Code Fix (D-011):**
```javascript
// server/api/location/location.js:164
// BEFORE: if (types.includes("country")) country = c.long_name;  // "United States"
// AFTER:  if (types.includes("country")) country = c.short_name; // "US"
```

---

### Comprehensive Architecture Audit + Hardening Protocol

**Memory Files Created:**
- `.serena/memories/comprehensive_audit_2026_01_10.md` - Full findings
- `.serena/memories/refactor-audit-2026-01-10.md` - ETL deep analysis
- `.serena/memories/architectural_fixes_roadmap_2026_01_10.md` - Prioritized roadmap

**Hardening Protocol Infrastructure:**

| File | Purpose |
|------|---------|
| `docs/architecture/standards.md` | Comprehensive 10-section standards document |
| `docs/preflight/standards.md` | Quick-reference card for all standards |
| `scripts/check-standards.js` | CI enforcement (6 checks) |
| `scripts/generate-schema-docs.js` | Auto-generates DATABASE_SCHEMA.md from schema.js |
| `docs/DATABASE_SCHEMA.md` | Auto-generated schema docs (51 tables) |
| `docs/DOC_DISCREPANCIES.md` | Blocking queue for doc/code conflicts |

**CRITICAL: Coach Schema Metadata Mismatches (D-005 to D-008)**

AI Coach is prompted with **wrong column names** causing hallucination:

| Table | Coach Says | Actual Schema |
|-------|------------|---------------|
| `snapshots` | `id` (PK) | `snapshot_id` |
| `strategies` | `immediate_strategy` | `strategy_for_now` |
| `briefings` | `traffic`, `weather` | `traffic_conditions`, `weather_current`, `weather_forecast` |
| `venue_catalog` | `opening_hours` | `business_hours` |

**Fix Location:** `server/api/coach/schema.js:23-43`

**Country Field Inconsistency (3 incompatible representations):**

| Source | Value | Format |
|--------|-------|--------|
| `pickAddressParts()` | "United States" | Full name (c.long_name) |
| `venue_catalog.country` | "USA" | Alpha-3 |
| `driver_profiles.country` | "US" | Alpha-2 (correct) |

**Root Cause:** `server/api/location/location.js:161` uses `c.long_name` instead of `c.short_name`

**ETL Pipeline Refactoring (Complete):**
- Created canonical modules in `server/lib/events/pipeline/`
- Symmetric field naming: `event_date` → `event_start_date`, `event_time` → `event_start_time`
- 57/57 tests passing

**Active Discrepancy Count:** 12 total (4 Critical, 5 High, 3 Medium)

See `docs/DOC_DISCREPANCIES.md` for full tracking.

---

## 2026-01-09

### P0/P1 Security Audit + Schema Cleanup (commits 5ec01bf, 815c81a, 178a5d5)

**Security Fixes (P0):**

| Issue | Fix | Files |
|-------|-----|-------|
| P0-1: Timezone fallback | `/api/location/timezone` returns 502 on error instead of server TZ | `location.js` |
| P0-2: Auth bypass | Removed `user_id` query param impersonation vulnerability | `location.js`, `location-context-clean.tsx` |
| P0-3: Ownership leak | `blocks-fast` now enforces snapshot ownership, writes `user_id` | `blocks-fast.js` |
| P0-4: NULL bypass | Ownership middleware rejects NULL-owned snapshots | `require-snapshot-ownership.js` |

**Contract Fixes (P1):**

| Issue | Fix | Files |
|-------|-----|-------|
| P1-5: Response fallbacks | Removed client-side fallbacks tolerating broken contract | `co-pilot-context.tsx` |
| P1-6: Storage keys | Replaced all hardcoded `'vectopilot_auth_token'` with `STORAGE_KEYS.AUTH_TOKEN` | 5 client files |

**Schema Cleanup Phase 1 & 2:**

| Phase | Change | Files |
|-------|--------|-------|
| Phase 1 | Consolidated reads to canonical columns (`drive_minutes`, `distance_miles`) | `intelligence/index.js`, `blocks-fast.js` |
| Phase 2 | Stopped writing legacy columns (`drive_time_min`, `straight_line_km`, etc.) | `enhanced-smart-blocks.js` |
| Bug Fix | **25-mile filter was completely broken** - property name mismatch (snake_case vs camelCase) | `blocks-fast.js` |

**Phase 3 (Deferred 48-72h):** Drop 4 redundant columns from `ranking_candidates` table after data cycles out.

**Documentation:**
- Added 25-mile filter bug to `LESSONS_LEARNED.md`
- Created `docs/plans/SCHEMA_CLEANUP_PLAN.md`
- Created `docs/memory/RESUME_PROTOCOL_2026-01-09.md`

---

### Database Detox + Root Cause Fixes

**Database Cleanup (`scripts/db-detox.js`):**
- Created comprehensive database cleanup script with 8 phases
- Cleaned 582 duplicate venue rows (Comerica Center: 68→1, Stonebriar Centre: 67→1)
- Added FK-aware deduplication (cleans `venue_metrics` before `venue_catalog`)
- Script supports `--analyze` (dry run) and `--execute` modes

**Critical Bug Fixes:**

| Issue | File | Fix |
|-------|------|-----|
| Venue linking broken | `server/scripts/sync-events.mjs:134` | Changed `venue.id` → `venue.venue_id` (PK mismatch) |
| Password chars logged | `server/api/auth/auth.js:225,567` | Removed first/last char logging (security) |
| LISTEN client race | `server/db/db-client.js` | Added `connectPromise` for initial connection lock |

**SSE Dual System Consolidation:**

Root cause of "data not pushed/fetched properly" - two SSE systems at overlapping paths:

| Before (Duplicate) | After (Single Source) |
|-------------------|----------------------|
| `/events` → EventEmitter SSE | Removed from routes.js |
| `/events/*` → DB NOTIFY SSE | Kept as canonical |
| `strategyEmitter.emit()` in blocks-fast.js | Removed (DB NOTIFY canonical) |
| `blocksEmitter.emit()` in blocks-fast.js | Removed (DB NOTIFY canonical) |

**Files Modified:**
- `scripts/db-detox.js` - NEW: Database cleanup script
- `server/scripts/sync-events.mjs` - Fixed venue_id field access
- `server/api/auth/auth.js` - Removed password character logging
- `server/db/db-client.js` - Added connection promise pattern
- `server/bootstrap/routes.js` - Removed duplicate `/events` mount
- `server/api/strategy/blocks-fast.js` - Removed EventEmitter emits
- `server/api/strategy/strategy-events.js` - Added `/events/phase` endpoint
- `LESSONS_LEARNED.md` - Added SSE Dual System Consolidation section

### SSE Cleanup + storeEvents Fix (commits 4c8c037, a7d5589)

**PhaseEmitter Extraction:**
- Created `server/events/phase-emitter.js` (dedicated module)
- Deleted `server/api/briefing/events.js` (legacy SSE router)
- Updated imports in strategy-events.js, blocks-fast.js

**briefing_ready Trigger:**
- Created `migrations/20260109_briefing_ready_notify.sql`
- Fires when `traffic_conditions` populated
- `/events/briefing` SSE now has a producer

**storeEvents() Fixes:**
- Fixed insert counting with `xmax = 0` check (RETURNING-based)
- Changed `ON CONFLICT DO NOTHING` → `DO UPDATE` for venue_id refresh
- Removed defensive 23505 catch (anti-pattern - see LESSONS_LEARNED)
- Now throws on unexpected duplicate key to surface root cause

**Documentation Updates:**
- Updated `server/api/briefing/README.md` - removed events.js reference
- Updated `docs/architecture/progress-bar-and-snapshot-flow.md` - fixed SSE endpoint
- Updated `docs/architecture/database-schema.md` - venue_cache → venue_catalog
- Updated `SYSTEM_MAP.md` - consolidated SSE endpoint listing
- Added "Defensive Catch Anti-Pattern" to LESSONS_LEARNED.md

---

## 2026-01-08

**Commits:** `a18cd3d`, `b7fe00b`, `7e6130d`, `a625be9`, `2534c07`

### Level 4 Architecture: Omni-Presence & Siri Interceptor (Documentation)
- Added `intercepted_signals` table schema to `docs/architecture/database-schema.md`
- Added `/co-pilot/omni` route and `SignalTerminal.tsx` component to `UI_FILE_MAP.md`
- Added "External Input Sources" section with Siri Shortcut data flow to `SYSTEM_MAP.md`
- Added "Headless Client Integration" section to `ARCHITECTURE.md`
- Updated Table Dependency Graph to include `intercepted_signals`

**New Components (Planned):**
- `OmniPage.tsx` - Omni-Presence signal terminal page
- `SignalTerminal.tsx` - Real-time offer analysis display
- `OfferCard.tsx` - Individual offer display card
- `DecisionBadge.tsx` - ACCEPT/REJECT badge component

**New API Endpoints (Planned):**
- `POST /api/hooks/analyze-offer` - Analyze ride offer from OCR text
- `GET /api/hooks/signals` - Fetch recent intercepted signals
- `SSE /api/hooks/signals/stream` - Real-time signal updates
- `PUT /api/hooks/signal/:id/override` - Override AI decision

### Manual Refresh Race Condition Fix
- **CRITICAL:** Fixed race condition where manual refresh would restore `lastSnapshotId` before completing the refresh
- Added `isManualRefresh` flag to prevent snapshotId restoration during refresh
- Fixed strategy clearing and workflow regeneration on manual refresh
- Updated `client/src/contexts/co-pilot-context.tsx` with manual refresh flag logic
- Updated `client/src/hooks/useStrategyPolling.ts` to check manual refresh flag

### Documentation Updates
- Added race condition fix to `LESSONS_LEARNED.md`
- Updated `client/src/contexts/README.md` and `client/src/hooks/README.md`

### Files Modified
- `client/src/contexts/co-pilot-context.tsx` - Manual refresh flag
- `client/src/hooks/useStrategyPolling.ts` - Respect manual refresh flag
- `client/src/components/BriefingTab.tsx` - Briefing UI changes
- `client/src/pages/co-pilot/BriefingPage.tsx` - Page-level updates
- `server/api/briefing/briefing.js` - Briefing API updates

---

## 2026-01-07

**Commits:** `8859041`, `3e1d893` (Audit remediation: security + no-fallbacks + PII logging)

### Security Audit Remediation (P0/P1/P2 Complete)

**P0 - Critical Security Fixes:**
| Issue | Resolution |
|-------|------------|
| Agent env-update accessible to any user | Added `requireAgentAdmin` middleware |
| IP allowlist accepts `*` wildcard | Block wildcard in production (returns 403) |
| Timezone fallback to UTC | Removed - returns `null` if missing |
| State/market fallbacks | Removed - throws error on missing data |
| PII in logs (full UUIDs) | Truncated to 8 chars |

**P1 - Technical Debt:**
| Issue | Resolution |
|-------|------------|
| Coach chat calls API directly | Now uses adapter pattern (`callModel`) |
| Fragile JSON parsing in adapters | Replaced regex with proper extraction |
| Client sends full strategy text | Reduced to IDs only |
| Coords cache precision docs wrong | Fixed to 6 decimals (~11cm) |

**P2 - Dispatch Primitives (Schema Only):**
| Table | Purpose |
|-------|---------|
| `driver_goals` | Earning/trip targets with deadlines |
| `driver_tasks` | Hard stops and time constraints |
| `safe_zones` | Geofence safety boundaries |
| `staging_saturation` | Anti-crowding tracker using H3 cells |

**P2-E - AI Change Protocol:**
- Created `docs/preflight/ai-change-protocol.md`

### AI Adapter Updates
- Updated Gemini adapter to use @google/genai SDK
- Added streaming support via `callGeminiStream()`
- Added Vertex AI adapter for Google Cloud deployment
- Updated adapter README with new {TABLE}_{FUNCTION} role naming

### Files Modified
- `server/agent/embed.js` - IP allowlist, admin middleware
- `server/agent/routes.js` - Admin-only route protection
- `server/api/chat/chat.js` - PII truncation, adapter pattern
- `server/api/chat/realtime.js` - PII truncation
- `server/api/health/diagnostics.js` - GPT-5.2 parameter fix
- `server/lib/venue/venue-enrichment.js` - Timezone fallback removal
- `server/lib/ai/adapters/gemini-adapter.js` - SDK migration, streaming
- `server/lib/ai/adapters/index.js` - Role mapping updates
- `shared/schema.js` - Dispatch primitives tables

---

## 2026-01-06

**Commits:** `e7ff4af`, `8706d13`, `a8ad8ea`, `1ca8c6e`, `95bd2b6`

### Security & Critical Fixes
- **CRITICAL:** Fixed destructive cascade deletes in database schema
- Added SECURITY.md documentation
- Fixed Haiku model 404 errors
- Fixed events endpoint deduplication

### AI Coach Enhancements
- Added schema awareness to AI Coach
- Implemented validation layer for coach responses
- Added notes CRUD operations (create, read, update, delete)
- Updated `server/api/chat/chat.js` with improved handling
- Modified `server/lib/ai/coach-dal.js` for data access

### Other Changes
- Updated `server/lib/strategy/strategy-utils.js`
- Modified `server/middleware/auth.js`
- Updated `server/agent/embed.js` and `server/agent/routes.js`
- Cleaned up npm vulnerabilities
- Removed dead code

### Files Modified
- `.claude/settings.local.json`
- `LESSONS_LEARNED.md`
- `client/src/components/CoachChat.tsx`
- `client/src/components/GlobalHeader.tsx`
- `client/src/components/auth/*` (multiple auth components)
- `client/src/contexts/auth-context.tsx`
- `client/src/contexts/location-context-clean.tsx`
- `client/src/hooks/README.md`
- `client/src/hooks/useBriefingQueries.ts`
- `client/src/pages/auth/*` (ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage)
- `client/src/pages/co-pilot/BriefingPage.tsx`
- `server/agent/*` (README, embed.js, routes.js)
- `server/middleware/*` (README, auth.js)

---

## 2026-01-05

**Commits:** `3c753ec`, `9b85443`, `c09b16b`, `db54074`, `95bd2b6`

### Codebase Audit - Health Score: 92/100

**Security Issues Fixed:**
| Issue | Severity | Resolution |
|-------|----------|------------|
| JWT_SECRET fallback mismatch (auth.js vs location.js) | HIGH | FIXED |
| `qs` npm package vulnerability | HIGH | FIXED |
| `esbuild` vulnerabilities (via drizzle-kit) | MODERATE | FIXED (npm override) |
| `resolveVenueAddressString` deprecated (no callers) | LOW | REMOVED |

**Confirmed Working Systems:**
- Venue Consolidation (venue_catalog unified)
- Highlander Session Model (one session per user)
- PostgreSQL Advisory Locks (horizontal scaling ready)
- Gemini 3 adapter upgraded (@google/genai SDK)
- Timezone-aware event filtering
- BarsTable trusts server's isOpen calculation
- Event deduplication (similar name/address/time grouping)

### Major Changes (113 files in commits)
- Updated documentation and renamed model calls
- Added 'haiku' to LEGACY_ROLE_MAP for backward compatibility
- Implemented `filterFreshEvents()` to prevent stale events in briefings
- Updated all model references to latest versions

### AI Model Updates
- Modified `server/lib/ai/llm-router-v2.js`
- Updated `server/lib/ai/model-registry.js`
- Changed `server/lib/ai/models-dictionary.js`
- Updated `server/lib/ai/adapters/gemini-2.5-pro.js`

### New Files Added
- `.serena/.gitignore` and `.serena/project.yml` (Serena MCP integration)
- `.serena/memories/` directory with memory files
- `CLAUDE-OPUS-4.5-FULL-ANALYSIS.md`
- `SAVE-IMPORTANT.md`
- `UBER_INTEGRATION_TODO.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/DATA_FLOW_MAP.json`
- `scripts/analyze-data-flow.js`
- `scripts/generate-schema-docs.js`
- `scripts/generate-schema-docs.sh`
- `scripts/resolve-venue-addresses.js`
- `client/src/types/demand-patterns.ts`
- `client/src/types/tactical-map.ts`
- `platform-data/uber/Airports/uber-us-airports-with-market.txt`
- `server/scripts/seed-uber-airports.js`
- `tools/research/flagship-models-2026-01-02.json`

### Files Deleted (Cleanup)
- `COACH_DATA_ACCESS.md`
- `ERRORS.md`
- `INTERACTIVE_REPO.md`
- `ISSUES.md`
- `NEWERRORSFOUND.md`
- `PRODISSUES.md`
- `REORGANIZATION_PLAN.md`
- `REPO_FILE_LISTING.md`

### Strategy & Briefing Changes
- Modified `server/lib/strategy/strategy-utils.js`
- Updated `server/api/briefing/briefing.js`
- Changed `client/src/components/BriefingTab.tsx`
- Modified `client/src/components/RideshareIntelTab.tsx`

---

## 2026-01-02

**Commit:** `679b306` (Published your App)

### AI & Coach Changes
- Updated `server/lib/ai/coach-dal.js`
- Modified `server/lib/ai/providers/consolidator.js`
- Changed `server/api/chat/chat.js`

### Briefing System
- Modified `server/api/briefing/briefing.js`
- Updated `server/lib/briefing/briefing-service.js`
- Changed `client/src/components/BriefingTab.tsx`

### Location & Snapshots
- Updated `client/src/contexts/location-context-clean.tsx`
- Modified `server/api/location/location.js`
- Changed `server/api/location/snapshot.js`

### Database & Schema
- Updated `shared/schema.js`
- Modified `docs/architecture/database-schema.md`

### New Scripts
- Added `server/scripts/seed-markets.js`
- Added `server/scripts/seed-uber-airports.js`
- Added `platform-data/uber/Airports/` directory

### Documentation Updates
- Modified `ARCHITECTURE.md`
- Updated `LESSONS_LEARNED.md`
- Changed `SYSTEM_MAP.md`
- Updated `UI_FILE_MAP.md`
- Modified `WORKFLOW_FILE_LISTING.md`

---

## 2026-01-01

**Commit:** `679b306` (Published your App)

### Root Documentation Overhaul
- Updated `ARCHITECTURE.md`
- Modified `SYSTEM_MAP.md`
- Changed `UI_FILE_MAP.md`
- Updated `WORKFLOW_FILE_LISTING.md`
- Modified `APICALL.md`

### Briefing Service
- Updated `server/lib/briefing/briefing-service.js`
- Modified `server/api/briefing/briefing.js`

### Markets API
- Added new markets-related endpoints
- Updated location context for market awareness

### Context Provider Changes
- Modified `client/src/contexts/location-context-clean.tsx`

---

## 2025-12-31

**Notable Changes:**

### GPS Location Fixes
- Fixed GPS location context issues
- Updated `client/src/contexts/location-context-clean.tsx`

### Authentication Pages
- Updated `client/src/pages/auth/ForgotPasswordPage.tsx`
- Modified `client/src/pages/auth/ResetPasswordPage.tsx`
- Changed `client/src/pages/auth/SignInPage.tsx`
- Updated `client/src/pages/auth/SignUpPage.tsx`

### Settings Page
- Added user settings functionality
- Updated settings-related components

---

## 2025-12-30

**Commits:** Multiple analysis sessions

### Strategy System
- Added strategy dump utility
- Modified `server/lib/strategy/strategy-utils.js`
- Updated strategy pipeline providers

### Holiday Detection
- Enhanced holiday detector logic
- Updated `server/lib/location/holiday-detector.js`

### Market Intelligence
- Added market intelligence features
- Enhanced consolidator providers

### Documentation
- Updated multiple README files
- Modified architecture docs

---

## 2025-12-29

**Multiple analysis sessions**

### Briefing Utilities
- Added briefing dump utility
- Updated `server/lib/briefing/briefing-service.js`

### Strategy Tactical Planner
- Enhanced tactical planner functionality
- Modified strategy generation logic

### Large-scale Changes
- 40-62 uncommitted file changes tracked
- Significant auth system modifications
- Component updates across client

---

## 2025-12-28

**Commits:** `fb3683f`, `b9fc00f`, `4a857af`

### Major: Authentication System Implementation
- Added `server/api/auth/auth.js`
- Created `client/src/contexts/auth-context.tsx`
- Added auth pages:
  - `client/src/pages/auth/ForgotPasswordPage.tsx`
  - `client/src/pages/auth/ResetPasswordPage.tsx`
  - `client/src/pages/auth/SignInPage.tsx`
  - `client/src/pages/auth/SignUpPage.tsx`
- Added `client/src/components/auth/` directory
- Created `client/src/types/auth.ts`
- Added `docs/architecture/authentication.md`
- Created `migrations/20251228_auth_system_tables.sql`

### Map Features
- Added bar markers on map (green=open, red=closing soon)
- Implemented multi-day event support with date range filtering
- Enhanced SmartBlocks with two-pass filtering (Grade A/B, spacing preferred)

### Briefing Fixes
- GlobalHeader shows "Resolving location..." instead of raw coords
- Briefing queries run as soon as snapshotId exists (removed pipeline phase gate)
- Smart retry for placeholder data (traffic, news, airport poll every 5s until real data)
- Added retry count limit to prevent infinite polling

### Database Schema Changes
- Modified `shared/schema.js`
- Created `migrations/20251228_drop_snapshot_user_device.sql`
- Updated `server/api/location/snapshot.js`
- Modified `server/lib/location/get-snapshot-context.js`

### Documentation
- Created `docs/memory/sessions/2025-12-28-map-features.md`
- Updated `client/src/components/README.md` for MapTab bar markers

### Files Modified
- `client/src/App.tsx`
- `client/src/routes.tsx`
- `package.json` and `package-lock.json`
- `server/api/platform/index.js`
- `server/bootstrap/routes.js`

---

## 2025-12-27

**Commit:** `b9fc00f`

### Major: Co-Pilot Router Refactor (799 files)
The co-pilot page was split into separate route-based pages:

| Route | Page Component |
|-------|----------------|
| `/co-pilot/strategy` | StrategyPage.tsx |
| `/co-pilot/bars` | BarsPage.tsx |
| `/co-pilot/briefing` | BriefingPage.tsx |
| `/co-pilot/map` | MapPage.tsx |
| `/co-pilot/intel` | IntelPage.tsx |
| `/co-pilot/about` | AboutPage.tsx |

### New Architecture
- Created `client/src/layouts/CoPilotLayout.tsx` for shared layout
- Added `client/src/contexts/co-pilot-context.tsx` for shared state
- Implemented `BottomTabNavigation` component

### Route Structure
```
/                         → Redirects to /co-pilot/strategy
/co-pilot                 → Redirects to /co-pilot/strategy
/co-pilot/strategy        → StrategyPage (AI + blocks + coach)
/co-pilot/bars            → BarsPage (venue listings)
/co-pilot/briefing        → BriefingPage (weather, traffic, news)
/co-pilot/map             → MapPage (interactive map)
/co-pilot/intel           → IntelPage (rideshare intel)
/co-pilot/about           → AboutPage (no GlobalHeader)
```

---

## 2025-12-18

**Changes tracked:**

### Authentication System Additions
- Early auth system changes
- Email alerts functionality added

### Strategy Pipeline
- Updated strategy providers
- Modified consolidator logic

---

## 2025-12-17

**Commit:** `3f44c1e` (Published your App)

### Strategy Pipeline Changes
- Modified `server/lib/strategy/strategy-utils.js`
- Updated `server/lib/ai/providers/consolidator.js`

### Component Updates
- Changed `client/src/components/SmartBlocksStatus.tsx`
- Modified `client/src/components/ui/alert.tsx`
- Updated `client/src/components/ui/toast.tsx`

### Hooks Updated
- `client/src/hooks/useEnrichmentProgress.ts`
- `client/src/hooks/useStrategyPolling.ts`
- `client/src/hooks/useVenueLoadingMessages.ts`

### Venue Logic
- Modified `server/lib/venue/enhanced-smart-blocks.js`
- Changed `server/lib/venue/event-matcher.js`

### New Files
- Added `server/lib/notifications/email-alerts.js`

### Background Jobs
- Modified `server/jobs/change-analyzer-job.js`

---

## 2025-12-16

**Multiple analysis sessions**

### Event Badge & UI
- Event badge styling changes
- Progress bar fixes

### SmartBlocks
- Enhanced SmartBlocks functionality
- Modified venue enrichment logic

### Strategy API
- Updated `server/api/strategy/blocks-fast.js`
- Changed `server/api/strategy/content-blocks.js`

---

## 2025-12-15

**Commits:** `df8ad89`, `d493581`, `00bae36`

### Change Analyzer System Created
- Added `server/jobs/change-analyzer-job.js`
- Created `server/lib/change-analyzer/file-doc-mapping.js`
- Created `docs/review-queue/README.md`
- Added `docs/review-queue/pending.md`

### AI Tools Documentation
- Added `docs/ai-tools/README.md`
- Created `docs/ai-tools/agent.md`
- Added `docs/ai-tools/assistant.md`
- Created `docs/ai-tools/eidolon.md`
- Added `docs/ai-tools/mcp.md`
- Created `docs/ai-tools/memory.md`

### SmartBlocks Event Feature
- Added event flag feature for SmartBlocks venues
- Created `server/lib/venue/event-matcher.js`

### Error Documentation
- Added `NEWERRORSFOUND.md`

### Other Changes
- Modified `gateway-server.js`
- Updated `server/api/mcp/mcp.js`
- Changed `client/src/hooks/useEnrichmentProgress.ts`
- Modified `client/src/pages/co-pilot.tsx` (before router split)
- Updated `client/src/types/co-pilot.ts`

---

## Documentation Areas Requiring Attention

Based on analysis, the following documentation files may need updates:

### High Priority
- `docs/architecture/auth-system.md` - Authentication changes
- `docs/architecture/api-reference.md` - API endpoint changes
- `docs/architecture/database-schema.md` - Schema changes
- `docs/preflight/database.md` - Database updates
- `docs/preflight/ai-models.md` - Model adapter changes
- `docs/architecture/ai-pipeline.md` - AI pipeline updates

### Medium Priority
- `docs/architecture/client-structure.md` - Component/context changes
- `docs/preflight/location.md` - Location/GPS changes
- `docs/architecture/constraints.md` - Constraint updates

### Low Priority
- `docs/architecture/server-structure.md` - Server structure changes
- Various folder README.md files

---

*This file is maintained by the change analyzer and manual review. Do not delete entries - only add new ones at the top.*
