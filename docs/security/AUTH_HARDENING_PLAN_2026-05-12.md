# AUTH HARDENING PASS — Plan only (no edits applied)

**Branch:** proposed new branch `auth-hardening-pass` (cut from `main` after the stop-gap on `block-anonymous-scanner-writes` publishes).
**Date:** 2026-05-12.
**Scope:** Repo-wide audit of every unauthenticated mount in this app, with a hardening proposal aimed at the architect's stated goal — *"if real users besides me start using this app, no anonymous request can hit a handler that reads or writes user-scoped state."*
**Constraints (per the architect):** plan mode only, no edits; do not modify auth, RLS, sharing, or permissions until a specific diff is approved; do not touch `coach_memos` migration or `pull-coach-memos.mjs`; do not delete the poisoned `cross_thread_memory.id=2` row.
**Companion docs:** `SECURITY_INCIDENT_2026-05-12_memory_poisoning.md` (stop-gap landed, awaiting publish). This plan supersedes the prior stop-gap plan that lived at this path.

---

## CRITICAL FINDINGS — read first

The three-axis Phase-1 audit surfaced three CRITICAL findings and two HIGH-severity ones. These are at the top because they meet the architect's "cross-user data leak" bar or are blast-radius equivalent to it. Everything below is shaped around fixing them.

### CRITICAL 1 — Cross-user memory pooling can leak between authenticated users via the Coach prompt

**Where:** the chain runs `server/agent/routes.js:138-220` → `server/eidolon/memory/pg.js:21-26` → `server/lib/ai/context/enhanced-context-base.js:154-205` → `server/api/chat/chat.js:1301`, with the leaked content reaching the Coach LLM via the splice at `chat.js:1346-1358`.

**The mechanism (verified by direct file reads, not inference):**

1. `/agent/memory/preference`, `/agent/memory/session`, `/agent/memory/project`, `/agent/memory/conversation` all declare a default of `userId = "system"` in their handler signatures (`server/agent/routes.js:140`, `:157`, `:174`, `:191`). If any caller — including the frontend, an internal cron, or a tooling integration — omits `userId` in the request body, the handler proceeds with that default.
2. The string `"system"` is passed through to `memoryPut` in `server/eidolon/memory/pg.js:28-72`, which calls `normalizeUserId("system")` at lines 21-26. That helper checks the argument against a UUID regex (`/^[0-9a-fA-F\-]{36}$/`) and **returns `null` for any non-UUID string**, including `"system"`.
3. The resulting row is written with `user_id = NULL` (line 30: `const user_id_val = normalizeUserId(userId);`, then bound as the third parameter at line 53).
4. Separately, the AI Coach hot path (the super-user branch in `server/api/chat/chat.js:1298-1301`) calls `await getEnhancedProjectContext()` with **no `userId` parameter**.
5. That resolves to `getEnhancedProjectContextBase('agent', 'agent_memory', ...)` in `server/lib/ai/context/enhanced-context-base.js:17-239`. Inside that base function, every memory query is explicitly hardcoded to `userId: null` — see lines 157, 171, 185, 199. Each one queries with `(user_id IS NOT DISTINCT FROM NULL)` (the equality semantics implemented in `memoryQuery` at `pg.js:131-134`).
6. That SQL predicate matches **every row whose `user_id` is NULL**, regardless of which user wrote it. The retrieved rows become `context.agentPreferences`, `context.sessionHistory`, `context.projectState`, and `context.conversationHistory`.
7. Those fields are interpolated directly into the Coach's system prompt at `chat.js:1346-1358`:
   ```
   **Agent Memory:**
   ${JSON.stringify(agentContext.agentPreferences, null, 2)}

   **Project State:**
   ${JSON.stringify(agentContext.projectState, null, 2)}
   ```

**Net effect:** if user A's authenticated session writes to any of the `/agent/memory/*` endpoints without explicitly setting `userId` to their own UUID (e.g. the frontend forgets the field, or any future client posts the default), the row lands in the **NULL pool**. Later, when user B's super-user Coach chat invokes the enhanced-context branch, user B's Gemini prompt receives user A's preferences, session state, and conversation history as part of the system prompt.

**Why this hasn't been observed in production yet:** the super-user branch is currently gated by `isSuperUser`, and only Melody is a super-user today. The leak chain is therefore *structurally present but operationally latent*. The moment a second super-user is added, or the moment the gate is loosened, the leak fires. Treating it as not-yet-critical because of operational gating is the same mistake we just made with the `cross_thread_memory` writer: a structural bug that nobody is exercising is still a structural bug.

**A second writer compounds the same shape on `agent_memory`:** `ThreadManager.addMessage` at `server/agent/thread-context.js:126-137` writes rows to `agent_memory` via raw SQL that **omits the `user_id` column entirely** (the INSERT statement at lines 127-128 lists `session_id, entry_type, title, content, metadata, expires_at`, but not `user_id`). So every agent action is stored with `user_id = NULL`. The matching reader at `thread-context.js:386-404` selects `WHERE entry_type = 'agent_action'` with **no user filter at all** — hard cross-user leak inside `getThreadAwareContext`. That reader has zero in-prompt callers today (we verified), but the data is sitting there for whoever next wires it in.

### CRITICAL 2 — SSE endpoints at `/events/*` are unauthenticated

**Where:** `server/api/strategy/strategy-events.js` defines the SSE routes; `gateway-server.js:131-132` mounts them via `mountSSE(app)` (which routes through `server/bootstrap/routes.js:178-189`, ending in `app.use('/', strategyEvents)` at line 183).

**The exposure:**
- `router.get('/events/strategy', ...)` at `strategy-events.js:68` — no `requireAuth`, no `optionalAuth`. The handshake at lines 101-123 reads the `strategies` table by `snapshot_id` (from the query string) and emits a `state` event containing the snapshot's strategy readiness — to any anonymous subscriber.
- `router.get('/events/briefing', ...)` at line 144 — same shape.
- `router.get('/events/blocks', ...)` and `router.get('/events/phase', ...)` follow the same pattern.
- Mounted at root (`app.use('/', strategyEvents)` in `routes.js:183`), so these are **not under `/api/*`** — any auth fix scoped only to `/api/*` would miss them.

