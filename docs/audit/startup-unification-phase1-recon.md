# Startup-Contract Reconnaissance: Structural Document

**Branch:** `startup-unification-pass` (off `5104fbf3` on `auth-hardening-pass`)
**Scope:** Read-only Phase 1. Files audited: `.replit`, `scripts/start-replit.js`, `gateway-server.js` (bootstrap), `server/config/load-env.js`, `server/config/env-registry.js`, `server/config/validate-env.js`, `package.json`.
**Explicitly out of scope:** agent topology (embedded vs standalone), `index.js` shadow server, flag-set consolidation beyond surfacing.

---

## 1. Launch Path Inventory (verified against `.replit`)

There are **three named invocations** in `.replit`, but only **two distinct gateway launch paths**:

| Invocation | `.replit` lines | Shell command | Gateway path | Parallel sidecar? |
|---|---|---|---|---|
| Workspace `run` (Run button / preview) | 7 | `sh -c "set -a && . ./.env.local && set +a && node scripts/start-replit.js"` | **Wrapper path** | No |
| Workflow `Project` task 1 | 35-37 | `sh -c "set -a && . ./.env.local && set +a && node scripts/start-replit.js"` (identical to workspace) | **Wrapper path** | — |
| Workflow `Project` task 2 | 39-42 | `sh -c "set -a && . ./.env.local && set +a && node agent-server.js"` | — | Yes: standalone agent on port 43717 |
| Deployment `run` | 17 | `node gateway-server.js` | **Direct path** | No |
| Deployment `build` | 16 | `npm ci --omit=dev && npm run build:client` | — | — |

**Audit deviation #1:** The audit (line 5, 15) implies workspace and workflow are different code paths. They are not — they share `start-replit.js`. The difference between workspace and workflow is *only* the parallel agent task. Workflow ⊃ Workspace + agent.

**Audit deviation #2:** Deployment runs `node gateway-server.js` directly, BUT the workspace shell prefix `set -a && . ./.env.local && set +a` is NOT in the deployment run command. Deployment never sources `.env.local`. Verified at `.replit:17` vs `:7,36,41`.

---

## 2. Every Env Decision Point in the Launch Chain (ordered by execution)

### Workspace path (current)

