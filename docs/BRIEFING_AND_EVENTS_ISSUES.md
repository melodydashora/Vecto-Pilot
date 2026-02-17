# Briefing & Events Pipeline: Known Issues

**Created:** 2026-02-17
**Last Verified:** 2026-02-17 (all claims code-verified against actual files)
**Context:** Deep analysis of the briefing pipeline during event-sync-job removal. These issues were identified by tracing the complete flow from snapshot creation through event discovery, venue linking, and strategist delivery.

## Verification Status

| Issue | Verified | Status |
|-------|----------|--------|
| Issue 1: Venue Creation Gap | CONFIRMED — **FIXED 2026-02-17** | Fixed |
| Issue 2: Two Discovery Paths | CONFIRMED | Open |
| Issue 3: Past Event Cleanup | CONFIRMED — **FIXED 2026-02-17** | Fixed |
| Issue 4: UTC Date in Cleanup | CONFIRMED — **FIXED 2026-02-17** (resolved by Issue 3 fix) | Fixed |
| Issue 5: `sql` not imported (market events) | CONFIRMED — **FIXED 2026-02-17** | Fixed |
| Issue 6: Event Cleanup Loop Dead Code | SUPERSEDED — per-snapshot cleanup replaces loop approach | Superseded |
| Issue 7: TTL Automation Not Implemented | CONFIRMED — no `expires_at` column, no trigger | Open |
| Issue 8: Event Verifier Subagent Unused | CONFIRMED — never imported | Low Priority |
| Race Condition: Strategist vs Briefing | NOT PRESENT — guard exists since 2026-01-10 | Verified Safe |
| Venue Consolidation (6-phase plan) | COMPLETE — all phases done | Verified Done |
| VENUELOGIC.md `is_bar`/`is_event_venue` | IMPLEMENTED — schema lines 301-304 | Verified Done |

### Race Condition Analysis (Verified Safe)

The strategist does NOT re-read briefing from DB. The flow in `blocks-fast.js`:
1. **Line 688:** `await runBriefing(snapshotId)` — properly awaited
2. **Line 689:** `freshBriefing = briefingResult.briefing` — captured from return value (AFTER DB write at `briefing-service.js:2271-2289`)
3. **Line 738:** `await runImmediateStrategy(snapshotId, { briefingRow: freshBriefing })` — passed directly
4. **`consolidator.js:963`:** Uses `options.briefingRow` directly, skips DB read

Comment at line 737: *"Pass fresh briefing directly (no DB re-read for stale data)"* — explicit guard since 2026-01-10.

### Issue 3 Correction

`cleanupPastEvents()` is the only **bulk date-based** deactivator. But other code paths also set `is_active = false`:
- `PATCH /api/briefing/event/:eventId/deactivate` (briefing.js:1094) — single event deactivation
- `coachDAL.deactivateEvent()` (coach-dal.js:1809) — AI Coach deactivation
- `POST /api/chat/deactivate-event` (chat.js:1399) — user-triggered via chat
- `scripts/db-detox.js` (line 277) — hard DELETES past events (more aggressive)

---

## Issue 1: Venue Creation Gap

**Severity:** HIGH — Events appear on map without proper venue records

### The Problem

There are two event discovery paths with different venue handling:

| Path | Entry Point | Venue Behavior |
|------|-------------|----------------|
| **Briefing pipeline** (per-snapshot) | `fetchEventsForBriefing()` in `briefing-service.js:1046` | `lookupVenueFuzzy()` — **read-only lookup, never creates venues** |
| **Manual refresh** (`/refresh-daily`) | `syncEventsForLocation()` in `sync-events.mjs:938` | `findOrCreateVenue()` — **creates new venues, enriches existing** |

### Impact

