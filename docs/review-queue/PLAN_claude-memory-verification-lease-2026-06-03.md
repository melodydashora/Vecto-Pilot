# PLAN — claude_memory Verification Lease (substrate-bound verification)

**Date:** 2026-06-03
**Author:** Claude Code (Opus 4.8, 1M) — at Melody's direction
**Status:** PLAN — awaiting Melody's design approval. NO schema/code landed yet (Rule 1, Rule 16).
**Branch:** `claude/memory-table-architecture-3YN9c`
**Relates to:** PR #34 (D-110), CLAUDE.md Rule 15, `docs/superpowers/specs/2026-04-29-threading-claude-memory-followups.md`, `migrations/20260429_claude_memory_antecedent_trigger.sql`

---

## 0. Provenance of this plan (the argument that produced it)

This is the resolution of a multi-turn architecture dialogue (2026-06-03) about why the
`claude_memory` table beats grepping a no-memory repo, and where it's fragile. The chain:

1. **Claim:** the table works because it records *decisions, rejected alternatives, and deliberate
   absences* — the class grep is structurally blind to (a decision NOT to do something leaves no
   string to match). It gives Claude **citable out-of-band authority to push back** on vibe-coding
   that would reintroduce killed work (live proof: D-110, `event-sync-job.js`).
2. **Pushback (Melody):** without a receipt layer it's a *confident-wrong amplifier* — a false
   "lesson" becomes next-session ground truth. The KAIROS compaction-invisibility problem reproduced
   in-stack.
3. **Counter:** it's not "no receipts" — *provenance* shipped (`source`, `Antecedent:` line,
   `parent_id`, `status='disputed'`, newest-wins). What's missing is *verification*. And unlike
   KAIROS it sits on a **persistent, falsifiable substrate** (the code is still there; `related_files`
   names what to re-read), so a wrong row is *recoverable*, not *invisible*.
4. **Residue (Melody):** two limits survive — (a) **the substrate drifts under the receipt**: a
   "verified" stamp expires silently the moment the referenced code changes; (b) **recoverable ≠
   recovered**: the floor only arms if something re-checks, and the table's whole purpose is to *not*
   re-derive. Proposed fix: bind verification to substrate *state* (store a hash), and demote
   verified→asserted when the hash drifts — a *lease*, not a stamp.
5. **Counter to the mechanism:** a Postgres trigger **cannot fire on substrate change** — the DB
   can't observe the filesystem/git. So "trigger on substrate change" must be either a git/CI hook
   (high standing cost, scans whole corpus per commit) or a **read-time lazy check** (≈0 standing
   cost, fires exactly at the consume-decision). Lazy-read dominates at low-to-moderate churn. Also:
   a whole-file hash **over-invalidates** (thrashes on hot files); the binding unit must be scoped to
   the claim's predicate (line range / symbol), which is the real cost center.

**This plan implements the lazy, scope-bound version.** It turns verification from a permanent stamp
into a **lease** that is *checked at read time against a scoped content hash*, and surfaces a loud
`stale` badge when the substrate has moved — re-routing residue (b) from *silent + unbounded* to
*loud + bounded*, consistent with the repo's existing soft-trigger / NO-SILENT-FAILURES doctrine.

---

## 1. Objectives

1. **Distinguish a durable fact from a prior guess at read time.** A consumer (primarily Claude Code
   doing pushback) must be able to tell `verified-and-substrate-unchanged` from
   `verified-once-against-code-that's-gone` from `merely-asserted`.
2. **Bind verification to substrate state, scoped to the claim's predicate** — not the whole file —
   so unrelated edits don't thrash the lease.
3. **Zero standing cost.** No background scanner, no git hook firing over the whole corpus on every
   push. Freshness is computed lazily, only when a row is actually read.
4. **Respect the DB↔filesystem observability boundary.** The DB never pretends to see the substrate;
   the freshness check lives in application/CLI code that *can* read the working tree.
5. **Degrade honestly where the source tree is absent** (bare deployment): return `unknown`, never a
   false `fresh`.
6. **Backward compatible.** Existing rows default to `asserted`; nothing about today's reads breaks.

