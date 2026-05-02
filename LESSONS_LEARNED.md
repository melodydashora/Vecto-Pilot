[SYSTEM TAG: HISTORICAL_RECORD | NON_EXECUTABLE]
AGENT DIRECTIVE: This file contains resolved historical post-mortems. Do NOT attempt to fix the bugs listed here. Use this file STRICTLY as read-only context to avoid repeating past architectural mistakes.


## 2026-05-02: Logger taxonomy migrations — spec the exceptions, don't violate them

- **Symptom:** Tier 3 of the matrixLog migration (auth.js + location.js + blocks-fast.js) needed to keep the existing `userId.substring(0, 8)` correlation prefix in auth-flow log messages for real-time DX, but the matrixLog spec at `server/logger/matrix.js:26-28` (written 2026-05-01) explicitly forbade UUIDs in messages. Initial Claude recommendation was to drop the prefix entirely (Option (i), spec-literal); deeper review revealed this would degrade Replit console correlation when multiple drivers log in concurrently.
- **Root cause:** A new structured logging spec was written on top of an existing convention without auditing the convention first. The auth-flow `userId.substring(0, 8)` pattern (`auth.js:56` and similar) predated the matrixLog spec by months and was load-bearing for debuggability — but the spec text was authored as if no prior pattern existed.
- **Resolution (Melody, 2026-05-02):** modified Option (ii) — keep the 8-char hex prefix in messages, AND amend the matrixLog spec to explicitly permit it as a deliberate exception. Spec-amendment commit (`docs(matrix): permit 8-char hex correlation prefix in messages`) lands BEFORE the migration commits so the spec authorizes the convention rather than being silently violated. Email / coord / full-address / full-UUID remain forbidden in messages.
- **Lesson 1 — Audit existing conventions before writing fresh specs.** When introducing a new structured logging spec on top of existing convention, grep the active convention first. Either (a) explicitly carry it forward into the spec as a permitted exception, or (b) deprecate it deliberately. "We'll fix it during migration" rationalization leads to silent spec violations.
- **Lesson 2 — Spec-amendment commits should precede the migration commits that rely on them.** The git timeline reads as *spec said X → spec said Y → code does Y*. If migration commits land first with the convention, future readers grep the spec, see "NO UUIDs in messages", and assume the code is buggy. By landing the spec amendment first, the timeline is self-explanatory.
- **Lesson 3 — Real-time DX is a real architectural concern.** Spec-literal compliance can be the right call for log-pipeline ingest, but the cost of "you must tail JSON sidecar to correlate" should be measured against the value, not assumed away. Multiple concurrent driver logins in the dev console were the concrete forcing function.
- **Files:** `server/logger/matrix.js` (spec amendment), `server/api/auth/auth.js`, `server/api/location/location.js`, `server/api/strategy/blocks-fast.js`, `docs/review-queue/PLAN_matrixlog-tier3-auth-location-strategy-2026-05-02.md`.

## 2026-04-30: Hash Function Normalization Gap → 161 Duplicate Events Past UNIQUE Constraint

