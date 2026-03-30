# Briefing System: Issues & Findings

**Generated:** 2026-03-09
**Branch:** `claude/analyze-briefings-workflow-Ylu9Q`
**Companion doc:** `briefing-deep-dive-analysis.md`

> Per CLAUDE.md Rule 9: ALL findings are HIGH priority. No "low priority" bucket.

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 5 | Runtime errors, broken exports, data integrity |
| **HIGH** | 8 | Security, dead code, race conditions, missing fallbacks |
| **MEDIUM** | 12 | Inconsistencies, stale docs, fragile logic |
| **Total** | 25 | |

---

## CRITICAL Issues (5)

### C-1: Barrel exports reference non-existent functions

**File:** `server/lib/briefing/index.js`
**Impact:** Any consumer importing from the barrel gets `undefined`

The barrel file exports 3 function names that don't exist in `briefing-service.js`:

| Exported Name | Actual Function Name |
|--------------|---------------------|
| `fetchTrafficBriefing` | `fetchTrafficConditions` |
| `fetchEventsBriefing` | `fetchEventsForBriefing` |
| `fetchNewsBriefing` | `fetchRideshareNews` |

**Fix:** Rename exports to match actual function names, or add aliases in `briefing-service.js`.

---

### C-2: `/traffic/realtime` endpoint — missing import (runtime crash)

**File:** `server/api/briefing/briefing.js` ~line 407
**Impact:** Endpoint throws `ReferenceError: fetchTrafficConditions is not defined` at runtime

The `/traffic/realtime` endpoint calls `fetchTrafficConditions()` which is NOT in the import list. Only `fetchWeatherConditions` is imported from `briefing-service.js`.

**Fix:** Add `fetchTrafficConditions` to the import statement.

---

### C-3: `/weather/realtime` endpoint — wrong parameter shape

**File:** `server/api/briefing/briefing.js` ~line 429
**Impact:** Endpoint calls `fetchWeatherConditions({ lat, lng })` but function expects `fetchWeatherConditions({ snapshot })`

The function will receive `{ lat, lng }` but tries to access `snapshot.lat`, `snapshot.lng`, `snapshot.country` — all `undefined`.

**Fix:** Pass `{ snapshot: { lat, lng, country: 'US' } }` or refactor function to accept direct params.

---

### C-4: `normalizeEvent()` called without city/state context

**File:** `server/lib/briefing/briefing-service.js` ~line 1090
**Impact:** Events may be stored with empty `city`/`state` fields, breaking downstream filtering and venue linking

In the event discovery pipeline, `normalizeEvent(e)` is called without passing `{ city, state }` from the snapshot. If the AI response doesn't include city/state in the event object, the normalized event will have empty values, and the DB insert succeeds but downstream `WHERE city = ? AND state = ?` queries won't find it.

**Fix:** Pass `normalizeEvent(e, { city: snapshot.city, state: snapshot.state })` or ensure the function defaults from context.

---

### C-5: Date calculation in `fetchEventsForBriefing` uses UTC instead of user timezone

**File:** `server/lib/briefing/briefing-service.js` ~lines 1071-1075
**Impact:** 7-day event query window is off by up to 1 day for non-UTC users

`todayStr` and `endDateStr` are calculated using `toISOString().split('T')[0]` which is UTC-based. A driver in UTC-8 at 11PM local time would get tomorrow's UTC date as "today", causing a misaligned 7-day window for the discovered_events query.

**Fix:** Use `Intl.DateTimeFormat` with the snapshot's timezone to compute `todayStr`.

---

## HIGH Issues (8)

### H-1: Event deactivation/reactivation has no authorization check

**File:** `server/api/briefing/briefing.js`
**Endpoints:** `PATCH /event/:eventId/deactivate`, `PATCH /event/:eventId/reactivate`
**Impact:** Any authenticated user can deactivate/reactivate ANY event in the system

These endpoints only require `requireAuth`. There is no check that the user owns the event, is in the same market, or has admin privileges. A malicious authenticated user could deactivate all events.

**Fix:** Add ownership check or admin-only middleware. At minimum, verify the user's market matches the event's city/state.

---

### H-2: AI callModel timeout is disabled globally

**File:** `server/lib/ai/adapters/index.js`
**Impact:** AI calls can hang indefinitely, blocking the briefing pipeline

`router.execute()` is called with `timeout: 0`, which disables the timeout entirely. Only event category searches have the separate 90s `withTimeout` wrapper. Weather, traffic analysis, news, airport, and school closure calls have NO timeout protection.

