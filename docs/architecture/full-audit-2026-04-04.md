# Full Repository Audit — 2026-04-04

**Conducted by:** Claude Opus 4.6 (5 parallel exploration agents)
**Scope:** Server, Client, Schema, Documentation, Code Quality
**Status:** DOCUMENTED — awaiting prioritized implementation

---

## Executive Summary

| Dimension | Stats |
|-----------|-------|
| **Server** | 228 JS files, ~57K LOC |
| **Client** | 62+ components, 23 pages, ~32K LOC |
| **Database** | 55 tables, 27 migrations, Drizzle ORM on PostgreSQL |
| **AI Models** | 31 roles across 4 providers (Anthropic, OpenAI, Gemini, Vertex) |
| **API Endpoints** | ~50 server routes, ~278 client-side route constants |

### Finding Summary

| Severity | Count | Category |
|----------|-------|----------|
| **CRITICAL** | 5 | Briefing system runtime bugs (C-1 to C-5) |
| **HIGH** | 15 | Security gaps, silent failures, unprotected JSON.parse, outdated deps |
| **MEDIUM** | 12 | Dead code, ESLint violations, stale docs, debug flags |
| **LOW** | 5 | Naming inconsistencies, TODO cleanup |

---

## 1. CRITICAL — Briefing System Bugs (5)

> Already documented in `docs/architecture/briefing-issues-findings.md` (2026-03-09).
> Listed here for tracking. These are runtime crashers in the main pipeline.

| ID | File | Issue | Impact |
|----|------|-------|--------|
| **C-1** | `server/lib/briefing/index.js` | Barrel exports reference non-existent functions: `fetchTrafficBriefing` (should be `fetchTrafficConditions`), `fetchEventsBriefing` (should be `fetchEventsForBriefing`), `fetchNewsBriefing` (should be `fetchRideshareNews`) | Consumers importing from barrel get `undefined` |
| **C-2** | `server/api/briefing/briefing.js` ~line 407 | `/traffic/realtime` endpoint calls `fetchTrafficConditions` but never imports it | Runtime `ReferenceError` |
| **C-3** | `server/api/briefing/briefing.js` ~line 429 | `/weather/realtime` receives `{ lat, lng }` but function expects `{ snapshot }` | Wrong parameter shape, undefined field access |
| **C-4** | `server/lib/briefing/briefing-service.js` ~line 1090 | `normalizeEvent()` called without city/state context | Events stored with empty city/state, breaks downstream filtering |
| **C-5** | `server/lib/briefing/briefing-service.js` ~lines 1071-1075 | Event date calculation uses `toISOString()` (UTC) instead of user timezone | 7-day event query window off by up to 1 day |

### Status: ✅ FIXED 2026-04-04

---

## 2. HIGH — Briefing System Issues (8)

> Also documented in `briefing-issues-findings.md`.

| ID | File | Issue | Impact |
|----|------|-------|--------|
| **H-1** | `server/api/briefing/briefing.js` | Event deactivation endpoint has NO authorization check | Any authenticated user can deactivate ANY event |
| **H-2** | `server/lib/ai/adapters/index.js` | AI callModel timeout disabled globally (`timeout: 0`) | AI calls can hang indefinitely |
| **H-3** | `server/lib/ai/adapters/index.js` | No fallback for critical briefing roles (weather/traffic/schools) | Fail silently on Gemini outage |
| **H-4** | `server/lib/briefing/briefing-service.js` | Race condition in concurrent `generateAndStoreBriefing` | Data loss possible |
| **H-5** | `server/lib/briefing/briefing-service.js` | `withTimeout` doesn't cancel underlying promises | Timed-out API calls continue consuming quota |
| **H-6** | `server/lib/briefing/briefing-service.js` | ON CONFLICT doesn't update event content | Corrected event data silently dropped |
| **H-7** | `shared/schema.js` vs migrations | Schema/migration discrepancy (lat/lng/zip columns) | Code/schema mismatch unclear |
| **H-8** | `server/api/briefing/briefing.js` ~lines 652, 769 | `source_model` column accessed but doesn't exist in schema | Returns `undefined` in every event response |

### Status: ✅ ALL 8 FIXED 2026-04-04

---

## 3. HIGH — Unprotected JSON.parse Calls

Found across multiple critical files. Any malformed AI response crashes the pipeline.

| File | Lines | Context |
|------|-------|---------|
| `server/lib/ai/adapters/vertex-adapter.js` | 145 | `JSON.parse(jsonMatch[0])` without try-catch |
| `server/lib/ai/adapters/gemini-adapter.js` | 220 | `JSON.parse(extracted)` unprotected |
| `server/lib/ai/providers/consolidator.js` | 377 | `JSON.parse(field)` unprotected |
| `server/lib/briefing/briefing-service.js` | 501, 712, 720, 735, 740, 765 | Multiple JSON.parse calls without error handling |
| `server/lib/external/perplexity-api.js` | 193, 366, 475, 624 | JSON parsing without protection |
| `server/lib/venue/venue-intelligence.js` | 292, 320, 745 | Unprotected JSON parsing |
| `server/lib/location/holiday-detector.js` | 109, 249 | JSON.parse on file reads without try-catch |

