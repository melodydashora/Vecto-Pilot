# Cleanup Plan: Legacy Replit Agent Environment Code

**Created:** 2026-02-25
**Author:** Claude Code (Master Architect)
**Status:** COMPLETE (all phases verified 2026-02-25)
**Priority:** HIGH (Rule 9 — all findings are high priority)

---

## Background

Replit Agents built an over-engineered environment configuration system during early development. They:
1. Didn't understand Replit's native `DATABASE_URL` auto-swap mechanism
2. Planned a multi-mode deployment architecture (`mono/split/worker`) that was never adopted
3. Created duplicate env loading, validation, and GCP credential reconstruction across multiple files
4. Left behind firefighting scripts and dead imports

This cleanup removes dead code, consolidates duplicates, and simplifies the boot chain — while preserving every piece of functionality that's actually used.

---

## Objectives

1. **Eliminate dead code** — remove files/imports that serve no purpose
2. **Consolidate duplicates** — one place for env loading, one for validation, one for GCP credentials
3. **Simplify boot chain** — stop loading mono-mode.env 3 times
4. **Fix active bugs** — undefined `sdk` reference, simulation mode race condition
5. **Zero functionality loss** — every working feature must remain working
6. **Update documentation** — all affected READMEs and architecture docs

---

## Phase 1: Safe Removals (Zero Risk)

These files/code have no active callers and can be deleted with zero impact.

### 1A. Remove `server/scripts/db-doctor.js`
- **Why:** 41-line diagnostic that checks for a `documents` table that doesn't exist. Superseded by `GET /api/diagnostic/db-info` endpoint in gateway-server.js.
- **Risk:** None — never imported, only runnable manually.
- **Files affected:** `server/scripts/db-doctor.js` (delete)

### 1B. Remove `agent-ai-config.js` + dead import
- **Why:** Exports `GATEWAY_CONFIG`, `EIDOLON_CONFIG`, `ASSISTANT_CONFIG`, `AGENT_AI_CONFIG` — none are used anywhere. `gateway-server.js:104` imports `GATEWAY_CONFIG` but never references it after import.
- **Risk:** None — import is a no-op.
- **Files affected:**
  - `agent-ai-config.js` (delete)
  - `gateway-server.js:104` (remove dead import line)

### 1C. Remove `start-mono.sh`
- **Why:** 87-line script that is a strict subset of `start.sh`. Both load mono-mode.env, start gateway, start worker. `start.sh` adds dev/prod/clean modes.
- **Risk:** None — not referenced by `.replit` or any automation. `start.sh` is the canonical shell entry point.
- **Files affected:** `start-mono.sh` (delete)

---

## Phase 2: Bug Fixes in `start-replit.js`

These are real bugs, not just cleanup.

### 2A. Fix undefined `sdk` reference
- **Location:** `scripts/start-replit.js:306-307`
- **Code:** `if (typeof sdk !== 'undefined' && sdk) sdk.kill();`
- **Bug:** `sdk` is never declared. The `typeof` check prevents a ReferenceError, but this is dead cleanup code referencing a removed SDK process.
- **Fix:** Remove both lines (306-307) from SIGTERM and SIGINT handlers.

### 2B. Fix simulation mode race condition
- **Location:** `scripts/start-replit.js:54`
- **Code:** `process.exit(0);` runs immediately after spawning child process
- **Bug:** `process.exit(0)` fires before the child process event handlers (exit/error on lines 38-45) can resolve. The child may be killed mid-execution.
- **Fix:** Remove the `process.exit(0)` on line 54. Add a guard (e.g., early return or `else` block) to prevent normal boot code from running when `SIMULATE === '1'`. The existing `child.on('exit')` handler already calls `process.exit()`.

---

## Phase 3: Consolidate Validation

