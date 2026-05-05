# DUPLICATE_FILENAMES_AUDIT.md — Repo-Wide Duplicate-Name Risk Map

**File:** `.code_based_rules/code_to_requirements/Pipeline_Updated/Master Pipeline/DUPLICATE_FILENAMES_AUDIT.md`
**Author:** Claude (at Melody's direction, post-deletion of `/server/api/coach/`)
**Date written:** 2026-05-04
**Working tree branch:** `feat/coach-handsfree-2026-05-04` @ `acedd54f`
**Trigger:** Melody asked "go through the code base and see why we might be having some issues, check file names for duplicate file names, and see which one it might start with and causes problems."
**Companion to:** `MASTER_COACH_PIPELINE.md` (this is the repo-wide generalization of §13 — the dead-folder doctrine).

**Doctrine:** Per Rule 16, this document maps duplicates and flags risk; it does **not** propose deletions or refactors. Each `❓ DECIDE` row is a Melody-decision pending. Each `✅ SAFE` row is a confirmed-legitimate pattern. The anti-junk rule from `MASTER_COACH_PIPELINE.md §15` applies here too — when a row resolves, flip status, never delete.

---

## 0. Why File Order Matters in Replit (Recap)

Replit runs on Linux. On Linux, Node.js's `fs.readdir` uses `scandir(3)` with `alphasort` — **directory entries come back alphabetically sorted**. Bash globbing (`*`) is alphabetical per POSIX. Express's `fs.readdirSync` enumerations match. AI agents (Claude Code, Replit Agent, Gemini) walking the filetree see the alphabetically-earliest path **first**.

This means: **two folders or files with the same name, where one is dead/stale, are not just duplicate junk — they are silent traps for AI tooling and any auto-discovery code.** The alphabetically-earlier one gets matched first.

Source: [Node.js Issue #3232](https://github.com/nodejs/node/issues/3232).

---

## 1. Method

```bash
find . \( -path ./node_modules -o -path ./.git -o -path ./.local -o -path ./client/dist
         -o -path ./.cache -o -path ./.pythonlibs -o -path ./test-results -o ... \) -prune
   -o -type f \( -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o ... \) -print
   | awk -F/ '{print $NF" "$0}' | sort | awk '{count[$1]++; ...}'
```

Result: **30 distinct duplicate basenames** in production source (excluding `node_modules`, `dist`, `.git`, `.local/skills/artifacts/` skill scaffolding templates, and other generated/vendored trees).

---

## 2. The Real Find: A Second Dead Parallel Folder

After deleting `/server/api/coach/` (Master Pipeline §13), this audit found **another parallel-fork dead folder**: `/server/assistant/`. Same pattern, same alphabetical-first risk, **same kind of silent junk**.

### 2.1 The `agent/` vs `assistant/` vs `eidolon/` trio

Three top-level folders under `server/` with overlapping names and overlapping filenames:

| Folder | Status | Evidence |
|---|---|---|
| `server/agent/` | ✅ **LIVE** | Mounted via `gateway-server.js` → `bootstrap/routes.js:142-151` (`mountAgent` from `agent/embed.js`); `chat.js:16` imports `from '../../agent/enhanced-context.js'`; also imported by `server/lib/subagents/event-verifier.js` and `server/jobs/change-analyzer-job.js` |
| `server/eidolon/` | ✅ **LIVE** | `eidolon/memory/pg.js` is imported by 5 files (`lib/ai/context/enhanced-context-base.js`, `agent/thread-context.js`, `agent/routes.js`, `agent/context-awareness.js`, `assistant/thread-context.js`); `eidolon/index.ts` exports `core/code-map.js`, `core/memory-store.js`, `core/context-awareness.js`, `core/memory-enhanced.js` |
| `server/assistant/` | ✅ **DELETED 2026-05-04 (was 💀 DEAD)** | **Zero non-self importers.** The only "external" references are TWO **commented-out** export lines in `eidolon/index.ts:17-18` (with the inline comment "Assistant system (commented out - files don't exist)" — but the files DO exist, in `server/assistant/`). `assistant/routes.js` is **not mounted** in `bootstrap/routes.js` or `gateway-server.js`. |

### 2.2 Files inside the dead `server/assistant/` folder

```
server/assistant/
  enhanced-context.js   36 lines  — identity-scoped wrapper (IDENTITY="assistant")
  policy-loader.js      41 lines  — `loadAssistantPolicy()` only called by assistant/routes.js (also dead)
  policy-middleware.js  (?)       — only "imported" by commented-out line in eidolon/index.ts:17
  routes.js             (?)       — defines `/context`, `/search`, `/analyze` endpoints — NOT mounted
  thread-context.js    139 lines  — identity-scoped wrapper
  README.md             (?)       — claims "AI assistant proxy layer providing enhanced context, internet search, and workspace analysis"
```

**Total: ~6 files, ~250-400 lines.** Less than `/server/api/coach/`'s 1,034 dead lines, but the same shape.

**Why this is the same kind of trap as `/server/api/coach/` was:**
- Alphabetical order: `agent < assistant < eidolon`. AI tools walking `server/` see `assistant/` between the two live folders.
- Filenames overlap: `enhanced-context.js`, `thread-context.js`, `routes.js`, `policy-loader.js` all exist in `assistant/` AND in at least one live folder.
- A grep for "policy-loader" returns both `assistant/policy-loader.js` (dead) AND `eidolon/policy-loader.js` (live). Without verifying mount state, an AI can edit the wrong one and introduce a bug that won't surface because the dead file is never executed.

❓ DECIDE — see §6.

---

## 3. Full Duplicate Inventory (production source only, `.local/skills/artifacts/` excluded)

### 3.1 ✅ SAFE — Legitimate per-folder convention

These duplicates follow recognizable conventions and are not AI-trap risks at the same level. Listed here for completeness so future audits don't re-flag them.

| Basename × count | Pattern | Why it's safe |
|---|---|---|
| `index.js` × 30 | One per Express sub-router folder | Standard Node convention; importers always use the parent folder name (`from './api/auth/'` resolves to `index.js`). Risk is low because the path disambiguates. |
| `index.ts` × 4 | `client/src/constants/`, `client/src/pages/auth/`, `server/agent/`, `server/eidolon/` | Same convention as `index.js`. The two `server/` ones are different domains. |
| `auth.js` × 3 | `server/api/auth/auth.js` (route) / `server/lib/auth.js` (lib utilities) / `server/middleware/auth.js` (Express middleware) | **3-tier convention** — route, lib, middleware. Each layer has a distinct caller. |
| `validate.js` × 2 | `server/api/rideshare-coach/validate.js` (Coach action validation, Zod) / `server/middleware/validate.js` (generic Express validator) | Different domains; clear path disambiguation. |
| `schema.js` × 2 | `server/api/rideshare-coach/schema.js` (Coach metadata for prompt) / `shared/schema.js` (Drizzle ORM schema) | Different domains. |
| `health.js` × 2 | `server/api/health/health.js` (route handler) / `server/bootstrap/health.js` (boot probe) | Different concerns. |
| `venue-intelligence.js` × 2 | `server/api/venue/venue-intelligence.js` (186 lines, route) imports from `server/lib/venue/venue-intelligence.js` (1,051 lines, lib) | **Route-vs-lib convention.** Route is a thin wrapper. |
| `briefing.js` × 2 | `server/api/briefing/briefing.js` (route) / `server/lib/ai/providers/briefing.js` (Legacy Adapter — see §5.5 caveat) | Route-vs-lib convention, but the lib file is labeled "Legacy Adapter" — see §5.5 |
| `Callback.tsx` × 2 | `client/src/pages/auth/google/Callback.tsx` / `client/src/pages/auth/uber/Callback.tsx` | Per-OAuth-provider convention. |
| `location.ts` × 2 | `client/src/_future/user-settings/location.ts` (parked WIP) / `shared/types/location.ts` (shared types) | `_future/` prefix is the parked-WIP convention; clear signal. |

### 3.2 ⚠️ PARALLEL — Identity-scoped wrappers (same name, different purpose)

These are **the agent/assistant/eidolon trio's** duplicates. Each file is a wrapper around `lib/ai/context/enhanced-context-base.js` with a different `IDENTITY` and `MEMORY_TABLE` (e.g., agent → `agent_memory`, assistant → `assistant_memory`). Architecturally they're "skins"; a single shared base + per-identity facade. Not duplicate logic — duplicate filenames.

| Basename × count | Live? | Notes |
|---|---|---|
| `enhanced-context.js` × 3 | agent ✅, eidolon ✅, **assistant 💀** | `agent/enhanced-context.js` (36 lines) and `assistant/enhanced-context.js` (36 lines) are the same shape with different IDENTITY constants. `eidolon/enhanced-context.js` (92 lines) is a different and larger implementation. Assistant version is unreachable. |
| `thread-context.js` × 2 | agent ✅, **assistant 💀** | `agent/thread-context.js` (488 lines, big) and `assistant/thread-context.js` (139 lines, thin) — different sizes and content. Assistant version is unreachable. |
| `routes.js` × 3 | agent ✅, bootstrap ✅, **assistant 💀** | `agent/routes.js` is mounted via `agent/embed.js`. `bootstrap/routes.js` is the central route-wiring file (different concept entirely — not an Express Router). `assistant/routes.js` is not mounted anywhere. |
| `policy-loader.js` × 2 | eidolon ✅, **assistant 💀** | `eidolon/policy-loader.js` (57 lines) is used internally by eidolon. `assistant/policy-loader.js` (41 lines) only called by `assistant/routes.js` (also dead). |
| `policy-middleware.js` × 2 | eidolon ✅, **assistant 💀** | Only "external reference" to assistant version is the **commented-out** line in `eidolon/index.ts:17`. |

**Risk:** AI tool searches for "enhanced-context.js" without specifying path → 3 hits. Without verifying which is mounted, the AI could edit the dead `assistant/enhanced-context.js` and the change would have no effect, while a future session debugging the symptom would assume the change was applied. **Same trap as the deleted `/server/api/coach/`.**

### 3.3 Reference: `.local/skills/artifacts/` is NOT a problem

The first scan returned dozens of `client/src/components/ui/*.tsx` duplicates — `button.tsx`, `dialog.tsx`, `tooltip.tsx`, etc. **All of those are inside `.local/skills/artifacts/{mockup-sandbox,react-vite,slides,video-js,expo,automation}/`** which is Claude Code skill scaffolding (template projects). Not project source. Excluded from the analysis.

---

## 4. Alphabetical-Order Risk Ranking

**The full ranked list of duplicate basenames by alphabetical-first risk** (which one comes first in `ls`/`fs.readdir` order). High-risk = alphabetically-earlier path is dead/stale and an AI would land on it first.

| Basename | Alphabetically first (Linux/Replit) | Status of first | Risk |
|---|---|---|---|
| `enhanced-context.js` | `server/agent/enhanced-context.js` | ✅ live | LOW — first match is correct |
| `thread-context.js` | `server/agent/thread-context.js` | ✅ live | LOW — first match is correct |
| `routes.js` | `server/agent/routes.js` | ✅ live (under `agent/embed.js` mount) | LOW |
| `policy-loader.js` | `server/assistant/policy-loader.js` | 💀 **DEAD** | **HIGH** — first match is dead; AI lands here before `eidolon/policy-loader.js` |
| `policy-middleware.js` | `server/assistant/policy-middleware.js` | 💀 **DEAD** | **HIGH** — same |
| `validate.js` | `server/api/rideshare-coach/validate.js` | ✅ live | LOW |
| `schema.js` | `server/api/rideshare-coach/schema.js` | ✅ live | LOW (other is `shared/schema.js`, clearly distinct domain) |
| `auth.js` | `server/api/auth/auth.js` | ✅ live (route) | LOW |
| `health.js` | `server/api/health/health.js` | ✅ live (route) | LOW |
| `venue-intelligence.js` | `server/api/venue/venue-intelligence.js` | ✅ live (route, thin wrapper) | LOW — first hit is the wrapper, second is the lib it imports |
| `briefing.js` | `server/api/briefing/briefing.js` | ✅ live (route) | MEDIUM — sibling `lib/ai/providers/briefing.js` is labeled "Legacy Adapter" |
| `index.js` | `./index.js` (root) | ✅ live (entry) | LOW |
| `index.ts` | `client/src/constants/index.ts` | ✅ live | LOW |
| `Callback.tsx` | `client/src/pages/auth/google/Callback.tsx` | ✅ live | LOW |
| `location.ts` | `client/src/_future/user-settings/location.ts` | parked | LOW (visible `_future/` prefix is a clear "WIP" signal) |

**Two HIGH-risk findings:** both `policy-loader.js` and `policy-middleware.js` have the alphabetically-first instance dead. An AI tool that walks `server/` alphabetically and grep-matches these names hits the dead `assistant/` version first.

---

## 5. Cases Worth a Second Look (not rising to HIGH risk, but worth noting)

### 5.1 `briefing.js` "Legacy Adapter" comment

`server/lib/ai/providers/briefing.js` line 3: `// BRIEFING PROVIDER - Legacy Adapter`. The word "Legacy" suggests this file may be a deprecation candidate. Verify whether it's still imported by anything live, and whether the route at `server/api/briefing/briefing.js` would still work without it.

### 5.2 `eidolon/index.ts:17-18` commented-out exports

```ts
// Assistant system (commented out - files don't exist)
// export { default as unifiedAssistant } from '../assistant/unified-assistant';
// export { default as memoryRouter } from '../assistant/memory-router';
```

The comment says "files don't exist" but `server/assistant/` clearly does exist (the dead folder). Either:
- The comment was written before the assistant/ folder was created (stale comment)
- Or the specific files referenced (`unified-assistant`, `memory-router`) never existed but other files in `assistant/` did

Either way, the commented-out exports are dead text + the folder they reference is dead code. Removing both together is the natural pairing.

### 5.3 `client/src/_future/user-settings/location.ts`

The `_future/` prefix is the convention for "parked WIP." Verify whether this is actively being worked on or has been parked indefinitely. If parked > 90 days, candidate for removal or a `git mv` to a clearer "shelved-" prefix.

### 5.4 `assistant/README.md`

Documents an API surface (`/assistant/context`, `/assistant/search`, `/assistant/analyze`) that is **not mounted anywhere**. This is "doc points at dead code" — same flavor as the `RIDESHARE_COACH.md §9.5` two-state-vs-three-state contradiction in Master Pipeline §7.

### 5.5 `agent/index.ts` exists but the active mount point is `agent/embed.js`

`bootstrap/routes.js:142-143` mounts via `embed.js`, not `index.ts`. Worth confirming which is the canonical entry point for the agent module — having both is mild ambiguity.

---

## 6. ✅ DECIDED 2026-05-04 — `/server/assistant/` Dead Folder (D1 executed)

**Outcome:** Melody chose **D1 — Delete the folder.** Executed. `/server/assistant/` deleted.

### Original context:
**Pattern matches the `/server/api/coach/` situation exactly:** unmounted, only-self-imported (excluding commented-out lines), filenames collide with live folders, alphabetically-earlier than the live alternative.

**Three options (mirroring Master Pipeline §13):**

| Option | What | Cost | Notes |
|---|---|---|---|
| **D1 — Delete the folder** | `rm -rf server/assistant/` (~6 files). Update `eidolon/index.ts:17-18` to remove the dead commented-out exports. | Clean. Reversible via git. Same shape as the `/server/api/coach/` deletion. | Recommended-style precedent: the prior deletion on this branch. |
| **D2 — Add a `_DEPRECATED` marker** | Rename to `server/_assistant_DEPRECATED_2026-05-04/` or add a top-of-file deprecation header. | Documents the dead state without removing it. | Useful if you want git-blame archaeology to remain easy. |
| **D3 — Investigate first** | `git log --follow --oneline server/assistant/` to confirm no in-flight branch depends on it. | ~10 seconds. | Belt-and-suspenders. |

**Pre-run history check (saves you a step if you pick D1):**
```bash
$ git log --oneline -- server/assistant/
```
_(Did NOT pre-run this one — Melody hadn't decided. Ready on request.)_

Per Rule 16: this is a Melody decision. Audit flags it; doesn't act.

---

## 7. ✅ DECIDED 2026-05-04 — Lower-priority Cleanups

Each of the below is a separate Melody decision. Each row is independent; pick zero or any combination.

| # | Cleanup | Where | Cost |
|---|---|---|---|
| C1 | Decide fate of `server/lib/ai/providers/briefing.js` (Legacy Adapter) | ✅ KEPT: Verified active imports in `strategy.js`, `blocks-fast.js`, and `diagnostics-strategy.js` | Small |
| C2 | Resolve `eidolon/index.ts:17-18` commented-out exports + stale "files don't exist" comment | ✅ DONE: Removed dead exports along with D1 execution | Small (paired with D1) |
| C3 | Decide whether `client/src/_future/user-settings/location.ts` should stay parked or be unparked/removed | ✅ DONE: Deleted (file was parked since Dec 2025 and unused) | Small |
| C4 | Reconcile `assistant/README.md` (or delete it with the folder under D1) | ✅ DONE: Deleted with D1 | None if D1 picked; small otherwise |
| C5 | Confirm `agent/index.ts` vs `agent/embed.js` canonical entry-point — leave both, or move logic together | ✅ DONE: Left both, but added inline comment to `agent/index.ts` marking it as a standalone alternative while `embed.js` is the canonical active mount point | Small |

---

## 8. What This Audit Changed (For the Record)

| Action | Result |
|---|---|
| Scanned all production source for duplicate basenames | 30 distinct duplicate names found |
| Excluded `.local/skills/artifacts/` template scaffolding | Removed dozens of UI-component duplicate noise |
| Categorized: SAFE / PARALLEL / HIGH-RISK | §3 |
| Verified every "PARALLEL" duplicate's live status via `grep` for importers | §2.1, §3.2 |
| Identified `/server/assistant/` as a dead parallel folder (the second one this session) | §2 |
| Confirmed `policy-loader.js` and `policy-middleware.js` as the two HIGH-RISK alphabetical-first dead entries | §4 |
| Documented but did NOT act on findings | Per Rule 16 |

**Files modified by this audit:** zero in production code. One new file created: this audit.

---

## 9. Cross-References

| File | Purpose |
|---|---|
| `MASTER_COACH_PIPELINE.md` (sibling) | Coach-pipeline master plan; §13 is the precedent for §6 of this audit. |
| `coach_finalizing/coach_full_pipeline.md` | Frozen historical Coach baseline at `274cadc5`. |
| `bootstrap/routes.js:142-151` | The actual mount of `server/agent/`. |
| `eidolon/index.ts:17-18` | The commented-out dead-export references to the dead `assistant/` folder. |
| `LESSONS_LEARNED.md` (root) | Per Rule 12, doc-currency lessons live here. The "alphabetical-first AI trap" from this audit + the Coach folder deletion is a candidate lesson — flagged for Melody to add or not. |
| `CLAUDE.md` "ABSOLUTE PRECISION" rule | The same exact-match-over-similarity discipline used for GPS coords, place_ids, and event hashes applies to folder paths: don't let two paths name the same concept. |

---

## 10. Update Log

| Date | What changed | By |
|---|---|---|
| 2026-05-04 | Document created. Repo-wide duplicate-name scan complete. Found `/server/assistant/` as a second dead parallel folder (after `/server/api/coach/` was deleted earlier in the session). Two HIGH-risk alphabetical-first dead entries identified (`policy-loader.js`, `policy-middleware.js` in `assistant/`). | Claude (at Melody's direction) |
| _(future)_ | _Append a row each time §6 / §7 status flips. Never delete prior rows._ | _(implementer)_ |
