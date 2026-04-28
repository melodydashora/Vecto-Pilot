# Plan: PR Review Master Fixes — `coach-pass2-phase-b`

**Date:** 2026-04-28
**Branch:** `coach-pass2-phase-b` (37 commits, +7,428 / −1,976 across 182 files; 4 commits unpushed; no GitHub PR open)
**Status:** DRAFT — awaiting Melody approval per Rule 1
**Trigger:** `/pr-review-toolkit:review-pr` aggregate (5 specialized agents) + `CODEBASE_AUDIT_2026-04-27.md` (sibling-branch audit, 13 sections) + 18 personal Read-verifications
**Sources:**
- Aggregate review report (this session — code-reviewer, silent-failure-hunter, pr-test-analyzer, type-design-analyzer, comment-analyzer)
- `CODEBASE_AUDIT_2026-04-27.md` on `audit/codebase-2026-04-27` branch (Melody pasted content)
- `CLAUDE.md` Rules 1, 5, 9, 11, 13, 14, 15
- `claude_memory` rows #229 (canonical chain), #240 (no-grep), #243 (static-analysis floor), #258 (legacy fallback followup)

---

## Why this plan exists

Three Critical issues (C1, C2, C3) and one cross-system structural issue (C4 — `updatePhase` ownership) were identified by parallel review and confirmed via direct file Reads. These need to land **before** new features ship; otherwise the foundation has known live bugs that will surface during driver use.

**The most consequential finding:** commit `5cecd113`'s "tz-aware Rule 13" claim is **incomplete on the read path**. `filterInvalidEvents` shim called from `briefing-service.js:1603` (read-after-fetch revalidation) and `briefing.js:1202` (API endpoint that filters arbitrary events) accepts no `timezone` parameter and falls back to UTC inside `validateEventsHard`. AHEAD-timezone drivers (HST, JST, AEST, Pacific/Kiritimati) still see today's stored events stripped during the 9–14h UTC window. The bug the PR claimed to fix recurs through a different code path. The audit also flagged this independently in §11.1 / §13.5 as the "Path B" gap.

---

## Decisions locked

