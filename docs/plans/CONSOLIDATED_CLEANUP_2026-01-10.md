# Consolidated Cleanup Plan - 2026-01-10

**Created:** 2026-01-10
**Sources:** GPT-5.2 Analysis, Claude Opus 4.5 Verification, Existing Audit Docs
**Status:** ACTIVE - Prioritized for implementation

---

## Executive Summary

This plan consolidates findings from multiple audits:
- GPT-5.2 codebase analysis (6 findings)
- refactor-audit-2026-01-10.md (7 critical findings)
- AUDIT_REMEDIATION_PLAN.md (P0-P6 phases)
- AUDIT_LEDGER.md (venue pipeline fixes)
- DOC_DISCREPANCIES.md (18 D-* items)

**Key Insight:** Many issues are already documented but scattered across files. This plan creates a single execution order.

---

## Verification Matrix

| GPT Finding | Verified? | Status | Cross-Reference |
|-------------|-----------|--------|-----------------|
| 1. District Tagging + Closed Go Anyway | ✅ YES | Already implemented | venue-cache.js, venue-intelligence.js |
| 2. isOpen/is_open mismatch | ✅ YES | **ACTIVE BUG** | transformers.js:163, content-blocks.js:177 |
| 3. Reverse-geocode redundancy | ✅ YES | Documented | LESSONS_LEARNED:389 "Duplicate GPS Enrichment" |
| 4. Snapshot + GlobalHeader completeness | ✅ YES | Enforced | blocks-fast gates on formatted_address |
| 5. Consolidation audit exists | ✅ YES | Documented | refactor-audit-2026-01-10.md |
| 6. Hardened workflow plan | ✅ YES | Documented | AUDIT_REMEDIATION_PLAN.md |

---

## Priority 0: Critical Infrastructure Fixes - IMMEDIATE

### Issue S-001: SSE `strategy_ready` Never Fires for NOW Strategy (CRITICAL)

**Severity:** HIGH - Causes polling spam, SSE path dead

**Location:** `migrations/20251209_fix_strategy_notify.sql:21`

**Current Trigger:**
```sql
IF NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL THEN
```

**Problem:**
- Immediate pipeline writes `strategy_for_now`, NOT `consolidated_strategy`
- `consolidated_strategy` stays NULL in the NOW flow
- SSE `strategy_ready` **NEVER fires** for the main use case!
- UI falls back to 2s polling loop

**Fix Required:** Create new migration:
```sql
-- Fire when strategy_for_now becomes non-null (NOW strategy ready)
IF NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL THEN
```

---

### Issue S-002: Advisory Locks Can Leak (CRITICAL)

**Severity:** HIGH - Causes stuck SmartBlocks generation

**Location:** `server/api/strategy/blocks-fast.js:66-93`

**Problem:**
- Comment says `pg_advisory_xact_lock` (transaction-scoped)
- Code uses `pg_advisory_lock` (session-level)
- With connection pooling, acquire/release can hit different sessions
- Locks can leak, causing indefinite hangs

**Fix Required:**
```javascript
// Use transaction-scoped locks (auto-release on commit/rollback)
sql`SELECT pg_try_advisory_xact_lock(hashtext(${snapshotId})) as acquired`
```

---

### Issue S-003: Wrong Error Message in blocks-fast.js

**Severity:** LOW - Confusing but not breaking

**Location:** `server/api/strategy/blocks-fast.js:345`

**Current:** `'Waiting for consolidated strategy to complete'`
**Fix:** `'Waiting for immediate strategy to complete'`

---

### Issue S-004: Status Enum Drift

**Severity:** MEDIUM - Causes inconsistent UI states

**Schema says:** `pending|ok|failed`
**Code uses:** `running`, `complete`, `pending_blocks`

**Fix Required:** Create shared enum constant.

---

### Issue S-005: mapCandidatesToBlocks Missing Snake_Case Tolerance

**Severity:** MEDIUM - Can cause `isOpen: undefined`

**Location:** `server/api/strategy/blocks-fast.js:271`

**Current:** `isOpen: c.features?.isOpen`
**Fix:** Same casing tolerance as `toApiBlock()`:
```javascript
isOpen: c.features?.isOpen ?? c.features?.is_open ?? c.isOpen ?? c.is_open ?? null
```

