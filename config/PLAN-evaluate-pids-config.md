# Plan: Evaluate PIDs & Config Files — Findings & Remediation

**Date:** 2026-04-09
**Status:** AWAITING APPROVAL
**Author:** Claude Code (Master Architect)
**Branch:** `claude/evaluate-pids-config-6SkIT`

---

## Objectives

Audit all assigned PIDs (process tracking) and configuration files for drift, duplication, corruption, and dead code. Propose targeted fixes.

---

## Summary of Findings

### A. PID Management — CLEAN (No action required)

| Location | Line | PID Purpose |
|----------|------|-------------|
| `gateway-server.js` | 67 | Gateway bootstrap startup |
| `index.js` | 8 | SDK server boot mark |
| `agent-server.js` | 155 | Agent diagnostic logs |
| `server/bootstrap/workers.js` | 117 | Strategy worker child process |
| `server/api/health/health.js` | 35 | Authenticated health endpoint |
| `scripts/diagnose.js` | 56 | Diagnostic script PID |

- Worker lifecycle is centralized in `gateway-server.js` (Phase 6 refactor)
- In-memory `children` Map in `workers.js` — no stale PID files
- Auto-restart capped at 10 consecutive failures with 5s backoff
- Graceful shutdown via `killAllChildren()` on SIGTERM/SIGINT
- Autoscale guard prevents embedded workers in scaled environments

**Verdict:** Architecture is sound. No remediation needed.

---

### B. Config Files — 3 Issues Found

#### Issue 1: CRITICAL — 3 Duplicate Policy JSON Pairs with Drift

The same policy files exist in two locations with different content:

| File | `config/` version | `server/config/` version | Drift |
|------|-------------------|--------------------------|-------|
| `agent-policy.json` | `web_fetch_20250910`, `max_uses: 5`, full headers | `web_fetch_20250305`, no `max_uses`, missing headers | YES |
| `assistant-policy.json` | `web_fetch_20250910`, `max_uses: 5`, full headers | `web_fetch_20250305`, no `max_uses`, missing headers | YES |
| `eidolon-policy.json` | `web_fetch_20250910`, `max_uses: 5`, full headers | `web_fetch_20250305`, no `max_uses`, missing headers | YES |

**Specific differences per pair:**

| Field | `config/` (newer) | `server/config/` (older) |
|-------|-------------------|--------------------------|
| `tools.available[1].type` | `web_fetch_20250910` | `web_fetch_20250305` |
| `tools.available[1].max_uses` | `5` | *(missing)* |
| `headers.anthropic-beta` | Includes `web-search-20250305` + `web-fetch-2025-09-10` | Missing both |

**Loading chain — BOTH paths are actively used:**
- `.env.local.example` → points to `config/` (intended source of truth)
- `assistant-proxy.ts:16` → defaults to `config/eidolon-policy.json`
- `policy-loader.js:8` → defaults to `server/config/assistant-policy.json`
- `config-manager.js:68-69` → lists `config/` then `server/config/` as fallback
- `enhanced-context-base.js:219-224` → reads ALL 6 files into context

**Rule 9 violation:** Duplicate logic = bug

#### Issue 2: CRITICAL — JSON Syntax Error in `config/eidolon-policy.json`

Line 66 contains a corrupted string:
```json
"web-fetch-2025-09-10"5",
```

The `5"` after the closing quote makes this **invalid JSON**. Additionally, line 68 is a duplicate entry of the same header value. This file will fail `JSON.parse()` at runtime.

Full corrupted section (lines 64-69):
```json
"anthropic-beta": [
  "interleaved-thinking-2025-05-14",
  "code-execution-2025-08-25",
  "web-search-20250305",
  "web-fetch-2025-09-10"5",        ← BROKEN
  "fine-grained-tool-streaming-2025-05-14",
  "web-fetch-2025-09-10"           ← DUPLICATE
]
```

#### Issue 3: LOW — Dead Code `client/vite.config.ts`

Line 18 explicitly states: `// NOTE: This config is NOT used - see root /vite.config.js`

The root `vite.config.js` is the authoritative build config. `client/vite.config.ts` is 2.5K of dead code.

---

## Proposed Remediation

### Fix 1: Consolidate Policy JSONs (Issue 1 + 2)

**Approach:** Make `config/` the single source of truth. Delete `server/config/` copies.

**Steps:**
1. Fix the JSON syntax error in `config/eidolon-policy.json` (line 66: remove `5"`, line 68: remove duplicate entry)
2. Delete `server/config/agent-policy.json`
3. Delete `server/config/assistant-policy.json`
4. Delete `server/config/eidolon-policy.json`
5. Update `policy-loader.js:8` default path: `'server/config/assistant-policy.json'` → `'config/assistant-policy.json'`
6. Update `config-manager.js:69` — remove `server/config/assistant-policy.json` from allowed list
7. Update `enhanced-context-base.js:222-224` — remove `server/config/` entries
8. Update `server/config/README.md` — remove references to deleted policy files

**Files affected:**
- `config/eidolon-policy.json` (fix syntax)
- `server/config/agent-policy.json` (delete)
- `server/config/assistant-policy.json` (delete)
- `server/config/eidolon-policy.json` (delete)
- `server/assistant/policy-loader.js` (update default path)
- `server/agent/config-manager.js` (update allowed list)
- `server/lib/ai/context/enhanced-context-base.js` (remove stale refs)
- `server/config/README.md` (update docs)
- `config/README.md` (mark as canonical)

### Fix 2: Remove Dead Vite Config (Issue 3)

**Steps:**
1. Delete `client/vite.config.ts`

**Files affected:**
- `client/vite.config.ts` (delete)

---

## Test Cases

### Fix 1 Tests
- [ ] `config/eidolon-policy.json` passes `JSON.parse()` without error
- [ ] `policy-loader.js` loads from `config/assistant-policy.json` successfully
- [ ] `config-manager.js` reads `config/assistant-policy.json` via `readConfigFile()`
- [ ] `enhanced-context-base.js` reads only `config/` policy files (no errors for missing `server/config/` files)
- [ ] `assistant-proxy.ts` loads `config/eidolon-policy.json` at startup
- [ ] No `require` or `import` references to `server/config/{agent,assistant,eidolon}-policy.json` remain
- [ ] Server starts without policy-related errors

### Fix 2 Tests
- [ ] `vite build` succeeds (root `vite.config.js` is unaffected)
- [ ] No imports reference `client/vite.config.ts`

---

## Risk Assessment

| Fix | Risk | Mitigation |
|-----|------|------------|
| Fix 1 | `server/config/` fallback chain breaks | All env vars already point to `config/`; `policy-loader.js` default updated |
| Fix 1 | Eidolon JSON fix changes runtime behavior | Syntax error currently prevents loading; fix enables correct behavior |
| Fix 2 | Build breaks | File is explicitly marked dead code; root config is authoritative |

---

## Approval Required

Per Rule 1: **Melody must confirm "All tests passed"** before implementation proceeds.

**Estimated scope:** 9 files modified, 3 files deleted, 1 file syntax-fixed.