- **Symptom:** `discovered_events` accumulated 161 dupes (out of 1826 rows) despite `event_hash` having a `UNIQUE` constraint at the schema level. Read-path application logic ran `deduplicateEvents` + `deduplicateEventsSemantic` ~15× per page load on `/co-pilot/strategy` to compensate, masking the underlying integrity gap.
- **Root Cause:** `generateEventHash` (write-side) used narrower title normalization than `deduplicateEvents` (read-side). The hash stripped only "at Venue" suffixes; the dedup also stripped prefixes ("Live Music:", "Concert:", "Show:"), parentheticals ("(Shared Reality)"), and free-form suffixes. Same logical event with title variations therefore produced different hashes, bypassing the UNIQUE constraint.
- **Aggravator:** Read-path dedup ran in 4 places (3 in `briefing.js`, 1 post-SELECT inside `fetchEventsForBriefing` in `briefing-service.js`). The noise was familiar; the underlying gap wasn't surfaced for months.
- **Initial proposal (rejected):** Add a second UNIQUE on `(state, lower(title), event_start_date, venue_id)` as a composite key. Melody rejected: `lower(title)` requires exact match → would force title-mangling in the DB to catch prefix variations, degrading UI presentation.
- **Actual fix (Choice A):** Upgrade `generateEventHash`'s normalization to match `deduplicateEvents` (strip prefixes, parentheticals; extract normalized street name from address). Migrate existing 1826 rows by re-hashing with the new logic in a Node script that imports the same function the app uses → guaranteed parity. Strip dedup from all 4 read sites; relocate to PRE-INSERT in the briefing pipeline. Result: 161 dupes consolidated; 0 dupes by `event_hash` post-migration; read-path silent on DEDUP under `[API]` chain; runtime logs confirmed `[BRIEFING] [EVENTS] [DEDUP] [WRITE] hash: 15 → 15, semantic: 15 → 15` firing once per briefing generation.
- **Files:** `server/lib/events/pipeline/hashEvent.js` (v3), `server/scripts/migrate-event-hashes.js`, `server/lib/briefing/briefing-service.js`, `server/api/briefing/briefing.js`, `tests/events/pipeline.test.js` (12 new Choice A unit tests).
- **Lesson 1 — Late-binding identity beats early-binding constraints when normalization needs to evolve.** A computed hash is *late-binding*: the function lives in code, can change, and decouples identity from presentation. A composite-key index is *early-binding*: it locks identity to literal column values. The hash-function approach lets normalization evolve without schema migration — only data migration via a Node script that imports the same function.
- **Lesson 2 — Audit findings should update the recommendation, not be rationalized into the original framing.** The plan was framed as "add a constraint" before the audit. The audit revealed a constraint already existed. The right response was to redesign from first principles (Choice A). Anchoring on plan-aligned options is its own failure mode — when audit findings change the problem statement, the recommendation should change too.
- **Lesson 3 — `[Action]` chains in logs are stage specifications, not readability niceties.** A log line showing `[BRIEFING] [API] [EVENTS] [DEDUP]` was structural evidence that DEDUP was running at the wrong stage. The right response is to relocate the operation to its correct waterfall stage (write, not read) — not to memoize/cache/suppress the noise. Per claude_memory rows 268–269.
- **CLAUDE.md ref:** Rule 16 (Events Deduplication Architecture) added 2026-04-30.
- **Plan ref:** `docs/review-queue/PLAN_events-dedup-architectural-2026-04-30.md` (Course Correction Log + Decision Log + 8 test cases).

## 2026-04-09: Soft Warnings Hiding Broken Production Features

- **Symptom:** Production deployment logs showed `⚠️ ENVIRONMENT WARNINGS` for `VECTO_AGENT_SECRET` and `TOKEN_ENCRYPTION_KEY`, but `✅ Environment validation passed`. The server started successfully while agent auth and Uber OAuth were completely broken.
- **Root Cause:** `validate-env.js` classified missing feature-critical secrets as "warnings" instead of "errors." The validation passed, the server booted, and users hit runtime failures with no indication at startup that entire features were non-functional.
- **Fix:** Promoted `VECTO_AGENT_SECRET` and `TOKEN_ENCRYPTION_KEY` (when Uber is configured) to production errors. In dev, they remain warnings (flexibility for local testing). In production, they now block startup with a clear error message.
- **File:** `server/config/validate-env.js`
- **Lesson:** A warning that describes a broken feature is a lie. If the consequence of a missing env var is "all requests to this endpoint will fail" or "this entire integration is broken," that is an ERROR, not a warning. Soft validation that lets broken deployments through is worse than no validation — it creates false confidence. The validation tier (error vs warning) must match the user-facing impact, not the developer's convenience. In production, if it's broken, fail fast and say so.

