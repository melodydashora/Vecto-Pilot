# Codebase Audit — 2026-04-16

**Conducted by:** Claude Opus 4.6 (5 parallel investigation agents)
**Scope:** Bars/Lounges pipeline, venue matching, server code health, performance
**Builds on:** `docs/architecture/full-audit-2026-04-04.md` (37 prior findings)

---

## Executive Summary

| Priority | Count | Description |
|----------|-------|-------------|
| **P0** | 6 | Critical bugs — broken filtering, parsing failures, memory leaks |
| **P1** | 14 | Important fixes — race conditions, silent failures, cache bugs, security |
| **P2** | 10 | Improvements — performance, code quality, documentation |
| **Total** | **30** | New findings (not previously documented) |

---

## P0 — Critical Bugs (Fix Immediately)

### P0-1: Bars Tab Serves Venues Without Confirmed Hours

**The Problem:** The bars tab's contract is "definitively open near you right now." Venues with `null`/missing hours from Google Places API are NOT filtered out — they make it into the final candidate pool if Haiku classified them as a bar.

**Root Cause:** The code conflates venue quality (Haiku: "is this a real bar?") with operating status (Google: "is it open right now?"). A venue can be a legitimate premium cocktail bar AND have unknown hours.

| Location | Lines | What Happens |
|----------|-------|-------------|
| `server/lib/venue/venue-intelligence.js` | 645-648 | Fresh API path: keeps `isOpen===null` if `venue_quality_tier` set |
| `server/lib/venue/venue-intelligence.js` | 487-490 | Cache path: identical logic, keeps null-hours venues |
| `server/lib/venue/venue-intelligence.js` | 42-46 | `calculateOpenStatus()` returns `is_open: null` when Google has no hours |
| `server/lib/venue/venue-intelligence.js` | 970-971 | Persists venues to DB with `hours_full_week: null` |

**Data Flow:**
```
Google Places API (no hours) → calculateOpenStatus() returns is_open: null
  → Haiku classifies as "Premium" → filter KEEPS it (line 645)
  → persisted to venue_catalog with null hours → cache reloads it next time (line 487)
```

**Fix:** Lines 645-648 and 487-490 must require `isOpen !== null` for the bars tab. Add a separate flag like `hours_unknown_but_quality` for display-only sorting, but do NOT include these venues in the "open now" results.

---

### P0-2: Weekday Parsing Fails on Abbreviated Day Names

**The Problem:** "The Green Gator" and "Rollertown Beerworks" show "Could not find Thursday in weekdayDescriptions" because the parser can't match abbreviated weekday names.

**Root Cause:** Two different parsing paths exist with incompatible matching:

| Path | File | Lines | Handles Abbreviations? |
|------|------|-------|----------------------|
| Canonical parser | `server/lib/venue/hours/parsers/google-weekday-text.js` | 37, 136 | YES — `WEEKDAY_MAP` maps "thu"→"thursday" |
| Display parser | `server/lib/venue/venue-intelligence.js` | 92-101 | NO — uses `startsWith("thursday")` |

**The Buggy Code (line 99-101):**
```javascript
const todayHours = weekdayDescs.find(d =>
  d.toLowerCase().startsWith(todayName.toLowerCase())  // "thu:..." does NOT startsWith("thursday")
);
```

**Fix:** Replace the `startsWith` match with logic that handles abbreviations:
```javascript
const todayHours = weekdayDescs.find(d => {
  const colonIdx = d.indexOf(':');
  if (colonIdx === -1) return false;
  const dayPart = d.slice(0, colonIdx).trim().toLowerCase();
  const todayLower = todayName.toLowerCase();
  return dayPart === todayLower || todayLower.startsWith(dayPart);
});
```

This affects ALL days, not just Thursday — any venue where Google returns abbreviated format ("Mon", "Tue", "Wed", etc.) will fail.

---

### P0-3: Job Queue Memory Leak — Unbounded Growth

**File:** `server/lib/infrastructure/job-queue.js`

**The Problem:** The `jobs` Map stores completed job metadata indefinitely. Dead-letter (failed) jobs are explicitly excluded from cleanup.

| Location | Lines | Issue |
|----------|-------|-------|
| `job-queue.js` | 5-134 | `this.jobs` Map grows without bound |
| `job-queue.js` | 117 | `!job.deadLetter` — dead-letter jobs NEVER cleaned |
| `job-queue.js` | 112 | Cleanup runs hourly but only removes non-deadletter completed jobs |