**Fix:** Set a reasonable global timeout (e.g., 60-90s) in `router.execute()`, or add `withTimeout` wrappers to all AI calls.

---

### H-3: No fallback for critical briefing roles

**File:** `server/lib/ai/adapters/index.js` (fallback config)
**Impact:** If Gemini is down, weather/traffic/schools/airport fail silently with empty data

`BRIEFING_WEATHER`, `BRIEFING_TRAFFIC`, `BRIEFING_SCHOOLS`, and `BRIEFING_AIRPORT` are NOT in `FALLBACK_ENABLED_ROLES`. If Gemini experiences an outage, these subsystems produce empty/null data with no provider fallback.

**Fix:** Add these roles to `FALLBACK_ENABLED_ROLES` or implement explicit fallback logic in each fetch function.

---

### H-4: Race condition in `generateAndStoreBriefing` concurrent calls

**File:** `server/lib/briefing/briefing-service.js` ~lines 2088-2151
**Impact:** Concurrent briefing generation for same snapshot could cause data loss

The function checks for existing rows then inserts/updates, but between the check and insert, another process could insert. The `catch` handles insert conflicts, but the cleared-fields UPDATE on an existing row (lines 2143-2151) that's being concurrently regenerated could clear fields that another process is about to write.

**Fix:** Use database-level locking (SELECT FOR UPDATE) or a single atomic upsert.

---

### H-5: `withTimeout` does not cancel underlying promises

**File:** `server/lib/briefing/briefing-service.js`
**Impact:** Timed-out AI calls continue running, consuming resources and API quota

When `withTimeout` resolves with `{ timedOut: true }`, the underlying AI call's Promise continues executing. The result is discarded, but the API call still completes, consuming tokens and compute.

**Fix:** Pass an AbortController signal to the AI call and abort on timeout.

---

### H-6: ON CONFLICT for events doesn't update content

**File:** `server/lib/briefing/briefing-service.js` (event INSERT)
**Impact:** Corrected event data from re-discovery is silently dropped

When an event with the same `event_hash` is re-discovered with corrected data (e.g., updated time, venue name), the `ON CONFLICT (event_hash) DO UPDATE` only updates `updated_at`. The corrected title, venue_name, times, etc. are NOT written.

**Fix:** Update all relevant fields in the ON CONFLICT clause, or at minimum update `event_start_time`, `event_end_time`, `venue_name`, `address`.

---

### H-7: Schema/migration discrepancy for lat/lng/zip on discovered_events

**Files:** `shared/schema.js` vs `migrations/20260110_drop_discovered_events_unused_cols.sql`
**Impact:** Either the migration wasn't applied (schema is truth) or code references non-existent columns

Migration `20260110_drop_discovered_events_unused_cols.sql` drops `lat`, `lng`, `zip` from `discovered_events`. But `schema.js` still defines them, and the events API endpoint references `e.lat`, `e.lng`. This is a code/schema mismatch that needs resolution.

**Fix:** Verify whether migration was applied. If yes, remove from schema.js. If no, decide whether to drop or keep.

---

### H-8: `source_model` column accessed but doesn't exist

**File:** `server/api/briefing/briefing.js` ~lines 652, 769
**Impact:** `source: undefined` in API response for every event

The `source_model` column was removed from `discovered_events` (confirmed by schema comment and migration). The events endpoint still references `e.source_model`, which will always be `undefined`.

**Fix:** Remove `source_model` references from the events endpoint code.

---

## MEDIUM Issues (12)

### M-1: `event_end_time` format inconsistency

**Files:** `cleanup-events.js`, `briefing-service.js`, `validateEvent.js`
**Impact:** Past events may not be properly deactivated

`cleanup-events.js` compares `event_end_time` strings using `<` operator. If DB stores "10:00 PM" (12h format) but the comparison uses "22:00" (24h format from `toLocaleTimeString('en-GB')`), the string comparison is broken because "10:00 PM" < "22:00" is `true` (alphabetical), but "9:00 PM" < "15:00" is also `true` — wrong for events ending at 9PM when current time is 3PM.

**Fix:** Standardize time format in DB (either always 24h or always 12h) and match in cleanup logic.

---

### M-2: Duplicate `briefing_ready` notifications

**Files:** `migrations/20260109_briefing_ready_notify.sql`, `briefing-service.js` ~line 2327
**Impact:** Client receives 2 notifications per briefing generation

The DB trigger fires when `traffic_conditions` goes from NULL to NOT NULL, AND `briefing-service.js` manually sends the same notification. The client handles this gracefully (just refetches), but it's unnecessary work and network traffic.