When a user gets events through the normal per-snapshot flow (login, location refresh):
- Events with **existing** venue_catalog matches get linked correctly (venue_id FK set)
- Events at **new** venues get stored in `discovered_events` with `venue_id = NULL`
- These unlinked events have raw AI-generated coordinates (not Google-verified)
- The venue never gets added to `venue_catalog` unless the user manually hits "Refresh Daily"

### Where in Code

- **Briefing path (lookup only):** `briefing-service.js:1082-1099`
  ```javascript
  const matchedVenue = await lookupVenueFuzzy({ venueName, city, state });
  if (matchedVenue) { venueId = matchedVenue.venue_id; }
  // If no match → venueId stays null, no venue created
  ```

- **Sync path (find or create):** `sync-events.mjs` Phase 3 calls `processEventsWithVenueCache(events)` which calls `findOrCreateVenue()` in `venue-cache.js:423`
  ```
  1. Lookup by place_id (Google Place ID)
  2. Lookup by coord_key (6-decimal)
  3. Fuzzy match on normalized_name
  4. IF NO MATCH → insertVenue() with venue_types: ['event_host']
  5. IF match without place_id → UPDATE venue with geocoded place_id
  ```

### Fix Applied (2026-02-17) — Option A

Replaced `lookupVenueFuzzy()` with `geocodeEventAddress()` + `findOrCreateVenue()` in the briefing pipeline.

**Changes:**
1. **NEW `server/lib/events/pipeline/geocodeEvent.js`** — Extracted geocoding from `sync-events.mjs` into shared ETL module
2. **`briefing-service.js:1084-1117`** — Per-event: geocode address → `findOrCreateVenue()` (creates venue if new)
3. **`sync-events.mjs`** — Removed private geocoding functions, imports shared module

**Flow (per event in briefing pipeline):**
```
event.venue_name + city + state
    → geocodeEventAddress() → { lat, lng, place_id, formatted_address }
    → findOrCreateVenue() → lookup by place_id → coord_key → fuzzy name → CREATE
    → venue_id populated in discovered_events
```

**Graceful degradation:** If geocoding fails, `findOrCreateVenue` still attempts fuzzy match (same as old `lookupVenueFuzzy` behavior). Events only get `venue_id = NULL` if both geocoding AND fuzzy match fail AND no coordinates exist.

---

## Issue 2: Two Separate Event Discovery Code Paths

**Severity:** MEDIUM — Duplicate logic, different provider sets, maintenance burden

### The Problem

Event discovery exists in two completely separate implementations:

| | Briefing Pipeline | Sync Pipeline |
|---|---|---|
| **File** | `briefing-service.js` (`fetchEventsForBriefing`) | `sync-events.mjs` (`syncEventsForLocation`) |
| **Providers** | Gemini google_search (2 categories) + Claude fallback | SerpAPI + GPT-5.2 + Gemini + Claude + Perplexity (5 providers) |
| **When** | Every snapshot (login/refresh) | Manual "Refresh Daily" button |
| **Venue linking** | `findOrCreateVenue()` (was lookupVenueFuzzy, fixed 2026-02-17) | `findOrCreateVenue()` (create + enrich) |
| **Geocoding** | `geocodeEventAddress()` per-event (fixed 2026-02-17) | `geocodeMissingCoordinates()` batch via Google Maps |
| **ETL** | Normalize + Validate + Hash + Fuzzy Link + Store + Read | Validate + Geocode + VenueCache + Store |

### Impact

- Both paths normalize/validate/hash events independently
- The briefing pipeline uses fewer AI providers (faster, cheaper, but finds fewer events)
- The sync pipeline geocodes and creates venues (more complete, but only on manual refresh)
- Bug fixes in one path don't automatically apply to the other
- The ETL modules (`normalizeEvent`, `validateEvent`, `hashEvent`) are shared, but the orchestration around them is duplicated

### Where in Code

- **Briefing path orchestration:** `briefing-service.js:1046-1228`
- **Sync path orchestration:** `sync-events.mjs:938-1033`
- **Shared ETL modules:** `server/lib/events/pipeline/` (normalizeEvent.js, validateEvent.js, hashEvent.js)