**Operational caveat:** `mountSSE` only runs when `!isAutoscaleMode` per `gateway-server.js:131`. In Cloud Run autoscale, SSE is disabled entirely. So this exposure is mono-mode-only (Replit workspace + non-autoscale deployments). The architect should still treat this as CRITICAL because (a) the workspace is the dev surface used by the architect, and (b) mode detection is brittle and depends on a single boolean.

**Why the snapshot data matters:** subscribing with `?snapshot_id=<X>` reveals real strategy state. An attacker enumerating snapshot UUIDs (or watching the public concierge `share_token → snapshot_id` mapping at `/api/concierge/p/:token/*`) can monitor any user's strategy generation in real time without authentication.

### CRITICAL 3 — `/api/memory/*` (the `claude_memory` CRUD API) is mounted publicly with no auth

**Where:** `server/bootstrap/routes.js:117` mounts `./server/api/memory/index.js` at `/api/memory`. The route file has no `requireAuth` — its own comment at lines 4-6 reads:

```
// NOTE: No auth middleware — this API is for Claude Code internal use,
// not exposed to end users. If exposed publicly, add requireAuth.
```

The comment's premise is wrong. **The router IS exposed publicly** by virtue of being mounted under `/api/*`, which has no app-level auth gate. Anyone on the internet can hit `GET /api/memory`, `POST /api/memory`, `PATCH /api/memory/:id`. The "is for Claude Code internal use" framing assumed the route would be reachable only via an internal bridge, but the mount declares no IP restriction, no service-secret header gate, nothing — it's wide open.

