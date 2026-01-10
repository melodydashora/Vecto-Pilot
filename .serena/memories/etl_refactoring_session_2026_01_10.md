# ETL Pipeline Refactoring Session - 2026-01-10

## Summary
Completed comprehensive 7-point audit of ETL pipeline refactoring. All issues resolved.

## Key Changes Made
1. **Canonical Pipeline Modules** - Created `server/lib/events/pipeline/` with:
   - `types.js` - JSDoc type definitions
   - `normalizeEvent.js` - Title, date, time, coords normalization
   - `validateEvent.js` - TBD/Unknown removal + VALIDATION_SCHEMA_VERSION
   - `hashEvent.js` - MD5 hash + venue suffix stripping

2. **Model-Agnostic Naming** - Renamed `searchWithGemini3Pro` → `searchWithGoogleSearch` (capability-based)

3. **Removed Redundancy** - Deleted `searchWithGemini25Pro` (was duplicate of Google Search function)

4. **Fixed Duplicate Functions** - Renamed db-detox.js `deduplicateEvents` → `purgeEventDuplicatesFromDB`

5. **Accurate Comments** - Fixed misleading comments about schema_version and "Cache hit"

6. **Workflow Logging** - Added EVENTS workflow with 5 ETL phases to workflow.js

## Test Results
- **55/55 tests pass (100%)**
- Tests cover: normalization, validation, hashing, full pipeline integration

## Key Invariants Enforced
1. **No Cached Data to LLMs** - LLMs only receive data from DB rows
2. **Hash Stability** - Venue suffix stripping prevents duplicates
3. **No Timezone Fallbacks** - Throws error if missing
4. **is_active Preservation** - ON CONFLICT doesn't re-activate events
5. **ChIJ Prioritization** - Real Place IDs preferred over synthetic Ei* IDs

## Files Modified
- `server/scripts/sync-events.mjs` - Complete ETL refactor
- `server/lib/briefing/briefing-service.js` - Delegates to canonical validation
- `server/lib/ai/providers/consolidator.js` - Uses filterEventsReadTime
- `server/logger/workflow.js` - Added EVENTS workflow
- `scripts/db-detox.js` - Renamed duplicate function
- `docs/review-queue/2026-01-09.md` - Added verification matrix

## New Files Created
- `server/lib/events/pipeline/*` - Canonical ETL modules
- `tests/events/pipeline.test.js` - 55 integration tests
- `docs/architecture/etl-pipeline-refactoring-2026-01-09.md` - Full verification matrix

## Known Future Work (Deferred)
- Issue #7-8: Add schema_version column to discovered_events for read-time skip
- Issue #15: Standardize date handling across files
- Issue #16: Expand BRIEFING workflow from 3 to 5 phases
- Issue #18: Add comments explaining entry points vs internal helpers

## Documentation Still Needed
- `docs/architecture/api-reference.md` - Strategy API changes
- `docs/architecture/strategy-framework.md` - Strategy API changes
- `docs/architecture/client-structure.md` - Component renames