---

## Priority 0: Contract Drift (API ↔ DB) - IMMEDIATE

### Issue C-001: isOpen/is_open Casing Mismatch

**Severity:** HIGH - Causes `isOpen: undefined` in API responses

**Root Cause:**
```javascript
// transformers.js:163 - Current (BROKEN)
isOpen: dbBlock.features?.isOpen ?? dbBlock.isOpen

// MISSING checks for:
// - dbBlock.is_open (snake_case from DB)
// - dbBlock.features?.is_open (nested snake_case)
```

**Files Affected:**
| File | Line | Issue |
|------|------|-------|
| `server/validation/transformers.js` | 163 | Only checks camelCase |
| `server/api/strategy/content-blocks.js` | 177 | Manual mapping, bypasses transformer |

**Fix Required:**
```javascript
// transformers.js:163 - Fixed (snake/camel tolerant)
isOpen: dbBlock.isOpen ?? dbBlock.is_open ??
        dbBlock.features?.isOpen ?? dbBlock.features?.is_open ?? null
```

**Additional Fix:** content-blocks.js should use `toApiBlock()` instead of manual object construction.

**Test Case:**
```javascript
// Fixture with mixed casing - should all resolve correctly
const fixtures = [
  { is_open: true },                    // snake_case root
  { isOpen: false },                    // camelCase root
  { features: { is_open: true } },      // nested snake
  { features: { isOpen: false } },      // nested camel
];
// All should produce valid isOpen in API response
```

---

### Issue C-002: Other Casing Mismatches in toApiBlock()

**Severity:** MEDIUM - May cause undefined fields

Apply same pattern to all fields in `toApiBlock()` that could have mixed casing:

| Field | Current Check | Should Add |
|-------|--------------|------------|
| `placeId` | `dbBlock.place_id \|\| dbBlock.placeId` | ✅ Already tolerant |
| `proTips` | `dbBlock.pro_tips ?? dbBlock.proTips` | ✅ Already tolerant |
| `businessHours` | `dbBlock.business_hours ?? dbBlock.businessHours` | ✅ Already tolerant |
| `isOpen` | `dbBlock.features?.isOpen ?? dbBlock.isOpen` | ❌ Missing snake_case |
| `streetViewUrl` | `dbBlock.features?.streetViewUrl` | ❌ Missing `street_view_url` |

---

## Priority 1: Duplicate Code Consolidation

### Issue C-003: 4 Duplicate coordsKey Functions

**Source:** refactor-audit-2026-01-10.md, Finding 1

**Current State:**
| Location | Function | Exported? |
|----------|----------|-----------|
| `server/api/location/location.js:13` | `makeCoordsKey()` | No |
| `server/api/location/snapshot.js:23` | `makeCoordsKey()` | No |
| `server/lib/venue/venue-enrichment.js:433` | `getCoordsKey()` | No |
| `server/lib/venue/venue-utils.js:83` | `generateCoordKey()` | Yes |

**Fix:** Create single canonical module:
```javascript
// server/lib/location/coords-key.js
export function coordsKey(lat, lng) {
  return `${Number(lat).toFixed(6)}_${Number(lng).toFixed(6)}`;
}
```

Then replace all 4 implementations with imports.

---

### Issue C-004: Duplicate calculateIsOpen Functions (DIFFERENT SIGNATURES!)

**Source:** refactor-audit-2026-01-10.md, Finding 2

**DANGER:** Same function name, DIFFERENT I/O contracts!

| Location | Signature | Returns |
|----------|-----------|---------|
| `venue-enrichment.js:293` | `(weekdayTexts, timezone)` | `boolean\|null` |
| `venue-utils.js:133` | `(hoursFullWeek, timezone)` | `{is_open, next_close_time, closing_soon}` |

**Fix:** Rename to clarify purpose:
- `venue-enrichment.js` → `calculateIsOpenFromWeekdayText()`
- `venue-utils.js` → `calculateOpenStatusFromHoursObject()`

**Note:** D-014 created canonical hours module - verify these functions now use it.

---

## Priority 2: LLM Adapter Centralization

### Issue C-005: Direct LLM API Calls Outside Adapters