### Resolution Options

- **Option A:** Unify into a single `discoverEvents()` function with a `mode` parameter (fast vs full)
- **Option B:** Have the briefing pipeline call `syncEventsForLocation()` directly with a `briefingMode: true` flag
- **Option C:** Keep separate but ensure venue creation happens in both paths

---

## Issue 3: Past Event Cleanup Orphaned

**Severity:** MEDIUM — Past events accumulate in discovered_events without deactivation
**Status:** FIXED 2026-02-17

### The Problem

`cleanupPastEvents()` was only called from the daily event sync job (`event-sync-job.js:50-59`). With the daily job's scheduled timer removed (2026-02-17), this cleanup no longer ran automatically.

### Fix Applied (2026-02-17) — Option A (per-snapshot cleanup)

**Rewritten:** `server/lib/briefing/cleanup-events.js`
- Renamed: `truncateOldEvents()` → `deactivatePastEvents(timezone)`
- Changed: Hard DELETE → soft-deactivate (`is_active = false`, `deactivated_at = NOW()`)
- Fixed: UTC date → timezone-aware date using `toLocaleDateString('en-CA', { timeZone })` (also resolves Issue 4)
- Added: `WHERE is_active = true` guard (skip already-deactivated events)
- Removed: Default timezone `'America/Chicago'` — NO FALLBACKS rule (throws if missing)
- Added: End-time awareness — deactivates events where `event_end_date < today` OR `(event_end_date = today AND event_end_time < now)`

**Wired into:** `briefing-service.js:1065-1070` inside `fetchEventsForBriefing()`
- Runs before event discovery on every snapshot
- Uses `snapshot.timezone` for accurate local time
- Non-fatal: cleanup failure doesn't block discovery

**Other deactivation paths (unchanged):**
- `PATCH /api/briefing/event/:eventId/deactivate` (briefing.js:1094) — single event
- `coachDAL.deactivateEvent()` (coach-dal.js:1809) — AI Coach
- `POST /api/chat/deactivate-event` (chat.js:1399) — user-triggered via chat

---

## Issue 4: Event Date Uses UTC for Cleanup

**Severity:** LOW (related to local_iso fix applied 2026-02-17)
**Status:** FIXED 2026-02-17 (resolved by Issue 3 fix)

### The Problem

The old `cleanupPastEvents()` used `new Date().toISOString().split('T')[0]` which gives the UTC date, not the driver's local date.

### Fix

The rewritten `deactivatePastEvents(timezone)` in `cleanup-events.js` uses:
```javascript
const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD in driver's tz
const timeStr = now.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }); // HH:MM
```

Timezone is REQUIRED (throws if missing) — comes from `snapshot.timezone` at the call site in `fetchEventsForBriefing()`.

---

## Issue 5: `sql` Not Imported in briefing.js (Market Events Broken)

**Severity:** HIGH — Market-wide events never load
**Status:** FIXED 2026-02-17

### The Problem

`server/api/briefing/briefing.js` line 756 uses the `sql` tagged template from drizzle-orm:

```javascript
sql`${discovered_events.category} IN ('sports', 'concert', 'festival')`
```

But line 6 imported everything EXCEPT `sql`:

```javascript
import { eq, desc, and, gte, lte, ilike, not, or } from 'drizzle-orm';
// Missing: sql
```

This caused a `ReferenceError: sql is not defined` every time the market events query ran. The catch at line 794 swallowed it:

```javascript
} catch (marketError) {
  console.error('[BriefingRoute] Market events lookup failed (non-blocking):', marketError.message);
}
```

### Impact