| Decision | Locked value | Rationale |
|---|---|---|
| Commit order | C3 → C2+§11.1 → C1 → C4 → §13-P1 (legacy delete) → doc sweep | Smallest-blast-radius first; doc sweep moves with C2 because EVENTS.md is stale on the same fix |
| Atomicity | One concern per commit; per-Rule-1 approval-gate between commits | Each fix is independently reviewable and revertable. Audit's `5cecd113` precedent (5 steps in one commit) was justified by file-overlap; here C2 and Path B share files (briefing.js) so they bundle, but C1 / C3 / C4 stand alone. |
| Schema version bump | `VALIDATION_SCHEMA_VERSION` 5 → 6 in C2 commit | Read-path becoming tz-aware is a validation-rule change; matches `5cecd113`'s 4→5 precedent for write-path tz fix |
| EVENTS.md update | Bundled with C2 commit | Comment-analyzer found EVENTS.md is stale on `5cecd113`'s tz fix (header still says 2026-04-11, schema=4, §9.2 Known Gap #1 still flags the bug as open). C2 lands the read-path fix AND closes the doc gap together. |
| C1 mitigation | Phase 1 (this plan): production-refusal of `?token=` query param + WARN log; Phase 2 (separate plan, post-merge): HttpOnly cookie ticket via `POST /api/logs/ticket` | Phase 1 closes the production hole today; Phase 2 redesigns SSE auth properly without blocking ship |
| C4 scope | Idempotent + monotonic `updatePhase` + single-writer `'complete'` | Two `'venues'` writers and four `'complete'` writers Read-verified. The auto-correct path at `content-blocks.js:208-211` should remain (Fix #15.2 safety net) but become a no-op when phase is already `'complete'`. |
| Legacy fallback delete | Yes, in standalone commit AFTER C2 lands | Audit §13-P1 + claude_memory #258 + Read-verified at `filter-for-planner.js:222-234`. Comment says "no known live callers remain"; deleting tightens the contract. |
| Inline-comment dating | Per Rule 5 — `// 2026-04-28: <reason>` blocks on every changed function | All commits |
| Testing approval | Required per Rule 1 between commits | Plan-then-implement-then-Melody-confirms-tests-passed-then-next-commit |
| Code-simplifier wave 2 | Held until ALL fixes land + tests pass | Avoids simplifier suggestions racing against bug fixes |
| Push + PR | Held until ALL fixes + simplifier wave land; `gh` CLI unavailable in env so Melody pushes from IDE | Per the original `/pr-review-toolkit:review-pr` ordering |

---

## Verified findings — what we're fixing

### C1 — Bearer token in URL on `/api/logs/stream` (Read: `server/api/health/logs.js` full)

**Lines:**
- `:26-31` — `requireAuthFromQueryOrHeader` shim accepts `?token=<bearer>` unconditionally
- `:71` — SSE `event: open` payload leaks absolute `LOG_FILE` path to client
- `:351` — viewer page client-side constructs `/api/logs/stream?token=<token>` URL itself

**Impact:**
- HMAC tokens are **session-permanent** — not JWTs. Per `auth.js:200-203`, the SSE stream's continual activity refreshes the sliding window, so effective TTL = the 2-hour hard cap.
- Token leaks via Cloud Run / Replit / nginx / proxy access logs (URL is logged), browser history, `Referer` headers, and shared bookmarks.
- SSE payload contains live driver PII (lat/lng, snapshot IDs, city/state, market, full strategy/briefing text streamed line-by-line from `logs/server-current.log`).

**Fix:** Phase 1 — add production check in `requireAuthFromQueryOrHeader`. When `NODE_ENV === 'production' || REPLIT_DEPLOYMENT === '1'`, refuse `req.query.token` with 401 + `chainLog` WARN. Update viewer page client-side code to NOT construct `?token=` URL in production (rely on cookie session instead, or fall back to polling endpoint via `Authorization: Bearer` header).

### C2 — `filterInvalidEvents` shim doesn't thread timezone (Read: `briefing-service.js:295-315`, `:1598-1610`; `briefing.js:1198-1208`, `:870-920`)

**Lines:**
- `briefing-service.js:300` — `export function filterInvalidEvents(events) { ... validateEventsHard(events, { logRemovals: true, phase: 'BRIEFING_SERVICE_COMPAT' }); ... }` — no `context` field
- `briefing-service.js:1603` — read-path caller after `discovered_events` fetch
- `briefing.js:1202` — `POST /api/briefing/events/filter`-style endpoint
- `dump-last-briefing.js` (debug-only, lower stakes; same shim)

**Impact:** AHEAD-timezone (HST, JST, AEST, Pacific/Kiritimati) drivers see today's stored events stripped on every snapshot during the 9–14h UTC window where local-today equals UTC-tomorrow. The bug `5cecd113` claimed to fix on the discovery write path recurs on the read path because the shim re-validates events with no timezone.

**Fix:**
1. Update `filterInvalidEvents(events, { timezone } = {})` signature; forward to `validateEventsHard(events, { logRemovals, phase, context: { timezone } })`.
2. Thread `briefing.timezone || snapshot.timezone` at `briefing-service.js:1603`.
3. Thread `req.body.timezone` at `briefing.js:1202` with WARN-on-missing log: `[BRIEFING] [API] [EVENTS] [FILTER] WARN: client did not supply timezone — Rule 13 falling back to UTC; AHEAD-timezone events may be incorrectly stripped`.
4. Thread tz at `dump-last-briefing.js:167-168` for consistency.
5. Bump `VALIDATION_SCHEMA_VERSION` 5 → 6 at `validateEvent.js:30`.
6. Update EVENTS.md header `Last Updated: 2026-04-28`, schema version line (`5` → `6`), Section 9.2 Known Gap #1 (mark closed with date), change log entries for both `5cecd113` (write-path) and this commit (read-path).

### §11.1 — Path B multi-day predicate (Read: `briefing.js:870-920`)

**Lines:** `briefing.js:816` route `GET /events/:snapshotId`, predicate at WHERE clause uses `gte(event_start_date, today) AND lte(event_start_date, endDate)` — start-date only, end-date never checked.

**Impact:** Map sees a different event set than the planner. A 4-day festival on day 2 (started yesterday, ending tomorrow) is missed by the map but present for the planner.

**Fix (bundled with C2 since same file, related cause):**
- Mirror the Path A predicate: `lte(event_start_date, endDate) AND gte(event_end_date, today)` (overlap window)
- Sort by impact + distance instead of `event_start_date` (use the same haversine annotation Path A uses)
- Apply the same planner-grade `isPlannerGradeVenue` gate (3-bucket classification: planner-ready / re-resolve-needed / orphan)
- Preserve `LIMIT 50` for now but log when truncation occurs (separate followup if higher cap is needed)

### C3 — `briefingLog ?? console.error` ReferenceError (Read: `briefing.js:460-475`)

**Lines:** `briefing.js:465` — `briefingLog ?? console.error(\`[BRIEFING] Market events lookup failed (non-fatal): ${marketErr.message}\`);`

**Impact:** Two bugs in one expression:
1. `briefingLog` is never imported in this file — only reference is line 465 itself. Throws `ReferenceError` inside the catch, propagates to outer 500 handler at `:510`, masks the real `marketErr`.
2. Even if imported, `??` short-circuits on truthy: `truthyLogger ?? console.error(...)` evaluates to `truthyLogger` and never invokes `console.error` as a fallback. Both halves broken.

**Fix:** Replace with `chainLog({ parent: 'BRIEFING', sub: 'EVENTS', callTypes: ['DB'], table: 'market_events', callName: 'lookup' }, \`Market events lookup failed (non-fatal): ${marketErr.message}\`);`. Add `chainLog` to imports if not already present.

### C4 — `updatePhase` writers + idempotency (Read: 6 call sites)

**Lines (all Read-verified):**
- `'venues'` writers (2):
  - `enhanced-smart-blocks.js:414` — orchestrator (Step 1: VENUE_SCORER call)
  - `blocks-fast.js:839` — orchestrator (Phase 4: Venue Discovery)
- `'complete'` writers (4):
  - `blocks-fast.js:272` — `ensureSmartBlocksExist` helper success path
  - `blocks-fast.js:898` — POST handler with-ranking branch
  - `blocks-fast.js:919` — POST handler without-ranking branch
  - `content-blocks.js:208-211` — auto-correct path with comment "Fix #15.2 — prevents 98% stuck issue"

**Definition (Read: `strategy-utils.js:215-260`):** `updatePhase(snapshotId, phase, options)` writes `phase`, `phase_started_at`, `updated_at` unconditionally; sets `status='ok'` on `'complete'`; emits SSE `phase_change` event. **Not idempotent** — calling twice writes twice, emits SSE twice.

**Impact:** Duplicate SSE phase emits cause client-side `useStrategyPolling` confusion and noise. The `content-blocks.js:208-211` auto-correct path is a documented Fix #15.2 safety net (drivers experienced "98% stuck" issue) so it should stay, but become a no-op when already `'complete'`.

**Fix:**
1. Add idempotency check at top of `updatePhase`: if current row's `phase === phase` already, return early without DB write or SSE emit. (Read current row first; if it doesn't exist, proceed to write — first call has no current row.)
2. Add monotonic ordering check: define a phase-order array `['init', 'snapshot', 'briefing', 'immediate', 'resolving', 'analyzing', 'venues', 'routing', 'places', 'verifying', 'enriching', 'complete']`. Refuse backward transitions with WARN log; this prevents the auto-correct path from ever moving backward.
3. The `content-blocks.js:208-211` path now safely no-ops when phase is already `'complete'` (idempotency); the warn-on-backward-transition catches accidental regressions.