## 2026-04-09: Bot Blocker Blocking Replit Preview Proxy Probes

- **Symptom:** Replit preview pane showed "We couldn't reach this app" despite server running healthy on port 5000 with correct port mapping (5000 → external 80).
- **Root Cause:** The bot blocker middleware treats empty User-Agent as bot traffic. Replit's preview proxy probes `/__repl*` endpoints to check app reachability, and these probes arrived with no/internal User-Agent. The 403 response made Replit conclude the app was unreachable.
- **Timing:** Bot blocker and Helmet had been in place for weeks with a working preview. The break appeared ~2026-04-08, suggesting Replit changed their probe behavior (new endpoints, different User-Agent). Platform-side change, not a code regression.
- **Fix:** Added `/__repl*` to the bot blocker's path allowlist, alongside existing allowlists for `/health` and `/api/hooks/`.
- **File:** `server/middleware/bot-blocker.js`
- **Lesson:** Security middleware (bot blockers, rate limiters, WAFs) must account for the hosting platform's internal traffic. When debugging "can't reach" errors on PaaS platforms, check whether your middleware is blocking the platform's own health/reachability probes — the server can be perfectly healthy internally while appearing dead to the platform's proxy layer. Test with `curl` against internal probe paths, not just your own endpoints.

## 2026-02-26: snapshot.weather vs briefing.weather — Wrong Data Source in Strategy Prompt

- **Symptom:** The STRATEGY_TACTICAL prompt's weather section was always empty or undefined, despite weather data existing in the briefing.
- **Root Cause:** The tactical prompt used `snapshot.weather` but snapshot objects do not contain weather data. Weather is fetched during the briefing pipeline and stored in the `briefings` table. The correct reference is `briefing.weather`.
- **Fix:** Changed `snapshot.weather` to `briefing.weather` in the tactical prompt builder.
- **File:** `server/lib/ai/providers/consolidator.js`
- **Lesson:** When building LLM prompts that combine data from multiple sources (snapshot, briefing, venue), verify that each field reference points to the correct source object. The snapshot has location/time context; the briefing has weather/traffic/events/news. Confusing them produces silently undefined values that degrade strategy quality without any error.

## 2026-02-25: Legacy Environment Cleanup — Triple Env Loading & Replit Agent Over-Engineering

- **Symptom:** Environment files loaded 3 times per boot (.replit shell → start-replit.js → gateway loadEnvironment()). GCP credentials reconstructed in both start.sh (inline Node.js) and load-env.js. A DEPLOY_MODE contract system referenced an `env/` directory that was never created.
- **Root Cause:** Replit Agents during early development didn't understand Replit's native `DATABASE_URL` auto-swap or that `.replit` already sources `mono-mode.env` via shell. They built: (1) a multi-mode deployment system (`mono/split/worker`) for a Cloud Run architecture that was never adopted, (2) duplicate env loading in every entry point, (3) duplicate GCP credential reconstruction in shell and JS, (4) a standalone validation file that only ran in dev mode.
- **Fix (5 phases):**
  1. Deleted 3 dead files: `db-doctor.js`, `agent-ai-config.js`, `start-mono.sh` (+ dead import in gateway)
  2. Fixed 2 bugs in `start-replit.js`: undefined `sdk` reference in signal handlers, simulation mode race condition (`process.exit(0)` killing child before event handlers fired)
  3. Merged `validate-strategy-env.js` into `validate-env.js` (now runs in all environments, not just dev)
  4. Simplified `load-env.js` (removed DEPLOY_MODE, validateEnvContract, env/ cascade: 237→148 lines), removed duplicate mono-mode.env load from boot script, removed duplicate GCP reconstruction from start.sh
  5. Updated all affected documentation
- **Net result:** ~300 lines of dead/duplicate code removed, 2 bugs fixed, zero functionality loss.
- **Lesson:** When inheriting AI-generated code, audit the full startup chain end-to-end before trusting it. AI agents frequently over-engineer systems they don't fully understand — especially platform-specific behavior like Replit's native environment handling. "It works" doesn't mean "it's not running the same code three times."