**Source:** refactor-audit-2026-01-10.md, Finding 3

**Files with direct API calls (MUST FIX):**
1. `server/lib/ai/providers/consolidator.js:226,296` - Direct OpenAI/Gemini
2. `server/lib/location/holiday-detector.js:213` - Direct Gemini
3. `server/lib/strategy/planner-gpt5.js:3` - Defines OPENAI_URL
4. `server/api/research/research.js:22,86` - Direct Gemini (2x)
5. `server/api/venue/venue-events.js:46` - Direct Gemini
6. `server/scripts/sync-events.mjs:497,586` - Direct OpenAI/Gemini
7. `server/gateway/assistant-proxy.ts:60,71` - Direct OpenAI/Gemini

**Exceptions (OK to skip):**
- `server/api/chat/realtime.js` - OpenAI Realtime API (different protocol)
- Test scripts

**Fix:** Replace with `callModel(ROLE, ...)` pattern.

---

## Priority 3: Location/Snapshot Flow

### Issue C-006: Duplicate GPS Enrichment on Mount

**Source:** LESSONS_LEARNED.md:389, GPT Finding 3

**Problem:** Client triggers location API twice on load due to `useEffect` + `refreshGPS()` interaction, creating duplicate snapshots.

**Already Fixed?** LESSONS_LEARNED documents the ref pattern fix. Verify implementation in:
- `client/src/contexts/location-context-clean.tsx:593-637`

**Verification:**
```javascript
// Should see this pattern (ref-based, not deps-based)
const refreshGPSRef = useRef();
useEffect(() => { refreshGPSRef.current = refreshGPS; }, [refreshGPS]);
// ... later effect uses refreshGPSRef.current?.() instead of refreshGPS
```

---

### Issue C-007: Bars/Events Queries Run on "Unknown" City

**Source:** AUDIT_REMEDIATION_PLAN.md P3-C, GPT Finding 4

**Problem:** `useBarsQuery` falls back to "Unknown" city and browser timezone.

**Violation:** CLAUDE.md says NO FALLBACKS, must gate on `isLocationResolved`.

**Files to check:**
- `client/src/hooks/useBarsQuery.ts`
- Any component using bars data

**Fix:** Hard gate on `isLocationResolved === true`, no fallbacks.

---

## Priority 4: Session Resume (UX)

### Issue C-008: Strategy Regenerates on App Switch

**Source:** AUDIT_REMEDIATION_PLAN.md P3-A, P3-B, P3-D

**Root Cause:** Strategy cleared on mount + no resume mode.