**Risk:** Process OOM after ~7-14 days under normal load. Every failed job stays in memory forever.

**Fix:** Remove the `!job.deadLetter` exclusion on line 117, or add a separate max-age cleanup for dead-letter jobs (e.g., 24 hours).

---

### P0-4: Places Memory Cache Never Evicts Stale Entries

**File:** `server/lib/venue/venue-enrichment.js`

**The Problem:** `placesMemoryCache` (line 39) is a module-level `Map` with no eviction. The TTL check on line 335 prevents *re-use* of stale data but never *deletes* the stale entry from the Map.

| Location | Lines | Issue |
|----------|-------|-------|
| `venue-enrichment.js` | 39 | `const placesMemoryCache = new Map()` — no max size |
| `venue-enrichment.js` | 335 | Stale check: skips entry but doesn't delete it |
| `venue-enrichment.js` | 40 | TTL = 6 hours, but expired entries remain in Map |

**Risk:** Memory leak. After days of operation with many unique venue lookups, 100K+ entries accumulate.

**Fix:** Delete stale entries when detected (`placesMemoryCache.delete(cacheKey)` after TTL check), or use an LRU cache with a max size (e.g., 2000 entries).

---

### P0-5: Advisory Lock Race Condition in Briefing Generation

**File:** `server/lib/briefing/briefing-service.js`

**The Problem:** If `getBriefingBySnapshotId` (line 2581) throws, the advisory lock is released (finally block, line 2651) but the `inFlightBriefings` dedup entry is never stored (line 2680). Another process then sees no lock and no dedup entry, starting concurrent generation.

| Location | Lines | Issue |
|----------|-------|-------|
| `briefing-service.js` | 2573 | Advisory lock acquired |
| `briefing-service.js` | 2581 | DB read — if this throws, function exits |
| `briefing-service.js` | 2651 | Lock released in finally block |
| `briefing-service.js` | 2680 | Dedup entry stored AFTER lock — never reached on error |

**Risk:** Data corruption from concurrent writes to the same briefing row.

**Fix:** Move the `inFlightBriefings.set()` call inside the try block immediately after acquiring the lock, before the DB read.

---

### P0-6: Venue Coordinates From AI Are Unvalidated Hallucinations

**File:** `server/lib/strategy/tactical-planner.js`

**The Problem:** VENUE_SCORER generates lat/lng coordinates from LLM knowledge — no validation against real Google Places data. The prompt says "EXACT COORDINATES" (line 127) but provides no mechanism for the model to look up real coordinates.

| Location | Lines | Issue |
|----------|-------|-------|
| `tactical-planner.js` | 127 | Prompt: "specific venues with EXACT COORDINATES" |
| `tactical-planner.js` | 371-377 | Post-processing: filters `null` coords but accepts ANY numeric value |
| `venue-enrichment.js` | 391 | Nearby search radius: 500m (up from 150m to compensate) |

**Impact:** AI-generated coordinates are typically 50-150m off target. The 500m search radius compensates but introduces false matches (e.g., "Hall Park Hotel" → "Rallytown Sportswear" at 82m, 0% name match).

**Fix (two-part):**
1. **Short-term:** Reduce nearby search radius to 250m. If no match at 250m, fall through to text search immediately (skip the 500m mismatch problem).
2. **Long-term:** Remove coordinate generation from VENUE_SCORER prompt entirely. Have the AI return venue names + city/district, then use text search as the primary lookup. Coordinates should come FROM Google, not from the AI.

---

## P1 — Important Fixes

### P1-1: Event Deactivation Endpoint Missing Authorization

**File:** `server/api/briefing/briefing.js`
**Lines:** (event deactivation endpoint)

Any authenticated user can deactivate ANY user's events. No ownership check.

**Fix:** Add `WHERE user_id = req.auth.userId` to the deactivation query.

---

### P1-2: AI `callModel` Timeout Disabled Globally

**File:** `server/lib/ai/adapters/index.js`
**Lines:** (timeout configuration)

`timeout: 0` means AI calls can hang indefinitely, blocking request threads.

**Fix:** Set reasonable timeouts per role (e.g., 30s for quick roles, 90s for generation roles).

---

### P1-3: Silent Keepalive Failures Hide Database Disconnections

**File:** `server/db/db-client.js`
**Lines:** 71, 167

