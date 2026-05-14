# Minimum Viable Startup Manifesto

**Branch:** `startup-unification-pass` (off `5104fbf3` on `auth-hardening-pass`)
**Inputs:**
- `docs/audit/startup-unification-phase1-recon.md` (Phase 1 recon — env decision points, forks, contradictions)
- `docs/audit/startup-archaeology.md` (Steps A+B+C — defensive-line classification by introducing commit + intent)
- Architect decisions Q1–Q6 + Step 0–8 detailed plan + Step D framing instruction (this session, 2026-05-13)

**Status:** Specification. No source-tree edits begin until this document is approved.
**Authority:** Full lead exercised by architect (Melody).

---

## 1. Core Principle

Make `gateway-server.js` the canonical entrypoint for both workspace and deployment. Eliminate the launch wrapper. Replace `NODE_ENV`-driven runtime branching with `APP_RUNTIME` — the sole sanctioned environment-class enum. Preserve the two load-bearing workspace conveniences (port-5000 zombie cleanup, `client/dist` auto-rebuild) in a tiny prerun shell script invoked by `.replit:run` before the gateway. Treat capability flags as the right tool for "can this process do X here?" — `APP_RUNTIME` answers only "what topology am I in?", which is a strictly narrower question.

---

## 2. Canonical Entrypoints

| Invocation | `.replit` lines | Target shell command |
|---|---|---|
| Workspace `run` | 7 | `sh -c "set -a && . ./.env.local && set +a && bash scripts/dev-prerun.sh && APP_RUNTIME=workspace node gateway-server.js"` |
| Workflow `Project` task 1 (gateway) | 35-37 | (same as workspace) |
| Workflow `Project` task 2 (agent) | 39-42 | (unchanged: `sh -c "set -a && . ./.env.local && set +a && node agent-server.js"` — agent topology deferred) |
| Deployment `build` | 16 | `npm ci --omit=dev && npm run build:client` (unchanged) |
| Deployment `run` | 17 | `node gateway-server.js` (unchanged) |

Notes:
- The workspace shell prefix `set -a && . ./.env.local && set +a` is preserved — it's how `.env.local` gets into the process env before Node starts.
- `bash scripts/dev-prerun.sh` runs synchronously before `node gateway-server.js`. If prerun fails (e.g., build error), the gateway never starts — fail-loud.
- `APP_RUNTIME=workspace` is set explicitly in the shell command so the gateway's resolution code sees the explicit value. Without this prefix, gateway would compute `workspace` from `REPLIT_DEPLOYMENT` being unset, which is also correct but less explicit.
- Deployment.run is unchanged — it already invokes the gateway directly. The Manifesto changes workspace and workflow to match deployment's shape.

---

## 3. APP_RUNTIME — The Sole Sanctioned Environment-Class Enum

### 3a. Values

| Value | Meaning |
|---|---|
| `workspace` | Local Replit IDE, or any local dev outside Replit |
| `deployment` | Published Replit/Cloud Run runtime |
| `test` | jest/playwright test runner |

### 3b. Resolution

Implemented at module load in `gateway-server.js` (or factored into `load-env.js` during Step E):

```javascript
function resolveAppRuntime() {
  const explicit = process.env.APP_RUNTIME;
  if (explicit && ['workspace', 'deployment', 'test'].includes(explicit)) {
    return explicit;
  }
  if (process.env.REPLIT_DEPLOYMENT === '1') {
    return 'deployment';
  }
  return 'workspace';
}
```

Resolution precedence:
1. **Explicit `APP_RUNTIME` env var** (highest) — set by `.replit:run` shell prefix (workspace) or test runner (`test`).
2. **Derived from `REPLIT_DEPLOYMENT`** — if `=== '1'`, treat as `deployment`.
3. **Fallback `workspace`** — for local dev outside Replit with no env vars set.

### 3c. Allowed uses (application code)

- `validate-env.js` severity escalation: `APP_RUNTIME === 'deployment'` gates which warnings become errors.
- `validate-env.js` test-skip: `APP_RUNTIME === 'test'` skips fatal exit on validation failure.
- Any new "is this deployment vs workspace" branch in feature code.

### 3d. Disallowed uses (application code)