## 2026-02-17: Docs Agent Silently Corrupting Documentation (Including CLAUDE.md)

- **Symptom:** CLAUDE.md kept "truncating" across sessions. Doc files had AI commentary ("Based on the code changes...") prepended to them. `api-reference.md` lost real endpoint rows.
- **Root Cause:** The Docs Agent orchestrator ran on every server restart, but had NO safety rails:
  1. `file-doc-mapping.js` mapped `gateway-server.js` → `CLAUDE.md` — a project instruction file, not documentation
  2. `docs-policy.json` defined `allowed_paths` but the orchestrator **never enforced them** (loadPolicy() discarded the `agents` config)
  3. The validator only checked for empty content and unclosed code blocks — no size, structure, or preamble checks
  4. The AI generator returned commentary/analysis instead of updated docs, and nothing caught it
- **Fix (5 layers):**
  1. Removed CLAUDE.md from `gateway-server.js` mapping in `file-doc-mapping.js`
  2. Added `PROTECTED_FILES` set in orchestrator (CLAUDE.md, GEMINI.md, ARCHITECTURE.md, LESSONS_LEARNED.md, etc.)
  3. Enforced `allowed_paths` from `docs-policy.json` (fixed loadPolicy() to preserve `agents` config)
  4. Added validator checks: content size (rejects >50% shrinkage), AI preamble detection (9 patterns), structural integrity (table/header preservation)
  5. Cleaned AI preambles from 6 corrupted doc files, reverted 1 data-loss corruption
- **Files:** `orchestrator.js`, `validator.js`, `file-doc-mapping.js`, `docs-policy.json`
- **Lesson:** Autonomous AI systems that write to disk need defense-in-depth. A single validation check is never enough — LLMs are creative and will bypass narrow patterns. Combine content checks (preamble regex), structural checks (tables/headers preserved), and size checks (no catastrophic shrinkage). Also: never map AI instruction files (CLAUDE.md, GEMINI.md) as auto-update targets.

## 2026-02-17: SSE Reconnect Orphans All Subscribers + Same-Provider Fallback = Zero Redundancy

- **Symptom:** Production cascade: SSE "Client has encountered a connection error and is not queryable", Gemini 503 → HedgedRouter "All providers failed" → briefing/news timeouts at 75-90s.
- **Root Cause (3 bugs):**
  1. `db-client.js`: `notificationHandlerAttached` flag never reset during LISTEN client reconnect. New pgClient got no notification handler. All SSE subscribers became orphaned.
  2. `model-registry.js`: `FALLBACK_CONFIG` used `gemini-3-flash` for ALL roles. When primary was also Google (18 Gemini roles), same-provider guard filtered it out → zero redundancy.
  3. `model-registry.js`: 5 briefing roles missing from `FALLBACK_ENABLED_ROLES`.
- **Fix:**
  1. Reset `notificationHandlerAttached = false` in reconnect + added `resubscribeChannels()` to re-LISTEN and re-attach handler
  2. Added `getFallbackConfig(primaryProvider)` for cross-provider fallback (Google → OpenAI, others → Gemini Flash)
  3. Added all 5 missing briefing roles to fallback list
- **Files:** `server/db/db-client.js`, `server/lib/ai/model-registry.js`, `server/lib/ai/adapters/index.js`
- **Lesson:** Fallback systems must be tested for actual provider diversity. A "fallback" using the same provider family as the primary is not a fallback — it's a decoration. Also: singleton boolean flags (like `notificationHandlerAttached`) must be reset when the resource they track is destroyed.

## 2026-02-17: Duplicate briefing_ready Notifications