| # | File | Lines | Decision | Reads | Writes (mutates) |
|---|---|---|---|---|---|
| 1 | `.replit` shell | 7 | Source `.env.local` into process env via `set -a` | `.env.local` file | Every KEY in `.env.local` (with shell precedence: env-var wins over file) |
| 2 | `start-replit.js` | 23-28 | Fail if `SIMULATE=1` (simulate-workflow.js does not exist) | `process.env.SIMULATE` | — (exits 1) |
| 3 | `start-replit.js` | 76 | `isDeployment = REPLIT_DEPLOYMENT === "1" \|\| "true"` | `REPLIT_DEPLOYMENT` | — |
| 4 | `start-replit.js` | 92 | `loadEnvFile('.env')` (note: `.env`, NOT `.env.local`) | `.env` file (if exists) | Each `KEY=value` IFF `process.env[KEY]` is currently empty |
| 5 | `start-replit.js` | 95 | `PORT = PORT \|\| '5000'` | `PORT` | `PORT` (defensive default) |
| 6 | `start-replit.js` | 97-102 | **`NODE_ENV = (FORCE_DEV === '1') ? 'development' : 'production'`** | `FORCE_DEV` | **`NODE_ENV` (unconditional mutation)** |
| 7 | `start-replit.js` | 104 | `WORKER_ID = WORKER_ID \|\| 'replit:${pid}'` | `WORKER_ID` | `WORKER_ID` |
| 8 | `start-replit.js` | 107 | `const isCloudRun = false` (hardcoded — see deviation #4) | — | — |
| 9 | `start-replit.js` | 110-133 | Skip in Cloud Run (but `isCloudRun=false` so always runs): kill port 5000, verify/build client dist | `PORT` (read), `client/dist/index.html` (read) | None on env (kills port, spawns build) |
| 10 | `start-replit.js` | 141-144 | Spawn `node gateway-server.js` with `env: { ...process.env }` (full propagation) | All current env | — |
| 11 | **gateway-server.js loads** | 30 | `loadEnvironment()` (load-env.js) | — | — |
| 12 | `load-env.js` | 63-107 | Reconstruct GCP credentials from individual `type/project_id/private_key/client_email` env vars → write `/tmp/gcp-credentials.json` | Multiple GCP fields | `GOOGLE_APPLICATION_CREDENTIALS` (writes file path) |
| 13 | `load-env.js` | 116-121 | Mirror `GOOGLE_CLOUD_PROJECT` from `GOOGLE_CLOUD_PROJECT_ID` if needed | both vars | `GOOGLE_CLOUD_PROJECT` |
| 14 | `load-env.js` | 138 | `isReplitDeployment = REPLIT_DEPLOYMENT === '1' \|\| 'true'` | `REPLIT_DEPLOYMENT` | — |
| 15 | `load-env.js` | 145-149 | **If deployment → return early (skip .env.local)** | `REPLIT_DEPLOYMENT` | — |
| 16 | `load-env.js` | 153-158 | Load `.env.local` again (workspace only); each `KEY=value` IFF `process.env[KEY] === undefined` | `.env.local` file | Each new KEY |
| 17 | `gateway-server.js` | 32 | `validateOrExit()` (validate-env.js) | — | — |
| 18 | `validate-env.js` | 8-122 | Validate required env vars; collect errors/warnings | `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `JWT_SECRET`, `VECTO_AGENT_SECRET`, Uber vars, `PORT`/`EIDOLON_PORT`, `APP_MODE`/`MODE`, `OPENWEATHER_API_KEY`, `GOOGLEAQ_API_KEY` | — |
| 19 | `validate-env.js` | 40 | **`isProd = NODE_ENV === 'production'`** — escalates several warnings to errors | `NODE_ENV` | — |
| 20 | `validate-env.js` | 131-134 | If `NODE_ENV === 'test'` skip fatal exit | `NODE_ENV` | — |
| 21 | `gateway-server.js` | 35 | `MODE = (APP_MODE \|\| 'mono').toLowerCase()` | `APP_MODE` | — |
| 22 | `gateway-server.js` | 36 | `PORT = Number(PORT \|\| 5000)` | `PORT` | — |
| 23 | `gateway-server.js` | 41 | `isDeployment = REPLIT_DEPLOYMENT === '1' \|\| 'true'` | `REPLIT_DEPLOYMENT` | — |
| 24 | `gateway-server.js` | 46 | `isAutoscaleMode = CLOUD_RUN_AUTOSCALE === '1' \|\| REPLIT_AUTOSCALE === '1'` | both | — |
| 25 | `gateway-server.js` | 61-64 | **`uncaughtException` handler: `process.exit(1)` IFF `NODE_ENV !== 'production'`** | `NODE_ENV` | — |
| 26 | `gateway-server.js` | 94 | `trustProxyHops = parseInt(TRUST_PROXY_HOPS, 10)`; default 1 if not integer | `TRUST_PROXY_HOPS` | — (Express setting) |
| 27 | `gateway-server.js` | 142 | `if (!isAutoscaleMode) mountSSE(app)` | — | — |
| 28 | `gateway-server.js` | 149 | `if (MODE === 'mono') mountRoutes(app, server)` | — | — |
| 29 | `gateway-server.js` | 184 | Only `server.listen()` if `import.meta.url === entryUrl` (direct-invocation guard) | `process.argv[1]` | — |
| 30 | `gateway-server.js` | 193 | `workerConfig = shouldStartWorker({ isAutoscaleMode })` → reads `ENABLE_BACKGROUND_WORKER` inside | `ENABLE_BACKGROUND_WORKER` (transitively) | — |
| 31 | `gateway-server.js` | 208 | Snapshot observer mounted only if `!isAutoscaleMode` | — | — |

### Deployment path (current)

The deployment path **skips steps 1–10** entirely. It enters at **step 11** (`node gateway-server.js` → `loadEnvironment()`). Inside `loadEnvironment()`, step 15 takes the early-return branch — `.env.local` is NEVER loaded in deployment. All env values must come from Replit Secrets / Cloud Run env injection.

### NPM-script alternate paths (current)

These are not invoked by `.replit` but are runnable manually:

| Script | `package.json` line | Command | NODE_ENV mutation |
|---|---|---|---|
| `start` | 11 | `NODE_ENV=production node gateway-server.js` | **Forces `production`** at shell level |
| `dev` | 12 | `NODE_ENV=development node gateway-server.js` | **Forces `development`** at shell level |
| `start:replit` | 9 | `node scripts/start-replit.js` | Inherits start-replit.js's NODE_ENV mutation |
| `agent` | 22 | `node agent-server.js` | Inherits caller's NODE_ENV |
| `prestart:replit` | 8 | `npm run build:client` | — |

---

## 3. Every `NODE_ENV` Reference and What Mutates It

### Mutators (write `process.env.NODE_ENV` or inject via shell)

| Source | Location | Effect | Override |
|---|---|---|---|
| `start-replit.js` | 97-102 | Sets `NODE_ENV='production'` unconditionally | `FORCE_DEV=1` → `'development'` |
| `package.json:start` | 11 | Shell-prefix `NODE_ENV=production` | — |
| `package.json:dev` | 12 | Shell-prefix `NODE_ENV=development` | — |
| `.env.local` (potentially) | n/a | If `NODE_ENV=…` is in the file, sourced by `.replit:7` | Replit Secrets take precedence per `set -a` semantics |

### Readers (branch on `NODE_ENV`)

| Reader | Location | Branch behavior |
|---|---|---|
| `validate-env.js:40` | `isProd = NODE_ENV === 'production'` | Escalates JWT_SECRET, VECTO_AGENT_SECRET, Uber creds, TOKEN_ENCRYPTION_KEY from warning → error |
| `validate-env.js:131` | `NODE_ENV === 'test'` | Skip fatal exit on validation failure |
| `gateway-server.js:63` | `NODE_ENV !== 'production'` | `process.exit(1)` on uncaughtException; in prod, **log and continue** |
| `env-registry.js:17-21` | Registered with `default: 'development'` | No branching; metadata only |

### Net effect of current chain (workspace)

`.replit` shell → may set NODE_ENV from `.env.local` → `start-replit.js:97-102` OVERWRITES NODE_ENV (production unless FORCE_DEV) → spawns gateway → `validate-env.js` and `gateway-server.js:63` observe a value that's been forced by the wrapper, not the operator.

**Result:** A workspace session "looks like production" to the validator and to the crash-policy logic, *because the wrapper made it look that way*. This is what the audit (line 23) and the user's instruction both flag — `NODE_ENV` is being used simultaneously as a deployment proxy, runtime behavior switch, and boot-script override.

---

## 4. Every Fork in Launch Behavior Between Workspace / Workflow / Deployment

| Fork | Workspace | Workflow | Deployment |
|---|---|---|---|
| Source `.env.local` via shell | ✅ Yes (`.replit:7`) | ✅ Yes (`.replit:36`) | ❌ No (`.replit:17`) |
| Run `start-replit.js` wrapper | ✅ Yes | ✅ Yes | ❌ No |
| Load `.env` file (separate from `.env.local`) | ✅ Yes (`start-replit.js:92`) | ✅ Yes | ❌ No |
| Force `NODE_ENV='production'` | ✅ Yes (wrapper-forced) | ✅ Yes | Depends on Cloud Run env injection |
| Kill any process on port 5000 | ✅ Yes (`start-replit.js:115`) | ✅ Yes | ❌ No |
| Verify/build client/dist | ✅ Yes (`start-replit.js:122-132`) | ✅ Yes | ❌ No (deployment.build does it) |
| Health-poll `/health` from wrapper | ✅ Yes (`start-replit.js:166-204`) | ✅ Yes | ❌ No (Cloud Run does its own) |
| Wrapper SIGTERM/SIGINT forwarder | ✅ Yes | ✅ Yes | ❌ No |
| Load `.env.local` again inside gateway | ✅ Yes (`load-env.js:153`) | ✅ Yes | ❌ No (`load-env.js:145` early return) |
| Parallel `agent-server.js` on 43717 | ❌ No | ✅ Yes | ❌ No |
| Embedded agent under `/agent` | Depends on `DISABLE_SPAWN_AGENT` | Same | Same |
| `uncaughtException` → crash | ✅ Yes only if NODE_ENV ≠ production (always non-prod fork? No — wrapper forces production, so NO crash in workspace either) | Same as workspace | If Cloud Run sets NODE_ENV=production: no crash |
| Autoscale mode (`CLOUD_RUN_AUTOSCALE` or `REPLIT_AUTOSCALE`) | Off (not set in `.env.local`) | Off | Off currently (`.replit:18` is `cloudrun` but flag not set) |

**Audit deviation #3 (subtle but important):** Because `start-replit.js:97-102` forces `NODE_ENV='production'` and `gateway-server.js:63` only crashes if `NODE_ENV !== 'production'`, the crash-on-uncaughtException policy is **inverted from intent** in workspace: the wrapper masquerades workspace as prod, so workspace runs with the prod crash policy (no crash). Only `FORCE_DEV=1` would restore the dev crash policy. The audit (line 36) called this out as "different failure semantics by env" but didn't trace that the workspace inherits the prod semantics because of the wrapper.

**Audit deviation #4 (verified):** `start-replit.js:107` hardcodes `const isCloudRun = false` with the comment "Reserved VM deployment - always run full application, never autoscale mode." This contradicts the gateway's runtime check at `gateway-server.js:46` which DOES read `CLOUD_RUN_AUTOSCALE`. The wrapper assumes "never autoscale"; the gateway accepts "maybe autoscale." Today, deployment never flows through the wrapper, so there's no live conflict. But if anyone ever sets `.replit:[deployment].run = "node scripts/start-replit.js"` (e.g., for parity), autoscale flags would be silently ignored in the wrapper's branch.

---

## 5. Unregistered / Undocumented Env Vars Used in the Launch Chain

These are read by code but not in `server/config/env-registry.js`:

| Var | Read at | Default | Notes |
|---|---|---|---|
| `APP_MODE` | `gateway-server.js:35`, `validate-env.js:94` | `'mono'` | Not in registry; `validate-env.js:94` also accepts legacy `MODE` |
| `MODE` | `validate-env.js:94` | — | Legacy alias for `APP_MODE`; both supported, neither registered |
| `TRUST_PROXY_HOPS` | `gateway-server.js:94` | `1` (if not integer) | Documented in inline comment but not in registry |
| `FORCE_DEV` | `start-replit.js:98` | — | Wrapper-only escape hatch; not in registry |
| `DISABLE_SPAWN_AGENT` | Referenced in `.replit:24` comment | — | Used by gateway/embed.js (not read in audited files); not in registry |
| `EIDOLON_PORT` | `validate-env.js:88` | — | Legacy `PORT` alias; not in registry |
| `SIMULATE` | `start-replit.js:23` | — | Hard-fail tripwire; not in registry |
| `WORKER_ID` | `start-replit.js:104` | `replit:${pid}` | Wrapper default; not in registry |
| `GOOGLE_AI_API_KEY` | `validate-env.js:20-27` | — | Deprecated alias for `GEMINI_API_KEY`; not in registry |
| `OPENWEATHER_API_KEY` | `validate-env.js:58` | — | Validated but not in registry |
| `GOOGLEAQ_API_KEY` | `validate-env.js:62` | — | Validated but not in registry |
| `TOKEN_ENCRYPTION_KEY` | `validate-env.js:71` | — | Validated but not in registry |
| `UBER_CLIENT_ID/SECRET/REDIRECT_URI` | `validate-env.js:69,78` | — | Validated but not in registry |
| `VECTO_AGENT_SECRET` | `validate-env.js:49` | — | Validated but not in registry |
| `REPLIT_DEVSERVER_INTERNAL_ID` | `validate-env.js:43` | — | Documented dev-only JWT fallback; not in registry |

`env-registry.js` claims to be "single source of truth for all env vars" (file header). It is not — at least 14 vars used in the launch chain are missing.

---

## 6. Internal Contradictions Surfaced

| # | Contradiction | Sources |
|---|---|---|
| C1 | Registry doctrine: "environment-based branching is an anti-pattern; route logic by capability flags." Validator practice: `NODE_ENV === 'production'` keys severity, `NODE_ENV === 'test'` keys exit policy. Gateway practice: `NODE_ENV !== 'production'` keys crash policy. | `env-registry.js:253-255` vs `validate-env.js:40,131`, `gateway-server.js:63` |
| C2 | Wrapper says "Reserved VM, never autoscale" (`isCloudRun = false` hardcoded). Gateway reads two autoscale flags. | `start-replit.js:107` vs `gateway-server.js:46` |
| C3 | `validate-env.js` header comment says path is `server/lib/validate-env.js`. Actual path is `server/config/validate-env.js`. | `validate-env.js:1` |
| C4 | Wrapper loads `.env` (file basename). Comment on line 90-91 references "`.env.local`" as sourced upstream. There is no statement about what `.env` is for, or whether it's expected to exist alongside `.env.local`. | `start-replit.js:90-92` |
| C5 | `load-env.js` regex (`/^([A-Z_][A-Z0-9_]*)=(.*)$/`) requires keys to begin with uppercase letter or underscore. `start-replit.js` regex (`line.includes('=')` with no validation) accepts any key. Two different env-file parsers in the same launch. | `load-env.js:33` vs `start-replit.js:48-49` |
| C6 | `loadEnvFile` in `start-replit.js` skips `${VAR_NAME}` references entirely (line 59-61). `load-env.js` performs `${VAR}` substitution (line 39-41). Same syntactic input, different semantics. | `start-replit.js:59-61` vs `load-env.js:39-41` |
| C7 | `package.json:main = "gateway-server.js"` and `.replit:entrypoint = "gateway-server.js"`. Workspace and workflow do NOT actually start that file — they start `scripts/start-replit.js` which spawns it. Documentation says one thing, runtime does another. | `package.json:5`, `.replit:2` vs `.replit:7,36` |

---

## 7. Process-Level Hooks Inventory (within audited files)

| Hook | Location | Behavior |
|---|---|---|
| `process.emitWarning` interceptor | `gateway-server.js:22-28` | Suppress `pg-connection-string` SSL deprecation warning |
| `process.on('uncaughtException')` | `gateway-server.js:61-64` | Log; exit IFF `NODE_ENV !== 'production'` |
| `process.on('unhandledRejection')` | `gateway-server.js:66-68` | Log only; never exit |
| `process.on('SIGINT')` (gateway) | `gateway-server.js:248` | `shutdown('SIGINT')` → kill workers, close conns, exit |
| `process.on('SIGTERM')` (gateway) | `gateway-server.js:249` | `shutdown('SIGTERM')` |
| `process.on('SIGINT')` (wrapper) | `start-replit.js:213-216` | Forward signal to child gateway |
| `process.on('SIGTERM')` (wrapper) | `start-replit.js:208-211` | Forward signal to child gateway |
| `setInterval` (unified-AI health) | `gateway-server.js:264-270` | Health check every 30s |
| `setTimeout` (force-exit fallback) | `gateway-server.js:242-245` | 5s `.unref()`'d hard exit if graceful shutdown wedges |
| `server.on('error')` (gateway) | `gateway-server.js:120-123` | Log + `process.exit(1)` |
| `child.on('error')` (wrapper → gateway) | `start-replit.js:146-149` | Log + `process.exit(1)` |
| `child.on('exit')` (wrapper → gateway) | `start-replit.js:151-154` | Propagate child exit code |

---

## 8. Proposed Unified Shape (per Melody's decision)

The architect's decision: **eliminate wrapper env-mutation; gateway-server.js becomes the single canonical entrypoint for both workspace and deployment; replace `NODE_ENV` mutation with explicit `APP_RUNTIME` flag.**

### Target launch contracts

| Path | Target shell command |
|---|---|
| Workspace `run` | `sh -c "set -a && . ./.env.local && set +a && node gateway-server.js"` |
| Workflow Project task 1 | (same as workspace) |
| Workflow Project task 2 | (unchanged: standalone agent — agent topology is out of Phase 1 scope) |
| Deployment `run` | `node gateway-server.js` (unchanged) |

### Target env-policy structure

| Concern | Current signal | Target signal |
|---|---|---|
| "Am I in a Replit deployment / Cloud Run?" | `REPLIT_DEPLOYMENT === '1'` (kept) | Unchanged — keep as the deployment-detection primitive |
| "What runtime topology am I in?" | Inferred from `NODE_ENV` + `REPLIT_DEPLOYMENT` | New `APP_RUNTIME` enum: `workspace` \| `deployment` \| `test`. Set by `.replit` shell (workspace), defaulted to `deployment` when `REPLIT_DEPLOYMENT === '1'`, set to `test` by test runner. |
| "Should validator escalate severity?" | `NODE_ENV === 'production'` | `APP_RUNTIME === 'deployment'` |
| "Should I skip fatal exit for tests?" | `NODE_ENV === 'test'` | `APP_RUNTIME === 'test'` |
| "Should I crash on uncaughtException?" | `NODE_ENV !== 'production'` | Decide per Melody — current behavior was "crash in dev, don't crash in prod"; one defensible choice is "always crash, rely on Cloud Run / Replit supervisor to restart." Out of Phase 1 to decide. |
| `NODE_ENV` itself | Mutated everywhere | Treated as **build-mode only** (Vite / framework). Never read by application code. Validator may still accept it but only as a deprecated alias. |
| `APP_MODE` (mono/split) | Read at gateway:35 + validator:94 | Register in `env-registry.js`. Resolve `MODE` legacy alias. (Detailed flag-consolidation is out of Phase 1 per scope.) |
| `CLOUD_RUN_AUTOSCALE` vs `REPLIT_AUTOSCALE` | Either turns on autoscale | Out of Phase 1 (flag-consolidation specifics deferred). |

### Operations the wrapper currently performs — Phase 1 inventory of where they go

The wrapper does six things beyond NODE_ENV mutation. Each needs a new home (decisions deferred — surfacing only):

| Wrapper operation | `start-replit.js` lines | Workspace-only? | Candidate new home |
|---|---|---|---|
| Hard-fail on `SIMULATE=1` | 23-28 | Yes | Drop (dead tripwire) OR move to gateway-server.js pre-init |
| Load `.env` file (in addition to `.env.local`) | 92 | Yes | Either (a) merge into `.env.local` and drop `.env`, OR (b) extend `load-env.js` to load both files in workspace |
| Default `PORT=5000` | 95 | Both (defensive) | Already defaulted in gateway-server.js:36 — wrapper line is redundant |
| Default `WORKER_ID=replit:${pid}` | 104 | Yes | Move to `load-env.js` or `gateway-server.js` main() |
| Kill any process on port 5000 | 115 | Yes (helpful in workspace re-runs) | Either (a) add a `prerun` shell script invoked by `.replit:run`, OR (b) move into gateway-server.js with a `WORKSPACE_KILL_PORT` opt-in flag |
| Verify/rebuild client/dist | 122-132 | Yes (deployment.build already does it) | Either (a) add a `prerun` shell step, OR (b) trust `npm run build:client` to be invoked manually in workspace |
| Spawn child gateway + health-poll | 141-204 | Yes | Drop entirely. If a workspace health-readiness gate is desired for the IDE preview, that's an IDE concern, not an app concern. |
| SIGTERM/SIGINT forwarder | 208-216 | Yes | Drop entirely (gateway has its own handlers; running in-process means no forwarding needed) |

### Adjustment notes per divergence (the format you asked for)

| # | Divergence found | Current behavior | Unified shape | Explicit Adjustment |
|---|---|---|---|---|
| A1 | Workspace runs wrapper, deployment runs gateway directly | Two code paths | Single code path: `node gateway-server.js` | Change `.replit:7` and `.replit:36` shell commands to drop the wrapper. **Defer:** what to do with workspace-only ops (port kill, client build verify) — needs Melody's call. |
| A2 | Wrapper forces `NODE_ENV='production'` unless `FORCE_DEV=1` | `start-replit.js:97-102` mutates | Wrapper is gone, so mutation goes with it. Workspace shell sets `APP_RUNTIME=workspace` (or leaves unset → defaulted by gateway). | Remove `start-replit.js` (or reduce to no-op shim, see A8). Add `APP_RUNTIME` definition to `env-registry.js`. |
| A3 | `package.json:start` and `dev` hard-set `NODE_ENV` | Shell-prefix mutation | Replace with plain `node gateway-server.js`. If `dev` is meant to imply "verbose Vite, dev framework," keep `NODE_ENV=development` ONLY for the build path (`vite dev` / `vite build`), not the runtime. | Edit `package.json:11-12`. Possibly add `start:workspace` that sets `APP_RUNTIME=workspace` if needed for parity with `.replit:run`. |
| A4 | `validate-env.js:40` keys severity off `NODE_ENV === 'production'` | Validator escalation | Key off `APP_RUNTIME === 'deployment'` | Edit `validate-env.js:40`. Also lines 70-85 inherit `isProd`. |
| A5 | `validate-env.js:131` skips exit on `NODE_ENV === 'test'` | Test-mode exception | Key off `APP_RUNTIME === 'test'` | Edit `validate-env.js:131-134`. Test runner must set `APP_RUNTIME=test`. |
| A6 | `gateway-server.js:63` crashes only when `NODE_ENV !== 'production'` | Inverted in workspace because wrapper forces prod | Key off explicit policy (TBD by Melody — drop the env-conditional and always crash? OR always log-only?) | Edit `gateway-server.js:61-64`. **Decision deferred.** |
| A7 | `start-replit.js:107` hardcodes `isCloudRun=false`, contradicts gateway runtime check | Latent inconsistency | Removed with the wrapper. | No new code needed — A1 subsumes. |
| A8 | Wrapper does port-kill, client-build verify, health-poll | Workspace convenience | Move to a small `scripts/dev-prerun.sh` (or similar) invoked by `.replit:run` AFTER `set -a && . ./.env.local && set +a` and BEFORE `node gateway-server.js`. OR drop entirely if Melody decides workspace operators can run `npm run build:client` and `lsof -ti:5000 \| xargs kill -9` themselves. | **Decision deferred** — three options listed. |
| A9 | `.env` (separate from `.env.local`) loaded only by wrapper | Hidden second env file | Either consolidate into `.env.local` or extend `load-env.js` to load `.env` too. | Inspect repo for `.env` (file may not exist; tripwire was added defensively). Out of Phase 1 read-set — surface for Phase 2. |
| A10 | Two env-file parsers with different semantics (wrapper vs `load-env.js`) | C5, C6 | One parser. Drop wrapper's `loadEnvFile`. | Goes away with A1. |
| A11 | `APP_MODE`/`TRUST_PROXY_HOPS`/etc. not registered | C7 + Section 5 | Register all 14 missing vars in `env-registry.js`. | Edit `env-registry.js`. Out of Phase 1's listed scope ("flag consolidation specifics") — surface only. |
| A12 | `env-registry.js` doctrine contradicts validator/gateway practice | C1 | Either (a) update doctrine to acknowledge `APP_RUNTIME`-based branching is allowed, OR (b) refactor validator/gateway to use capability flags. | Doctrine reconciliation. **Decision deferred** — affects A4-A6. |
| A13 | `package.json:main` and `.replit:entrypoint` claim `gateway-server.js`; workspace doesn't honor it | C7 | After A1, this becomes truthful. | No action — emerges from A1. |
| A14 | `load-env.js` early-returns in deployment, skipping `.env.local` load | Intentional, but documented poorly | Keep, OR consider loading a `.env.deployment` for parity. | Likely keep as-is — Replit Secrets / Cloud Run env are the deployment source of truth. Surface for confirmation. |
| A15 | Workflow's parallel `agent-server.js` task | Workflow-only sidecar | Out of Phase 1 scope (agent topology decision deferred to later phase). | No action this pass. |

---

## 9. Open Questions Surfaced (Decisions Deferred)

These came up during recon and need Melody's call before Phase 2 implementation:

1. **Crash policy on `uncaughtException`** (A6): always crash, never crash, or keep env-conditional?
2. **Workspace pre-run operations** (A8): keep them (via shell script), drop them, or fold them into gateway-server.js behind an opt-in flag?
3. **`.env` file existence and purpose** (A9): does `.env` exist as a sibling to `.env.local`, or is `start-replit.js:92` reading a non-existent file silently?
4. **Validator/gateway doctrine reconciliation** (A12): allow `APP_RUNTIME`-based branching as a sanctioned pattern, or refactor toward capability flags only?
5. **Loading `.env.local` in deployment** (A14): keep the early-return, or load deployment-specific env files for symmetry?
6. **`package.json` scripts** (A3): how aggressively to clean up `start`/`dev`/`start:replit` — drop legacy ones, or keep for backward compatibility?

---

## 10. What I Did Not Read (Per Phase 1 Scope)

- `agent-server.js` (agent topology deferred)
- `index.js` (shadow-server question deferred)
- `server/bootstrap/middleware.js`, `routes.js`, `workers.js`, `health.js` (out of Phase 1's listed file set, though they are called by gateway-server.js's bootstrap)
- `server/db/db-client.js`, `connection-manager.js` (DB env policy)
- `server/middleware/auth.js` (auth env reads)
- `start-mono.sh`, `.env.local`, `.env.local.example` (env file contents)

The audit explicitly cited these as in-scope follow-ups. They are not blockers for the unification shape itself but will surface adjacent env-decision points during Phase 2.