Per Rule 15 in CLAUDE.md the `claude_memory` table is the canonical cross-session memory layer. The architect has separately noted that the table is dropped from production today, which materially reduces the live impact — but the dev/Replit instance still has the table and the API. If a scanner finds `/api/memory` it can both read existing memories (intelligence about the project's internal state) and write new ones (which would later be ingested as durable context for Claude Code sessions reading the table at session start per Rule 12). This is a prompt-injection storage path with no gate.

### HIGH 4 — `trust proxy = 1` lets a client spoof `req.ip` in non-reverse-proxy deployments

**Where:** `gateway-server.js:84` — `app.set('trust proxy', 1)`.

`trust proxy = 1` tells Express to trust *the first proxy* in the X-Forwarded-For chain. In a deployment that sits behind a single trusted reverse proxy (Replit's edge, Cloud Run's frontend), this is correct: `req.ip` returns the real client IP. In a deployment that's directly on the internet, an attacker sends `X-Forwarded-For: 127.0.0.1` and `req.ip` reports `127.0.0.1`. `req.ip` is read by `server/agent/embed.js:11` inside `checkAgentAllowlist`, which gates `/agent/*` access by IP. So if there's any non-proxy deployment of this app, the agent IP allowlist is bypassable.

`req.ip` is also recorded into the persisted JSON in the (now-stop-gapped) `sdk-embed.js:52` writer — purely telemetry today, but the spoof-ability matters for any future code that trusts `req.ip` for security decisions.

### HIGH 5 — `agent_memory` writer omits user_id, reader has no user filter

Already covered in CRITICAL 1's "second writer compounds the same shape" paragraph. Flagged separately at HIGH because it is the cleanest "defense-in-depth missing" finding in the audit and is independently fixable.

---

## §1. Endpoint inventory

The format is `Method · Path · Handler file:line · Auth on this prefix · Touches user state · Classification`. Status is **verified** by direct file reads, not inferred from the agents' first-pass guess.

### `/api/*` routes mounted via `server/bootstrap/routes.js:46-127`

```
PREFIX: /api/diagnostics            (server/api/health/diagnostics.js)
  ROUTER-LEVEL AUTH: requireAuth applied per-route (each handler has it)
  CLASSIFICATION: ALREADY_AUTHED for all routes

PREFIX: /api/diagnostic             (server/api/health/diagnostic-identity.js)
  ROUTER-LEVEL AUTH: not separately inspected — verify before patching
  CLASSIFICATION: UNCLEAR (low traffic, low blast radius)

PREFIX: /api/health                  (server/api/health/health.js)
  - GET /api/health                            — liveness probe, no user state, PUBLIC_OK
  - GET /api/health/details                    — requireAuth (per-route), ALREADY_AUTHED
  - GET /api/health/pool-stats                 — requireAuth, ALREADY_AUTHED
  - GET /api/health/metrics                    — requireAuth, ALREADY_AUTHED

PREFIX: /api/ml-health                (server/api/health/ml-health.js:14 `router.use(requireAuth)`)
  CLASSIFICATION: ALREADY_AUTHED

PREFIX: /api/job-metrics              (server/api/health/job-metrics.js)
  ROUTER-LEVEL AUTH: NONE (router.get('/', ...) at :11 with no middleware)
  TOUCHES STATE: background job queue metrics — fine-grained operational data
  CLASSIFICATION: AUTH_REQUIRED ← work item

PREFIX: /api/logs                    (server/api/health/logs.js)
  - GET /api/logs                              — requireAuth (per-route :82), ALREADY_AUTHED
  - GET /api/logs/raw                          — requireAuth (per-route :89), ALREADY_AUTHED
  - GET /api/logs/stream                       — requireAuthFromQueryOrHeader (:97) — accepts token in query OR header
  - GET /api/logs/viewer                       — NO requireAuth at :164 — HTML viewer; AUTH_REQUIRED? ← verify-before-patch

PREFIX: /api/chat                    (server/api/chat/chat.js:46 + per-route :398/:504)
  ALL 14 routes ALREADY_AUTHED

PREFIX: /api/tts                     (server/api/chat/tts.js) — not directly inspected; verify
PREFIX: /api/realtime                (server/api/chat/realtime.js) — not directly inspected; verify

PREFIX: /api/coach                    (server/api/rideshare-coach/index.js:14 `router.use(requireAuth)`)
  CLASSIFICATION: ALREADY_AUTHED

PREFIX: /api/venues                   (server/api/venue/venue-intelligence.js:15 `router.use(requireAuth)`)
  CLASSIFICATION: ALREADY_AUTHED

PREFIX: /api/briefing                 (server/api/briefing/briefing.js:12)
  CLASSIFICATION: ALREADY_AUTHED

PREFIX: /api/traffic                  (server/api/traffic/index.js:27 `router.use(requireAuth)`)
  CLASSIFICATION: ALREADY_AUTHED

PREFIX: /api/auth                     (server/api/auth/auth.js)
  - login, register, forgot-password, reset-password, google, google/exchange, apple — PUBLIC_OK (by design)
  - me, profile, logout                       — ALREADY_AUTHED
  - token                                     — UNCLEAR; verify before patching
PREFIX: /api/auth/uber                — UNCLEAR; verify

PREFIX: /api/location                 (server/api/location/location.js:31 `router.use(requireAuth)`)
PREFIX: /api/snapshot                 — ALREADY_AUTHED + requireSnapshotOwnership on per-snapshot routes
  Both ALREADY_AUTHED post-2026-02-12.

PREFIX: /api/blocks-fast              (server/api/strategy/blocks-fast.js)
  - GET /api/blocks-fast — per-route requireAuth at :398
  - POST /api/blocks-fast — per-route requireAuth at :504
  CLASSIFICATION: ALREADY_AUTHED (correction: agent 2's "UNCLEAR" was wrong here)

PREFIX: /api/blocks                   (server/api/strategy/content-blocks.js:56)
  CLASSIFICATION: ALREADY_AUTHED

PREFIX: /api/strategy                 (server/api/strategy/strategy.js:23 `router.use(requireAuth)`)
  CLASSIFICATION: ALREADY_AUTHED (correction: agent 2 was wrong here too)

PREFIX: /api/strategy/tactical-plan   — UNCLEAR; verify before patching

PREFIX: /api/feedback                 (server/api/feedback/feedback.js:57 per-route requireAuth)
PREFIX: /api/actions                  (server/api/feedback/actions.js:33 per-route requireAuth)
  Both ALREADY_AUTHED.

PREFIX: /api/research                 (server/api/research/research.js:12 `router.use(requireAuth)`)
PREFIX: /api/vector-search            (server/api/research/vector-search.js:11 `router.use(requireAuth)`)
  Both ALREADY_AUTHED post-2026-02-12.

PREFIX: /api/platform                 (server/api/platform/index.js)
  CLASSIFICATION: PUBLIC_OK (city/market lookup, no user state)

PREFIX: /api/intelligence             (server/api/intelligence/index.js)
  - /api/intelligence/markets-dropdown    — PUBLIC_OK
  - all others                            — ALREADY_AUTHED (per-route requireAuth)

PREFIX: /api/vehicle                  (NHTSA passthrough)
  CLASSIFICATION: PUBLIC_OK

PREFIX: /api/concierge                (server/api/concierge/concierge.js)
  - /token                              — ALREADY_AUTHED (requireAuth)
  - /preview/:token, /p/:token/*       — validateShareToken (weak: token.length >12 is insufficient — DB-existence check
                                          may be partial; 2026-04-10 fix incomplete per agent 2's flag).
                                          CLASSIFICATION: WEAK_AUTH ← work item

PREFIX: /api/translate                (server/api/translate/index.js)
  Per-route requireAuth at :28 and :88 — ALREADY_AUTHED

PREFIX: /api/memory                   (server/api/memory/index.js)
  ROUTER-LEVEL AUTH: NONE — file comment at :4-6 says "no auth ... if exposed publicly, add requireAuth"
                            BUT IT IS EXPOSED PUBLICLY via routes.js:117.
  CLASSIFICATION: AUTH_REQUIRED ← CRITICAL 3 above

PREFIX: /api/hooks (analyze-offer)    (server/api/hooks/analyze-offer.js)
  ROUTER-LEVEL AUTH: NONE (post handlers at :194, :708, :780, :820 — no requireAuth)
  CLASSIFICATION: UNCLEAR — may be intended public webhook; verify request-signature/HMAC scheme
                  before deciding between AUTH_REQUIRED and PUBLIC_OK-with-signature

PREFIX: /api/hooks (translate)        (server/api/hooks/translate.js)
  ROUTER-LEVEL AUTH: NONE (POST at :34)
  CLASSIFICATION: UNCLEAR — Siri integration may use a webhook secret; verify
```

### `/agent/*` routes (mounted via `server/agent/embed.js:115`)

```
app.use(basePath, checkAgentAllowlist, requireAuth, agentRoutes)
  basePath = process.env.AGENT_PREFIX || '/agent'
  ALL /agent/* routes are gated by checkAgentAllowlist + requireAuth
  EXCEPT /agent/health at server/agent/embed.js:120 — intentional PUBLIC_OK for load balancer probes
  EXCEPT /agent/memory/* — bypasses the IP allowlist per server/agent/embed.js:20-21
    (so memory routes are auth-only, no IP gate — relevant to CRITICAL 1 fix)
  CLASSIFICATION: ALREADY_AUTHED across the board

  HIDDEN ISSUE: the /agent/memory/* handlers default userId='system'. See CRITICAL 1.
```

### SSE routes (mounted via `mountSSE` in `gateway-server.js:131-132` → `routes.js:178-189`)

```
PREFIX: / (root mount of strategy-events.js router)
  - GET /events/strategy    — NO AUTH
  - GET /events/briefing    — NO AUTH
  - GET /events/blocks      — NO AUTH
  - GET /events/phase       — NO AUTH
  CLASSIFICATION: AUTH_REQUIRED ← CRITICAL 2 above
  CAVEAT: only mounted when !isAutoscaleMode
```

### Other top-level mounts in `gateway-server.js`

```
app.use(express.static(distDir))             — static SPA assets (line 123) — PUBLIC_OK
app.use('/health', healthRouter)             — via configureHealthEndpoints (line 100) — liveness — PUBLIC_OK
/api/unified/capabilities                    — gateway-server.js:149 — PUBLIC_OK (LLM capability advertisement)
app.use('/api', sdkRouter)                   — routes.js:163 — catch-all for /api; INHERITS UNAUTH from the catch-all mount
  All subroutes inside sdk-embed.js have their own auth gates today, BUT the structural risk is that
  a new subroute added inside sdk-embed.js without explicit requireAuth will silently inherit unauth status.
```

### Inheritance-gap callout

The decentralised-auth pattern means **every new router that lands under `/api/*` is responsible for its own `router.use(requireAuth)`**, with no app-level safety net. Today's auth omissions (`/api/memory`, `/api/hooks/*`, `/api/job-metrics`, `/events/*`) are all instances of this same shape. The hardening plan (see §3 item 4) proposes flipping this to default-deny.

---

## §2. Auth architecture review

**Mechanism in use today (verified at `server/middleware/auth.js:149-264`):**

The app authenticates requests via HS256 JSON Web Tokens. Tokens carry the claims `sub` (user UUID), `iat`, `exp`, `iss='vecto-pilot'`, `aud='vecto-pilot-api'`, are signed with `process.env.JWT_SECRET`, and have a 2-hour TTL (`server/lib/jwt.js:12`). A legacy 2-segment HMAC token (`userId.sha256(userId, secret)`) is verifiable at `server/middleware/auth.js:111-141` during a transition window with `matrixLog` telemetry for the drain. Service-account auth via the `x-vecto-agent-secret` or `x-claude-bridge-token` headers grants access as the system user UUID `00000000-0000-0000-0000-000000000001` (`server/middleware/auth.js:35-86`) — used by the Agent embed and the Claude Code bridge.

The primary gate is `requireAuth` (`server/middleware/auth.js:149-264`). It (1) accepts service-account headers and short-circuits to next() if present, (2) extracts the bearer token from `Authorization`, (3) verifies it via `verifyAppToken`, (4) looks the user's session row up in `users` table, (5) checks the 2-hour hard limit and 60-minute sliding window, (6) sets `req.auth = { userId, sessionId, currentSnapshotId, phantom }`. Failure modes: `no_token` (401), `session_expired` (401, with the session cleared via UPDATE — fix on 2026-01-06 because DELETE was blocked by RESTRICT FKs), `auth_service_unavailable` (503 — fail-closed F-1 fix on 2026-03-17 if the session DB throws). The `next()` call at line 260 was once accidentally deleted by F-1 and re-added in a hotfix; that scar is a quiet reminder that the gate is a single-point-of-failure middleware.

`optionalAuth` (`server/middleware/auth.js:271-314`) is the soft variant — it validates a token if one is present but lets the request through otherwise.

**Where the middleware is mounted (the structural finding):**

`requireAuth` is **never mounted at the app level**. There is no `app.use(requireAuth)` anywhere in `gateway-server.js`. Instead, the gate is applied router-by-router: each route file under `server/api/**` is expected to call `router.use(requireAuth)` (or attach it per-route as a middleware argument). This is the decentralised-auth pattern.

This pattern has a single dominant failure mode: an *omission bug*. A new route file that forgets the `router.use(requireAuth)` line is silently unauthenticated. That is what produced `/api/memory` (the file comment shows the author *knew* auth was needed but moved on), the SSE router (a different author, same omission), `/api/job-metrics`, and the original `/api/strategy`, `/api/research`, `/api/vector-search`, `/api/venues`, `/api/translate`, `/api/ml-health`, `/api/traffic` problems that were patched on 2026-02-12 (post-incident retrofit). The 2026-02-12 wave shows the failure mode is recurrent in this codebase, not a one-off.

**Mount ordering in `gateway-server.js`:** `configureMiddleware` at line 97 mounts helmet, CORS, body parsers, rate limits *first*. Health endpoints at lines 100-101. The HTTP server is created at 104. Static SPA at 123. SSE (conditional) at 131. `mountRoutes(app, server)` at 139 — this is where every `/api/*` router gets mounted. Error handler at 143. `app.set('trust proxy', 1)` at line 84 — before all of the above.

**Catch-all middlewares running before auth (the dangerous shape):**

1. The stop-gapped `sdk-embed.js:42-68` writer — already neutralised by the recentPaths guard, but the structural shape (middleware on a catch-all `app.use('/api', router)` mount with no upstream auth) is still in place. Any future side-effecting middleware added there will be vulnerable to the same abuse.
2. The SSE router at `app.use('/', strategyEvents)` — CRITICAL 2 above. Mounted at root, no router-level auth gate.
3. The static SPA mount `app.use(express.static(distDir))` at `gateway-server.js:123` — runs before all `/api/*` routes. This is correct (static assets should be public) but it occupies the position in the chain where an app-wide auth middleware would *otherwise* sit.

**Token format / secret management:** HS256 (symmetric). No `kid` claim — secret rotation requires either reissuing all tokens or carrying a rolling-secret list. No RS256 / JWKS today. `verifyAppToken` is in `server/lib/jwt.js`.

**Trust proxy:** `gateway-server.js:84` sets `app.set('trust proxy', 1)`. See HIGH 4 above.

**Synthesis:** the auth architecture today is *adequate but fragile*. The primitives (JWT, session check, fail-closed on DB error, service-account header) are sensible; the application of those primitives is decentralised in a way that makes every new router a potential omission. The structural fix (§3 item 4) is to invert that pattern.

---

## §3. Proposed hardening, ordered by blast-radius reduction

Items are ordered by what closes the biggest leak first. Each item gives the one-line change, affected files, an illustrative diff sketch (not a final patch), the risk to legitimate users, and a rollout note.

---

### Item 1 — Close the NULL-user pool that leaks across users in the Coach prompt

**Change (one sentence):** Reject non-UUID `userId` values at the agent memory routes (and at `memoryPut` as defense-in-depth), and thread the authenticated `req.auth.userId` into `getEnhancedProjectContext` so the Coach hot path never queries `userId: null`.

**Affected files:**
- `server/agent/routes.js` (handlers at :138, :155, :172, :189, :206)
- `server/lib/ai/context/enhanced-context-base.js` (signature + base function lines 17-239)
- `server/api/chat/chat.js:1301` (the super-user invocation site)
- `server/eidolon/memory/pg.js:21-26` (`normalizeUserId` — tighten or replace with an explicit reject)

**Diff sketch (illustrative):**

```diff
--- a/server/agent/routes.js
+++ b/server/agent/routes.js
@@ -138,9 +138,12 @@ router.post("/memory/preference", async (req, res) => {
   try {
-    const { key, value, userId = "system" } = req.body;
+    const { key, value } = req.body;
+    const userId = req.auth?.userId;
+    if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) {
+      return res.status(400).json({ ok: false, error: 'user_id_required' });
+    }
     await memoryPut({
       table: "assistant_memory",
       scope: "user_preferences",
       key, userId, content: value, ttlDays: 365,
     });
```

```diff
--- a/server/lib/ai/context/enhanced-context-base.js
+++ b/server/lib/ai/context/enhanced-context-base.js
@@ -17,5 +17,7 @@ export async function getEnhancedProjectContextBase(identity, memoryTable, optio
-  const { threadId = null, includeThreadContext = true } = options;
+  const { threadId = null, includeThreadContext = true, userId = null } = options;
+  if (!userId) throw new Error('getEnhancedProjectContext requires userId — refusing NULL-pool query');
@@ -154,5 +154,5 @@ ...
-      userId: null,
+      userId,
       limit: 50
```

```diff
--- a/server/api/chat/chat.js
+++ b/server/api/chat/chat.js
@@ -1300,5 +1300,5 @@ if (isSuperUser) {
   try {
-    const agentContext = await getEnhancedProjectContext();
+    const agentContext = await getEnhancedProjectContext({ userId: req.auth.userId });
```

```diff
--- a/server/eidolon/memory/pg.js
+++ b/server/eidolon/memory/pg.js
@@ -21,7 +21,9 @@ function normalizeUserId(userId) {
   if (!userId) return null;
   if (/^[0-9a-fA-F-]{36}$/.test(userId)) return userId;
-  return null;
+  // 2026-05-12 SECURITY: refuse to silently downgrade non-UUID strings to NULL.
+  // The "system" → NULL silent coercion was the root of the multi-tenant leak.
+  throw new Error(`memoryPut/memoryGet/memoryQuery: invalid userId (not a UUID): ${userId.slice(0, 8)}…`);
 }
```

**Risk to legitimate users:** any current caller that passes a non-UUID `userId` will now 400 (at the route layer) or throw (in the memory layer). The known callers that do this are:
- `getThreadAwareContext` at `server/agent/thread-context.js:370/376/414` passes `userId: "system"` → would throw.
- `manager.getRecentThreads("system", ...)` at `thread-context.js:370` → would throw.
- Defaults in `server/agent/routes.js:140/157/174/191` → would 400 once the default is removed.

These are the exact code paths that produce the leak today. Their callers should pass a real `userId`, or the function should be split into a "system-scope" variant that writes to a separate `system_memory` table (or scope literal). Until then, **the throw is preferable to silent NULL coercion** — surface the bad call sites and fix them deliberately.

**Rollout note:** stage in dev for one session; run the Coach super-user chat end-to-end and confirm no `invalid userId` errors are thrown by the new `normalizeUserId` (means all callers were correctly updated). For prod, deploy behind a feature flag (`ENFORCE_USERID_UUID=1`) so the throw is gated for the first 24h while we observe matrixLog for accidental non-UUID callers.

---

### Item 2 — Authenticate the SSE endpoints

**Change:** Add `router.use(requireAuth)` at the top of `server/api/strategy/strategy-events.js`. Because SSE in browsers uses `EventSource`, which cannot attach an `Authorization` header, also provide a query-token fallback identical to the pattern in `server/api/health/logs.js:43-58` (`requireAuthFromQueryOrHeader`).

**Affected files:**
- `server/api/strategy/strategy-events.js` (entire file — 4 SSE routes)
- Possibly `server/middleware/auth.js` if we promote `requireAuthFromQueryOrHeader` from `logs.js` to a shared helper.
- Frontend client code that subscribes to `/events/*` — needs to pass `?token=<jwt>` in the query string.

**Diff sketch:**

```diff
--- a/server/api/strategy/strategy-events.js
+++ b/server/api/strategy/strategy-events.js
@@ -28,6 +28,8 @@
 import { eq, and, isNotNull, desc, or, sql as drizzleSql } from 'drizzle-orm';
+import { requireAuthFromQueryOrHeader } from '../../middleware/auth.js'; // promoted from logs.js

 const router = express.Router();

+router.use(requireAuthFromQueryOrHeader);
+
 // 2026-04-18 (F2): Helper to write the initial-state SSE event after subscribe.
```

**Risk to legitimate users:** any frontend code subscribing to `/events/*` without a token will start getting 401s. The architect should grep the client for `EventSource(` and confirm each subscription is updated to include `?token=${jwt}`. Existing precedent for query-token SSE/streaming exists in `logs.js`.

**Rollout note:** ship with `optionalAuth` variant for one deploy cycle so unauthenticated subscribers get a 200 with a "WARN: no token, subscription denied" event, plus matrixLog telemetry. Flip to hard 401 once the telemetry is empty for 24h.

---

### Item 3 — Authenticate `/api/memory/*`

**Change:** Add `router.use(requireAuth)` to `server/api/memory/index.js`. Tighten the file comment to reflect the actual deployment posture.

**Affected files:** `server/api/memory/index.js` only.

**Diff sketch:**

```diff
--- a/server/api/memory/index.js
+++ b/server/api/memory/index.js
@@ -7,9 +7,12 @@
 import { Router } from 'express';
 import { db } from '../../db/drizzle.js';
 import { claudeMemory } from '../../../shared/schema.js';
 import { eq, desc, and, ilike, sql } from 'drizzle-orm';
+import { requireAuth } from '../../middleware/auth.js';

 const router = Router();

+// 2026-05-12: SECURITY — this router is mounted under /api (publicly reachable);
+// see server/bootstrap/routes.js:117. requireAuth gates all routes here.
+router.use(requireAuth);
```

**Risk to legitimate users:** Claude Code's `pull-coach-memos.mjs`-style internal callers using the API need to attach the service-account header (`x-vecto-agent-secret` or `x-claude-bridge-token`) or a bearer token. Per the architect's earlier directive, `pull-coach-memos.mjs` is not in scope for edits — the memory API caller is separately ingested.

**Rollout note:** verify Claude Code's session-start ingest of `claude_memory` rows works via the service-account header path. Since the table is dropped from production today, the dev/Replit instance is the only one affected.

---

### Item 4 — Default-deny inversion at the SDK mount (structural fix)

**Change:** Move the authoritative auth gate up to the `/api` mount point. Replace `app.use('/api', sdkRouter)` at `server/bootstrap/routes.js:163` with `app.use('/api', requireAuthForApi, sdkRouter)`, where `requireAuthForApi` is a wrapper that skips a small positive-list of intentionally-public prefixes and applies `requireAuth` to everything else.

**Affected files:**
- `server/bootstrap/routes.js` (the mount line and the iteration loop that mounts the named-prefix routes)
- A new file, e.g. `server/middleware/auth-default-deny.js`, that owns the public allow-list
- Most individual route files lose their `router.use(requireAuth)` line over time (kept initially for defense-in-depth)

**Diff sketch:**

```diff
--- a/server/bootstrap/routes.js
+++ b/server/bootstrap/routes.js
@@ -160,6 +160,8 @@ ...
   try {
     console.log('[GATEWAY] Loading SDK embed (catch-all fallback)...');
     const sdkPath = path.join(rootDir, 'sdk-embed.js');
     const createSdkRouter = (await import(pathToFileURL(sdkPath).href)).default;
     const sdkRouter = createSdkRouter({});
-    app.use(process.env.API_PREFIX || '/api', sdkRouter);
+    const { requireAuthForApi } = await import(pathToFileURL(path.join(rootDir, 'server/middleware/auth-default-deny.js')).href);
+    app.use(process.env.API_PREFIX || '/api', requireAuthForApi, sdkRouter);
```

```js
// server/middleware/auth-default-deny.js (new file — illustrative)
import { requireAuth, optionalAuth } from './auth.js';

const PUBLIC_PREFIXES = [
  '/health',                  // /api/health liveness only — sub-routes still require auth
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/google',
  '/auth/google/exchange',
  '/auth/apple',
  '/platform',
  '/vehicle',
  '/intelligence/markets-dropdown',
  '/unified/capabilities',
  '/assistant/verify-override',
  '/ranking',
];

export function requireAuthForApi(req, res, next) {
  const sub = req.url.split('?')[0];
  if (PUBLIC_PREFIXES.some(p => sub === p || sub.startsWith(p + '/'))) {
    return next();
  }
  return requireAuth(req, res, next);
}
```

**Risk to legitimate users:** large. Any route that *was* reachable without auth and *isn't* on the allow-list will start 401'ing. The whole point is that today's accidentally-unauth routes (memory, hooks, job-metrics) start refusing — but it requires getting the allow-list right. The allow-list above is derived from the verified PUBLIC_OK rows in §1 and should be reviewed by the architect.

**Rollout note:** ship with `optionalAuth` for one full deploy cycle (the wrapper attaches `req.auth` if a token is present but lets unauth through) plus matrixLog telemetry on every "would have rejected" hit. After 48h with the telemetry empty for every prefix outside the allow-list, flip the wrapper to `requireAuth`. Keep router-level `requireAuth` in each route file as defense-in-depth — do **not** remove those in the same PR; they can be cleaned up in a follow-up after the structural gate has been in place for a release cycle.

This item is the architectural fix the architect specifically asked for. Items 1, 2, 3 are tactical patches; item 4 is the structural change that makes future omissions impossible. Items 1-3 are all subsumable by item 4 long-term, but each item solves a specific bug today and is safer to deploy independently.

---

### Item 5 — Fix `trust proxy` for the actual deployment topology

**Change:** Set `app.set('trust proxy', value)` to a value that matches the real proxy chain (e.g. an IP list for Replit's edge, or `'loopback'` if direct).

**Affected files:** `gateway-server.js:84`.

**Diff sketch (illustrative — final value depends on deployment topology):**

```diff
--- a/gateway-server.js
+++ b/gateway-server.js
@@ -83,2 +83,4 @@
 app.disable('x-powered-by');
-app.set('trust proxy', 1);
+// 2026-05-12: trust only known upstreams. '1' was too permissive — allowed
+// XFF spoofing in any non-proxy deployment. Lock to the known upstream proxy.
+app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
```

**Risk:** if the value is too restrictive, `req.ip` reports `127.0.0.1` for legitimate traffic, breaking the agent IP allowlist for real callers. If too permissive, the XFF spoof remains.

**Rollout note:** validate by hitting `/api/health` from outside the deployment and inspecting matrixLog for the recorded `req.ip` — should match the public origin IP, not localhost. Test in dev (Helium / Replit workspace) first, then prod (Neon / Cloud Run autoscale).

---

### Item 6 — Add user_id to `agent_memory` writer; add user_id filter to `agent_memory` reader

**Change:** Pass and bind `user_id` in the agent action INSERT and the subsequent SELECT.

**Affected files:** `server/agent/thread-context.js` (lines 126-137 writer, 386-404 reader).

**Diff sketch:**

```diff
--- a/server/agent/thread-context.js
+++ b/server/agent/thread-context.js
@@ -126,13 +126,14 @@
   await pool.query(
     `INSERT INTO agent_memory (session_id, entry_type, title, content, metadata, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)`,
     [
       this.currentThreadId || 'default',
       'agent_action',
       `Agent action ${message.id}`,
       content,
       JSON.stringify({ ...metadata, threadId: this.currentThreadId, timestamp: message.timestamp }),
       new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
     ]
   );
+  // 2026-05-12: column missing on purpose? add user_id binding here; see §3 item 6
```

(The full diff also needs to pass `user_id` into the query — needs schema confirmation on the column's nullability first.)

**Risk:** existing rows are NULL-user; readers gated on user_id will not see them. Acceptable — those rows are the pooled-cross-user data we want excluded.

**Rollout note:** the column already exists per `shared/schema.js`. Backfilling existing NULL rows to a synthetic per-thread user_id is out of scope; the cleaner path is to delete the unscoped historical rows once the writer is fixed (operator action, similar to the §6(g) cleanup in the incident doc).

---

### Item 7 — Authenticate the remaining unauthenticated /api routes

`/api/job-metrics`, `/api/logs/viewer`, and the two `/api/hooks/*` mounts.

For job-metrics and `/api/logs/viewer`: add `router.use(requireAuth)` per the pattern used in their sibling routers. Risk: the mobile log viewer URL the architect uses from a phone may break — verify the viewer can attach the query-token like `/api/logs/stream` does.

For `/api/hooks/*`: these may be intentional external webhooks (analyze-offer is OCR/signal processing; translate is Siri). If so, they need a *different* auth shape — request signature / HMAC / shared-secret header — not bearer-token auth. **Recommendation: do not patch in this pass.** Surface them to the architect, ask for the intended auth model (webhook signature? mTLS? secret header?), then patch in a separate task.

---

### Item 8 — Carry-forward items from `SECURITY_INCIDENT_2026-05-12_memory_poisoning.md` §6

These were deferred in the incident doc and remain in scope for the hardening pass:

- **§6(b) explicit allow-list for /api/* subroute prefixes** — implemented by item 4 above (the `PUBLIC_PREFIXES` array). Resolved.
- **§6(c) edge null-byte rejection middleware** — small additional middleware mounted in `gateway-server.js` after `configureMiddleware` that rejects any request with a `%00` (URL-decoded null byte) in path, query, or any header value. Independently valuable; ~10 lines. Risk: none for legitimate traffic; null bytes are never valid in HTTP semantics.
- **§6(d) IOC scan of briefings/actions/assistant_memory for poisoned rows** — operator action, not code. Documented as a follow-up.
- **§6(f) reader-side untrusted-data wrapping** — if any future feature wires `getCrossThreadMemory` or `SELECT FROM cross_thread_memory` into a prompt, the loaded rows must be wrapped as `<untrusted>` context. Not needed today since item 1 closes the leak chain; flagged for future readers.
- **§6(h) auth-before-write invariant test** — covered in §5 below.

Items §6(a) (auth-before-write in sdk-embed.js / routes.js) and §6(e) (schema drift) are addressed in this plan: §6(a) is the §3 item 4 structural fix; §6(e) is a separate concern that should land independently of the auth pass.

---

## §4. Multi-tenant data-isolation findings (the architect's "can another user see my stuff?" question)

The audit answers the architect's question with: **yes, in narrow but real conditions, one authenticated user's data can today surface in another authenticated user's LLM prompt.** The mechanism is CRITICAL 1 above. Beyond that one path, isolation looks reasonable.

**Tables that have hard isolation today (user_id is correctly filtered on every reader):**
- `coach_conversations` — reader at `server/api/rideshare-coach/rideshare-coach-dal.js:1577-1587` filters `eq(coach_conversations.user_id, userId)`.
- `snapshots`, `strategies`, `actions`, `rankings`, `briefings` — accessed via per-snapshot routes that go through `requireSnapshotOwnership` (`server/api/location/snapshot.js`, etc.). The ownership middleware enforces that `req.auth.userId === snapshot.user_id` before the handler runs. Two users will not see each other's snapshots/strategies/actions even if they guess the UUID.

**Tables that have soft isolation (NULL pool risk):**
- `assistant_memory` — `memoryPut/Get/Query` uses `(user_id IS NOT DISTINCT FROM $X)` which correctly distinguishes real-user from NULL rows, BUT all callers passing non-UUID userIds get coerced to NULL by `normalizeUserId`. The route handlers default `userId="system"` so any client that omits the field writes to the NULL pool.
- `eidolon_memory` — same coercion. Same risk.
- `cross_thread_memory` — same coercion. (Plus the now-stop-gapped sdk-embed.js writer was producing NULL rows for scanner traffic.)

**Tables that have no isolation:**
- `agent_memory` — writer at `thread-context.js:126-137` omits `user_id` from the INSERT entirely (column would default to NULL). Reader at `thread-context.js:386-404` has no `WHERE user_id = ...` clause. **All agent actions are visible to all readers of agent_memory.** Mitigated today only by the fact that the reader (`getThreadAwareContext`) has no in-prompt callers — see Phase 1 audit. Still HIGH because the data is being staged for a leak the moment someone wires the reader in.

**RLS state reconciliation:**
- `migrations/003_rls_security.sql:43` enables RLS on `cross_thread_memory`, `eidolon_memory`, `assistant_memory`, `agent_memory`.
- `server/eidolon/memory/pg.js:45` explicitly states "RLS is disabled - data isolation handled via SQL filtering on user_id column".
- The actual code uses raw `client.query()` without ever calling `SET LOCAL app.user_id` or routing through any RLS-aware helper. So RLS is enabled at the table level but the app never sets the session variable RLS would need — meaning RLS gates only direct-SQL-bypass attacks, not in-app queries. The active isolation is the SQL WHERE clause, not RLS. This is consistent and not a bug in itself — just worth knowing that the table-level RLS is **not** what's protecting users from each other today.

**The leak scenario in plain words:**
1. User A's session, during normal use, posts to `/agent/memory/session` with `{ key: 'last_thread', data: {...} }` and forgets to set `userId`.
2. The handler at `server/agent/routes.js:157` defaults `userId = "system"`. `normalizeUserId("system")` returns NULL. Row stored with `user_id = NULL` in `eidolon_memory`.
3. Some time later, the architect (or any other super-user, once added) starts a Coach chat. `chat.js:1301` calls `getEnhancedProjectContext()` with no userId arg.
4. `getEnhancedProjectContextBase` queries `eidolon_memory` with scope=`session_state`, `userId: null` — returns user A's row (and any other NULL-pool row that matches scope).
5. Row content lands in the Coach system prompt at `chat.js:1346-1358` as part of `agentContext.sessionHistory`.
6. The Coach LLM, billed to the super-user's account, reads user A's session metadata.

That sixth step is the leak. Item 1 closes it at three layers (route validation, memoryPut throw, getEnhancedProjectContext signature change).

---

## §5. Test plan

The architect asked for concrete test file paths and names, not implementations. Here are the tests that should exist and currently do not. These will enforce the auth-before-write invariant and the multi-tenant-isolation invariant going forward.

- `tests/auth/api-mount-coverage.test.js`
  - test: `every mounted /api/* route either runs requireAuth or is on the public allow-list`
  - test: `every router file in server/api/** that does not appear in the public allow-list has a router.use(requireAuth) call`
- `tests/auth/sse-auth.test.js`
  - test: `GET /events/strategy without a bearer token returns 401`
  - test: `GET /events/strategy with ?token=<valid-jwt> returns 200 and a heartbeat`
  - test: `GET /events/strategy with a malformed token returns 401`
- `tests/auth/memory-api-auth.test.js`
  - test: `GET /api/memory without a bearer token returns 401`
  - test: `POST /api/memory without a bearer token returns 401`
  - test: `POST /api/memory with a valid token persists a row`
- `tests/auth/job-metrics-auth.test.js`
  - test: `GET /api/job-metrics without a bearer token returns 401`
- `tests/multi-tenant/user-id-normalization.test.js`
  - test: `normalizeUserId("system") throws (no silent NULL coercion)`
  - test: `normalizeUserId(undefined) throws`
  - test: `normalizeUserId(validUUID) returns the UUID`
- `tests/multi-tenant/cross-user-leak-prevention.test.js`
  - test: `getEnhancedProjectContext refuses to run without an explicit userId`
  - test: `user A's NULL-pool writes via /agent/memory/* are rejected at the route layer (400)`
  - test: `user B's Coach context returned by getEnhancedProjectContext({ userId: B }) contains zero rows authored by user A`
- `tests/multi-tenant/agent-memory-user-scoping.test.js`
  - test: `ThreadManager.addMessage inserts user_id into agent_memory`
  - test: `getThreadAwareContext({ userId: A }) returns zero rows authored by user B`
- `tests/auth/trust-proxy.test.js`
  - test: `req.ip is not influenced by a forged X-Forwarded-For when the connection origin is not the trusted upstream`
- `tests/auth/default-deny-invariant.test.js` (after item 4 lands)
  - test: `a newly added router file under server/api/** that omits requireAuth still returns 401 because the /api mount enforces auth by default`
  - test: `the public allow-list in server/middleware/auth-default-deny.js matches the documented PUBLIC_OK rows in §1 of the auth-hardening plan`

The last test is the most durable of the lot — it catches future omission bugs the moment a developer lands a new router without thinking about auth. It's the test that would have prevented `/api/memory` from being mounted unauth.

---

## Out of scope (per architect constraints)

- No edits applied in this plan (plan mode).
- No modifications to auth, RLS, sharing, or permissions until a specific diff is approved. The diff sketches in §3 are illustrative; each one is its own approval gate.
- No touching `coach_memos` migration or `pull-coach-memos.mjs`.
- No deletion of the poisoned `cross_thread_memory.id=2` row (deferred to incident-doc §6(g)).
- No changes to `shared/schema.js` or the migration files (the schema drift on `cross_thread_memory.user_id` — incident doc §6(e) — is its own separate task).
- No code commits, no pushes, no PRs.

---

## Critical files referenced

- `gateway-server.js:84` — `trust proxy = 1` (HIGH 4)
- `gateway-server.js:131-132` — `mountSSE(app)` conditional mount
- `server/bootstrap/routes.js:46-127` — the `routes` array (the explicit named-prefix mounts)
- `server/bootstrap/routes.js:117` — `/api/memory` mount (CRITICAL 3)
- `server/bootstrap/routes.js:120-121` — `/api/hooks/*` mounts (Item 7)
- `server/bootstrap/routes.js:157-169` — SDK catch-all mount at `/api`
- `server/bootstrap/routes.js:178-189` — `mountSSE` body
- `sdk-embed.js:42-68` — unauthenticated catch-all middleware (already stop-gapped)
- `server/middleware/auth.js:149-264` — `requireAuth` (the canonical gate)
- `server/middleware/auth.js:271-314` — `optionalAuth`
- `server/middleware/auth.js:111-141` — legacy HMAC verifier (transition-window only)
- `server/middleware/auth.js:35-86` — service-account header validator
- `server/lib/ai/context/enhanced-context-base.js:154-205` — hardcoded `userId: null` queries (CRITICAL 1)
- `server/lib/ai/context/enhanced-context-base.js:430-440` — `storeCrossThreadMemory` (stop-gapped)
- `server/eidolon/memory/pg.js:21-26` — `normalizeUserId` silent NULL coercion (CRITICAL 1)
- `server/eidolon/memory/pg.js:28-72` — `memoryPut`
- `server/eidolon/memory/pg.js:74-149` — `memoryGet` / `memoryQuery`
- `server/agent/routes.js:138-220` — `/agent/memory/*` handlers with `userId = "system"` defaults (CRITICAL 1)
- `server/agent/thread-context.js:96-117` — `cross_thread_memory` writer (scope `all_threads`)
- `server/agent/thread-context.js:126-137` — `agent_memory` writer with missing user_id (HIGH 5)
- `server/agent/thread-context.js:359-378+` — `getThreadAwareContext` reader (no current callers)
- `server/agent/thread-context.js:386-404` — `agent_memory` reader without user filter (HIGH 5)
- `server/agent/embed.js:115` — agent mount with `checkAgentAllowlist, requireAuth`
- `server/api/strategy/strategy-events.js:68-160+` — SSE handlers without auth (CRITICAL 2)
- `server/api/memory/index.js` — `claude_memory` CRUD without auth (CRITICAL 3)
- `server/api/health/job-metrics.js` — job metrics without auth (Item 7)
- `server/api/health/logs.js:43-58, 164` — `requireAuthFromQueryOrHeader` precedent + unauth viewer (Item 7)
- `server/api/hooks/analyze-offer.js` — webhook routes without bearer auth (Item 7)
- `server/api/hooks/translate.js` — Siri webhook without bearer auth (Item 7)
- `server/api/chat/chat.js:1298-1364` — super-user Coach branch + the prompt splice that surfaces CRITICAL 1
- `migrations/003_rls_security.sql:43-161` — RLS enabled on memory tables (inert today; §4 reconciliation)
