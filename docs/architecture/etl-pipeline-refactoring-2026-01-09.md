> **Created:** 2026-01-09
> **Status:** Complete

# ETL Pipeline Refactoring Verification Matrix

## Summary

This document tracks the comprehensive refactoring of the event discovery ETL pipeline following the "No Cached Data to LLMs" architecture pattern. All strategy LLMs now receive events only from database rows, never from raw provider payloads.

## Architecture Overview

```
RawEvent (providers) → NormalizedEvent → ValidatedEvent → StoredEvent (DB)
                                                              ↓
BriefingEvent ← (DB read) ← discovered_events ← (DB write)
```

**Key Invariant:** Strategy LLMs ONLY receive BriefingEvent from DB rows.

---

## Canonical Modules Created

All event processing logic is now consolidated in `server/lib/events/pipeline/`:

| Module | Purpose | Functions |
|--------|---------|-----------|
| `types.js` | JSDoc type definitions | RawEvent, NormalizedEvent, ValidatedEvent, StoredEvent, BriefingEvent |
| `normalizeEvent.js` | Raw → Normalized transformation | normalizeTitle, normalizeVenueName, normalizeDate, normalizeTime, normalizeCoordinate, normalizeCategory, normalizeAttendance, normalizeEvent, normalizeEvents |
| `validateEvent.js` | Hard filter validation | validateEvent, validateEventsHard, needsReadTimeValidation, VALIDATION_SCHEMA_VERSION |
| `hashEvent.js` | MD5 hash generation | stripVenueSuffix, normalizeForHash, normalizeTimeForHash, buildHashInput, generateEventHash, eventsHaveSameHash, groupEventsByHash, findDuplicatesByHash |

---

## Files Modified

### 1. server/logger/workflow.js
**Changes:**
- Added EVENTS workflow with 5 ETL phases
- Added new OP types: VALIDATE, NORMALIZE, HASH

**ETL Phases:**
| Phase | Label | Operation |
|-------|-------|-----------|
| 1 | Extract\|Providers | SerpAPI, Gemini, Claude discovery calls |
| 2 | Transform\|Normalize | normalizeEvent + validateEvent |
| 3 | Transform\|Geocode | Geocode + venue linking |
| 4 | Load\|Store | Upsert to discovered_events |
| 5 | Assemble\|Briefing | Query from DB + shape for briefings |

### 2. server/scripts/sync-events.mjs
**Changes:**
- Imports use canonical modules (normalizeEvent, validateEventsHard, generateEventHash)
- Fixed searchWithGemini25Pro: correct model URL, added existingEvents parameter, use userLocalDate
- Updated processEventsWithVenueCache for ChIJ/Ei ID prioritization
- Updated storeEvents with is_active preservation comment
- Logging uses eventsLog with ETL phase numbers

**ChIJ vs Ei ID Logic:**
```javascript
const isChIJId = venue.place_id?.startsWith('ChIJ');  // Valid Google Place ID
const isSyntheticId = venue.place_id?.startsWith('Ei'); // Synthetic/session ID

if (isSyntheticId) {
  event._venue_id = venue.venue_id;
  event._synthetic_venue_id = true;  // Flag for future cleanup
}
```

### 3. server/lib/events/pipeline/hashEvent.js
**Changes:**
- Added stripVenueSuffix() to remove " at Venue", " @ Venue", " - Venue" patterns
- Added normalizeTimeForHash() for consistent time hashing
- Updated buildHashInput to include time and venue+address

**Hash Input Format:**
```
normalized(title_without_venue_suffix) | normalized(venue_name + address) | date | normalized_time
```

### 4. server/lib/briefing/briefing-service.js
**Changes:**
- Imports canonical validateEventsHard module
- Updated filterInvalidEvents to delegate to canonical module
- Removed redundant "FINAL SAFETY NET" empty event check
- Fixed timezone fallbacks in 3 functions (throw errors instead of using browser timezone)

**Timezone Handling (NO FALLBACKS):**
```javascript
// BEFORE (wrong)
const timezone = snapshot?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

// AFTER (correct)
if (!snapshot?.timezone) {
  return { items: [], reason: 'Location data not available (missing timezone)' };
}
const timezone = snapshot.timezone;
```

### 5. server/lib/ai/providers/consolidator.js
**Changes:**
- Imports canonical validateEventsHard module
- Added filterEventsReadTime helper function
- Replaced filterInvalidEvents calls with filterEventsReadTime
- Fixed double logging prefixes (removed `[consolidator]` since triadLog already adds prefix)