### Non-goals (explicitly out of scope)
- Forcing re-derivation (would defeat the table's reason to exist — residue (b) is *routed*, not closed).
- Auto-correcting stale rows (a stale badge demands human/agent triage; it does not rewrite content).
- Symbol-level AST scoping in v1 (line-range scoping ships first; symbol scoping is a future iteration if line-ranges prove too brittle).
- Prod migration (dev only this cycle, Rule 13).

---

## 2. Design

### 2.1 Schema additions to `claude_memory` (`shared/schema.js`)

Four columns, all nullable/defaulted (backward compatible):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `verification` | text | `'asserted'` | `'asserted'` (claimed, not checked) \| `'verified'` (checked against substrate at `verified_at`) \| `'disputed'` (human/agent flagged wrong). Orthogonal to `status`. |
| `verification_targets` | jsonb | `'[]'` | Array of scoped substrate bindings: `[{ path, line_start, line_end, content_sha }]`. The hash is over **only the referenced line range**, not the whole file. |
| `verified_at` | timestamptz | `NULL` | When the verification was performed. |
| `verified_at_commit` | text | `NULL` | Repo `HEAD` sha at verification time (context for "which version was this checked against"). |

- `content_sha` = `sha256` of the **raw bytes of lines `[line_start, line_end]`** of `path` (1-indexed, inclusive). Raw bytes (no whitespace normalization) to avoid false-fresh.
- Optional index: `idx_claude_memory_verification on (verification)` for "show me all unverified high/critical rows" sweeps.

`verification` is **stored as the author's claim**; `stale` is *never stored* — it is **derived at read time** by recomputing `content_sha` and comparing. (A row is `verified` in the DB; a reader computes whether that verification is currently *fresh* or *stale*.) This keeps writes truthful and avoids write-on-read.

### 2.2 Shared helper — `server/lib/memory/verify-substrate.js` (NEW)

Pure functions, no DB or HTTP coupling, reused by both the API and the CLI:

```
computeTargetSha({ path, line_start, line_end }) -> { content_sha } | { missing: true }
   // reads working-tree file, slices the line range, sha256 of raw bytes.
   // returns { missing: true } if file absent or range out of bounds.

freshnessFor(row) -> 'fresh' | 'stale' | 'n/a' | 'unknown'
   // 'n/a'     : verification !== 'verified' (asserted/disputed rows have no lease)
   // 'unknown' : source tree not available (bare deployment) — never claims fresh
   // 'fresh'   : every target's recomputed content_sha === stored content_sha
   // 'stale'   : any target drifted or went missing; include which targets in detail
```

Source-tree availability is detected once (e.g. presence of the repo root / a sentinel file). In the
Replit workspace and Claude Code's container the tree is present; in a bare Cloud Run image it may
not be — there the helper returns `unknown` and the feature no-ops safely.

### 2.3 Read path — surface freshness, don't store it

- **CLI (primary consumer — Claude Code's psql workflow): `scripts/memory-verify.mjs` (NEW)**
  - `node scripts/memory-verify.mjs --active --priority high,critical` → prints active high/critical
    rows with a `freshness` column. This is what a session runs at start (Rule 12) to see which
    "verified" lessons have gone stale since they were last checked.
  - `node scripts/memory-verify.mjs --id N` → detail incl. which targets drifted.
- **API: `server/api/memory/index.js` GET handlers**
  - For each returned row, attach a derived `freshness` field via `freshnessFor(row)` **iff** the
    source tree is available; otherwise `unknown`. Derived only — not persisted.

### 2.4 Write path — recording a verification

- **API:** extend `PATCH /api/memory/:id` (already exists) to accept `verification`,
  `verification_targets`, `verified_at`, `verified_at_commit`. When a caller sets
  `verification='verified'` it MUST supply ≥1 `verification_targets` with computed `content_sha`
  (validated 400 otherwise — a verified claim with nothing to check against is a lie).
- **CLI:** `node scripts/memory-verify.mjs --verify N --targets "path:start-end,..."` computes the
  hashes from the working tree and PATCHes the row. This is how Claude Code stamps a lesson it just
  re-derived from code.

### 2.5 Trigger extension (soft, `RAISE NOTICE` only) — extend `claude_memory_antecedent_check`

Add a second nudge to the existing function (keep it one soft trigger, same philosophy):

```
IF NEW.priority IN ('high','critical')
   AND NEW.verification = 'asserted'
   AND (NEW.verification_targets IS NULL OR NEW.verification_targets = '[]'::jsonb)
THEN
  RAISE NOTICE 'claude_memory: high/critical row written as asserted with no verification_targets. Consider verifying against substrate — see scripts/memory-verify.mjs.';
END IF;
```

Soft, never blocks (same rationale as the 2026-04-29 antecedent trigger §10.2): false-positives on
genuinely-unverifiable rows (pure design decisions with no code to point at) must not break writes.

### 2.6 Why lazy-read, not the proposed substrate-change trigger (recorded rationale)

A DB trigger fires on DB writes; editing `event-sync-job.js` writes nothing to `claude_memory`, so
"demote on substrate change" cannot be a DB trigger. The alternatives are a git/CI hook (scans the
whole corpus on every commit — high standing cost, and thrashes on hot files) vs. read-time lazy
check (cost only when a row is consumed, fires exactly at the trust-decision). Lazy-read's break-even
churn rate is ≈0 because you pay only when you'd otherwise have trusted a possibly-stale row. This is
the disposition this plan implements. (If a future need arises for *push* notification of staleness
without a read, a CI sweep can be layered on top reusing the same `verify-substrate.js` helper.)

---

## 3. Files affected

| Action | Path | Purpose |
|---|---|---|
| Modify | `shared/schema.js` | +4 columns on `claudeMemory`, optional `verification` index |
| New | `migrations/20260603_claude_memory_verification_lease.sql` | `ALTER TABLE ADD COLUMN` ×4; `CREATE OR REPLACE FUNCTION` to extend the existing trigger |
| New | `server/lib/memory/verify-substrate.js` | `computeTargetSha`, `freshnessFor` (pure, shared) |
| New | `server/lib/memory/README.md` | Sub-README for the new dir (Rule 2) |
| Modify | `server/api/memory/index.js` | GET attaches derived `freshness`; PATCH accepts verification fields + validates verified⇒targets |
| New | `scripts/memory-verify.mjs` | CLI: list-with-freshness, detail, and `--verify` stamping |
| New | `.claude/skills/verifying-claude-memory-claims/SKILL.md` | Teaches *when* to set `verified` vs `asserted` and how to scope targets (sibling to the threading skill) |
| Modify | `CLAUDE.md` (Rule 15) | Document the verification lease + the canonical `memory-verify.mjs` start-of-session sweep |
| Modify | `docs/superpowers/specs/2026-04-29-threading-claude-memory-followups.md` | Cross-ref the new sibling skill |
| Modify | `docs/DOC_DISCREPANCIES.md` | Resolve/annotate as the lease lands (verification gap was the open finding) |
| Update | `scripts/`, `migrations/` sub-READMEs if present (Rule 2) | Keep folder docs in sync |

---

## 4. Test cases (Rule 1 — required before implementation approval)

**Unit — `verify-substrate.js`:**
1. **Hash stability** — verified row, target range unchanged → `fresh`.
2. **Drift detection** — edit a line *inside* a target range → `stale`, detail names the target.
3. **Granularity / no-thrash** — edit a line in the *same file but outside* the target range → **still `fresh`** (this is the test that proves whole-file hashing was the wrong unit).
4. **Missing target** — file deleted or range now out of bounds → `stale` with `missing` reason.
5. **asserted row** → `freshnessFor` returns `n/a` (no lease).
6. **No source tree** (simulate absent working tree) → `unknown`, no throw, never `fresh`.

**Trigger:**
7. High-priority `asserted` row with empty `verification_targets` → emits `NOTICE`.
8. `verified` row with targets, or `normal`-priority asserted row → silent.
9. Existing antecedent-check behavior (the 2026-04-29 cases) still fires correctly (regression).

**API / CLI:**
10. `PATCH` setting `verification='verified'` with no targets → **400** (verified-without-receipt rejected).
11. `PATCH` with valid targets → row stored; subsequent GET returns `freshness: 'fresh'`.
12. Edit substrate, GET again → `freshness: 'stale'` (derived, DB row unchanged — confirms no write-on-read).
13. `memory-verify.mjs --active --priority high,critical` → freshness column matches API.

**Backward compatibility:**
14. Pre-existing rows (NULL/default verification columns) → load fine, `freshness: 'n/a'`, no read breaks.

---

## 5. Rollout

1. Land plan approval (this doc) — Melody.
2. Implement on the branch; run the §4 suite; report results.
3. **Apply migration to DEV only** (`$DATABASE_URL` in workspace). Prod deferred to Melody's cadence (Rule 13). **NOTE:** prod `claude_memory` still lacks the 2026-04-29 antecedent trigger ("prod migration pending"); this lease migration extends that same function, so the two prod migrations should ship together.
4. Update PR #34 (or open a follow-up PR) with the implementation.

---

## 6. Open valuation calls for Melody (Rule 16 — architect decides)

1. **Scope unit default:** line-range (v1 proposal) vs. symbol/AST range vs. an extracted snippet hash. Line-range is cheapest and good enough if claims usually cite a tight span; symbol-range is sturdier against line renumbering but costs a parser. **Recommend line-range v1, revisit if renumber-churn causes false `stale`.**
2. **Write-back demotion:** keep `stale` purely derived (proposal) vs. also persist a `verification='disputed'` demotion when a reader observes drift. Derived-only is simpler and truthful; persisted demotion makes staleness visible to non-checking consumers but adds write-on-read. **Recommend derived-only v1.**
3. **Is the lease worth its write-cost at all?** Depends on your substrate churn rate. The lazy-read design has ≈0 standing cost, so it earns its keep even at modest churn — but the *write-time* cost (scoping + hashing a target every time you stamp `verified`) is non-zero discipline load. If most load-bearing memory rows are design decisions with no single code predicate to point at, the lease helps less than expected. **This is the call only you can make** — same shape as the WBS valuation question.

---

## 7. What this does and does not solve (honest ceiling)

- **Solves residue (a) — silent expiry:** a verified stamp can no longer rot silently; the moment its scoped substrate moves, any reader sees `stale`. Verification becomes a lease.
- **Routes residue (b) — recoverable ≠ recovered:** it does **not** force re-derivation (that would defeat the table). It converts the liability from *silent + unbounded* (a rotten row looks fine forever) to *loud + bounded* (a stale-badged row demands triage when relied upon). Routing, not elimination — the same ceiling the repo already accepts everywhere via soft triggers and FAIL-HARD/NO-SILENT-FAILURES.
- **Does not** prevent a wrong verification at write time (a bad read of code can still be hashed and stamped). It guarantees only that the stamp *expires* when the code moves — narrowing the window in which a confident-wrong `verified` row can mislead, and pointing the next reader at exactly what to re-check.