- **All market-wide events silently failed** — users in a metro market (e.g., "Dallas-Fort Worth") only saw events from their exact city (e.g., Frisco), not from Arlington, Plano, Dallas, etc.
- The `sql` IN clause was added 2026-02-10 (line 754 comment: "Include major categories regardless of attendance tag")
- The bug has been live for **7 days** without detection because the error was caught as "non-blocking"

### Fix Applied

Added `sql` to the import (line 6):

```javascript
import { eq, desc, and, gte, lte, ilike, not, or, sql } from 'drizzle-orm';
```

### Lesson

This is a textbook case of the **NO SILENT FAILURES** rule (CLAUDE.md). The catch at line 794 labels the error "non-blocking" and continues — exactly the anti-pattern the rule forbids. The `sql is not defined` error was architecturally impossible to fix without checking the import, and the "graceful degradation" comment masked a real bug for a week.

---

## Reference: Current Event Flow Diagram

```
USER ACTION (login / location refresh / manual button)
    |
    v
POST /api/blocks-fast { snapshotId }
    |
    +--[Phase 2]--→ generateAndStoreBriefing()
    |                 |
    |                 +--→ fetchEventsForBriefing()
    |                 |     |
    |                 |     0. deactivatePastEvents(timezone) — soft-deactivate ended events
    |                 |     1. Gemini google_search (2 parallel categories)
    |                 |        └─ Fallback: Claude web_search
    |                 |     2. normalizeEvent() each
    |                 |     3. validateEventsHard() — reject TBD/broken
    |                 |     4. generateEventHash() — MD5 dedup key
    |                 |     5. geocodeEventAddress() — Google Geocoding API (place_id + coords)
    |                 |     6. findOrCreateVenue() — link or CREATE in venue_catalog
    |                 |     7. INSERT discovered_events ON CONFLICT UPDATE
    |                 |     8. SELECT discovered_events LEFT JOIN venue_catalog
    |                 |        └─ deduplicateEvents() + filterInvalidEvents()
    |                 |
    |                 +--→ [weather, traffic, news, closures, airport in parallel]
    |                 |
    |                 +--→ Write ALL to briefings table
    |                 |
    |                 +--→ pg_notify('briefing_ready')
    |
    +--[Phase 3]--→ runImmediateStrategy()
    |                 └─ briefing data + snapshot → GPT-5.2 → strategy_for_now
    |
    +--[Phase 4]--→ SmartBlocks generation
    |
    v
RETURN to client


MANUAL REFRESH (button click)
    |
    v
POST /api/briefing/refresh-daily/:snapshotId
    |
    +--→ syncEventsForLocation() [5 AI providers]
    |     |
    |     1. SerpAPI + GPT-5.2 + Gemini + Claude + Perplexity (parallel)
    |     2. validateEventsHard()
    |     3. geocodeMissingCoordinates() via Google Maps
    |     4. findOrCreateVenue() — CREATES new venues in venue_catalog
    |     5. storeEvents() — UPSERT discovered_events
    |
    +--→ fetchRideshareNews() [in parallel with events]
    |
    v
RETURN event + news counts
```

### Table Relationships

```
snapshots ──1:1──→ briefings
    │                  └── events JSONB ← read from discovered_events JOIN venue_catalog
    │
    ├──1:1──→ strategies (strategy_for_now uses briefing data)
    │
    └──1:1──→ rankings ──1:N──→ ranking_candidates

discovered_events ──N:1──→ venue_catalog (via venue_id FK, can be NULL)
    └── event_hash (UNIQUE) deduplication key
    └── is_active (AI Coach toggleable)
```

---

## Cross-Reference Analysis (2026-02-17)

*Added by cross-referencing: Venue Architecture Consolidation Plan (2026-01-05), VENUELOGIC.md (2026-01-10), EVENT_FRESHNESS_AND_TTL.md (2026-01-14), and current codebase state.*

### Issue 6: Event Cleanup Loop Never Started (Dead Code) — SUPERSEDED

