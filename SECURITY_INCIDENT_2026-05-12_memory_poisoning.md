# Security Incident — Memory Poisoning via Unauthenticated /api/* Writer

**Filed:** 2026-05-12
**Incident type:** Storage poisoning of an LLM-adjacent table via an unauthenticated
catch-all Express middleware.
**Severity (today):** Medium — attacker-controlled content reached the DB but, as of the
trace recorded in §2, did **not** reach any live LLM prompt.
**Severity (architectural):** High — the writer is anonymous and runs before any auth gate
on the catch-all `/api/*` mount, so any inbound scanner request continuously refreshes the
payload until the writer is shut.
**Stop-gap branch:** `block-anonymous-scanner-writes`
**Stop-gap status:** Applied to `server/lib/ai/context/enhanced-context-base.js`. Lint
clean. No publish yet at the time this document was written.

---

## 1. Incident summary

Two GCP-sourced scanner IPs (`34.46.158.82`, `35.185.191.37`) were observed probing
`/api/*` paths and, as a direct consequence of the request, were causing rows to be written
into the `cross_thread_memory` table. The first row produced by the abuse pattern (id=1)
was manually deleted by the operator; within roughly thirty minutes a fresh row (id=2)
appeared with the same shape, demonstrating that the underlying writer was still active and
that deletion alone was not stopping the abuse.

The mechanism is structural rather than exploitative. An Express middleware at
`sdk-embed.js:42-68` is installed on the SDK router that the gateway mounts at the
catch-all `/api/*` prefix in `server/bootstrap/routes.js:157-169`. The middleware runs on
**every** request entering `/api/*`, before subroute matching and before any auth gate on
the eventual handler. Inside that middleware, at `sdk-embed.js:52-57`, the code
unconditionally calls:

```js
await storeCrossThreadMemory('recentPaths', {
  path: req.originalUrl,
  method: req.method,
  t: Date.now(),
  ip: req.ip
}, null, 7);
```

`storeCrossThreadMemory` (`server/lib/ai/context/enhanced-context-base.js:430-440`) forwards
straight to `memoryPut` in `server/eidolon/memory/pg.js:28-72`, which performs an upsert
keyed on `(scope, key, user_id) = ('cross_thread_context', 'recentPaths', NULL)`. Because
the key and user_id are constant, every anonymous request UPDATEs the same row in place
with a fresh `content` JSON and `updated_at`. The observed payload that landed in id=2 was
`{ path: '/api/staging/.env', method: 'GET', t: <epoch_ms>, ip: '35.185.191.37' }` — a
clean fingerprint of a credential-scanner probe.

There is no rate limit, no auth gate, and no allow-list on this path. Any path under
`/api/*` produces a row, including paths that have no registered handler — those still pass
through the catch-all router's middleware and only become 404s downstream of the write.

## 2. Blast radius assessment

**The attacker-controlled content has not, to date, been fed to any LLM.** The investigation
established this by tracing every reader of `cross_thread_memory` and every reader of
`scope='cross_thread_context'`:

The dedicated reader `getCrossThreadMemory` at
`server/lib/ai/context/enhanced-context-base.js:443-452` (which reads exactly
`scope='cross_thread_context'`, the same scope the writer uses) is exported from that file
and re-exported through `server/agent/enhanced-context.js:37` and
`server/eidolon/enhanced-context.js:93`, and is imported by `server/agent/routes.js:10`. A
repository-wide grep for the invocation pattern `getCrossThreadMemory(` returns **zero**
hits. The function is wired into the import graph but never called. Nothing in the codebase
today consumes scope `cross_thread_context` and forwards it to an LLM.

The closest prompt-assembly path that *might* have read the poisoned rows is the AI Coach
super-user branch at `server/api/chat/chat.js:1301`:

```js
const agentContext = await getEnhancedProjectContext();
```

This return value is spliced into the Coach's system prompt at `chat.js:1346-1358`:

```
**ENHANCED CONTEXT:**
- Current Time: ${agentContext.currentTime}
- Environment: ${agentContext.environment}
- Workspace: ${agentContext.workspace}
- Snapshots (24h): ${agentContext.recentSnapshots?.length || 0}
- Strategies (24h): ${agentContext.recentStrategies?.length || 0}
- Actions (24h): ${agentContext.recentActions?.length || 0}

**Agent Memory:**
${JSON.stringify(agentContext.agentPreferences, null, 2)}

**Project State:**
${JSON.stringify(agentContext.projectState, null, 2)}
```