### 3A. Merge `validate-strategy-env.js` into `validate-env.js`
- **Why:** `validate-strategy-env.js` is only called in dev mode from `start-replit.js:137`. Its STRATEGY_* checks should run in ALL environments.
- **Approach:**
  1. Move the model-to-API-key validation logic into `validateEnvironment()` in `validate-env.js`
  2. Add STRATEGY_* to the existing check flow (they have defaults in env-registry.js, so they're non-fatal warnings)
  3. Remove `server/config/validate-strategy-env.js`
  4. Update `scripts/start-replit.js` to remove the import
- **Files affected:**
  - `server/config/validate-env.js` (add strategy validation)
  - `server/config/validate-strategy-env.js` (delete)
  - `scripts/start-replit.js` (remove import + call)
  - `server/config/README.md` (update)

---

## Phase 4: Simplify Environment Loading

### 4A. Remove DEPLOY_MODE contract from `load-env.js`
- **Why:** The `env/` directory was never created. `DEPLOY_MODE` is never set. The entire "load shared.env → load mode-specific.env" cascade (lines 196-230) is dead code that always falls through to the mono-mode.env fallback.
- **Approach:**
  1. Remove the `env/shared.env` + `env/{mode}.env` loading (lines 196-230)
  2. Remove `validateEnvContract()` function — its checks are for deployment patterns that don't exist
  3. Keep the Replit deployment detection (line 164, 174-183) — that's legitimate
  4. Keep the mono-mode.env fallback (lines 185-194) — that's actually used
  5. Keep GCP credential reconstruction (lines 95-153) — that's legitimate
  6. Keep `ensureGoogleCloudProject()` (lines 148-153) — that's legitimate
- **Result:** `loadEnvironment()` becomes ~80 lines instead of ~237 lines
- **Files affected:**
  - `server/config/load-env.js` (simplify)

### 4B. Remove duplicate env loading in `start-replit.js`
- **Why:** `start-replit.js` has its own 40-line `loadEnvFile()` function (lines 58-96) that duplicates `load-env.js`. Then it spawns gateway-server.js which calls `loadEnvironment()` again. Combined with `.replit` sourcing mono-mode.env via shell, env files get loaded **3 times**.
- **Approach:**
  1. Remove the `loadEnvFile()` function from `start-replit.js`
  2. Remove the `.env` and `mono-mode.env` load calls (lines 114, 117)
  3. Gateway's `loadEnvironment()` already handles all env loading correctly
  4. The `.replit` shell source (`set -a && . ./mono-mode.env && set +a`) provides the baseline — gateway validates
- **Files affected:**
  - `scripts/start-replit.js` (remove duplicate function + calls)

### 4C. Remove duplicate GCP reconstruction from `start.sh`
- **Why:** `start.sh:53-77` reconstructs GCP credentials with an inline Node.js script. `load-env.js:95-138` does the exact same thing. Since `start.sh` calls `gateway-server.js` which calls `loadEnvironment()`, the reconstruction happens twice.
- **Approach:** Remove lines 53-83 from `start.sh`. `loadEnvironment()` in gateway handles this.
- **Files affected:**
  - `start.sh` (remove GCP reconstruction block)

---

## Phase 5: Documentation Updates

### Files to update after all changes:
| Document | Update Needed |
|----------|---------------|
| `server/config/README.md` | Remove validate-strategy-env.js reference, update load-env.js description |
| `docs/architecture/environment.md` | Simplify env loader description, remove DEPLOY_MODE references |
| `docs/architecture/database-environments.md` | Update legacy artifacts table (mark completed) |
| `LESSONS_LEARNED.md` | Add entry about triple env loading and Replit Agent over-engineering |
| `docs/review-queue/pending.md` | Clear items related to these changes |

---

## Files Affected — Complete List

| File | Action | Lines Changed |
|------|--------|---------------|
| `server/scripts/db-doctor.js` | DELETE | -41 |
| `agent-ai-config.js` | DELETE | -45 |
| `start-mono.sh` | DELETE | -87 |
| `server/config/validate-strategy-env.js` | DELETE | -89 |
| `gateway-server.js` | EDIT (remove dead import) | -3 |
| `scripts/start-replit.js` | EDIT (bugs + duplicate removal) | -50 |
| `server/config/load-env.js` | EDIT (simplify) | -80 |
| `server/config/validate-env.js` | EDIT (add strategy validation) | +25 |
| `start.sh` | EDIT (remove GCP duplicate) | -30 |
| `server/config/README.md` | EDIT (update docs) | ~10 |
| `docs/architecture/environment.md` | EDIT (update docs) | ~15 |
| **Net change** | | **~-350 lines** |

---

## Test Cases

### Pre-Implementation Verification
- [ ] `node gateway-server.js` starts successfully in workspace (dev mode)
- [ ] `/api/health/` returns 200
- [ ] `/api/diagnostic/db-info` returns correct database info
- [ ] Strategy generation works (TRIAD pipeline completes)
- [ ] AI Coach chat works (Gemini responds)

### Post-Implementation Verification
- [ ] `node gateway-server.js` starts successfully (same behavior as before)
- [ ] `/api/health/` returns 200
- [ ] `/api/diagnostic/db-info` returns correct database info
- [ ] Strategy generation works (TRIAD pipeline completes)
- [ ] AI Coach chat works (Gemini responds)
- [ ] GCP credentials reconstruct correctly (check /tmp/gcp-credentials.json exists)
- [ ] Environment validation catches missing DATABASE_URL (test by unsetting)
- [ ] Strategy model warnings print when API keys mismatch models
- [ ] `start.sh` starts the app successfully
- [ ] `start.sh dev` starts in development mode
- [ ] `start.sh clean` clears port and starts

### Regression Guards
- [ ] No 500 errors in `/api/blocks-fast` (full TRIAD run)
- [ ] No console errors mentioning `agent-ai-config`, `db-doctor`, `validate-strategy-env`, or `DEPLOY_MODE`
- [ ] Worker process starts and connects (if ENABLE_BACKGROUND_WORKER=true)

---

## Execution Order

1. Phase 1 (safe removals) — can be done as a single commit
2. Phase 2 (bug fixes) — separate commit for traceability
3. Phase 3 (consolidate validation) — requires testing
4. Phase 4 (simplify env loading) — requires testing
5. Phase 5 (documentation) — after all code changes verified

Each phase is independently reversible via git revert.

---

## What We Are NOT Changing

| Item | Reason to Keep |
|------|----------------|
| `connection-manager.js` | 57P01 handling is production-critical |
| `db-client.js` | LISTEN/NOTIFY real-time is production-critical |
| `env-registry.js` | Clean registry pattern, used by getEnv() |
| `scripts/db-detox.js` | Useful manual maintenance utility |
| `.env_override` | **DELETED** (2026-04-05) — contained stale Neon credentials |
| `strategy-generator.js` | Active worker entry point |
| `server/bootstrap/workers.js` | Active worker lifecycle management |
| `mono-mode.env` | Dev env file (simplify later, but not in this cleanup) |