**Severity:** MEDIUM → SUPERSEDED by Issue 3 fix
**Source:** Cross-reference with `EVENT_FRESHNESS_AND_TTL.md`

**Original problem:** `event-cleanup.js` exports `startCleanupLoop()` but no file calls it — dead code.

**Resolution:** The per-snapshot `deactivatePastEvents()` call (Issue 3 fix) supersedes the hourly loop approach. Every snapshot automatically cleans up past events using the driver's timezone. The loop-based approach is no longer needed.

**Remaining dead code:**
- `server/jobs/event-cleanup.js` — `startCleanupLoop()` never called. **Candidate for deletion.**
- `fn_cleanup_expired_events()` — DB function referenced in docs but likely doesn't exist (no `expires_at` column). See Issue 7.

---

### Issue 7: TTL Automation Partially Implemented

**Severity:** HIGH — Schema doesn't match documented TTL system
**Source:** Cross-reference with `EVENT_FRESHNESS_AND_TTL.md`

**What the docs say:**
`EVENT_FRESHNESS_AND_TTL.md` describes a full TTL automation system:
- `discovered_events` has an `expires_at` column
- A BEFORE INSERT trigger `trigger_validate_event` on table `events_facts` rejects past events
- Auto-sets `expires_at = event_end_time + 24 hours`
- Migration: `drizzle/0008_event_ttl_automation.sql`

**What the schema actually has:**
- `discovered_events` has **NO `expires_at` column** — verified in `shared/schema.js`
- The trigger references `events_facts` — a table that **does not exist** in the schema (the actual table is `discovered_events`)
- `discovered_events` uses `is_active` boolean + `deactivated_at` timestamp for lifecycle management
- Compare: `traffic_zones` table DOES have `expires_at` — showing the pattern was used elsewhere

**Why it doesn't match:**
The TTL automation appears to have been designed (docs written, migration SQL drafted) but the Drizzle schema in `shared/schema.js` was never updated to include `expires_at`. The table name mismatch (`events_facts` vs `discovered_events`) suggests the design doc was written against a planned schema rename that never happened. The actual codebase uses `is_active` flag-based deactivation instead of TTL-based expiration.

**Impact:**
- No automatic event expiration exists in the database layer
- The "defense in depth" described in EVENT_FRESHNESS_AND_TTL.md is missing its DB-level layer
- All event lifecycle management depends on application-level code (Issue 3)

---

### Issue 8: Event Verifier Subagent Unused

**Severity:** LOW — Dead code, but no functional impact
**Source:** Cross-reference with `EVENT_FRESHNESS_AND_TTL.md`

**What the docs say:**
`EVENT_FRESHNESS_AND_TTL.md` describes an LLM-powered event verification subagent:
- `server/lib/subagents/event-verifier.js` exports `verifyEvent()`, `verifyEventBatch()`, `filterVerifiedEvents()`
- Uses fallback chain: anthropic → openai → google
- Verifies validity, freshness, impact scoring

**What the code actually does:**
- The file EXISTS and exports these functions ✅
- **No file in the codebase imports or calls any of these functions** ❌
- The verification step is not part of either event discovery path (briefing pipeline or sync pipeline)

**Why it doesn't match:**
The subagent was built as part of the 2026-01-14 freshness work but was likely deemed too slow/expensive for per-event verification in the hot path. The pipeline instead relies on `validateEventsHard()` (rule-based, no LLM call) and `filterFreshEvents()` (date comparison, no LLM call) — both are faster and cheaper.

---

### Venue Architecture Consolidation: COMPLETE

**Source:** Cross-reference with Venue Architecture Consolidation Plan (2026-01-05)

The 6-phase venue consolidation plan is **fully implemented**:

| Phase | Status | Evidence |
|-------|--------|----------|
| 1. Add consolidated columns to `venue_catalog` | ✅ DONE | `is_bar`, `is_event_venue`, `record_status` exist in schema with defaults and indexes |
| 2. Migrate data from `venue_cache` | ✅ DONE | `migrate-venues-to-catalog.ARCHIVED.js` — migration script archived |
| 3. Migrate data from `nearby_venues` | ✅ DONE | `nearby_venues` deleted from schema (comment at line 637-638) |
| 4. Update all code references | ✅ DONE | All code (venue-cache.js, venue-intelligence.js, sync-events.mjs) uses `venue_catalog` |
| 5. Drop old tables | ✅ DONE | `venue_cache` deleted (comment at line 367-368), `nearby_venues` deleted |
| 6. Add utility functions | ✅ DONE | `server/lib/venue/venue-utils.js` exists with `normalizeVenueName()`, `generateCoordKey()` |

**Extra work beyond original plan:**
- `record_status` column added (not in original plan) — values: `'stub'` (default), used for lifecycle tracking
- Three indexes on the new columns (lines 314-316 in schema.js)

**Relationship to Issue 1 (Venue Creation Gap):**
The consolidation being complete does NOT resolve Issue 1. The gap is about **when venues get created** (briefing path = never, sync path = always), not about which table they're stored in. Both paths now correctly target `venue_catalog`, but the briefing path still only does read-only lookups.

---

### VENUELOGIC.md: Proposed Solution Now Implemented

**Source:** Cross-reference with `VENUELOGIC.md` (2026-01-10)

VENUELOGIC.md Section "Proposed Solution (Pending Melody's Architecture Decision)" says:
> *Add explicit boolean flags to track discovery source: `is_bar`, `is_event_venue`*
> *These flags would be set at the point of discovery, not inferred later.*

**Current state:** Both flags ARE implemented in `shared/schema.js`:
```
is_bar: boolean("is_bar").default(false).notNull()        — line 301
is_event_venue: boolean("is_event_venue").default(false).notNull()  — line 302
```

VENUELOGIC.md needs updating to reflect this is no longer "proposed" but "implemented."

---

### EVENT_FRESHNESS_AND_TTL.md: Multiple Discrepancies

| Claim | Reality | Status |
|-------|---------|--------|
| `expires_at` column on discovered_events | Column does NOT exist | ❌ Doc Wrong |
| Trigger on `events_facts` table | Table `events_facts` does NOT exist | ❌ Doc Wrong |
| `startCleanupLoop()` called from gateway-server.js | NOT imported or called anywhere | ❌ Doc Wrong |
| `event-verifier.js` in active pipeline | Not imported anywhere in codebase | ❌ Dead Code |
| `filterFreshEvents()` in strategy-utils.js | EXISTS and actively used | ✅ Correct |
| `normalizeEvent` / `validateEventsHard` / `generateEventHash` | EXISTS and actively used | ✅ Correct |
| Canonical field names (event_start_date etc.) | Correctly used throughout | ✅ Correct |
| Client-side `filterFreshEvents` in BriefingPage.tsx | Would need verification | ⚠️ Unverified |

**Summary:** The ETL pipeline portion of EVENT_FRESHNESS_AND_TTL.md is accurate. The TTL/expiration automation portion (DB trigger, expires_at column, cleanup loop, LLM verifier) is largely unimplemented or dead code.

---

## Comprehensive Pipeline Inventory (2026-02-17)

*Full analysis of all briefing, events, and venue files across the codebase. Categorized by status.*

### ACTIVE — In Production Pipeline