### Status: UNFIXED

---

## 4. HIGH — Silent Promise Rejections (Fire-and-Forget)

| File | Line(s) | Pattern |
|------|---------|---------|
| `server/lib/venue/venue-enrichment.js` | 356 | `.catch(() => {})` — silently swallows |
| `server/lib/venue/venue-enrichment.js` | 498 | Non-blocking cache write, no error handling |
| `server/lib/venue/venue-address-resolver.js` | 65 | `.catch(() => {})` — silently swallows |
| `server/lib/venue/venue-cache.js` | 477, 504 | Non-blocking updates that could fail silently |
| `server/db/db-client.js` | 71, 90, 101, 168 | Connection health checks with no error handling |
| `server/lib/briefing/briefing-service.js` | 2521 | `dumpLastBriefingRow().catch(err => ...)` swallows |
| `server/middleware/auth.js` | 203 | `.catch(err => console.warn(...))` doesn't propagate auth failures |
| `scripts/test-snapshot-workflow.js` | 151, 158, 170, 214 | Multiple empty `catch {}` blocks |

### Status: UNFIXED

---

## 5. HIGH — Outdated npm Dependencies (22 packages)

| Package | Current | Latest | Gap |
|---------|---------|--------|-----|
| `@anthropic-ai/sdk` | 0.68.0 | 0.82.0 | 14 minor |
| `openai` | 6.17.0 | 6.33.0 | 16 minor |
| `@google/genai` | 1.39.0 | 1.48.0 | 9 minor |
| `googleapis` | 166.0.0 | 171.4.0 | 5 minor |
| `drizzle-orm` | 0.44.7 | 0.45.2 | 1 minor |
| `lucide-react` | 0.553.0 | 1.7.0 | **MAJOR** |
| `react-resizable-panels` | 3.0.6 | 4.9.0 | **MAJOR** |

**Note:** `npm audit` reports no active security vulnerabilities.

### Status: UNFIXED — schedule update pass

---

## 6. HIGH — Documentation Stale / Incorrect

| Document | Issue | Fix Needed |
|----------|-------|------------|
| `ARCHITECTURE.md` | Lists "OpenAI (GPT-5.2, Realtime API)" as primary — actual primary is Gemini 3.1 Pro | Update model table |
| `ARCHITECTURE.md` | Last updated 2026-03-17, code changed through 2026-03-29 | Refresh |
| `docs/architecture/briefing-system.md` | Lists phantom endpoint `POST /refresh-daily/:snapshotId` that doesn't exist | Remove |
| `docs/architecture/briefing-system.md` | Says "24 hours cache" but code uses 4h staleness for events, no cache for news | Fix TTL docs |
| `docs/architecture/briefing-system.md` | Missing 4 endpoints (filter-invalid-events, deactivate, reactivate, discovered-events) | Add |
| `server/lib/briefing/README.md` | References `phase-emitter.js` as in `server/lib/briefing/` but actual location is `server/events/phase-emitter.js` | Fix path |
| `server/lib/traffic/tomtom.js` | JSDoc says `radiusMiles` default 10, signature says `radiusMeters` 5000 | Fix JSDoc |

### Status: UNFIXED

---

## 7. MEDIUM — Dead Code & Deprecated Functions

### Briefing System Dead Code (9 functions)

| Function | File | Reason |
|----------|------|--------|
| `consolidateNewsItems` | briefing-service.js | Never called |
| `mapGeminiEventsToLocalEvents` | briefing-service.js | Replaced |
| `_fetchEventsWithGemini3ProPreviewLegacy` | briefing-service.js | Fallback reference only |
| `LocalEventSchema` | briefing-service.js | Never used for validation |
| `fetchWeatherForecast` | briefing-service.js | Not in pipeline |
| `needsReadTimeValidation` import | briefing-service.js | Unreferenced |
| `VALIDATION_SCHEMA_VERSION` import | briefing-service.js | Unreferenced |
| `sendModelErrorAlert` import | briefing-service.js | Unreferenced |
| `geocodeMissingCoordinates` | briefing-service.js | Never called |

### Other Dead Code

| Item | File | Issue |
|------|------|-------|
| `BRIEFING_NEWS_GPT` role | `model-registry.js:100-103` | Marked DEPRECATED 2026-01-14, never called |
| Semantic search module | `server/lib/external/semantic-search.js` | All functions return empty arrays / mock data (7 TODOs) |
| `strategy-generator.js` TODO | `strategy-generator-parallel.js:3` | Scheduled for cleanup |
| Archived migration script | `server/scripts/migrate-venues-to-catalog.ARCHIVED.js` | Should be removed |

### Status: UNFIXED — cleanup pass needed

---

## 8. MEDIUM — ESLint Violations (4)

