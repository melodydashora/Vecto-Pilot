# Documentation Discrepancies Queue

**Status:** BLOCKING QUEUE
**Protocol:** Items here must be resolved within 24 hours
**Rule:** Trust CODE over DOCS when they contradict

> For resolved items and historical sections, see the [archive](reviewed-queue/DOC_DISCREPANCIES_ARCHIVE.md).

---

## How to Use This File

1. When you find docs that contradict code, add an entry below
2. Trust the CODE (not docs) until resolved
3. Fix the docs within 24 hours
4. Move the entry to the archive after fixing
5. Log the fix in `docs/reviewed-queue/CHANGES.md`

---

## Active Discrepancies

### PRODUCTION ENVIRONMENT (P0 — Broken Features)

| ID | Location | Issue | Resolution Needed | Status |
|----|----------|-------|-------------------|--------|
| D-092 | Replit Prod Secrets | `VECTO_AGENT_SECRET` not set — agent/system auth rejects ALL requests in production | Must be added as Replit Secret in the production deployment | PENDING |
| D-093 | Replit Prod Secrets | `TOKEN_ENCRYPTION_KEY` not set — Uber OAuth token encryption broken in production | Must be added as Replit Secret in the production deployment | PENDING |

### PRODUCTION RUNTIME (P0/P1 — Active Failures)