| File | Role | Called From |
|------|------|------------|
| `server/lib/briefing/briefing-service.js` | Main briefing generation + event discovery | `blocks-fast.js` |
| `server/lib/briefing/cleanup-events.js` | Soft-deactivate past events per-snapshot | `briefing-service.js:1065` |
| `server/lib/events/pipeline/normalizeEvent.js` | Canonical event normalization | `briefing-service.js`, `sync-events.mjs` |
| `server/lib/events/pipeline/validateEvent.js` | Hard validation (11 rules) | `briefing-service.js`, `sync-events.mjs`, `consolidator.js` |
| `server/lib/events/pipeline/hashEvent.js` | MD5 dedup hash | `briefing-service.js`, `sync-events.mjs` |
| `server/lib/events/pipeline/geocodeEvent.js` | Google Geocoding (shared module) | `briefing-service.js`, `sync-events.mjs` |
| `server/lib/events/pipeline/types.js` | JSDoc type definitions | Used across pipeline |
| `server/scripts/sync-events.mjs` | Full 5-provider sync (manual refresh) | `briefing.js:/refresh-daily` |
| `server/lib/venue/venue-cache.js` | `findOrCreateVenue()`, venue lookup | `briefing-service.js`, `sync-events.mjs` |
| `server/lib/venue/venue-enrichment.js` | Google Places enrichment, `isOpen` | `blocks-fast.js` Phase 3 |
| `server/lib/venue/venue-intelligence.js` | Venue scoring for Tactical Planner | `blocks-fast.js` Phase 3 |
| `server/lib/venue/venue-utils.js` | `normalizeVenueName()`, `generateCoordKey()` | `venue-cache.js`, `sync-events.mjs` |
| `server/lib/venue/hours/venue-hours.js` | Business hours parsing and evaluation | `venue-enrichment.js` |
| `server/lib/briefing/filter-for-planner.js` | Filter events for Tactical Planner | `blocks-fast.js` Phase 3 |
| `server/lib/briefing/event-matcher.js` | Match events ↔ venues for SmartBlocks | `enhanced-smart-blocks.js` |
| `server/lib/briefing/venue-event-verifier.js` | Verify event-venue matches (hours + proximity) | `event-matcher.js` |
| `server/lib/briefing/enhanced-smart-blocks.js` | Generate SmartBlocks with event context | `blocks-fast.js` Phase 4 |
| `server/lib/briefing/district-detection.js` | Detect entertainment districts | `enhanced-smart-blocks.js` |
| `server/lib/briefing/dump-last-briefing.js` | Debug dump of last briefing row | `briefing-service.js` (imported) |
| `server/lib/briefing/phase-emitter.js` | SSE phase progress to client | `briefing-service.js`, `blocks-fast.js` |
| `server/lib/strategy/strategy-events.js` | Event formatting for strategy text | `consolidator.js` |
| `client/src/components/co-pilot/EventsComponent.tsx` | Events UI display | `BriefingPage.tsx` |
| `client/src/features/strategy/events.ts` | Event category constants + types | `EventsComponent.tsx` |

### DEAD CODE — Never Called / Never Imported

| File | Exports | Evidence |
|------|---------|----------|
| `server/jobs/event-cleanup.js` | `startCleanupLoop()` | Zero callers in codebase. Superseded by per-snapshot `deactivatePastEvents()` |
| `server/lib/subagents/event-verifier.js` | `verifyEvent()`, `verifyEventBatch()`, `filterVerifiedEvents()` | Zero imports in codebase. LLM verification deemed too slow for hot path |
| `server/lib/briefing/event-schedule-validator.js` | `validateEventSchedules()`, `filterVerifiedEvents()` | Commented out in `briefing-service.js:7` since discovery moved to Gemini |
| `server/lib/briefing/event-proximity-boost.js` | `calculateProximityBoost()` | Zero imports. Was planned for distance-based event scoring |
| `server/lib/briefing/context-loader.js` | Context assembly helpers | Zero external imports — only used internally by other dead files |

### NOT MOUNTED — Routes Exist but Unreachable

| File | Endpoint | Evidence |
|------|----------|----------|
| `server/api/venue/venue-events.js` | `POST /api/venue/events` | File exists but is NOT imported in any route mounting file |
| `server/api/venue/closed-venue-reasoning.js` | `POST /api/venue/closed-venue-reasoning` | File exists but is NOT imported in any route mounting file |