```javascript
pgClient.query('SELECT 1').catch(() => {});  // Silent failure
```

Database connectivity issues are invisible — no logging, no monitoring, no reconnection trigger.

**Fix:** Replace empty catch with `console.warn` + health metric update.

---

### P1-4: Fire-and-Forget DB Writes Swallow Errors

| File | Lines | Pattern |
|------|-------|---------|
| `server/lib/venue/venue-enrichment.js` | 353-356 | `.catch(() => {})` on cache update |
| `server/lib/venue/venue-enrichment.js` | 498 | Non-blocking cache write, no error handling |
| `server/lib/venue/venue-address-resolver.js` | 65 | `.catch(() => {})` on address resolution |
| `server/lib/venue/venue-cache.js` | 477, 504 | Non-blocking updates with empty catch |

**Fix:** Replace `.catch(() => {})` with `.catch(err => console.warn(...))` at minimum.

---

### P1-5: `venue_catalog` TOCTOU Race in `findOrCreateVenue`

**File:** `server/lib/venue/venue-cache.js`
**Lines:** 474-481

Multiple concurrent calls see the same venue without `place_id`, all issue redundant UPDATEs. No lock between check and update.

**Fix:** Use `ON CONFLICT` upsert or add a short advisory lock around the check-then-update.

---

### P1-6: Cache TTL Mismatch — Stale `isOpen` Across DST Transitions

**File:** `server/lib/venue/venue-enrichment.js`
**Lines:** 37-40, 335, 346-347

Three cache layers (memory, DB, application) with 6-hour TTL. `isOpen` is recalculated with current timezone, but `allHours` data is from a cached snapshot. Near DST boundaries, the cached hours window shifts but the underlying data doesn't.

**Fix:** Reduce venue hours cache TTL to 2 hours, or invalidate on DST transitions.

---

### P1-7: Briefing Cache Returns Stale Error After Recovery

**File:** `server/lib/briefing/briefing-service.js`
**Lines:** 2596-2614, 2658-2677

If generation fails, `inFlightBriefings` cache stores the error. Subsequent requests within 60 seconds get the cached error even if another process has since regenerated successfully. No cache invalidation on success.

**Fix:** Clear `inFlightBriefings` entry on successful generation, not just on timeout.

---

### P1-8: Chat Action Parsing — No Length or Count Limits

**File:** `server/api/chat/chat.js`
**Lines:** 33-127

No limit on number of actions parsed from AI response (could be thousands of note-saves). No limit on action data size. Processing loop is serial with no rate limiting.

**Fix:** Cap parsed actions at a reasonable limit (e.g., 20) and truncate action data to 10KB.

---

### P1-9: Unprotected `JSON.parse` Calls Across AI Pipeline

Already documented in `full-audit-2026-04-04.md` (Section 3) but still unfixed:

| File | Lines |
|------|-------|
| `server/lib/ai/adapters/vertex-adapter.js` | 145 |
| `server/lib/ai/adapters/gemini-adapter.js` | 220 |
| `server/lib/ai/providers/consolidator.js` | 377 |
| `server/lib/briefing/briefing-service.js` | 501, 712, 720, 735, 740, 765 |
| `server/lib/external/perplexity-api.js` | 193, 366, 475, 624 |
| `server/lib/venue/venue-intelligence.js` | 292, 320, 745 |

**Fix:** Wrap all `JSON.parse` of AI responses in try-catch with structured fallback.

---

### P1-10: OpenAI Realtime Token Minted Before Ownership Check

**File:** `server/api/chat/realtime.js`
**Lines:** 43-60, 75-87

OpenAI ephemeral token is generated (line 43, costs money) BEFORE verifying the user owns the snapshot (line 75). Unauthorized users can cause token minting costs.

**Fix:** Move the ownership check before the OpenAI API call.

---

### P1-11: Concurrent Briefing Dedup TOCTOU Bug

**File:** `server/lib/briefing/briefing-service.js`
**Lines:** 2590-2614

The dedup check (`hasTraffic && hasEvents && hasNews && hasClosures`) happens AFTER the advisory lock is released. Between check and return, another process could UPDATE the same row, setting fields to NULL.

**Fix:** Move the freshness check inside the advisory lock transaction.

---

### P1-12: Address Re-Resolution Results Not Cached or Persisted

**File:** `server/lib/venue/venue-cache.js`
**Lines:** 461-465, 486-490, 515-519