- **No `NODE_ENV` reads in app code.** `NODE_ENV` is build-mode only; see §4.
- **No ad-hoc `REPLIT_DEPLOYMENT` reads in app code.** Use `APP_RUNTIME` instead. (Infrastructure exception in §3e.)
- **No `REPL_ID` reads for non-topology concerns.** REPL_ID is for "are we in Replit at all" detection, not runtime branching.
- **No resurrection of `isProduction()` / `isDevelopment()` helpers.** They conflate build-mode with runtime topology — removed 2026-02-25, do not re-add.

### 3e. Infrastructure exception

`REPLIT_DEPLOYMENT` MAY be read at module load in infrastructure code (`server/config/*`, `gateway-server.js` pre-main bootstrap) for two specific purposes:

1. **Driving `APP_RUNTIME` resolution** — the `resolveAppRuntime()` function above.
2. **Env-loading strategy selection** — `load-env.js:138-149`'s deployment early-return (Replit Secrets as sole source of truth in deployment) stays as-is per architect Q5.

Once `APP_RUNTIME` is computed, all downstream code uses `APP_RUNTIME` only.

---

## 4. NODE_ENV — Build-Mode Only

`NODE_ENV` continues to exist and may be set by:
- Vite (`vite build`, `vite dev`) — framework verbosity / build optimization.
- jest — `NODE_ENV=test` is the convention for some test setups.

`NODE_ENV` MUST NOT be read by application code at runtime. Specifically:
- No `if (process.env.NODE_ENV === 'production')` branches outside Vite config and framework hooks.
- No `process.env.NODE_ENV` mutation by app code, scripts, or launch wrappers.
- Validator severity, crash policy, and feature gates all read `APP_RUNTIME` instead.