### SCRIPTS — Run Manually, Not In Pipeline

| File | Purpose | Status |
|------|---------|--------|
| `server/scripts/link-events.js` | Repair script: link orphan events to venues | Manual tool, works independently |
| `server/scripts/fix-venue-flags.js` | Set `is_bar`/`is_event_venue` on existing venues | One-time migration script |
| `server/scripts/resolve-venue-addresses.js` | Geocode venues missing addresses | Manual repair tool |
| `server/scripts/venue-data-cleanup.js` | Clean venue data inconsistencies | Manual repair tool |

### DEV TOOLS — Debug/Test Only

| File | Purpose |
|------|---------|
| `server/lib/briefing/dump-latest.js` | Dump latest briefing for debugging |
| `server/lib/briefing/dump-traffic-format.js` | Dump traffic data format for debugging |
| `server/scripts/test-api.js` | Test API endpoints manually |
| `server/scripts/test-event-dedup.js` | Test event deduplication logic |

### Deletion Candidates (Melody's Decision — Rule 10)

These files are confirmed dead code with no callers. They should be reviewed and either deleted or documented as intentionally preserved:

1. **`server/jobs/event-cleanup.js`** — Superseded by `cleanup-events.js` per-snapshot approach
2. **`server/lib/subagents/event-verifier.js`** — Never integrated, replaced by rule-based validation
3. **`server/lib/briefing/event-schedule-validator.js`** — Commented out since Gemini migration
4. **`server/lib/briefing/event-proximity-boost.js`** — Never integrated
5. **`server/lib/briefing/context-loader.js`** — No external consumers

---

## Files Referenced

| File | Role | Status |
|------|------|--------|
| `server/api/strategy/blocks-fast.js` | Main pipeline entry point | Active |
| `server/lib/briefing/briefing-service.js` | Briefing generation + event discovery (Path A) | Active |
| `server/lib/briefing/cleanup-events.js` | `deactivatePastEvents()` — per-snapshot event cleanup | Active (2026-02-17) |
| `server/lib/events/pipeline/normalizeEvent.js` | Canonical event normalization | Active |
| `server/lib/events/pipeline/validateEvent.js` | Hard validation (11 rules) | Active |
| `server/lib/events/pipeline/hashEvent.js` | MD5 dedup hash generation | Active |
| `server/lib/events/pipeline/geocodeEvent.js` | Shared geocoding module (Google Geocoding API) | Active (2026-02-17) |
| `server/scripts/sync-events.mjs` | Full event sync with 5 providers (Path B) | Active |
| `server/lib/venue/venue-cache.js` | Venue lookup + creation (`findOrCreateVenue`) | Active |
| `server/lib/venue/venue-utils.js` | Shared venue utilities (normalizeVenueName, generateCoordKey) | Active |
| `server/lib/ai/providers/consolidator.js` | Strategy generation (consumes briefing data) | Active |
| `server/api/briefing/briefing.js` | `/refresh-daily` and `/discover-events` endpoints | Active |
| `shared/schema.js` | Table definitions (discovered_events, venue_catalog, briefings) | Active |
| `server/jobs/event-sync-job.js` | Former daily sync job (timer removed 2026-02-17) | Dead code |
| `server/jobs/event-cleanup.js` | Cleanup loop — **superseded** by per-snapshot approach | Dead code |
| `server/lib/subagents/event-verifier.js` | LLM event verifier — **never imported** | Dead code |
| `server/lib/briefing/event-schedule-validator.js` | Schedule validator — **commented out** | Dead code |
| `server/lib/briefing/event-proximity-boost.js` | Proximity boost — **never imported** | Dead code |
| `docs/VENUELOGIC.md` | Venue field population audit (2026-01-10) | Reference doc |
| `docs/EVENT_FRESHNESS_AND_TTL.md` | TTL system docs (partially inaccurate — see Issues 6-8) | Reference doc |