- **Symptom:** Client received 2 `briefing_ready` SSE events per pipeline run, refetching all 6 briefing queries twice.
- **Root Cause:** Two sources: a DB trigger (`trg_briefing_complete`, fires on traffic_conditions NULL → populated) AND a manual `pg_notify` in `briefing-service.js` (fires after all sections saved). Both fired within milliseconds on the same INSERT/UPDATE.
- **Fix:** Dropped the DB trigger via migration `20260217_drop_briefing_ready_trigger.sql`. The manual notify is the authoritative signal.
- **Lesson:** When adding notification mechanisms, check if one already exists. The trigger was created in Jan when "the SSE endpoint had no producer." The manual notify was added later, making the trigger redundant. One canonical source of truth for notifications.

## 2026-02-15: Docs Agent Orchestrator — 4 Bugs Masking Total Failure

- **Symptom:** Docs Agent never updated any documentation despite running on every server startup. 155 DOCS_GENERATOR calls failed silently.
- **Root Cause (4 bugs):**
  1. `mapFileToDoc()` only had 4 hardcoded entries — the comprehensive `FILE_TO_DOC_MAP` (30+ entries) in `file-doc-mapping.js` was never used
  2. `config/docs-policy.json` was imported but never loaded — policy rules were ignored
  3. File paths were relative strings but `fs.readFile()` needs absolute paths — every read silently returned null
  4. No deduplication — if 5 files mapped to the same doc, it was processed 5 times
- **Fix:** Rewrote orchestrator to use `findAffectedDocs()` from the change-analyzer's shared mapping, `loadPolicy()` with lazy init, `path.resolve(REPO_ROOT, filePath)` for absolute paths, and `Map` for deduplication.
- **File:** `server/lib/docs-agent/orchestrator.js`
- **Lesson:** When a subsystem "runs without errors" but produces no output, it's not working — it's silently failing. The orchestrator caught all errors and returned empty results, making it look operational. Always verify that autonomous systems produce actual output, not just absence of errors.

## 2026-02-13: Logout Race Condition — Cancel Queries Before Clearing Auth Token

- **Symptom:** Clicking logout redirected to sign-in page, but immediately showed the red FAIL HARD (CriticalError) screen before the user could log back in.
- **Root Cause:** React Query keeps background queries running independently of component lifecycle. When `logout()` cleared the auth token, React didn't instantly unmount the protected `CoPilotContext` and `GlobalHeader` components. During that render-cycle delay, in-flight queries (location polling, strategy fetching) fired with the now-invalid token, received 401 responses, and triggered `setCriticalError()` — the blocking error modal.
- **Fix:** Call `queryClient.cancelQueries()` and `queryClient.clear()` at the **top** of `logout()`, BEFORE clearing the token or calling the server. This aborts all in-flight HTTP requests immediately so no stale 401 callbacks can fire.
- **File:** `client/src/contexts/auth-context.tsx`
- **Lesson:** Any app with background polling behind authentication MUST cancel all active queries as the first step of logout. The order matters: cancel queries → call server → clear local state. If you clear the token first, every in-flight request becomes an error.

## 2026-02-13: SPA Route Changes Require Client Rebuild

- **Symptom:** After adding new routes to `routes.tsx` (Google OAuth callback), the app showed a flashing screen and "Cannot GET /co-pilot/strategy" errors.
- **Root Cause:** In a single-page app served by Express, the server has a catch-all route that serves `index.html` for any non-API path. React Router then handles client-side routing. When new routes were added to `routes.tsx` but the client wasn't rebuilt, the old JavaScript bundle's React Router didn't know about the new paths — causing redirect loops as the SPA and server disagreed about valid routes.
- **Fix:** Run `npx vite build` after any route changes. The new bundle hash confirms the rebuild took effect.
- **Lesson:** Route changes in a React SPA are code changes, not config changes. They live in the compiled JavaScript bundle, not in the server. Always rebuild after modifying `routes.tsx`.

## 2026-02-13: GitHub Push Protection — Never Commit .env Files

