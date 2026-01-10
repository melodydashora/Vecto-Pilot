# Architectural Fixes Roadmap - 2026-01-10

## Summary

This document tracks architectural improvements identified during the ETL pipeline refactoring audit. Issues are prioritized by impact and complexity.

---

## Completed Fixes (2026-01-10)

| Issue | Fix | Commit |
|-------|-----|--------|
| #17 Duplicate function names | Renamed db-detox.js `deduplicateEvents` → `purgeEventDuplicatesFromDB` | a60e3216 |
| Model-specific naming | Renamed `searchWithGemini3Pro` → `searchWithGoogleSearch` (capability-based) | a60e3216 |
| Redundant provider | Removed `searchWithGemini25Pro` (duplicate, wrong model) | a60e3216 |
| ETL Pipeline | Created canonical modules in `server/lib/events/pipeline/` | a60e3216 |

---

## Priority 1: Database Schema Enhancement

### Issue #7-8: Read-time Validation Redundancy

**Problem:** `filterEventsReadTime` validates ALL events from DB even if already validated at STORE time.

**Impact:** Safe but wasteful CPU cycles on every briefing fetch.

**Solution:** Add `schema_version` column to `discovered_events` table.

```sql
ALTER TABLE discovered_events ADD COLUMN schema_version INTEGER DEFAULT 1;
```

**Code Changes:**
1. Update `storeEvents()` in sync-events.mjs to set schema_version = VALIDATION_SCHEMA_VERSION
2. Update `filterEventsReadTime()` to skip validation if row.schema_version >= VALIDATION_SCHEMA_VERSION
3. Backfill: UPDATE discovered_events SET schema_version = 2 WHERE event_hash IS NOT NULL

**Effort:** Medium (migration + 2 file changes)
**Risk:** Low (backward compatible)

---

## Priority 2: Date Handling Standardization

### Issue #15: Date Handling Inconsistency

**Problem:** 4 different patterns for getting "today's date" across files:
1. `new Date().toISOString().split('T')[0]` (server timezone)
2. `options.userLocalDate` (passed from client)
3. `Intl.DateTimeFormat` with venue timezone
4. Various hardcoded date parsing

**Impact:** Potential timezone bugs, especially near midnight.

**Solution:** Standardize to `getSnapshotTimeContext()` utility (created in ETL refactoring).

**Files to Update:**
- server/scripts/sync-events.mjs - already uses userLocalDate ✓
- server/lib/briefing/briefing-service.js - needs audit
- server/lib/ai/providers/consolidator.js - needs audit
- Any file using `new Date()` for "today"

**Effort:** Medium (audit + update 3-5 files)
**Risk:** Medium (timezone edge cases)

---

## Priority 3: Logging Phase Clarity

### Issue #16: BRIEFING Phase Mismatch

**Problem:** BRIEFING Phase 2 used for: events, news, school closures, AND airport conditions.

**Impact:** Confusing logs - can't tell which operation is running.

**Solution Options:**
1. Expand BRIEFING from 3 to 5 phases
2. Use separate workflows for each data type
3. Add sub-phase logging (e.g., "Phase 2a: Events", "Phase 2b: Airport")

**Recommended:** Option 3 (least invasive)

```javascript
briefingLog.phase(2, 'Events: fetching from providers');
briefingLog.phase(2, 'Airport: checking DFW conditions');
```

**Effort:** Low (logging changes only)
**Risk:** Low

---

## Priority 4: Function Naming Clarity

### Issue #18: Legacy Function Confusion

**Problem:** `fetchEventsWithGemini3ProPreview` vs `fetchEventsForBriefing` unclear relationship.

**Impact:** Developer confusion about entry points vs internal helpers.

**Solution:** Add JSDoc comments explaining:
- Entry points (called by API routes)
- Internal helpers (called by other functions)
- Deprecated functions (scheduled for removal)

**Example:**
```javascript
/**
 * @entrypoint Called by GET /api/briefing
 * @internal Uses fetchEventsWithGemini3ProPreview internally
 */
export async function fetchEventsForBriefing(snapshotId, options) {}
```

**Effort:** Low (documentation only)
**Risk:** None

---

## Priority 5: Test Infrastructure

### BlocksApi Test Failures

**Problem:** 3 tests fail in blocksApi.test.js (403 instead of 200/202/400)

**Root Cause:** Service Account pattern (commit 4013740e) changed auth middleware behavior.

**Impact:** Test suite incomplete - CI/CD could miss regressions.

**Solution:** Update test token generation or mock auth for test environment.

**Effort:** Medium (auth testing setup)
**Risk:** Low

---

## Future Considerations (Low Priority)

### Event Discovery Provider Consolidation

Current providers (5):
1. SerpAPI (Google Events)
2. GPT-5.2 (web search)
3. Gemini 3 Pro (google_search tool)
4. Claude (Perplexity)
5. Perplexity (direct)

Consider consolidating to 3-4 providers for cost optimization.

### Event Hash Collision Detection

Current: MD5 hash of title|venue|date|time
Risk: Hash collisions (extremely rare but possible)

Future: Consider SHA-256 or composite key approach.

---

## Implementation Order

1. **Week 1:** Issue #7-8 (schema_version) - highest impact
2. **Week 2:** Issue #15 (date handling) - bug prevention
3. **Week 3:** Test infrastructure - CI/CD reliability
4. **Week 4:** Issues #16, #18 (logging, docs) - developer experience

---

## Related Documents

- `docs/architecture/etl-pipeline-refactoring-2026-01-09.md` - Verification matrix
- `server/lib/events/pipeline/README.md` - Pipeline documentation
- `LESSONS_LEARNED.md` - Historical issues
