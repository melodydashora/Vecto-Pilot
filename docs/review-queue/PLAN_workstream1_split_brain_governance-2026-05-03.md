# PLAN — Workstream 1 — Split-Brain Governance Audit

**Created:** 2026-05-03
**Author:** Local Master Architect (drafted), Claude (verified + executed); Melody approved Path A "expand-and-execute" 2026-05-03
**Branch:** `feat/workstream1-governance-audit` (off `main` after Workstream 6 merge + Melody's cleanup commits)
**Related plans:** `PLAN_workstream6_step3_api_cache_enforcement-2026-05-03.md` (Step 3, surfaced the doctrine drift that motivated this audit)
**Status:** APPROVED 2026-05-03 — single atomic PR for execution.

---

## 1. Objective

Eliminate contradictory doctrine between `CLAUDE.md` and `GEMINI.md` so multi-agent collaboration on this repo cannot be misled by stale or contradicting rules. Specifically:

1. CLAUDE.md's Rule 2 falsely claims "109 sub-READMEs were deleted" — verified false (89+ sub-READMEs currently exist). The rule is reversed to align with reality and GEMINI.md's existing sync mandate.
2. GEMINI.md still treats the retired `docs/review-queue/pending.md` as live; it must be replaced with the canonical `claude_memory` active-rows query (per CLAUDE.md Rule 3, Rule 15).
3. GEMINI.md falsely states Dev and Prod are both Replit Helium; corrected to Dev=Helium, Prod=Neon serverless (per CLAUDE.md Rule 13 + `docs/architecture/audits/NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md`).
4. Seven other docs still cite `pending.md` as active — sweep them in the same PR so no agent reading any single file gets misled.
5. Add a structural lint (`scripts/check-standards.js`) that catches the next stale reference before merge — same idea as typecheck for code, but for doctrine.

## 2. Background

**Verified by Claude on 2026-05-03 before execution:**

| Claim | Verification | Outcome |
|---|---|---|
| Sub-READMEs do exist | `find server client shared migrations scripts tests -name README.md` → 89 hits | CLAUDE.md "deleted" claim is provably false; reverse it |
| Dev=Helium, Prod=Neon | Cross-checked CLAUDE.md Rule 13 + `NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md` audit | GEMINI.md "both Helium" is wrong, must align with CLAUDE.md |
| `pending.md` retired 2026-04-29 | Matches CLAUDE.md Rule 3 + Rule 12 row #3 + Rule 15 | Confirmed retired; sweep stale citations |
| 7 other doc citations of pending.md | Grep across `docs/` (excluding LESSONS_LEARNED.md and `docs/review-queue/README.md`) | All 7 confirmed; whitelist as below |

**Linkage to prior session:** the `source_model` schema-vs-doctrine drift discovered during Workstream 6 Step 3 is the same failure pattern. The `claude_memory` row #304 logged that drift as a follow-up; this audit completes the broader doctrine cleanup. The new lint (item 5 above) is the structural protection so this session is the LAST one that has to debug doctrine drift manually.

## 3. Approach (single atomic commit)

### 3.1 CLAUDE.md edits

**Rule 2 (Documentation Synchronization):** remove the "109 sub-READMEs deleted" claim. Replace the affected bullet with the GEMINI.md mandate, qualified per the verification above:

> Every modified folder that has a `README.md` MUST have it updated synchronously.

The "Canonical living docs" bullet stays (still accurate — these are root-level + `docs/` canon). The `pending.md` retirement note in this rule stays (correctly framed as historical). The "deleted sub-README" salvage bullet is removed (sub-READMEs aren't deleted).

**Rule 5 (Major Code Changes):** remove the trailing "Sub-READMEs no longer exist — see Rule 2" sentence. Replace with instruction to update the relevant `docs/` file or existing sub-README, per the new Rule 2 sync mandate.

### 3.2 GEMINI.md edits

**Phase 0 (Intent Synthesis):** the Context Ingestion list at line 6 currently mandates reading `docs/review-queue/pending.md`. Replace with the `claude_memory` active-rows query mandated by CLAUDE.md Rule 12 row #3 + Rule 15.

**Section 2 (Context Segregation), "Pending Verification":** currently directs verifying `pending.md` first. Replace with `claude_memory` active-rows verification.

**Section 3.A (Database & Environment):** "Dev and Prod are TWO SEPARATE Replit Helium instances" → "Dev is Replit Helium (local Postgres). Prod is Neon Serverless (SSL required)." Mirror CLAUDE.md Rule 13 wording exactly.

### 3.3 Seven-citation sweep

Replace each active reference to `pending.md` with the equivalent `claude_memory` instruction (or, where the original text was historical/snapshot context, mark it inline as historical with the retirement date). Per Melody's directive:

| File | Treatment |
|---|---|
| `docs/strategy-map-consolidation-plan.md:379` | Active workflow — replace with claude_memory |
| `docs/AI_PARTNERSHIP_PLAN.md` (lines 112, 169, 177, 247) | Active workflow — replace with claude_memory |
| `docs/DEAD_CODE_ANALYSIS.md:383` | Active workflow — replace with claude_memory |
| `docs/CHECKPOINT_AI_PARTNERSHIP.md:204` | Active workflow — replace with claude_memory |
| `docs/architecture/STANDARDS.md:236` | Active workflow — replace with claude_memory |
| `docs/architecture/DOCTRINE_SYNTHESIS.md` (lines 74, 89, 280, 320, 356) | Mixed — synthesis/audit context, mark historical inline |
| `docs/AUDIT_SYNTHESIS_2026-04.md:111` | Audit context — mark historical inline |

**Whitelist (left alone, explicitly historical):**
- `LESSONS_LEARNED.md` (history doc — preserves past mistakes)
- `docs/review-queue/README.md` (the retirement notice itself lives here)
- `docs/architecture/full-audit-2026-04-04.md` (timestamped audit snapshot)

### 3.4 Drift-prevention lint

Add a new check function in `scripts/check-standards.js` that greps for `pending.md` in the repo and fails CI when it appears outside the whitelist. Whitelist:
- `LESSONS_LEARNED.md`
- `docs/review-queue/README.md`
- `scripts/check-standards.js` (the lint file itself contains the regex)
- Any path under `.claude/` (session-bookkeeping)

Wire the check into the `runAllChecks` flow, expose it via `--check=pending-md-drift` for selective runs.

### 3.5 MASTER_ROADMAP.md

Mark the Workstream 1 "Split-Brain Governance" bullet as `[x]` (COMPLETED) with a one-line retro pointing at this PR.

### 3.6 claude_memory threading

Insert a new row at the end of execution:
- `parent_id = 304` (the row that flagged the original drift; maintains the session chain)
- `category = 'audit'`
- `status = 'resolved'`
- `title` lead with `Resolution:` per Rule 15 threading discipline
- `content` enumerates the files touched + the new lint, references this plan doc

## 4. Files Affected

| File | Change | Magnitude |
|---|---|---|
| `docs/review-queue/PLAN_workstream1_split_brain_governance-2026-05-03.md` | New plan doc (this file) | New |
| `CLAUDE.md` | Rule 2 + Rule 5 edits | ~5 lines |
| `GEMINI.md` | 3 edits (Phase 0, Context Segregation, Database) | ~5 lines |
| `docs/strategy-map-consolidation-plan.md` | 1 edit | 1 line |
| `docs/AI_PARTNERSHIP_PLAN.md` | 4 edits | ~6 lines |
| `docs/DEAD_CODE_ANALYSIS.md` | 1 edit | 1 line |
| `docs/CHECKPOINT_AI_PARTNERSHIP.md` | 1 edit | 1 line |
| `docs/architecture/STANDARDS.md` | 1 edit | 1 line |
| `docs/architecture/DOCTRINE_SYNTHESIS.md` | 5 edits | ~15 lines |
| `docs/AUDIT_SYNTHESIS_2026-04.md` | 1 edit | 1 line |
| `scripts/check-standards.js` | New check function + wired into runner | ~40 lines |
| `docs/MASTER_ROADMAP.md` | 1 edit | 1 line |

**No code/runtime changes. No schema changes. No migrations. Pure doctrine + tooling.**

## 5. Test Plan

- [x] Verification grep before execution — confirmed sub-READMEs exist, 7 active citations confirmed
- [ ] Verification grep after execution — `git grep "pending\.md"` outside whitelist returns zero hits
- [ ] `node scripts/check-standards.js --check=pending-md-drift` exits 0 after the sweep
- [ ] `node scripts/check-standards.js --check=pending-md-drift` would FAIL on the pre-sweep state (verified by temporarily reverting one citation, running, restoring)
- [ ] `npm run typecheck` clean (no code changes; safety net)
- [ ] PR diff review — no unintended sweep of historical refs (LESSONS_LEARNED.md untouched; full-audit-2026-04-04.md untouched)

## 6. Rollout & Risk

**Rollout:** single atomic commit on `feat/workstream1-governance-audit`, single PR for review, merge when approved. No migrations, no schema, no production deploy steps.

**Risk profile: Low.**
- Doc-only edits with no runtime behavior change.
- The lint is additive — it cannot block existing runs; it only fails on the pre-sweep state, which doesn't exist after this PR merges.
- Atomicity prevents the partial-state issue (CLAUDE.md saying "READMEs deleted" while GEMINI.md says "update synchronously"). Reviewers see all edits together.

**Rollback:** `git revert` the single commit. The lint can be deleted or its check function commented out without affecting other checks.

## 7. Out of Scope (deferred)

- **Code-comment refs to `briefing-service.js`** in `server/lib/briefing/{index,briefing-aggregator,event-schedule-validator}.js` and `server/lib/briefing/pipelines/*.js`. These are code provenance comments ("extracted from briefing-service.js"), not active doctrine. Different category. If they prove distracting they can be cleaned up in a follow-up commit.
- **`docs/architecture/full-audit-2026-04-04.md`** — timestamped audit snapshot, treated as historical per the whitelist.
- **`LESSONS_LEARNED.md`** — explicitly preserved per Melody's "don't rewrite history" directive.

## 8. Decisions Locked In (2026-05-03)

| # | Decision | Source |
|---|---|---|
| 1 | Path A (expand-and-execute) over deferred sweep | Melody approved 2026-05-03 |
| 2 | Exact Rule 2 text: "Every modified folder that has a README.md MUST have it updated synchronously." | Melody dictated |
| 3 | Single atomic commit / lock-step PR | Melody dictated |
| 4 | Whitelist for the lint = LESSONS_LEARNED.md + docs/review-queue/README.md + scripts/check-standards.js + .claude/ | Melody dictated |
| 5 | claude_memory row threads from #304 | Melody dictated ("maintaining our session chain") |

**Approval marker:** Melody — 2026-05-03 — "the local Master Architect formally approves Path A (Expand-and-execute). You are cleared to enter Phase 1 Execution."
