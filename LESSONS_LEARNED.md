
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