`getEnhancedProjectContext` resolves to `getEnhancedProjectContextBase('agent', 'agent_memory', ...)`
at `server/lib/ai/context/enhanced-context-base.js:17-239`. That function reads from the
`snapshots`, `strategies`, and `actions` tables via Drizzle, and queries the **`agent_memory`**
table (not `cross_thread_memory`) for scopes `agent_preferences`, `session_state`,
`project_state`, and `conversations`. It populates a `threadContext` field that initialises
to `null` and is not overwritten by the base function. It does not call
`getCrossThreadMemory` and does not run any direct SQL against `cross_thread_memory`.
Therefore the Coach super-user prompt did not, and does not, surface the poisoned content.

A second writer to `cross_thread_memory` exists at `server/agent/thread-context.js:106-117`,
but it is reached only from `ThreadManager.addMessage`, which is invoked from the
authenticated agent routes (`POST /agent/thread/:threadId/message` and similar) — scanner
traffic does not reach it, it writes under a different scope (`all_threads`) with real
authenticated `userId`s, and it is **out of scope** for this stop-gap. The accompanying
reader at `server/agent/thread-context.js:359-378+` (`getThreadAwareContext`) reads scope
`all_threads`, not `cross_thread_context`, so it would not have surfaced the poisoned rows
even if it had a caller — and a grep for `getThreadAwareContext(` invocations returns zero
hits as well.

Net read: the table was used as a write-only sink for the abuse pattern. The data sat
there, persistently upserted, but never crossed the path into a model prompt. The
remaining poisoned row (id=2) is therefore inert *today* — but the table is structurally
consumable, and any future code (a new audit query, a debug session piping `SELECT content
FROM cross_thread_memory` into a prompt, a feature that finally wires up
`getCrossThreadMemory`) would surface it. The stop-gap shuts the writer regardless of
current read consumption; cleanup of the row itself is deferred to §6(g).

## 3. Trace

The full call chain from inbound socket to DB write:

1. Inbound request hits `gateway-server.js` and is routed by Express through the middleware
   chain wired up in `server/bootstrap/routes.js`.
2. `server/bootstrap/routes.js:157-169` mounts the SDK router **last**, as a catch-all
   under `process.env.API_PREFIX || '/api'`:
   ```js
   app.use(process.env.API_PREFIX || '/api', sdkRouter);
   ```
   The catch-all mount means every request under `/api/*`, regardless of whether the
   subroute is registered, passes through the router's middleware before falling out to a
   404.
3. `sdk-embed.js:34` constructs the router. At `sdk-embed.js:42` the first registered
   middleware (`r.use(async (req, res, next) => { ... })`) runs unconditionally on every
   request — *before* any subroute is matched and *before* any subroute-level auth.
4. Inside that middleware, `sdk-embed.js:44` calls `getEnhancedProjectContext(...)`.
5. `sdk-embed.js:52-57` calls:
   ```js
   await storeCrossThreadMemory('recentPaths', { path, method, t, ip }, null, 7);
   ```
6. `storeCrossThreadMemory` at `server/lib/ai/context/enhanced-context-base.js:430-440`
   forwards to `memoryPut`.
7. `memoryPut` at `server/eidolon/memory/pg.js:28-72` performs an UPDATE-then-INSERT upsert.
   For the abuse pattern the row matches `(scope='cross_thread_context', key='recentPaths',
   user_id=NULL)` on the second and subsequent calls, so it is UPDATEd in place — `created_at`
   freezes at first contact and `updated_at` advances on every scanner request.
8. The middleware calls `next()` at `sdk-embed.js:62`; subroute matching then runs and
   typically produces a 404 for scanner paths that have no registered handler. Failures of
   the write are swallowed silently by the `try { ... } catch` at `sdk-embed.js:63-66`, so
   the scanner sees no observable signal.

**On the `t` field:** the original working hypothesis included a possible timezone-race or
client-controlled timestamp angle. That hypothesis is **disproven**. The `t` field at
`sdk-embed.js:55` is literally `Date.now()` — a server-side wall-clock call, executed in
Node, with no input dependency on request headers, query parameters, or body. It is clean.
The attacker-controlled fields in the persisted JSON are exclusively `path` (`req.originalUrl`),
`method` (`req.method`), and `ip` (`req.ip`, derived from the connection socket and any
trusted-proxy `X-Forwarded-For` headers Express has been configured to honour).

## 4. Stop-gap diff applied

A seven-line guard was added inside `storeCrossThreadMemory` at
`server/lib/ai/context/enhanced-context-base.js`, lines 431–437. The function previously
contained only the `memoryPut` forward; the guard is inserted at the very top of the body,
above the dynamic `import` of the memory module, so that abuse-pattern calls return before
any module-loading or pool-connection cost is paid.