`maybeReResolveAddress()` is called in 3 places. If resolution succeeds, the result is returned to the caller but NOT written back to `venue_catalog`. The same bad venue triggers the same API call on every access.

**Fix:** Persist the re-resolved address back to `venue_catalog` after successful resolution.

---

### P1-13: No Streaming Fallback for AI Coach

**File:** `server/api/chat/chat.js`, `server/lib/ai/model-registry.js`
**ID:** COACH-H7 (from DOC_DISCREPANCIES.md)

If Gemini goes down, the coach is completely unavailable. No fallback to another provider.

**Fix:** Add fallback model for COACH role in model-registry (e.g., Gemini → Claude Haiku).

---

### P1-14: Coach Conversation Saves Are Fire-and-Forget

**File:** `server/api/chat/chat.js`
**Lines:** 1325-1345
**ID:** COACH-H8 (from DOC_DISCREPANCIES.md)

Conversation message saves use try/catch that swallows errors. The coach silently forgets conversations.

**Fix:** Log errors at `error` level (not swallow) and return a warning header to the client.

---

## P2 — Improvements

### P2-1: Event Verification Pipeline — Remove Sequential Chunking (Saves 5-15 seconds)

**File:** `server/lib/venue/venue-event-verifier.js`
**Lines:** 87-114

Events are verified in sequential chunks of 3 LLM calls. With 6 venues: 2 chunks x 5-8s = 10-16 seconds. All 6 could run in parallel.

```
Current:  [V1,V2,V3] → wait → [V4,V5,V6] → wait     = 10-16s
Proposed: [V1,V2,V3,V4,V5,V6] → wait                  = 5-8s
```

**Fix:** Replace sequential chunk loop with single `Promise.all()` over all venues.

---

### P2-2: Address Resolution — Increase Chunk Size (Saves 2-3 seconds)

**File:** `server/lib/venue/venue-address-resolver.js`
**Lines:** 371-397

Hardcoded chunk size of 5 (`i += 5`). Places API allows 600 QPS for text search.

**Fix:** Increase to `i += 10` or `i += 15`. Monitor for rate limiting.

---

### P2-3: Nearby Search Radius — Reduce to 250m, Fallback Faster

**File:** `server/lib/venue/venue-enrichment.js`
**Lines:** 391

Current 500m radius was increased from 150m on 2026-01-05 to handle AI coordinate imprecision. But it causes false matches in dense commercial areas.

**Fix:** Reduce to 250m. If no match at 250m OR name similarity < 20%, immediately fall to text search. The text search path uses Google's semantic understanding and is more reliable than coordinate + word-overlap.

---

### P2-4: Implement Name Similarity With Fuzzy/Phonetic Matching

**File:** `server/lib/venue/venue-enrichment.js`
**Lines:** 530-551

Current `calculateNameSimilarity()` uses simple word overlap. "Hall Park Hotel" vs "Rallytown Sportswear" = 0% match, which is correct. But "Dave & Buster's" vs "Dave and Busters" would also score poorly due to normalization.

**Fix:** Consider Levenshtein distance or trigram matching for the per-word comparison, or use a library like `string-similarity`.

---

### P2-5: Dead Code Cleanup (9 Briefing Functions + Deprecated Roles)

Already documented in `full-audit-2026-04-04.md` (Section 7) but still unfixed:

| Function/Item | File |
|---------------|------|
| `consolidateNewsItems` | briefing-service.js |
| `mapGeminiEventsToLocalEvents` | briefing-service.js |
| `_fetchEventsWithGemini3ProPreviewLegacy` | briefing-service.js |
| `LocalEventSchema` | briefing-service.js |
| `fetchWeatherForecast` | briefing-service.js |
| 4 unreferenced imports | briefing-service.js |
| `BRIEFING_NEWS_GPT` role | model-registry.js |
| Semantic search stub | semantic-search.js |

---

### P2-6: ESLint Violations (4 Quick Fixes)

| File | Line | Issue |
|------|------|-------|
| `components/co-pilot/TranslationOverlay.tsx` | 183 | Unused eslint-disable |
| `hooks/useSpeechRecognition.ts` | 60 | Unused eslint-disable |
| `components/BriefingTab.tsx` | 117 | Unused variable `eventsToday` |
| `components/concierge/AskConcierge.tsx` | 9 | Unused import `Send` |

---

### P2-7: Stale Documentation (7 Items)

Already documented in `full-audit-2026-04-04.md` (Section 6) but still unfixed:

| Document | Issue |
|----------|-------|
| `ARCHITECTURE.md` | Lists OpenAI as primary — actual primary is Gemini 3.1 Pro |
| `docs/architecture/briefing-system.md` | Phantom endpoint, wrong TTL, missing 4 endpoints |
| `server/lib/briefing/README.md` | Wrong path for `phase-emitter.js` |
| `server/lib/traffic/tomtom.js` | JSDoc says `radiusMiles`, signature says `radiusMeters` |

---

### P2-8: Outdated npm Dependencies (22 Packages)

Already documented in `full-audit-2026-04-04.md` (Section 5). Key packages:

| Package | Gap |
|---------|-----|
| `lucide-react` | 0.553 → 1.7.0 (MAJOR) |
| `react-resizable-panels` | 3.0 → 4.9 (MAJOR) |
| `@anthropic-ai/sdk` | 14 minor versions behind |
| `openai` | 16 minor versions behind |

---

### P2-9: Pipeline Cache Warming for Popular Metros

**Files:** `server/lib/venue/venue-enrichment.js`, `server/lib/venue/venue-cache.js`

For repeat requests in the same metro area, cache misses dominate latency (8-15s). Pre-warming the Places cache for top metros (Dallas, Austin, Houston) during startup could save 10-20s on first request.

---

### P2-10: Job Queue Retry Metric Accounting Bug

**File:** `server/lib/infrastructure/job-queue.js`
**Lines:** 39-76

`metrics.retrying` counter is incremented on each retry attempt but never properly decremented on completion. Over time, the retrying count becomes meaningless.

**Fix:** Decrement `metrics.retrying` when a retrying job succeeds or is dead-lettered.

---

## Performance Summary — Venue Scoring Pipeline

**Current:** 39-80+ seconds depending on cache state.

| Phase | Duration | Bottleneck |
|-------|----------|-----------|
| VENUE_SCORER (LLM) | 5-8s | Model latency (unavoidable) |
| Routes Matrix (API) | 1-2s | Already batched |
| Address Resolution (API) | 3-5s | Chunked at 5 — increase to 10 |
| Places Details (API) | 8-15s | Cache-dependent |
| Event Matching (sync) | <1s | N/A |
| **Event Verification (LLM)** | **10-25s** | **Chunked at 3 — remove chunking** |
| Catalog Promotion (DB) | 1-3s | Already parallel |
| Insert Candidates (DB) | 2-5s | Single batch |

**With P2-1 and P2-2 optimizations:** 25-45 seconds (35-45% reduction).

---

## Cross-Reference: Prior Unfixed Items

These items from `full-audit-2026-04-04.md` remain open:

| Item | Original Date | Status |
|------|--------------|--------|
| Unprotected JSON.parse (Section 3) | 2026-04-04 | UNFIXED — elevated to P1-9 |
| Silent promise rejections (Section 4) | 2026-04-04 | UNFIXED — partially covered by P1-4 |
| Outdated npm deps (Section 5) | 2026-04-04 | UNFIXED — P2-8 |
| Stale docs (Section 6) | 2026-04-04 | UNFIXED — P2-7 |
| Dead code (Section 7) | 2026-04-04 | UNFIXED — P2-5 |
| ESLint violations (Section 8) | 2026-04-04 | UNFIXED — P2-6 |
| Briefing medium issues (Section 10) | 2026-03-09 | UNFIXED |
| Offer tier overhaul | 2026-03-29 | AWAITING TEST APPROVAL |
| Driver preferences migration | 2026-04-11 | BLOCKED on DB migration |

---

## Recommended Fix Order

1. **P0-1** — Bars hours filtering (violates core feature contract)
2. **P0-2** — Weekday parsing (affects all abbreviated-format venues, all days)
3. **P0-3 + P0-4** — Memory leaks (production stability)
4. **P0-5** — Advisory lock race (data corruption risk)
5. **P0-6** — Coordinate validation strategy (reduces false matches)
6. **P1-1** — Event deactivation auth (security)
7. **P1-9** — JSON.parse protection (crash prevention)
8. **P2-1** — Event verification parallelization (biggest perf win)
9. **P1 remainder** — Work through cache bugs and silent failures
10. **P2 remainder** — Code quality, docs, dependencies

---

*This audit builds on `docs/architecture/full-audit-2026-04-04.md`. Both documents should be referenced at session start per Rule 12.*