| Type | File | Line | Issue |
|------|------|------|-------|
| Error | `components/co-pilot/TranslationOverlay.tsx` | 183 | Unused eslint-disable directive |
| Error | `hooks/useSpeechRecognition.ts` | 60 | Unused eslint-disable directive |
| Warning | `components/BriefingTab.tsx` | 117 | Unused variable `eventsToday` |
| Warning | `components/concierge/AskConcierge.tsx` | 9 | Unused import `Send` from lucide-react |

### Status: UNFIXED — quick fix

---

## 9. MEDIUM — Architectural Concerns

| Issue | Location | Details |
|-------|----------|---------|
| **Dual mount on `/api/hooks`** | `server/bootstrap/routes.js:107-108` | Two modules (`analyze-offer.js` + `translate.js`) on same path — route collision risk |
| **UnifiedAIManager is a stub** | `unified-ai-capabilities.js:179-198` | Declares 99 capabilities, health checks always return `{ok: true}`, `autoHeal()` is a no-op |
| **Debug flags in production** | `venue/hours/evaluator.js:208-209`, `logger/logger.js:45` | `DEBUG_HOURS` and `DEBUG` conditional logging left in code |
| **Apple Sign In incomplete** | `server/api/auth/auth.js:1596` | TODO: Implement full Apple Sign In with passport-apple |
| **No frontend error tracking** | `client/src/components/ErrorBoundary.tsx:36` | TODO: Send to error tracking service |

### Status: UNFIXED

---

## 10. MEDIUM — Briefing Medium Issues (12)

> Documented in `briefing-issues-findings.md`. Key ones:

| ID | Issue | File |
|----|-------|------|
| M-1 | `event_end_time` format inconsistency (12h vs 24h) breaks cleanup | cleanup-events.js |
| M-3 | `safeJsonParse` corrupts English apostrophes | briefing-service.js |
| M-4 | `filterRecentNews` includes items with missing dates | briefing-service.js |
| M-9 | 3 "NO FALLBACKS" rule violations (`timezone \|\| 'UTC'`, `city \|\| 'Unknown'`, `state \|\| ''`) | briefing.js |
| M-10 | Events endpoint returns `success: true` on error | briefing.js:808-809 |

### Status: UNFIXED

---

## 11. LOW — TODO/FIXME Inventory (35+)

| Category | Count | Key Files |
|----------|-------|-----------|
| Vector search implementation | 7 | `semantic-search.js` |
| ML health (recallContext, searchMemory) | 4 | `ml-health.js` |
| Apple Sign In | 1 | `auth.js` |
| Coach inbox feature | 1 | `chat.js` |
| Error tracking | 1 | `ErrorBoundary.tsx` |
| Google Maps integration | 1 | `RideshareIntelTab.tsx` |
| Vehicle tier settings | 1 | `vehicleTiers.ts` |

---

## 12. POSITIVE Findings (What's Working Well)

| Area | Assessment |
|------|------------|
| **Schema** | 55 tables, 150+ indexes, all FK types match, all migrations clean and idempotent |
| **Security** | 56 discrepancies tracked, ALL marked fixed. 9 unprotected routes secured. IDOR vulnerability patched |
| **AI adapter pattern** | Hedged router with cross-provider fallback is well-architected. No API keys in code |
| **Client state** | React Query + Context + SSE handles complex strategy lifecycle. Memoization fixes applied |
| **Memory layer** | pending.md + DOC_DISCREPANCIES.md + LESSONS_LEARNED.md providing effective cross-session continuity |
| **ORM** | All DB operations use Drizzle ORM — no raw SQL injection risks |
| **Rate limiting** | Applied to sensitive endpoints (translation: 30 req/min) |
| **Graceful shutdown** | SIGINT/SIGTERM handlers with child process cleanup |

---

## 13. Pending Items From Prior Sessions

| Item | Date | Status |
|------|------|--------|
| **Offer tier overhaul** (Share/Standard/Premium) | 2026-03-29 | AWAITING TEST APPROVAL |
| **25 briefing bugs** (5 critical, 8 high, 12 medium) | 2026-03-09 | DOCUMENTED, UNFIXED |
| **Research P0 features** (acceptance rate tracking, multiple stops) | 2026-03-17 | NOT IMPLEMENTED |
| **Dependabot vulnerabilities** | 2026-03-17 | FLAGGED |

---

## Recommended Priority Order

1. **Fix C-1 to C-5** — Briefing critical bugs (runtime crashers)
2. **Test & approve offer tier overhaul** — Pending since 2026-03-29
3. **Fix H-1 to H-8** — Briefing high issues (security, reliability)
4. **Wrap unprotected JSON.parse calls** — Across AI adapters and briefing
5. **Update ARCHITECTURE.md** — Correct model assignments, refresh date
6. **Fix 4 ESLint violations** — Quick wins
7. **Clean dead code** — 9 briefing functions + deprecated roles
8. **Update stale docs** — briefing-system.md, README paths
9. **npm dependency update pass** — 22 packages behind
10. **Address silent promise rejections** — Add proper error logging

---

*This audit document persists across sessions. Reference it at session start per Rule 12.*