```diff
--- a/server/lib/ai/context/enhanced-context-base.js
+++ b/server/lib/ai/context/enhanced-context-base.js
@@ -428,6 +428,13 @@ export async function getIdentityMemory(identity, memoryTable, userId = null, li
 
 // Store cross-thread memory
 export async function storeCrossThreadMemory(key, content, userId = null, ttlDays = 730) {
+  // 2026-05-12 SECURITY STOP-GAP: refuse 'recentPaths' writes — sdk-embed.js:52
+  // is an unauthenticated /api/* catch-all middleware that persists req.originalUrl
+  // and req.ip into cross_thread_memory. Scanner traffic (34.46.158.82, 35.185.191.37)
+  // is producing rows like path=/api/staging/.env. Block until full hardening lands.
+  if (key === 'recentPaths') {
+    return null;
+  }
   const { memoryPut } = await import("../../../eidolon/memory/pg.js");
   return await memoryPut({
     table: "cross_thread_memory",
```

`git diff --stat` confirms `1 file changed, 7 insertions(+)`, zero deletions, single hunk,
no `-` lines in the patch — proving the change is purely additive and no existing line was
perturbed.

The branch staging this change is **`block-anonymous-scanner-writes`**. ESLint on the
modified file (`npx eslint server/lib/ai/context/enhanced-context-base.js`) and the
repo-wide lint (`npm run lint`, which runs with `--max-warnings 0` and lints
`client/src 'server/**/*.{js,mjs}' gateway-server.js agent-server.js`) both exited 0.
The unit suite (`npm run test:unit`) showed sixteen pre-existing failures, all of which
were inspected and confirmed to be unrelated to the guard: two `tests/blocksApi.test.js`
assertions failed with 503 from a not-running gateway, two empty-test-suite scaffolding
errors (`near-event-ranking.test.js`, `schema-validation.test.js`), one auth-middleware
test where `nextCalled` was false, and a doubling of the count from a pre-existing
`testMatch` glob in `jest.config.js` that descends into `.worktrees/logger-tier3/tests/...`.
A grep across all `*.test.*` and `*.spec.*` files for the symbols `storeCrossThreadMemory`,
`getCrossThreadMemory`, `memoryPut`, `enhanced-context-base`, `sdk-embed`,
`cross_thread_memory`, `cross_thread_context`, and `recentPaths` returned zero hits, so the
guard cannot be the cause of any test-level failure today.

## 5. Indicators of compromise observed

| IOC | Value | Notes |
|---|---|---|
| Row | `cross_thread_memory.id=1` | Deleted by operator before this document was written. |
| Row | `cross_thread_memory.id=2` | **Still in prod at time of writing.** `scope='cross_thread_context'`, `key='recentPaths'`, `user_id=NULL`, `content` includes `path='/api/staging/.env'` and `ip='35.185.191.37'`, `created_at=2026-05-12T23:28:57Z`, `updated_at=2026-05-12T23:29:14Z`. Pending deferred cleanup §6(g). |
| Source IP | `34.46.158.82` | GCP-range scanner. |
| Source IP | `35.185.191.37` | GCP-range scanner. The IP value recorded in id=2's `content.ip`. |
| Probe path | `/api/staging/.env` | Classic env-file scanner probe. The recorded payload in id=2. |
| Probe path | `/api/v1?X-App-Env=%00` | Null-byte (URL-encoded `%00`) injection probe. Directly motivates deferred item §6(c). |

All probes hit `/api/*` (the catch-all mount), so each produced a `cross_thread_memory`
upsert under `(scope='cross_thread_context', key='recentPaths', user_id=NULL)`. The fact
that the abuse pattern leaves a single row whose `created_at` is frozen and whose
`updated_at` slides forward on every probe is a reliable post-publish verification signal:
once the stop-gap is live, id=2's `updated_at` should freeze in place.

## 6. Deferred / full hardening checklist (NOT done in this hotfix)

The stop-gap shuts the bleeding but does not fix the architectural cause. The following
work is deferred and should land before the stop-gap is considered "the fix" rather than
"the band-aid":

- **(a) Move SDK writes behind auth.** Restructure `sdk-embed.js` so that any side-effecting
  call (memory writes, telemetry, etc.) runs only inside route handlers that have first
  passed an auth gate, never inside a catch-all `r.use(...)` middleware on an
  unauthenticated mount. The matching change to `server/bootstrap/routes.js:157-169` is to
  reconsider whether the SDK router should be mounted as a catch-all `/api/*` at all.
- **(b) Explicit allow-list for `/api/*` subroute prefixes.** Today an unmatched path under
  `/api/*` still passes through the router's middleware before falling out to a 404. An
  early prefix check (e.g. one of `health`, `blocks-fast`, `blocks`, `location`, `actions`,
  `research`, `feedback`, `diagnostics`, `snapshot`, `metrics/jobs`, `ml`, `chat`,
  `strategy`, `assistant/verify-override`, `ranking`) at the top of the router would
  short-circuit unknown paths *before* any work happens. This removes scanner traffic from
  the SDK router's hot path entirely.