| ID | Location | Issue | Root Cause | Status |
|----|----------|-------|------------|--------|
| D-099 | Briefing pipeline | Event search `high_impact` timeout at 90s — returns empty | External API or query exceeds timeout; events silently dropped | PENDING |
| D-100 | `server/bootstrap/middleware.js` | Payload too large (3x consecutive 413s) | Client doesn't validate upload size pre-flight; user retries with no helpful error | PENDING |
| D-101 | `scripts/check-standards.js:470` | `max_tokens` deprecation regex is provider-agnostic — false-positives on `server/lib/ai/adapters/anthropic-adapter.js:28,72` where `max_tokens` is the **correct** Anthropic parameter | Surfaced 2026-04-25 during the GPT-5.5 swap. Standards check exits non-zero. Fix: scope the regex to OpenAI files only, or whitelist anthropic-adapter.js. **FIXED 2026-05-08 (commit c7cf2730):** added `pathSkip` field to deprecated-pattern rule + applied skip regex `/anthropic\|claude\|perplexity\|sync-events\|models-dictionary\|agent-override-llm\|diagnostics\|eidolon/i` for max_tokens, and `/model-registry\|models-dictionary/i` for the gemini-pro ambiguity rule. `node scripts/check-standards.js` now reports 0 deprecated-ai violations (down from 30+). | FIXED |
| D-102 | `server/lib/strategy/planner-gpt5.js:53` | Comment says "Registry config: gpt-5.2, medium reasoning_effort, 32000 max_tokens" — stale by two model generations and now contradicts the registry | Surfaced 2026-04-25. Either update the comment to reflect current registry state, or remove (registry is the single source of truth — Rule 14). **OBSOLETE 2026-05-08:** `find . -name "planner-gpt5.js"` returns no matches — the file has been deleted/renamed since this entry was written. Nothing to fix. Keep the row for audit-trail; do not re-open. | OBSOLETE |
| D-103 | `scripts/check-standards.js:430-454` | Three pre-existing standards failures (duplicate exports, non-ISO country codes, max_tokens false positives) cause `node scripts/check-standards.js` to exit non-zero independent of any current change | Surfaced 2026-04-25 during the GPT-5.5 swap. Pre-existing issues unrelated to this PR. Fix each finding on its own merits — do not bundle | PENDING |
| D-104 | `docs/architecture/` | **Case-collision duplicate doc files** — 8 pairs total resolved in PR #29 (2026-05-03): `DECISIONS.md`/`decisions.md`, `LOCATION.md`/`Location.md`, `STANDARDS.md`/`standards.md`, `STRATEGY.md`/`Strategy.md`, `BRIEFING.md`/`Briefing.md`, `CONSTRAINTS.md`/`constraints.md`, `DEPRECATED.md`/`deprecated.md`, `LOGGING.md`/`logging.md`. Original 3 named in the audit directive, but the new structural `filename-case` lint surfaced 5 more (the value of structural enforcement). All 8 lowercase variants `git rm`'d; canonical UPPERCASE retained per `docs/architecture/` convention. 7 internal markdown links updated across `docs/README.md`, `DEPRECATED.md`, `strategy-framework.md`, `DECISIONS.md`, `auth-system.md`, `server-structure.md` to point at UPPERCASE. New `--check=filename-case` lint structurally prevents the next case-collision before merge. **Status row update belated** — the PR #29 working session edited this row to FIXED locally but the change never made it into the PR commit; surfaced 2026-05-03 by AUTH-003 branch hygiene (`git reset --hard origin/main` exposed the drift). | FIXED (PR #29) |
| D-105 | `tests/auth-token-validation.test.js:52` | "extracts userId from valid token" test calls `requireAuth` and expects `next()` to fire, but `requireAuth` (since 2026-01-05 SAVE-IMPORTANT.md change adding DB-backed session enforcement) requires a valid session row in the DB before calling `next()` — and the test uses a mock DATABASE_URL with no session seeded. Result: test has been a permanent red mark (5 of 6 cases pass) since session enforcement was added; it's a test-rot issue, not a logic bug. Surfaced 2026-05-03 during AUTH-003 migration validation (`git diff origin/main` confirmed the file is unchanged and the failure stack lands in unmodified middleware code). Fix: either seed a session fixture before the test runs, or split the test into a pure HMAC-math test (which already passes) plus an integration test that runs with a real DB. Out of scope for AUTH-003. | PENDING |
| D-106 | `SAVE-IMPORTANT.md:33-41` | The `users` table schema block lists `device_id TEXT NOT NULL` as the 2nd column, but the live DB has NO `device_id` column on `users` (verified 2026-05-12 via `\d users` — only user_id, session_id, created_at, updated_at, current_snapshot_id, session_start_at, last_active_at). `shared/schema.js:19-29` also does not define device_id on the users table. The `device_id` column DOES exist, but on different tables — `intercepted_signals` (schema.js:1514) and `offer_intelligence` (schema.js:1607) — both Siri shortcut integration tables using device-id-based auth instead of JWT. The drift is purely in SAVE-IMPORTANT.md. Fix: remove the `device_id           TEXT NOT NULL,        -- Device making request` line from the schema code block in SAVE-IMPORTANT.md and adjust the surrounding sentence "NO location fields in users table" to not imply device_id is/was a session field. Surfaced 2026-05-12 during session-architecture verification audit requested by Melody. **Confirmed:** no separate `sessions` table exists — session state lives in `users` (7 cols) and activity lives in `snapshots`, linked by `session_id` + `user_id`. | PENDING |
| D-107 | `server/api/location/location.js:969-1008` | `snapshot.market` was being copied verbatim from `driver_profiles.market` at snapshot creation, ignoring the snapshot's GPS-resolved `(city, state)`. Effect: a Dallas-registered driver who travels (or tests via manual coord override) gets `snapshot.market = "Dallas-Fort Worth"` regardless of where they actually are. Downstream, `pipelines/news.js:161` reads `snapshot.market` and embeds it in the Gemini prompt as "Search the entire Dallas-Fort Worth metro area" — so news returns DFW articles for NYC/SF/Chicago briefings. Real-world impact confirmed by Melody: "Across 6 states I drove in the last two days all showed DFW Rideshare news." Surfaced 2026-05-12 via the 2026-05-12 OVERRIDE-FEATURE (NYC manual coord test). **FIXED 2026-05-12:** inverted priority in `location.js:969-1008` — `resolveTimezoneFromMarket(city, state, country)` runs first; profile.market is fallback only if coord resolution fails. OAuth first-snapshot backfill preserved (Google signup leaves profile.market=NULL → write first known market). Comment updated in `shared/schema.js:50-52`. Plan: `docs/review-queue/PLAN_snapshot-market-gps-derived-2026-05-12.md`. Memory: row #332. | FIXED |
| D-108 | `server/lib/briefing/pipelines/airport.js:134-138` | Airport pipeline's Gemini prompt used JSON schema with literal *example values* (`"status":"normal"`, `"delays":"description"`, `"recommendations":"driver tips"`) instead of type hints. Schema priming biased Gemini's output toward returning generic "normal" status regardless of search-grounded current reality — `pipelines/airport.js` returned "On Time / minor 15-min delays" at LAX while `pipelines/news.js` (same Gemini class, different prompt) correctly returned "150+ delayed flights and 3-hour customs backups at Tom Bradley Terminal." The disagreement was the diagnostic signal. **FIXED 2026-05-12:** rewrote system prompt to declare quality intent ("CURRENT real-time... within the last 24 hours"), enumerated 5 search categories in user prompt (delays/ground-stops/customs-TSA/weather/busy-windows), replaced example values with `<type\|hint>` placeholders, added explicit anti-default ("do not default to 'normal'"). Verified with LAX, HNL, ORD tests — airport now reflects real conditions and strategy LLM downstream made correct ORD→MDW recommendation. Step 2 added TSA wait time fields (general/PreCheck/Clear with entry points) + AirportCard UI render block. Plan: `docs/review-queue/PLAN_gps-override-dev-feature-2026-05-12.md` (testing infrastructure that surfaced this). | FIXED |
| D-109 | `server/lib/briefing/shared/safe-json-parse.js:111-117` | The `fixCommonJsonIssues` helper's newline-escape regex `"([^"]*)\n([^"]*)"` was supposed to escape real newlines inside JSON string values (so `"line1\nline2"` becomes valid JSON). But `[^"]*` greedy-matches across separate sibling properties — given valid JSON like `"code": "LAS",\n      "name": "Harry..."`, the regex matches the closing-`"`-of-LAS through opening-`"`-of-name as if it were one string straddling the structural newline, then replaces that newline with literal `\n` (2 chars: backslash + n). The result is invalid JSON because `\n` is not allowed as whitespace between properties — only inside string values. All 5 parse attempts then fail and the pipeline returns 0 airports. Surfaced 2026-05-12 when the airport TSA addition produced larger/more-nested JSON that triggered the latent regex bug; Gemini was returning correct content ("83 flight disruptions and 7 cancellations reported today at LAS") but the parser mangled it. Affects ALL 5 briefing pipelines that use safeJsonParse (news/events/traffic/schools/airport) — they happen to escape so far because their JSON is simpler/flatter. **FIXED 2026-05-12:** replaced regex with a character-by-character state-machine walker that tracks `inString` boundaries via toggle on unescaped `"`, escapes `\n` only when `inString === true`. ~25 lines of clearly-correct code replacing a ~5-line regex that's been brittle since the 2026-02-17 "FIX" that introduced it. | FIXED |