- **Symptom:** `git push` was rejected with `PUSH_REJECTED` error. The Replit Git panel showed a misleading "remote has commits that aren't in the local repository" message.
- **Root Cause:** GitHub's Push Protection (secret scanning) detected OpenAI and Anthropic API keys in `.env_override` which was accidentally staged by the Replit Git panel commit. The actual error was `GH013: Repository rule violations — Push cannot contain secrets`.
- **Fix:** Soft-reset the commit, unstaged `.env_override`, re-committed without it, and added `.env_override` to `.gitignore` to prevent recurrence.
- **Lesson:** (1) Replit's Git panel `PUSH_REJECTED` message doesn't distinguish between divergence and secret scanning blocks — always check the actual error from the shell. (2) Any file matching `.env*` should be in `.gitignore`. (3) API keys belong in Replit Secrets or environment variables, never in committed files.

## 2026-02-13: OAuth Callbacks Must Be Public Routes

- **Symptom:** Google OAuth redirect URI was initially set to `/co-pilot/strategy` — a `<ProtectedRoute>` page.
- **Root Cause:** When a user returns from Google's consent screen, they are NOT authenticated in the app yet (the whole point of the OAuth flow is to authenticate them). If the callback URL is a protected route, `ProtectedRoute` detects `isAuthenticated: false` and redirects to `/auth/sign-in`, discarding the OAuth authorization code from the URL.
- **Fix:** Created a dedicated public route `/auth/google/callback` with `<GoogleCallbackPage />` (no `ProtectedRoute` wrapper). This page extracts the code/state from the URL, exchanges it with the server for an app token, then redirects to the protected area.
- **Lesson:** OAuth callback routes must ALWAYS be public. The authentication happens DURING the callback, not before it. This applies to all OAuth providers (Google, Apple, Uber, etc.).

## 2026-02-13: Adapter Pattern Hardening — 8 Direct API Calls Eliminated

- **Symptom:** 8 files called `callGemini()`/`callOpenAI()`/`callAnthropic()` directly instead of `callModel(role)`, bypassing the hedged router and fallback system.
- **Root Cause:** These calls pre-dated the model-registry and hedged router. They were never migrated when the adapter pattern was formalized.
- **Impact:** Zero resilience — if GPT-5.2 went down, tactical planning, venue reasoning, and consolidation all failed with no fallback. With `callModel()`, the hedged router automatically retries with Gemini Flash.
- **Fix:** Registered 4 new roles (`BRIEFING_HOLIDAY`, `VENUE_EVENTS_SEARCH`, `VENUE_REASONING`, `VENUE_EVENTS_SEARCH`) and migrated all 8 files to use `callModel()`.
- **Files Changed:** `planner-gpt5.js`, `consolidator.js`, `weather-traffic-validator.js`, `venue-events.js`, `venue-intelligence.js`, `holiday-detector.js`, `closed-venue-reasoning.js`
- **Lesson:** When introducing a new architectural pattern (like the adapter layer), audit ALL existing callers — not just new code. "It works" doesn't mean "it's using the pattern."

## 2026-02-13: Dead Timezone Fallback — blocks-fast.js Never Returns Timezone

- **Symptom:** Client code had `data.timezone || locationContext?.timeZone || null` which looked like a 3-tier fallback.
- **Root Cause:** `blocks-fast.js` never includes `timezone` in its response. `data.timezone` was always `undefined`. The "fallback chain" was an illusion — only `locationContext?.timeZone` ever provided the value.
- **Fix:** Removed dead `data.timezone` reference. Single source of truth is `locationContext?.timeZone` (GPS-derived).
- **Lesson:** Before adding a fallback, verify the primary source actually exists. Dead fallbacks create false confidence and mislead future developers.

## 2026-02-13: userId Body Fallback — IDOR Vulnerability in Feedback Routes