**Fix:** Remove the manual `pg_notify` since the trigger handles it, OR remove the trigger and rely on the manual send.

---

### M-3: `safeJsonParse` single-quote replacement corrupts apostrophes

**File:** `server/lib/briefing/briefing-service.js` ~line 625
**Impact:** Strings like "driver's guide" → `"driver"s guide"` → JSON parse error

The regex `'([^'\\]*(\\.[^'\\]*)*)'/g` replaces single quotes with double quotes to fix JSON, but this also corrupts English apostrophes in values, potentially causing parse failures.

**Fix:** Use a more targeted approach — only replace quotes that appear as JSON delimiters (after `:`, before `,`/`}`).

---

### M-4: `filterRecentNews` includes items with missing/invalid dates

**File:** `server/lib/briefing/briefing-service.js` ~lines 1854-1864
**Impact:** Stale news (>2 days old) can appear in briefings if AI omits `published_date`

Items without `published_date` or with unparseable dates are included with only a console warning. This defeats the freshness filter's purpose.

**Fix:** Exclude items without valid dates, or default to "today" for items with missing dates from the current search.

---

### M-5: `getLocalDate` in filter-for-planner falls back to UTC

**File:** `server/lib/briefing/filter-for-planner.js` ~line 51
**Impact:** Inconsistent with NO FALLBACKS rule used elsewhere

When timezone is null, `getLocalDate()` falls back to UTC instead of failing. This could cause wrong date calculations in the planner.

**Fix:** Throw error on missing timezone (consistent with other subsystems).

---

### M-6: `isLargeEvent` misclassifies small venues

**File:** `server/lib/briefing/filter-for-planner.js`
**Impact:** Bar bands tagged as `concert` are treated as market-wide events

`isLargeEvent` returns true for ALL sports and concert categories regardless of venue size. A local bar with live music tagged as `concert` would be shown as a market-wide event.

**Fix:** Check venue name against `LARGE_EVENT_INDICATORS` in addition to category.

---

### M-7: Address normalization over-deduplicates nearby venues

**File:** `server/lib/briefing/briefing-service.js` (deduplicateEvents)
**Impact:** Two distinct venues on the same street with similar event names/times are merged

`normalizeAddress` extracts only the first 2 words of the street name after the house number. Venues at 5776 Main St and 5752 Main St would have the same address key, causing incorrect deduplication if they have similar events at similar times.

**Fix:** Include the full street number in the dedup key, or increase the address specificity.

---

### M-8: Stale docstring in `refreshNewsInBriefing`

**File:** `server/lib/briefing/briefing-service.js` ~line 2516
**Impact:** Developer confusion

The docstring mentions "GPT-5.2 parallel fetch" which was removed. Code no longer uses GPT-5.2 for news.

**Fix:** Update docstring to reference current architecture (Gemini-only news fetch).

---

### M-9: Location/timezone fallback inconsistencies violate "no silent defaults" rule

**File:** `server/api/briefing/briefing.js`
**Impact:** Incorrect filtering/queries when location data is missing

The architecture mandates explicit failure on missing city/state/timezone, but three API endpoints silently use fallback values:

| Endpoint | Line | Violation |
|----------|------|-----------|
| `/rideshare-news/:snapshotId` | ~576 | `req.snapshot.timezone \|\| 'UTC'` — news filtered against UTC instead of local time |
| `/traffic/realtime` | ~410 | `city \|\| 'Unknown'` — traffic analysis tagged to fake city |
| `/traffic/realtime` | ~411 | `state \|\| ''` — empty state breaks any downstream state-based filtering |

**Fix:** Remove all three fallbacks. Return 400 if required fields are missing, matching the pattern used by the core briefing pipeline.

---

### M-10: Events endpoint returns `success: true` on error

**File:** `server/api/briefing/briefing.js` ~line 808-809
**Impact:** Client cannot distinguish between "no events" and "events failed to load"

The events endpoint catch block returns `{ success: true, events: [], marketEvents: [] }` on database errors, masking the failure.

**Fix:** Return `{ success: false, error: 'message' }` in the catch block.

---

### M-11: School closure coordinates are AI-estimated, not geocoded

**File:** `server/lib/briefing/briefing-service.js` (fetchSchoolClosures)
**Impact:** 15-mile distance filter uses inaccurate coordinates

Gemini generates approximate lat/lng for schools with no geocoding verification. Items without coordinates are included anyway (defeating the 15mi filter).

**Fix:** Either geocode school addresses (like events) or filter by city match instead of distance.