### AI COACH (P1 — Remaining from 2026-03-18 Audit)

| ID | Location | Issue | Impact | Status |
|----|----------|-------|--------|--------|
| COACH-H7 | `server/api/chat/chat.js`, `model-registry.js` | No streaming fallback — Gemini outage kills the coach entirely | Coach completely unavailable during any Gemini outage | PENDING |
| COACH-H8 | `server/api/chat/chat.js:1325-1345` | Conversation message saves are fire-and-forget with try/catch that swallows errors | Silent memory loss — coach forgets conversations | PENDING |

### CONCIERGE — Security (P1)

| ID | Location | Issue | Status |
|----|----------|-------|--------|
| CH-5 | `server/lib/concierge/concierge-service.js` | findOrCreateVenue() can't persist Gemini-discovered venues — missing coordinates | PENDING |

### CONCIERGE — Medium (P2)

| ID | Location | Issue | Status |
|----|----------|-------|--------|
| CM-1 | `concierge-service.js` | Race condition in searchNearby() — duplicate Gemini calls for same location | PENDING |
| CM-2 | `concierge-service.js` | No spatial index on venue_catalog for lat/lng range queries | PENDING |
| CM-3 | `concierge.js` | No response.ok check on Google Weather API fetch | PENDING |
| CM-4 | `concierge.js` | No response.ok check on Google AQI API fetch | PENDING |
| CM-5 | `concierge.js` | Feedback endpoint allows unlimited submissions per token | PENDING |
| CM-6 | `concierge-service.js` | askConcierge() errors return generic message, no error logging | PENDING |
| CM-7 | `PublicConciergePage.tsx` | No error boundary — React crash shows blank screen | PENDING |
| CM-8 | `AskConcierge.tsx` | Chat history not persisted — refresh loses all messages | PENDING |
| CM-9 | `concierge-service.js` | buildConciergeSystemPrompt() has no max length check | PENDING |
| CM-10 | `concierge.js` | Weather and AQI fetched sequentially — could be parallelized | PENDING |
| CM-11 | `concierge-service.js` | Gemini venue search uses unbounded radius | PENDING |
| CM-12 | `ConciergeMap.tsx` | Google Maps script loaded without error handling | PENDING |
| CM-13 | `concierge.js` | getDriverPublicProfile called twice per protected request | PENDING |
| CM-14 | `concierge-service.js` | No timeout on Gemini explore/ask calls | PENDING |
| CM-15 | `PublicConciergePage.tsx` | Loading states don't show skeleton UI | PENDING |
| CM-16 | `concierge.js` | Share token generation has no collision check | PENDING |