- **Symptom:** `req.auth?.userId || userId` in two feedback routes allowed request body to override authenticated identity.
- **Root Cause:** Legacy code from before `requireAuth` was universally applied. The `|| userId` fallback was meant for anonymous users that no longer exist.
- **Fix:** Changed to `req.auth.userId` (auth middleware guarantees it exists). Removed unused `userId` from body destructuring.
- **Lesson:** When upgrading auth (adding `requireAuth`), also remove all the anonymous-user fallback code. Leftover fallbacks from the "optional auth" era become security holes.

## 2026-02-12: Shell-Level Env Overwrite — Root Cause of DOCS_GENERATOR Failures

- **Symptom:** All 155 DOCS_GENERATOR calls failed at server startup with "API key not valid" errors from Gemini API. The Gemini API key in Replit Secrets was valid.
- **Root Cause:** `.replit` uses `set -a && . mono-mode.env && set +a` (shell source with auto-export) BEFORE Node.js starts. `mono-mode.env` had `GEMINI_API_KEY=dummy_key_for_dev` which blindly overwrote the real Replit Secret.
- **Why CLI tests passed:** Claude Code's terminal inherits Replit Secrets directly without sourcing `mono-mode.env`, so `node -e "callModel('DOCS_GENERATOR')"` worked fine — a misleading positive test.
- **Fix:** Commented out ALL Google API key entries in `mono-mode.env` (GEMINI_API_KEY, GOOGLE_AI_API_KEY, GOOGLE_MAPS_API_KEY, GOOGLEAQ_API_KEY, VITE_GOOGLE_MAPS_API_KEY). These keys now come exclusively from Replit Secrets.
- **Lesson:** Node-level env guards (`if (process.env[key]) return;`) are useless when shell-level `set -a && source .env` runs first. The shell overwrites secrets BEFORE Node even starts. Always check the full startup chain: `.replit` → shell source → Node loader.

## 2026-02-12: Auth Middleware Gaps — 9 Unprotected Server Routes

- **Symptom:** Anonymous user access was supposed to be removed, but 9 data-serving API route files had NO auth middleware at all.
- **Root Cause:** Express has no global auth layer. Each router file must explicitly `import { requireAuth } from '../../middleware/auth.js'`. New route files that forgot to import it were silently public.
- **Affected Routes:** strategy.js, tactical-plan.js, venue-intelligence.js, intelligence/index.js, vector-search.js, research.js, location/location.js, ml-health.js, actions.js (optionalAuth→requireAuth)
- **Fix:** Added `router.use(requireAuth)` or per-route `requireAuth` middleware to all 9 files.
- **Pattern:** Every new route file MUST import requireAuth unless explicitly designed as public (health checks, platform reference data, Siri hooks). The `coach/index.js` pattern (`router.use(requireAuth)` at top) is the gold standard.
- **SSE Exception:** `strategy-events.js` SSE endpoints remain open because the browser `EventSource` API cannot send custom headers (Authorization). SSE only broadcasts notification events; actual data is fetched via authenticated API calls.

## 2026-02-11: API Key Conflicts & Model Access
- **Conflict:** The `@google/genai` library emits a warning and prioritizes `GOOGLE_API_KEY` if both `GEMINI_API_KEY` and `GOOGLE_API_KEY` are present in the environment. This can cause authentication failures if `GOOGLE_API_KEY` is intended for a different service (e.g., Google Maps) or is invalid for the Generative AI API.
- **Resolution:** Ensure `GEMINI_API_KEY` is used for the AI adapter and remove `GOOGLE_API_KEY` from the environment if it conflicts, or ensure the library initialization explicitly selects the correct key.
- **Gemini 3:** `gemini-3-pro-preview` requires valid authentication on the `v1beta` API. It is not deprecated; 404 errors usually indicate an invalid key or incorrect API version targeting (though the standard adapter handles `v1beta` correctly).
- **Environment:** Dummy values in `.env_override` (e.g., `dummy_value`) can silently override valid platform secrets if sourced by startup scripts (`start.sh`). Always verify the actual loaded environment values when debugging auth issues.