### §13-P1 — Legacy `else` fallback in `filter-for-planner.js` (Read: `:215-240`)

**Lines:** `filter-for-planner.js:222-234` — `else` branch handling `!Array.isArray(todayEvents)` case. Comment: "Legacy path — kept for backward compatibility. See filterEventsForPlanner for the deprecated city/state split logic."

**Impact:** FR-PROD-002 ("implementation can't narrow product") — legacy branch silently substitutes city-filter for state-scoped contract. Per audit §12.6 + claude_memory #258, all live callers have been migrated to pass `todayEvents` explicitly. Deleting tightens the contract.

**Fix:** Standalone commit AFTER C2 lands (so Path B alignment is in place first). Delete the `else` branch; require `Array.isArray(todayEvents)` at the function entrance; throw `TypeError` with clear message if not.

---

## Out of scope (queued for follow-up)

Tracked-only — NOT in this plan. Will be triaged into separate plans:

| # | Item | Source |
|---|---|---|
| F1 | Logging refactor sed overshoot — `DECO_DONE/ERR/WARN` both branches empty (`workflow.js:97-99`); duplicate `ROUTES` key (`:128, :143`); `events/pipeline/types.js` JSDoc rename `location → LOCATION`; `JSON.stringify` unguarded (`workflow.js:522`) | Aggregate I1, I2, I-LOG-3, I-LOG-4 |
| F2 | Logger control-plane bypass — raw `console.log` regressions in `filter-for-planner.js:219, 233`; `briefing-service.js:860, 2311`; `semantic-search.js:56-132`; `strategy-utils.js:699`; `*Log.info('[...]')` patterns in 4 files | Aggregate I10, I11, I12; file-tee silent catches I-LOG-7 |
| F3 | Log endpoint hardening (Phase 2) — HttpOnly cookie ticket via `POST /api/logs/ticket`; SSE primer/tail race fix; sync-IO interval → `fs.createReadStream` async; backoff on persistent error; `res.writableEnded` guards; absolute-path leak in `event:open` payload | Aggregate I5-I9, F8, F9; logs.js full Read |
| F4 | Coach client refactor bugs — SSE chunk-boundary double-process (preserved from main); `reader.cancel()` on abort; `setIsStreaming(false)` in abort; localStorage try/catch; `_isChatLoaded` underscore-lies; empty assistant bubble on cancel; structurally unreachable `useStreamingReadAloud` chunk catch | Aggregate I16-I20, F5, F6 |
| F5 | Coach state machine type-design refactor — `useReducer<CoachChatState>` discriminated union for chat hook; `sentenceBoundary` discriminated-union return; `featureFlags` registry pattern; brand `cleanTextForTTS` IO; expose state in `useStreamingReadAloud` | Type-design agent findings |
| F6 | Strategy / DAL silent-failure cluster — `strategy-generator.js:31/38/65/70` returns null for 4 distinct failure modes; `rideshare-coach-dal.js` 10x DAL methods return empty values on DB error; `tactical-planner.js:504-506` replacement-call warn-and-continue; `realtime.js:142` drops OpenAI error message; `chat.js:1376-1380` AbortError indistinguishable from network failure; `chat.js:1295-1297` SSE chunk parse errors silently dropped | Silent-failure F2, F3, F4, F10, F13, F14, F16 |
| F7 | Auth dev-fallback assertion — `auth.js:79-84` `REPLIT_DEVSERVER_INTERNAL_ID` fallback should be guarded by an explicit `JWT_SECRET` startup assertion when log viewer is enabled | Aggregate I13 |
| F8 | `tomtom.txt` gitignore + `git rm --cached` — Melody confirmed intent (dev capture for tailing TomTom output); add `tomtom*.txt` to `.gitignore`, untrack the file, document the lifecycle in `docs/architecture/LOGGING.md` (or wherever the dev-capture pattern is canonical) | Aggregate I15 + Melody clarification + auto-memory `project_tomtom_txt_intent.md` |
| F9 | `CLAUDE.md` Rule 12 row #8 amendment — note that `CODEBASE_AUDIT_2026-04-27.md` lives on sibling branch `audit/codebase-2026-04-27`. Do NOT remove the citation (audit is canonical input). | Comment-analyzer + Melody correction + auto-memory `project_codebase_audit_2026-04-27.md` |
| F10 | `jest` not pinned in devDependencies — runner exists transitively via `jest-environment-jsdom@^30` and `ts-jest@^29`; add explicit `"jest": "^30.x"` to lock | pr-test-analyzer |
| F11 | Test gaps — extend `test-validate-event-tz.mjs` (rewrite tautological tests 1/3/4/6 to mock-clock pattern; BEHIND-tz mirror; half-hour offsets; DST-transition; invalid-tz fail-closed); add `findSentenceBoundary` + `cleanTextForTTS` unit tests; pin `chainLog` validators; `re-resolve-needed` bucket fixture in `test-smart-blocks-multi-day.mjs`; abort-propagation test for `chat.js` AbortSignal; **zero tests for the entire +463-line `health/logs.js`** | pr-test-analyzer |
| F12 | Daily-strategy doc sweep — 7 docs (`AI_ROLE_MAP.md`, `LLM-REQUESTS.md`, `AI_MODEL_ADAPTERS.md`, `briefing-transformation-path.md`, `DB_SCHEMA.md`, `EVENTS.md`, `AUDIT_SYNTHESIS_2026-04.md`) reference removed `STRATEGY_DAILY` / `generateDailyStrategy` / `consolidated_strategy`. Read each doc + strike or label as deprecated. | Audit §4.1 + Read-verified hits |
| F13 | `api-routes-registry.md` regeneration — last-updated 2025-12-14; missing `/api/strategy/tactical-plan`, `/api/memory/*`, `/api/translate`, `/api/hooks/*`, `/api/realtime/token`, `/api/logs/*` (4 endpoints). Coach path drift (`/api/coach` listed, actual is `/api/chat` + `/api/rideshare-coach/*`). | Audit §4.2 |
| F14 | Strategy `server/lib/strategy/` dead-code disambiguation — Read-verification reveals `providers.js` IS imported by live `health.js:9` (typecheck-only — provider functions never invoked). Static-analysis floor (memory #243): files are import-graph reachable but functionally dead. Deletion plan must remove the typecheck use OR keep the files. | Audit §6.1 + Read-verified |
| F15 | `server/types/driving-plan.ts` (167 lines, 15 types) — Read-confirmed scaffolding for unimplemented shift-planning feature. Add date-stamped intent comment per audit §9.7 recommendation (a). Don't move/delete. | Audit §9.7 + Read |
| F16 | `useActiveEventsQuery` polling scope — set `refetchInterval: false`, `refetchOnWindowFocus: false` once snapshot `phase === 'complete'`. Currently polls every 60s indefinitely (`useBriefingQueries.ts:418`). | Audit §10.3 |
| F17 | `StrategyPage.tsx:124-128` stale comment — claims "currently 2 consumers: this page + MapPage." MapPage was deleted in Phase B 2026-04-26; only StrategyPage remains. | Audit §10.3 |
| F18 | TRIAD branding policy — keep operational (CLEAR_CONSOLE_WORKFLOW spec doubled down on `[TRIAD 1/4]` in workflow logger); decommission only in user-facing route docs. | Audit §9.4 |

---

## Implementation gates (per Rule 1)

For each commit (C3 → C2+§11.1 → C1 → C4 → §13-P1 delete → doc sweep), the sequence is:

1. **Pre-commit:** Read all files to be modified in their current state (no grep).
2. **Edit:** Apply the change with inline `// 2026-04-28: <reason>` comment per Rule 5.
3. **Test:** Run any relevant test (`server/scripts/test-*.mjs`, `npm test:unit` if applicable). Capture output.
4. **Pause:** Surface the diff + test output to Melody. **Do NOT commit until Melody confirms "All tests passed."**
5. **Commit:** Create the commit with the canonical format (one concern per commit; commit message references this plan + the relevant audit section).
6. **Move to next:** Update task tracking; repeat.

The branch is currently 4 commits ahead of `origin/coach-pass2-phase-b`. After all this lands, push + open GitHub PR is the final step (gh CLI not installed in this env — Melody pushes from IDE).

---

## Per-commit test plans

**C3:**
- Reproduce: temporarily set `[BRIEFING] Market events lookup failed` to throw; call `GET /api/briefing/snapshot/:snapshotId`; observe the catch handler now emits the actual error message.
- Regression: normal aggregate path returns 200.

**C2 + §11.1:**
- Extend `test-validate-event-tz.mjs` with two new tests:
  - Test 8: `filterInvalidEvents(events, { timezone: 'Pacific/Kiritimati' })` at mock-clock 15:00 UTC → today's local-date event accepted; pre-fix UTC fallback would have rejected.
  - Test 9: `filterInvalidEvents(events)` (no tz) → falls back to UTC (backwards compat).
- Extend `test-smart-blocks-multi-day.mjs` with a fixture proving Path B (`/api/briefing/events/:snapshotId`) now returns multi-day events spanning today; pre-fix start-date-only predicate would have missed them.
- Confirm `validateEvent.js:30` reads `VALIDATION_SCHEMA_VERSION = 6`.
- Confirm `docs/EVENTS.md` header reads `Last Updated: 2026-04-28`, schema line `6`, Section 9.2 Known Gap #1 closed, change log has 2026-04-28 entries for both `5cecd113` and this commit.

**C1:**
- `NODE_ENV=production` + `GET /api/logs/stream?token=<valid>` → 401 with explicit error message.
- `NODE_ENV=development` + same → 200 + SSE stream (existing behavior preserved).
- Both envs: `Authorization: Bearer <valid>` → 200.
- Production refusal emits the expected `chainLog` WARN line.
- Viewer-page client-side: in production, does NOT construct `?token=` URL; falls back to polling endpoint with `Authorization: Bearer` header.

**C4:**
- Call `updatePhase(snapshotId, 'complete')` twice; assert second call no-ops (no DB write delta, no second SSE `phase_change` emit).
- Call `updatePhase(snapshotId, 'complete')` then `updatePhase(snapshotId, 'venues')`; assert backward transition refused with WARN log.
- `content-blocks.js:208-211` auto-correct path: insert a stuck-at-`'venues'` strategy row with all blocks present; call `GET /api/strategy/.../content-blocks`; assert phase auto-corrects to `'complete'` ONCE without duplicate emission.

**§13-P1 delete:**
- Read every caller of `filterBriefingForPlanner` / `composeBriefingForPlanner` (whatever it ends up named) module-by-module — confirm all pass `todayEvents` array.
- Call with non-array `todayEvents` argument → throws `TypeError`.
- Call with valid array → unchanged behavior.

**Doc sweep:**
- After C2 lands, EVENTS.md auto-updates (bundled). Final sweep checks `CLAUDE.md` Rule 12 row #8 — append "(lives on sibling branch `audit/codebase-2026-04-27`; pull or `git show audit/codebase-2026-04-27:docs/architecture/audits/CODEBASE_AUDIT_2026-04-27.md` to read)".

---

## Approval request

Per Rule 1, no code changes will be made until Melody confirms:

1. **Plan scope is correct** — C3, C2+§11.1, C1, C4, §13-P1 in this order, with the doc-sweep bundled into C2.
2. **Out-of-scope queue is acceptable** — items F1-F18 deferred to follow-up plans (NOT addressed in this PR).
3. **Test plans are sufficient** — additions to `test-validate-event-tz.mjs` and `test-smart-blocks-multi-day.mjs`; no new test framework infrastructure (jest pinning is F10, deferred).
4. **Per-commit gating** — Melody confirms "All tests passed" between each commit before proceeding to the next.

If approved, implementation starts with C3 (smallest blast radius, one-line expression fix). If any item should move into or out of scope, edit this doc and tell me.