This is the keystone change: by removing the NODE_ENV-keyed branches, the Manifesto eliminates the entire class of bugs where the wrapper-forced `NODE_ENV='production'` masqueraded workspace as deployment (Phase 1 recon audit deviation #3).

---

## 5. Crash Policy

`gateway-server.js`'s `uncaughtException` handler always exits with code 1:

```javascript
process.on('uncaughtException', (err) => {
  console.error('[GATEWAY] Uncaught exception:', err);
  process.exit(1);
});
```

No environment branching. The supervisor restarts the process:
- **Deployment:** Cloud Run / Replit deployment infrastructure restarts on exit.
- **Workspace:** Replit IDE workflow shows the exit; operator hits Run again. No silent partial state.
- **Test:** test runner observes the crash and reports failure.

Rationale: the prior `if (NODE_ENV !== 'production') process.exit(1)` (architect-flagged in Q1) was a Replit Agent pattern (Step B B2) that depended on `NODE_ENV` being trustworthy as a runtime topology signal. Once `NODE_ENV` is build-mode-only, the branching loses its meaning. Always-crash is simpler, more predictable, and matches supervisor-trust deployment semantics.

`unhandledRejection` continues to log-only (no exit) — that's the existing behavior at `gateway-server.js:66-68` and is not in Manifesto scope.

---

## 6. Load-Bearing Function Preservation

| # | Function | Current location | New home | Rationale |
|---|---|---|---|---|
| F1 | Port-5000 zombie cleanup | `start-replit.js:115` | `scripts/dev-prerun.sh` | Workspace re-run UX (Step A A7). Gateway shouldn't manage its own zombies; the prerun script runs before bind, deletes pre-existing listeners on 5000. |
| F2 | `client/dist` auto-rebuild | `start-replit.js:122-132` | `scripts/dev-prerun.sh` | Workspace fresh-checkout UX (Step A A8). Gateway shouldn't know how to build its own frontend; the prerun script invokes `npm run build:client` if `client/dist/index.html` is missing. |
| F3 | GCP credentials reconstruction | `load-env.js:63-107` | UNCHANGED | Already in `load-env.js`; `loadEnvironment()` is called at gateway boot before any GCP-using code initializes. No change required. |
| F4 | Deployment `.env.local` early-return | `load-env.js:145-149` | UNCHANGED | Architect Q5: Replit Secrets are the source of truth in deployment. The early-return prevents `.env.local` from clobbering Secrets. |
| F5 | Cross-provider autoscale detection | `gateway-server.js:46` | UNCHANGED | Step B B1: Melody-authored intentional defense-in-depth. Supports both `CLOUD_RUN_AUTOSCALE` and `REPLIT_AUTOSCALE`. Consolidation deferred. |

No load-bearing function is lost. F1 and F2 migrate to a new home; F3, F4, F5 are unchanged.

---

## 7. Explicit Deletions

| # | Target | File:lines | Driver |
|---|---|---|---|
| D1 | `scripts/start-replit.js` (entire file) | All 218 lines | Wrapper is scar tissue per archaeology Step A. 9 of 10 defensive lines classified as cargo-cult, past-patch, or wrapper-only-NA. Two load-bearing lines (F1, F2) migrate to `dev-prerun.sh`. |
| D2 | `EIDOLON_PORT` fallback in gateway port validator | `validate-env.js:88` — drop `\|\| process.env.EIDOLON_PORT` | Step B B3 / Step C C4: Replit Agent conflated SDK port (3102) with gateway port (5000). The var EIDOLON_PORT stays (4 live callsites in shared/, diagnostic-identity); only this misplaced reference goes. |
| D3 | `MODE` legacy alias in mode validator | `validate-env.js:94` — drop `\|\| process.env.MODE` | Step B B4: Melody-authored transition alias from 2026-01-28. 3.5 months of warning window. Grep-verify zero callers (`MODE=` excluding `APP_MODE=`) before deleting. |
| D4 | `GOOGLE_AI_API_KEY` deprecated alias + warning | `validate-env.js:20` (drop `\|\| process.env.GOOGLE_AI_API_KEY`) + `validate-env.js:26-27` (drop deprecation `warnings.push(...)`) | Step B B5: same transition-alias pattern as D3. Grep-verify zero callers before deleting. |
| D5 | NODE_ENV-conditional crash branching | `gateway-server.js:61-64` — replace `if (process.env.NODE_ENV !== 'production') process.exit(1)` with unconditional `process.exit(1)` | Architect Q1: always-crash, supervisor restart. |
| D6 | NODE_ENV reads in validator | `validate-env.js:40` (`isProd = NODE_ENV === 'production'`) → `isDeployment = APP_RUNTIME === 'deployment'`; `validate-env.js:131` (`NODE_ENV === 'test'`) → `APP_RUNTIME === 'test'` | Architect Q4 doctrine: NODE_ENV is build-mode only; APP_RUNTIME is the sanctioned enum. |

Drive-by fixes during the same edit pass (not strictly deletions, but in scope):
- `validate-env.js:1` header comment: update path from `server/lib/validate-env.js` to `server/config/validate-env.js`. Phase 1 recon C3, explained by Step B M6 (file moved in commit `76c57325`, header comment never updated).

---

## 8. `scripts/dev-prerun.sh` — Specification

A small shell script invoked by `.replit:run` before `node gateway-server.js`. Workspace-only — deployment.run does not invoke this script.

### Behavior

Exactly two functions:
1. **Port-5000 cleanup (F1):** if anything is listening on port 5000, kill it. Silent if nothing is listening. Falls back to no-op if `lsof` is unavailable (defense against non-standard environments).
2. **Client/dist verify (F2):** if `client/dist/index.html` does not exist, run `npm run build:client` (which is `vite build` per `package.json:11`). Errors halt prerun (and therefore the launch) — fail-loud.

### Reference implementation

```bash
#!/usr/bin/env bash
# scripts/dev-prerun.sh
# Workspace-only prerun invoked by .replit:run BEFORE node gateway-server.js.
# Deployment bypasses this entirely — .replit:[deployment].run does not call it.
# Two functions: F1 port-5000 cleanup, F2 client/dist verify.

set -e

# F1: Port-5000 zombie cleanup (Step A A7).
# Replit IDE re-runs can leave zombie processes bound to 5000; clear them
# before the new gateway binds. Silent if nothing is listening.
if command -v lsof >/dev/null 2>&1; then
  lsof -ti:5000 | xargs -r kill -9 2>/dev/null || true
fi

# F2: client/dist verify (Step A A8).
# Without this, workspace shows "cannot get" on fresh checkout because the
# Express static handler has no index.html to serve. Deployment.build runs
# npm run build:client explicitly; workspace has no equivalent unless this
# script runs.
if [ ! -f "client/dist/index.html" ]; then
  echo "[dev-prerun] client/dist/index.html missing — running npm run build:client"
  npm run build:client
fi
```

### Choices justified

- **`set -e`** so any failure halts the launch. The shell command in `.replit:run` chains with `&&`, but `set -e` provides an additional fail-loud layer (e.g., if `xargs` itself errors).
- **`xargs -r`** skips the kill when `lsof` returns no PIDs (avoids "no such process" stderr noise).
- **`command -v lsof` guard** because the wrapper assumed `lsof` was always present (Replit Nix has it, but bare environments may not).
- **`npm run build:client`** per architect's instruction, NOT the wrapper's `cd client && npm install && npm run build`. Vite build runs from repo root per `package.json:11`. Workspace deps are assumed installed.
- **No file permissions assertion** in the script — `.replit:run` invokes via `bash scripts/dev-prerun.sh` which doesn't require the exec bit.

### Permission bit

The script will be created with `chmod +x` for tidiness, but the `.replit:run` shell command explicitly invokes it via `bash scripts/dev-prerun.sh` so the bit is not load-bearing.

---

## 9. `server/config/env-registry.js` Additions

### 9a. APP_RUNTIME registration

Insert into the `=== Server ===` block, between `NODE_ENV` and `=== Database ===`:

```javascript
// 2026-05-13: APP_RUNTIME is the sanctioned environment-class enum (see doctrine
// comment at bottom of file). Replaces NODE_ENV as the runtime-topology signal.
APP_RUNTIME: {
  required: false,
  description: 'Runtime topology: workspace | deployment | test. Resolution at module load: explicit env var > derived from REPLIT_DEPLOYMENT === "1" → deployment > default "workspace". Set explicitly in .replit:run as APP_RUNTIME=workspace; test runner sets APP_RUNTIME=test. Resolution implemented in gateway-server.js.',
},
```

No static `default:` — the resolution lives in code; the registry description documents it.

### 9b. `NODE_ENV` description update (existing entry, lines 17-21)

```javascript
NODE_ENV: {
  required: false,
  default: 'development',
  description: 'Build-mode only (Vite/framework verbosity). NOT consumed by app logic at runtime — use APP_RUNTIME for runtime-topology decisions per the doctrine comment at the bottom of this file.',
},
```

### 9c. 14 newly-registered vars (from Phase 1 recon §5)

Grouped by existing registry sections:

**`=== Server ===` (add 4):**
- `APP_MODE` — Process topology: `mono` (default) | `split`. Read by `gateway-server.js:35`, `validate-env.js:94`.
- `MODE` — DEPRECATED — legacy alias for `APP_MODE`. Slated for removal in Phase 2 v2 deletion D3.
- `TRUST_PROXY_HOPS` — Express trust-proxy hop count for `req.ip`. Default `1`. Read by `gateway-server.js:94`.
- `EIDOLON_PORT` — Legacy SDK port (default 3102). Separate from gateway PORT. Read by `shared/ports.js`, `shared/config.js`, `diagnostic-identity.js`, `index.js` (orphaned), `tests/eidolon/`.

**`=== AI API Keys ===` (add 1):**
- `GOOGLE_AI_API_KEY` — DEPRECATED — use `GEMINI_API_KEY`. Slated for removal in Phase 2 v2 deletion D4.

**`=== External APIs ===` (add 2):**
- `OPENWEATHER_API_KEY` — OpenWeather API key. Warning if missing (validate-env.js:58).
- `GOOGLEAQ_API_KEY` — Google Air Quality API key. Warning if missing (validate-env.js:62).

**`=== Auth ===` (add 3):**
- `VECTO_AGENT_SECRET` — Bearer secret for agent/system auth endpoints. Hard error in `APP_RUNTIME === 'deployment'`.
- `REPLIT_DEVSERVER_INTERNAL_ID` — Dev-only fallback for `JWT_SECRET`. Auto-injected by Replit IDE; absent in deployment.
- `TOKEN_ENCRYPTION_KEY` — AES key for Uber OAuth token encryption. Required if any `UBER_*` var is set.

**`=== Uber Integration ===` (new section, 3 vars):**
- `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_REDIRECT_URI` — Uber OAuth credentials. All three required if any one is set.

**`=== Deployment ===` (add 1):**
- `DISABLE_SPAWN_AGENT` — When `'1'`, gateway does not spawn embedded agent. Used in workflow mode with standalone agent on port 43717.

**NOT registered** (going away with the wrapper):
- `FORCE_DEV` — wrapper-only escape hatch
- `SIMULATE` — wrapper-only tripwire (CARGO-CULT per Step A A1)
- `WORKER_ID` — zero readers outside wrapper

### 9d. Doctrine update (replaces current lines 253-255)

```javascript
// 2026-05-13: Doctrine update (Phase 2 v2 startup unification, full-lead-authorization).
// APP_RUNTIME (workspace|deployment|test) is the SOLE sanctioned environment-class enum
// for branching application behavior. Every other concern routes through a capability flag.
//
// Allowed in application code: branch on APP_RUNTIME for validator severity policy,
//   test-skip policy, and any true runtime-topology decision where workspace/deployment/
//   test differ structurally.
// Disallowed in application code: NODE_ENV reads (build-mode only, owned by Vite/framework);
//   ad-hoc REPLIT_DEPLOYMENT or REPL_ID reads for non-topology concerns; resurrecting
//   isProduction()/isDevelopment() helpers.
// Allowed in infrastructure code (server/config/*, gateway-server.js pre-main bootstrap):
//   REPLIT_DEPLOYMENT may be read at module load to drive APP_RUNTIME resolution or
//   env-loading-strategy selection (see load-env.js:138-149). Once APP_RUNTIME is
//   computed, application code uses APP_RUNTIME only.
//
// Capability flags kept: ENABLE_BACKGROUND_WORKER, CLOUD_RUN_AUTOSCALE, REPLIT_AUTOSCALE,
//   DISABLE_SPAWN_AGENT, FAST_BOOT, TRUST_PROXY_HOPS, AGENT_ENABLED. These remain the
//   right tool for "can this process do X here?" — APP_RUNTIME answers only "what
//   topology am I in?", which is a strictly narrower question.
//
// Historical: isProduction()/isDevelopment() were removed 2026-02-25 because they
//   conflated build-mode with runtime topology. APP_RUNTIME re-introduces that
//   distinction cleanly without the conflation.
```

---

## 10. Out of Manifesto Scope (Phase 3+ Deferred Items)

These items were surfaced during Phase 1 recon and Steps A+B+C archaeology but are explicitly deferred from Phase 2 v2 implementation. They are named here so they are tracked in writing rather than silently dropped.

| Item | Reference | Reason for deferral | Suggested Phase 3+ approach |
|---|---|---|---|
| `index.js` orphaned shadow server | Phase 1 recon §10, Step C §C2 (M9) | Zero codebase-internal callers verified, but external callers (deploy scripts, ops runbooks) not audited. Architect's Phase 1 scope statement explicitly defers the shadow-server question. | Phase 3 archaeology pass on `index.js` authorship + grep external deploy artifacts; then delete if confirmed unused. |
| `/agent` embedded-vs-standalone proxy split-brain | Step C §C3 (M10) | Agent topology decision is its own architectural concern. In workspace + deployment, the embedded gateway's proxy fallback to a non-running standalone returns `ECONNREFUSED` instead of `503 AGENT_DISABLED`. | Phase 3+ decide topology: (a) inline legacy routes into embedded version, OR (b) explicitly disable legacy surface in non-workflow environments. |
| `.env` / `.env.local` convention unification | Step C §C1 (M8) | Eliminating the duality (port `agent-server.js` + 7 scripts to `load-env.js`) is a separate concern. The duality is intentional structural-twin maintenance (per `.env` header comment), not scar tissue — but it is fragile. | Phase 3+ refactor: replace `import "dotenv/config"` in `agent-server.js` and the 7 scripts with `import { loadEnvironment } from './load-env.js'`; delete `.env`; promote `.env.local` as sole source. |
| `tests/eidolon/test-sdk-integration.js` | Step C §C4 footnote | Test predates the 2025-11-03 SDK-disabling commit (`312b252fc`). Likely dead, but jest's `tests/` glob still picks it up. | Phase 3+ dead-test sweep across `tests/`. |
| `CLOUD_RUN_AUTOSCALE` + `REPLIT_AUTOSCALE` consolidation | Phase 1 recon §8, Step B §B1 | Flag-consolidation specifics deferred per architect's Phase 1 scope. Both flags currently work; they are functionally indistinguishable downstream but signal autoscale from different providers. | Phase 3+ decide whether one unified `AUTOSCALE` flag (or `APP_RUNTIME=autoscale`) is preferable; if so, define migration path for any operator scripts that set the legacy flag names. |

---

## 11. Why This Is Minimum Viable

The wrapper at `scripts/start-replit.js` exists because 9 of its 10 defensive lines were introduced by the Replit Agent during a 5-day burst (Oct 30 – Nov 3, 2025) — each commit responding to a local symptom (port conflicts, env-propagation quirks, "cannot get" preview screens) with the most defensive local code possible. Melody's later 2026 commits patched bugs inside that defensive scaffolding but never asked whether the scaffolding itself was needed. Authorship-trailer archaeology (Step A M3, refined in Step B M5 and Step C M8) made that origin decisive: `Replit-Commit-Author: Agent` is a high-confidence cargo-cult signal; Melody-authored splits cleanly into intentional design, dismountable transitions, and bug-patches-without-architectural-question.

Of the 10 defensive ranges in the wrapper, only two preserve UX value that doesn't survive wrapper deletion automatically: port-5000 zombie cleanup (A7) and `client/dist` auto-rebuild (A8). Both migrate to `scripts/dev-prerun.sh` — a 12-line shell script invoked by `.replit:run` before `node gateway-server.js`. Everything else in the wrapper is dead (SIMULATE tripwire, WORKER_ID default, `isCloudRun=false` sentinel), redundant (PORT default, `.env` loader), or exists only because the wrapper exists (child-spawn, health-poll, signal forwarder).

The `NODE_ENV` mutation (A4) was the keystone of the wrapper's harm: by forcing `NODE_ENV='production'` in workspace, it made the validator and crash policy treat workspace as deployment — Phase 1 recon audit deviation #3. `APP_RUNTIME` replaces `NODE_ENV`-based branching with an explicit enum set at the shell level (workspace) or derived from `REPLIT_DEPLOYMENT` (deployment). No mutation, no inversion. Once the keystone is removed, the wrapper's reason for being dissolves — the architectural construct has no surviving justification.

This is the minimum viable startup contract because every line preserved is justified by archaeology, every line deleted is justified by archaeology, and every concern deferred (index.js, /agent topology, `.env` unification, eidolon test, autoscale flag consolidation) is named explicitly in §10 rather than silently dropped.

---

## Appendix: Step E Execution Order (Forward Reference Only)

When the Manifesto is approved, Step E implements it in dependency order. The exact order is determined at execution time, but the rough shape is:

1. Add `APP_RUNTIME` + 14 missing vars + doctrine to `env-registry.js`.
2. Update `validate-env.js`: NODE_ENV → APP_RUNTIME reads; drop EIDOLON_PORT/MODE/GOOGLE_AI_API_KEY clauses (with grep-verify); fix header comment path.
3. Update `gateway-server.js`: add `resolveAppRuntime()`; change `uncaughtException` to always-crash; drop NODE_ENV reads in bootstrap.
4. Update `package.json`: drop `start:replit` + `prestart:replit`; rewrite `start` as `node gateway-server.js`; rewrite `dev` as `APP_RUNTIME=workspace node gateway-server.js`.
5. Create `scripts/dev-prerun.sh` with the §8 reference implementation; chmod +x.
6. Update `.replit`: change workspace `run` (line 7) and workflow Project task 1 (lines 35-37) to the §2 target shell commands; deployment.run unchanged.
7. `git rm scripts/start-replit.js`.

Each step gets its own commit with the subject convention `2026-05-13 unification (step N): <concrete shape>` and a prose body explaining what changed and why, plus `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer. Verification trio runs per commit. If verification deviates from baseline, STOP and surface diagnosis — no papering over with retries.

The exact step numbering above intentionally differs from the original Phase 2 plan (which had Step 1 as registry edit, Step 8 as wrapper deletion) because the Manifesto reframes "register the 14 vars" as a single concern rather than the entire Step 1 scope. Final step boundaries get decided at the moment of execution, after Manifesto approval.