- **(c) Edge null-byte (`%00`) rejection middleware.** The `/api/v1?X-App-Env=%00` probe
  surfaces a class of input that should never reach application code. A small reject-on-
  null-byte middleware at the edge (URL, query, headers) will short-circuit a wide range of
  scanner probes and is independently valuable beyond this incident.
- **(d) IOC scan of other write-target tables.** The same scanner traffic may have produced
  rows on other tables whose writers run earlier or under similar unauthenticated paths.
  Tables flagged for IOC review are `briefings` (306 rows), `actions` (220 rows), and
  `assistant_memory` (37 rows). The scan should look for rows whose user-supplied content
  fields contain probe-shaped data (URL-encoded null bytes, `.env` paths, sensitive header
  names, suspicious user agents) and originate from anonymous sessions.
- **(e) Fix schema drift on `cross_thread_memory.user_id`.** Per the incident-investigation
  notes, the column type is recorded as `uuid` in `shared/schema.js` but `TEXT` in
  `migrations/002`. The drift needs to be resolved with a single source of truth; the
  resolution decision is a follow-up architectural call (depends on how callers like the
  thread manager are expected to identify "system" writers versus real UUID users) and
  should not be conflated with this hotfix.
- **(f) Reader-side untrusted-data wrapping.** If any future feature wires
  `getCrossThreadMemory` (or any direct `SELECT ... FROM cross_thread_memory`) into an LLM
  prompt, the loaded rows must be wrapped as untrusted data — explicitly framed as
  attacker-controlled, never interpolated as instructions, and ideally subjected to a
  length/character sanity check at the load boundary. Today no such consumer exists, so
  this is a future-proofing note rather than an immediate fix.
- **(g) Delete the remaining poisoned row.** Once §4's writer is confirmed shut (id=2's
  `updated_at` stops advancing post-publish), the row should be removed from prod. This is
  deliberately *not* part of the stop-gap so that the publish-verification signal
  (`updated_at` freezes) remains observable.
- **(h) Unit tests covering the guard and the broader invariant.** Add a focused test that
  asserts `storeCrossThreadMemory('recentPaths', ...)` returns null without invoking
  `memoryPut`, and a higher-level invariant test that asserts no SDK-router middleware
  performs a DB write before an auth gate on an unauthenticated mount. The second test is
  the more durable of the two — it will catch regressions of the underlying architectural
  bug even if a future writer chooses a different key than `'recentPaths'`.

## 7. Verification commands

A reviewer can verify the stop-gap end-to-end with the following commands. Each is
independent of the others; run in any order.

Confirm the diff is exactly the 7-line additive guard at the right line range:

```bash
git diff -- server/lib/ai/context/enhanced-context-base.js
git diff --stat -- server/lib/ai/context/enhanced-context-base.js
```

The `--stat` view should report `1 file changed, 7 insertions(+)` with no deletions, and
the full diff should contain a single hunk header `@@ -428,6 +428,13 @@` with only `+`
lines (no `-` lines).

Lint just the edited file, then the repository:

```bash
npx eslint server/lib/ai/context/enhanced-context-base.js
npm run lint
```

Both should exit `0`. The repo-wide lint runs with `--max-warnings 0`, so any new warning
would also fail the check.

Run the Jest unit suite. The expected outcome is sixteen pre-existing failures that are
unrelated to the guard (see §4 for the catalogue) and zero failures referencing the
modified symbols:

```bash
npm run test:unit
```

If the reviewer wants to independently confirm that no test references the guard's
surface, run:

```bash
grep -rln \
  'storeCrossThreadMemory\|getCrossThreadMemory\|memoryPut\|enhanced-context-base\|sdk-embed\|cross_thread_memory\|cross_thread_context\|recentPaths' \
  tests/ 2>/dev/null
```

The expected output is empty (zero lines). End-to-end Playwright tests under
`tests/e2e/` are not part of the publish-readiness signal for this stop-gap because they
require a live gateway plus the Replit-specific Chromium executable path described in
`docs/architecture/audits/REPLIT_WORKFLOW_CONTROL.md`; their pass/fail signal would not be
attributable to the guard either way.

Post-publish, the smallest persistent-state check that proves the writer is shut is to
query `cross_thread_memory` twice with a minute between samples and confirm that the
top row's `updated_at` is identical between the two samples. Once that's confirmed,
deferred item §6(g) (delete the id=2 row) is safe to execute.