---

### M-12: No rate limiting on external API proxy endpoints

**Files:** `server/api/briefing/briefing.js` (realtime endpoints)
**Impact:** `/traffic/realtime` and `/weather/realtime` proxy to external APIs with no throttling

These endpoints call TomTom and Google Weather APIs directly. Without rate limiting, they could exhaust API quotas (TomTom free tier: 2,500/day).

**Fix:** Apply `expensiveEndpointLimiter` to realtime endpoints.

---

## Dead Code Inventory

These items should be removed to reduce maintenance burden and confusion:

| Item | File | Lines | Notes |
|------|------|-------|-------|
| `consolidateNewsItems` function | briefing-service.js | ~2025-2085 | Jaccard dedup — never called |
| `mapGeminiEventsToLocalEvents` function | briefing-service.js | ~705-757 | Replaced by `normalizeEvent` pipeline |
| `_fetchEventsWithGemini3ProPreviewLegacy` function | briefing-service.js | ~943-1050 | "Kept for fallback reference" but never called |
| `LocalEventSchema` (Zod) | briefing-service.js | ~686-703 | Defined but never used for validation |
| `fetchWeatherForecast` function | briefing-service.js | ~1265-1301 | AI weather — not called in generation pipeline |
| `needsReadTimeValidation` import | briefing-service.js | top | Never referenced |
| `VALIDATION_SCHEMA_VERSION` import | briefing-service.js | top | Never referenced |
| `sendModelErrorAlert` import | briefing-service.js | top | Never referenced |
| `geocodeMissingCoordinates` function | events pipeline | — | Batch geocoding, never called |

---

## Documentation Gaps

| Doc | Gap |
|-----|-----|
| `docs/architecture/briefing-system.md` | Lists `POST /refresh-daily/:snapshotId` which doesn't exist in code |
| `docs/architecture/briefing-system.md` | Missing 4 endpoints: `/filter-invalid-events`, `PATCH /event/:eventId/deactivate`, `PATCH /event/:eventId/reactivate`, `/discovered-events/:snapshotId` |
| `docs/architecture/briefing-system.md` | Says "Events/News/Schools: 24 hours" but news has no cache and events use 4h staleness |
| `docs/architecture/briefing-system.md` | Last updated 2026-02-10, code has changes through 2026-02-17 |
| `server/lib/briefing/README.md` | References `source_model` as removed but API code still accesses it |
| `server/lib/briefing/README.md` | Lists `phase-emitter.js` in briefing dir but it's actually in `server/events/` |
| `server/lib/traffic/tomtom.js` | JSDoc says `radiusMiles` default 10, signature says `radiusMeters` default 5000 |

---

## Test Coverage Gaps

| Area | Status | Priority |
|------|--------|----------|
| All 16 API endpoints (server-side) | NOT TESTED | High |
| Event deactivation/reactivation | NOT TESTED | High |
| `deduplicateEvents` algorithm | NOT TESTED | High |
| Timezone-based date calculations | NOT TESTED | High |
| SSE notification chain | NOT TESTED | Medium |
| News deactivation hash filtering | NOT TESTED | Medium |
| Market events multi-city expansion | NOT TESTED | Medium |
| `filterBriefingForPlanner` logic | NOT TESTED | Medium |
| `normalizeNewsTitle` / `generateNewsHash` | NOT TESTED | Medium |
| Rate limiting behavior | NOT TESTED | Low |
| Error paths (500s, missing data) | NOT TESTED | Low |

---

## Recommended Fix Priority

### Immediate (blocks correctness)
1. **C-1:** Fix barrel exports in `index.js`
2. **C-2:** Fix missing import in `/traffic/realtime` endpoint
3. **C-3:** Fix parameter shape in `/weather/realtime` endpoint
4. **C-4:** Pass city/state to `normalizeEvent()` call
5. **C-5:** Use timezone-aware date calculation in event query
6. **H-6:** Update ON CONFLICT to write corrected event data
7. **H-8:** Remove `source_model` references

### Short-term (security & reliability)
8. **H-1:** Add authorization to event deactivation/reactivation
9. **H-2:** Set AI callModel timeout (60-90s)
10. **H-3:** Enable fallbacks for critical briefing roles
11. **M-1:** Standardize event time format
12. **M-10:** Return `success: false` on events endpoint errors

### Medium-term (code quality)
13. Remove all dead code (9 items listed above)
14. Fix documentation gaps (7 items listed above)
15. Fix remaining medium issues (M-2 through M-12)
16. Add test coverage for critical paths