### CONCIERGE — Low (P3)

| ID | Location | Issue | Status |
|----|----------|-------|--------|
| CL-1 | `PublicConciergePage.tsx` | No input sanitization on passenger question | PENDING |
| CL-2 | `AskConcierge.tsx` | Question input has no character limit in UI | PENDING |
| CL-3 | `concierge.js` | Feedback text field has no length limit | PENDING |
| CL-4 | `PublicConciergePage.tsx` | No offline detection for bad mobile connections | PENDING |
| CL-5 | `ConciergeMap.tsx` | Map markers don't cluster in dense areas | PENDING |
| CL-6 | `PublicConciergePage.tsx` | No dark mode support on public page | PENDING |
| CL-7 | `concierge-service.js` | Vehicle seatbelts field exposed without context | PENDING |
| CL-8 | `AskConcierge.tsx` | No typing indicator while waiting for Gemini | PENDING |
| CL-9 | `concierge.js` | Rate limiter messages not localized | PENDING |
| CL-10 | `PublicConciergePage.tsx` | Page title is generic — should show driver name | PENDING |
| CL-11 | `ConciergeMap.tsx` | No "recenter" button when passenger scrolls map | PENDING |
| CL-12 | `concierge-service.js` | searchNearby() hardcodes 5km radius | PENDING |

---

## Known Technical Debt

| ID | Area | Issue | Current State | Future Recommendation |
|----|------|-------|---------------|----------------------|
| ARCH-001 | Session Architecture | Users table used for sessions with `onDelete: 'restrict'` | Intentional — prevents data loss (2026-01-05) | Split into separate `sessions` table |
| ARCH-002 | Async Waterfall | `blocks-fast.js` runs strategy generation synchronously (~35-50s) | HTTP request holds connection open | Use 202 Accepted + poll/SSE |

---

## Deferred (By Design)

These items were reviewed and intentionally left open with documented rationale.

| ID | Location | Reason |
|----|----------|--------|
| D-052 | `coach_conversations` schema | Missing 8 columns — table already documented in D-037; low usage |
| D-053 | `driver_profiles` schema | Missing 10+ columns — low usage |
| D-054 | `auth_credentials` schema | Missing 5 security columns — low usage |
| D-060 | FK `onDelete` behaviors | Requires full schema audit pass |
| D-071 | SSE endpoints no auth | By design — EventSource API can't send auth headers |
| D-072 | Health endpoints no auth | By design — standard for monitoring |
| D-073 | Job metrics no auth | By design — standard for monitoring |
| D-074 | Platform endpoints no auth | By design — public reference data |
| D-075 | Vehicle endpoints no auth | By design — public NHTSA reference data |
| D-076 | Hooks endpoints no auth | By design — public for Siri Shortcuts |

---

## Open Hardening Items

### Phase 2: Adapter-Only AI Calls
- [ ] Add CI check: no direct SDK calls outside adapters

### Phase 4: Schema Defect Resolution
- [ ] Run full schema validation against shared/schema.js
- [ ] Audit all column naming for semantic accuracy
- [ ] Generate fresh schema documentation

---

## Adding New Discrepancies

```markdown
| D-XXX | `file:line` | [Brief issue description] | [What the code actually does] | PENDING |
```

After fixing:
1. Change status to RESOLVED
2. Move to [archive](reviewed-queue/DOC_DISCREPANCIES_ARCHIVE.md) with date
3. Log in `docs/reviewed-queue/CHANGES.md`