**Fix Required:**
1. Remove strategy-clearing on mount (both `useStrategyPolling` + `co-pilot-context`)
2. Add resume mode (don't create new snapshot if resuming)
3. Add `reason` to `vecto-snapshot-saved` event: `'init' | 'manual_refresh' | 'resume'`
4. Only trigger `/api/blocks-fast` on `init` or `manual_refresh`, not `resume`

---

## Priority 5: Venue Pipeline (Already Fixed - Verify)

### Issues from AUDIT_LEDGER.md

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Documentation (AUDIT_LEDGER.md) | ✅ COMPLETE |
| 1 | D-013: places_cache.place_id → coords_key | ✅ COMPLETE |
| 2 | Wire Places API into Event ETL | ✅ COMPLETE |
| 3 | Stop Silent Failures (insertVenue) | ✅ COMPLETE |
| 4 | Data Cleanup Script | ⏳ SCRIPT CREATED |

**Remaining Action:**
```bash
node scripts/venue-data-cleanup.js --analyze  # Audit
node scripts/venue-data-cleanup.js --execute  # Clean
```

---

## Implementation Order

### Sprint 1: Contract Drift (Today)

1. **C-001: Fix toApiBlock() casing tolerance**
   - Add `is_open` and `features?.is_open` checks
   - Add unit test fixture

2. **C-002: Update content-blocks.js**
   - Replace manual block mapping with `toApiBlock()`
   - Remove duplicate transformation logic

### Sprint 2: Code Consolidation

3. **C-003: Create coords-key.js canonical module**
   - Create `server/lib/location/coords-key.js`
   - Replace 4 duplicate implementations
   - Update imports

4. **C-004: Rename calculateIsOpen functions**
   - Clarify function signatures in names
   - Verify D-014 canonical hours module usage

### Sprint 3: Adapter Centralization

5. **C-005: Migrate direct LLM calls to adapters**
   - Start with highest-impact files (consolidator.js, sync-events.mjs)
   - Add CI check for direct API calls

### Sprint 4: UX Improvements

6. **C-006, C-007: Verify GPS dedup + bars gating**
7. **C-008: Implement session resume mode**

---

## Verification Commands

```bash
# Check for snake/camel tolerance in transformers
grep -n "is_open\|isOpen" server/validation/transformers.js

# Check for duplicate coordsKey functions
grep -rn "makeCoordsKey\|getCoordsKey\|generateCoordKey\|coordsKey" server/

# Check for direct LLM calls outside adapters
grep -rn "api.openai.com" server/ --include="*.js" --include="*.ts" | grep -v adapters | grep -v models-dictionary
grep -rn "generativelanguage.googleapis.com" server/ --include="*.js" --include="*.ts" | grep -v adapters

# Check for "Unknown" fallbacks in client
grep -rn "Unknown" client/src/hooks/ client/src/components/
```

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `docs/AUDIT_LEDGER.md` | Venue pipeline issues |
| `docs/DOC_DISCREPANCIES.md` | D-* tracking |
| `.serena/memories/refactor-audit-2026-01-10.md` | Code duplication audit |
| `docs/plans/AUDIT_REMEDIATION_PLAN.md` | P0-P6 phases |
| `LESSONS_LEARNED.md` | Historical issues |

---

## Additional Findings from Serena Memories

### From comprehensive_audit_2026_01_10.md
- Country field has 3 incompatible representations (US, USA, United States)
- `pickAddressParts()` uses `c.long_name` - should use `c.short_name`
- Coach schema metadata mismatches (D-005 to D-008) - FIXED

### From d014_d018_audit_verification_2026_01_10.md
- D-014, D-018, D-012 verified as FIXED in code
- D-011 was NOT FIXED (location.js:161 still uses long_name) - NOW FIXED per DOC_DISCREPANCIES.md

### From architectural_fixes_roadmap_2026_01_10.md
- Issue #7-8: Read-time validation redundancy (schema_version column)
- Issue #15: Date handling inconsistency (4 patterns)
- Issue #16: BRIEFING Phase 2 overloaded
- BlocksApi test failures (403 instead of 200/202/400)

### From etl-deep-analysis-file-audit-2026-01-10.md
- 6 duplicate functions (4 coords + 2 isOpen)
- 9 production files bypass LLM adapters
- 21 files modified for event field renaming
- MULTI_STRATEGY_ENABLED silent exit issue

### Canonical Hours Module Architecture
```
server/lib/venue/hours/
├── index.js                    # Barrel export
├── evaluator.js                # getOpenStatus() - SINGLE SOURCE OF TRUTH
├── normalized-types.js         # Type definitions
└── parsers/
    ├── google-weekday-text.js  # Google Places format
    ├── hours-text-map.js       # Text map format
    └── structured-hours.js     # JSON format
```

---

---

## Strategy Flow Analysis (2026-01-10 ULTRATHINK)

Per user request, thorough analysis before any additional DB changes.

**Naming Convention Clarification:**
- `consolidated_strategy` = Daily strategy (manual trigger by end user)
- `strategy_for_now` = NOW/Immediate strategy (pushed to strategy tab)

### Finding A: strategy_ready Notification Logic

**Status:** ✅ ALREADY FIXED (S-001)

**Verification:** `migrations/20260110_fix_strategy_now_notify.sql`
```sql
-- Lines 18-23: Fires for NOW strategy
IF (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL) THEN
  PERFORM pg_notify('strategy_ready', ...);
END IF;

-- Lines 28-33: Fires for Daily strategy
IF (NEW.status = 'ok' AND NEW.consolidated_strategy IS NOT NULL) THEN
  PERFORM pg_notify('strategy_ready', ...);
END IF;
```

**Conclusion:** Migration is correct. SSE will fire for both strategy types once deployed.

---

### Finding B: Status === 'complete' vs Phase Issue

**Status:** ⚠️ CLIENT STILL USES DEPRECATED VALUE

**Problem:** Client code checks `status === 'complete'` but server uses `'ok'`.

**Locations Found:**
| File | Line | Current Code | Impact |
|------|------|--------------|--------|
| `client/src/contexts/co-pilot-context.tsx` | 494 | `if (strategyData.status === 'complete')` | Strategy never shows as "complete" |
| `client/src/pages/co-pilot/StrategyPage.tsx` | ~869 | `status === 'complete'` check | Same issue |

**Server Status Values:** (from `status-constants.js`)
```javascript
STRATEGY_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  OK: 'ok',              // ← This is what server sends
  PENDING_BLOCKS: 'pending_blocks',
  FAILED: 'failed',
}
```

**Fix Required:**
```javascript
// Option 1: Change client to use 'ok'
if (strategyData.status === 'ok') { ... }

// Option 2: Use canonical import
import { STRATEGY_STATUS } from '../../../server/lib/strategy/status-constants.js';
if (strategyData.status === STRATEGY_STATUS.OK) { ... }
```

---

### Finding C: Block-Mapper Divergence

**Status:** ⚠️ TWO DIFFERENT MAPPERS

**Problem:** `blocks-fast.js` has its own `mapCandidatesToBlocks()` function while `content-blocks.js` uses `toApiBlock()`. They produce potentially different output.

**Comparison:**

| Aspect | `blocks-fast.js:mapCandidatesToBlocks()` | `content-blocks.js:toApiBlock()` |
|--------|------------------------------------------|----------------------------------|
| Location | Line 254-320 | `transformers.js` |
| isOpen handling | `c.features?.isOpen ?? c.features?.is_open ?? c.isOpen ?? c.is_open ?? null` | `dbBlock.features?.isOpen ?? dbBlock.isOpen` (less tolerant) |
| Field mapping | Custom inline | Centralized transformer |
| Maintenance | Diverges from canonical | Single source of truth |

**Fix Required:**
1. `content-blocks.js` should use the same fallback chain as `blocks-fast.js`
2. OR both should use `toApiBlock()` with enhanced snake/camel tolerance
3. Consolidate to single canonical mapper

---

### Finding D: event_start_date Column Issue

**Status:** ⚠️ SCHEMA INDEX BUG

**Problem:** `shared/schema.js` line 592 defines an index on `event_date` but the column was renamed to `event_start_date`.

**Current (BROKEN):**
```javascript
// shared/schema.js:592
idxDate: sql`create index if not exists idx_discovered_events_date on ${table} (event_date)`,
```

**Should Be:**
```javascript
idxDate: sql`create index if not exists idx_discovered_events_start_date on ${table} (event_start_date)`,
```

**Impact:** Index may fail to create or may be on wrong/non-existent column.

---

### Finding E: Redundant Call Paths

**Status:** ℹ️ DOCUMENTED - MITIGATED BY DEDUPE

**Architecture:**
```
POST /api/blocks-fast triggered by:
1. useEffect on mount (client/src/contexts/co-pilot-context.tsx:155)
2. Event listener for 'vecto-snapshot-saved' (line 250)
   └── Deduplicated via Set() preventing double calls
```

**Polling Configuration:**
- Strategy polling: 3000ms (`co-pilot-context.tsx:389`)
- Blocks polling: 15000ms (`co-pilot-context.tsx:501`)
- SSE subscription active for `strategy_ready` events

**Conclusion:** Dual trigger is intentional with dedupe. No immediate fix needed, but documented for future session resume improvements (C-008).

---

## Unified Fix Priority for Strategy Flow

| Priority | Issue | Action | Blocking? |
|----------|-------|--------|-----------|
| P0 | D) Schema index bug | Fix `event_date` → `event_start_date` in schema.js | ❌ Not blocking |
| P1 | B) Client status check | Change `'complete'` → `'ok'` in 2 files | ⚠️ UI shows wrong state |
| P2 | C) Mapper divergence | Enhance `toApiBlock()` or consolidate | ⚠️ Can cause isOpen:undefined |
| P3 | A) SSE trigger | Deploy migration (already correct) | ❌ Fixed, needs deploy |
| P4 | E) Dual trigger | Document only | ❌ Mitigated |

---

*This plan consolidates all known issues for unified execution.*