---

## Testing

### Integration Tests Created

**File:** `tests/events/pipeline.test.js`

| Test Suite | Tests | Status |
|------------|-------|--------|
| normalizeEvent.js - Title Normalization | 3 | ✅ Pass |
| normalizeEvent.js - Venue Normalization | 2 | ✅ Pass |
| normalizeEvent.js - Date Normalization | 4 | ✅ Pass |
| normalizeEvent.js - Time Normalization | 4 | ✅ Pass |
| normalizeEvent.js - Coordinate Normalization | 3 | ✅ Pass |
| normalizeEvent.js - Category Normalization | 3 | ✅ Pass |
| normalizeEvent.js - Full Event Normalization | 4 | ✅ Pass |
| validateEvent.js - Single Event Validation | 10 | ✅ Pass |
| validateEvent.js - Batch Validation | 3 | ✅ Pass |
| validateEvent.js - Schema Versioning | 2 | ✅ Pass |
| hashEvent.js - Hash Input Building | 5 | ✅ Pass |
| hashEvent.js - Hash Generation | 4 | ✅ Pass |
| hashEvent.js - Hash Comparison Utilities | 5 | ✅ Pass |
| ETL Integration - Full Pipeline | 3 | ✅ Pass |
| **TOTAL** | **55** | **100% Pass** |

**Run command:** `node tests/events/pipeline.test.js`

---

## Verification Checklist

### Canonical Modules
- [x] types.js defines all event types (RawEvent, NormalizedEvent, etc.)
- [x] normalizeEvent.js handles all normalization (title, venue, date, time, coords, category)
- [x] validateEvent.js handles all TBD/Unknown filtering with VALIDATION_SCHEMA_VERSION
- [x] hashEvent.js strips venue suffixes and includes time in hash

### sync-events.mjs
- [x] Uses canonical imports (normalizeEvent, validateEventsHard, generateEventHash)
- [x] searchWithGemini25Pro uses correct model URL (gemini-2.5-pro-preview-05-06)
- [x] searchWithGemini25Pro receives existingEvents for semantic dedup
- [x] Uses userLocalDate instead of server date
- [x] processEventsWithVenueCache prioritizes ChIJ over Ei IDs
- [x] storeEvents preserves is_active (doesn't re-activate deactivated events)
- [x] Logging uses eventsLog with ETL phase numbers

### briefing-service.js
- [x] filterInvalidEvents delegates to canonical validateEventsHard
- [x] Removed redundant "FINAL SAFETY NET" empty check
- [x] No timezone fallbacks (throws error if missing)

### consolidator.js
- [x] Uses canonical validateEventsHard for read-time validation
- [x] filterEventsReadTime helper checks needsReadTimeValidation
- [x] No double logging prefixes

### Logging
- [x] eventsLog created with 5 ETL phases
- [x] OP types include VALIDATE, NORMALIZE, HASH
- [x] Phase labels map 1:1 to pipeline stages

### Testing
- [x] 55 integration tests pass
- [x] Tests cover normalization, validation, hashing, and full pipeline
- [x] Tests verify venue suffix stripping prevents duplicates
- [x] Tests verify normalization idempotency

---

## Key Invariants Enforced

1. **No Cached Data to LLMs** - Strategy LLMs only receive BriefingEvent from DB
2. **Normalization Determinism** - Same input always produces same output
3. **Validation Consistency** - Uses VALIDATION_SCHEMA_VERSION for read-time skip
4. **Hash Stability** - Same event produces same hash regardless of:
   - Time format (7 PM vs 19:00)
   - Title variations ("Concert" vs "Concert at Venue")
   - Provider differences (SerpAPI vs Gemini vs Claude)
5. **No Timezone Fallbacks** - Missing timezone throws error, doesn't use browser
6. **is_active Preservation** - Re-discovery doesn't re-activate deactivated events
7. **ChIJ Prioritization** - Real Google Place IDs preferred over synthetic Ei IDs

---

## Related Documentation

- [server/lib/events/pipeline/README.md](../../server/lib/events/pipeline/README.md) - Pipeline modules
- [tests/events/README.md](../../tests/events/README.md) - Test documentation
- [docs/architecture/ai-pipeline.md](ai-pipeline.md) - Full AI pipeline architecture
- [LESSONS_LEARNED.md](../../LESSONS_LEARNED.md) - Historical issues
