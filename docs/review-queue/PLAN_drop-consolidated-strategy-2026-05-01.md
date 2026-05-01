# PLAN — Drop `strategies.consolidated_strategy` column (Phase 3 Schema Fix)

> **Date:** 2026-05-01
> **Status:** APPROVED 2026-05-01 (Melody, "Please go ahead") — implementation in progress on branch `chore/drop-consolidated-strategy-2026-05-01`
> **Author:** Claude Code (Opus 4.7)
> **Doctrine:** Rule 1 (Plan before implement), Rule 13 (DB env awareness), Rule 16 (Melody is architect)
>
> **Revision log:**
> - 2026-05-01 (post-approval): Step E rewritten. Original draft used `psql "$PROD_DATABASE_URL"` to apply migration to prod, treating dev/prod migrations as two manual steps. That model was incorrect under modern Replit. The actual mechanism (per [Replit blog post on automated migrations](https://blog.replit.com/production-databases-automated-migrations) and the production-databases doc) is: at deploy time, Replit introspects dev + prod DB schemas, computes a diff, dry-runs the generated migration on a Neon branch as a preview deployment, and applies after user approval. Application code stays environment-agnostic — `DATABASE_URL` resolves per runtime context (dev = Helium, deployed = Neon). Step E now reflects this. The §10 prod-migration-timing question is obsolete.
> - 2026-05-01 (decisions locked): Defaults `1a / 2a / 3c / 4a` confirmed by Melody.

---

## 1. Objective

Drop the dead `consolidated_strategy` column from the `strategies` table. The column was the storage for the now-removed `STRATEGY_DAILY` AI role; the role was retired on 2026-04-27 and the doc-sweep on 2026-04-30 (`adb981cb`) cleaned its references from `docs/`. Code references and the column itself remained as forward-only follow-up — this is that follow-up.

## 2. Why now

- The doc-sweep that retired `STRATEGY_DAILY` mentions left a stale comment at `shared/schema.js:100` referencing the dead role. Comment is doctrine drift surfaced during PR-23 verification.
- Three dead-code surfaces (sub-READMEs, the column, an active SSE trigger that branches on the column) are accumulating mutual references; cleaning them together is cheaper than three separate sweeps.
- `claude_memory` row #265 (Prod-DB migrations applied to dev — prod application unverified) is partially closed by the same prod-deploy procedure this migration will use. Working through this PR re-exercises that procedure.

## 3. Investigation findings

### 3.1 Live database state (verified `2026-05-01` against dev Helium)

| Surface | Detail |
|---|---|
| Column | `strategies.consolidated_strategy text NULL` |
| Row population | **3 of 349 rows** non-null (0.86%) — historical residue, not in active write path |
| Trigger | `trg_strategy_ready_v2` (UPDATE) and `trg_strategy_ready_v2_insert` (INSERT) — `WHEN` clause has an `OR` branch on `consolidated_strategy IS NOT NULL` |
| Function | `notify_strategy_ready_v2()` (defined in `migrations/20260110_fix_strategy_now_notify.sql`) — body has a second `IF` block that `pg_notify`'s when `consolidated_strategy` becomes non-null |

**Critical:** dropping the column without first rewriting the trigger and function will cause the migration to fail at the `WHEN` clause re-validation. They must be rewritten **in the same transaction as the column drop**.

### 3.2 Live code references (production paths)

| File:Line | Operation | Risk on removal |
|---|---|---|
| `server/lib/ai/coach-dal.js:176` | Drizzle `SELECT consolidated_strategy` | **None** — pure read, remove the field from the select |
| `server/lib/ai/coach-dal.js:204` | `strategy_text: strat.consolidated_strategy \|\| strat.strategy_for_now \|\| null` | **None** — fallback collapses to `strategy_for_now \|\| null` |
| `server/lib/ai/coach-dal.js:206` | Returns `consolidated_strategy: strat.consolidated_strategy` to caller | **None if no consumer reads it** — grep across `client/`, `server/`, and `shared/` finds zero downstream readers of the returned `consolidated_strategy` field. Safe to remove. (Verified during plan write — see Step 5.) |
| `server/lib/ai/coach-dal.js:869` | Status branch: returns `'pending_consolidation'` if column null | **Logic dead-code** — branch becomes unreachable; remove it. The remaining ladder collapses to: `missing_snapshot \| pending_strategy \| pending_blocks \| ready` |
| `server/lib/ai/coach-dal.js:1006-1007` | Adds "AI-GENERATED DAILY STRATEGY" section to coach prompt | **Prompt regression risk** — the coach prompt loses this section. It's been emitting only when `consolidated_strategy` was non-null (3/349 rows ≈ 0.86% of the time). Net behavior change: in those 3 historic snapshots, the coach prompt was richer. New runs aren't affected because no new rows populate the column. **Decision point #2 below.** |
| `server/lib/ai/coach-dal.js:1188` | DATA ACCESS SUMMARY: `'Ready'` vs `'In Progress'` based on column | **Cosmetic** — collapses to `Ready/Pending` on `strategy_for_now` |
| `server/api/coach/schema.js:28` | Lists `consolidated_strategy` in `key_columns` metadata array | **None** — descriptive only; remove from array |
| `scripts/seed-dev.js:82` | `INSERT … consolidated_strategy: strategyText` in dev seed | **MUST be removed before column drops** — a seed run after the migration but before the code change would throw `column "consolidated_strategy" of relation "strategies" does not exist` |

### 3.3 Schema declaration

| File:Line | Item |
|---|---|
| `shared/schema.js:100` | `consolidated_strategy: text("consolidated_strategy"), // Daily 8-12hr strategy (STRATEGY_DAILY role, on-demand via Briefing tab)` |

### 3.4 Doctrine drift surfaced

CLAUDE.md Rule 2 (revised 2026-04-18) states: *"Sub-READMEs have been removed. 109 sub-READMEs were deleted."*

**Reality:** the following sub-READMEs still exist and reference `consolidated_strategy` — meaning either the deletion was incomplete or the doctrine claim is stale.

| File | Lines |
|---|---|
| `server/README.md` | 89 |
| `server/lib/ai/README.md` | 95 |
| `server/lib/strategy/README.md` | 92, 101, 102, 158, 202 |
| `server/lib/ai/providers/README.md` | 14, 54, 75, 89 |
| `server/api/strategy/README.md` | 79, 206, 215 |
| `server/validation/README.md` | 55, 58 |
| `client/src/types/README.md` | 39 |

**Decision point #3 below** — this PR can absorb their cleanup or defer it.

### 3.5 Top-level docs and references

| File | Lines | Action proposed |
|---|---|---|
| `WORKFLOW_FILE_LISTING.md` | 669, 1876 | Remove `consolidated_strategy` references |
| `docs/architecture/DB_SCHEMA.md` | 96 | Remove the row (already marked "unused") |
| `docs/architecture/ai-coach.md` | 80 | Remove from `strategies` key_columns list |
| `docs/architecture/ai-pipeline.md` | 59 | Remove from ASCII art table |
| `docs/architecture/database-schema.md` | 73, 86 | Remove rows |
| `docs/melswork/needs-updating/architecture/urgent/MISMATCHED.md` | 333 | Remove the row (already marked DEPRECATED) |

### 3.6 Frozen historical artifacts (DO NOT modify)

- `docs/architecture/audits/FRISCO_LOCK_DIAGNOSIS_2026-04-18.md:134` — timestamped audit
- `docs/reviewed-queue/FIX_PLAN_2026-02-01.md:145` — historical fix plan
- `docs/reviewed-queue/DOC_DISCREPANCIES_ARCHIVE.md` — archive
- `.merge-log-server-lib.md` — merge log
- `server/db/sql/2025-10-31_strategy_generic.sql` — original column-creation SQL
- `migrations/20260110_fix_strategy_now_notify.sql` — superseded but kept for history

## 4. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration fails because trigger references dropped column | High if naive `DROP COLUMN` | Migration aborts on Postgres | Atomic transaction: `DROP TRIGGER → CREATE FUNCTION (replace) → CREATE TRIGGER → DROP COLUMN`, all inside `BEGIN/COMMIT` |
| `seed-dev.js` runs against post-migration schema before code update | Medium | Dev seed throws | Apply code change before migration in deploy order; alternatively run migration in same atomic step as a `git pull && deploy` |
| Coach prompt regression (1006-1007 section removed) for 3 historic rows | Low | Cosmetic — those rows existed in a deprecated daily-strategy era | Acceptable per Phase 3 scope; preserve the 3 rows' `consolidated_strategy` content as a backup file if Melody wants paranoia (Decision #1) |
| Prod-Neon application drift from dev-Helium | Medium | Code on prod expects column not to exist; if migration didn't apply, code crashes | Per Rule 13: apply migration to prod *first*, then deploy code. Verify with `\d strategies` before deploy. |
| Sub-README not updated → grep noise / doctrine confusion | Low | Future sessions hit the stale text | Decision #3 — bundle or defer |

## 5. Decision points for Melody (Rule 16)

These are the questions where I need your call before writing code:

### Decision 1 — Data preservation for the 3 non-null rows

The 3 historic rows have non-null `consolidated_strategy` text. Options:

- **(a) Drop without preservation** — column is dead, those rows are residue from the deprecated daily-strategy era. Simplest. *Recommended.*
- **(b) Snapshot before drop** — write a one-shot SQL `COPY (SELECT id, snapshot_id, consolidated_strategy FROM strategies WHERE consolidated_strategy IS NOT NULL) TO '/tmp/dropped_consolidated_2026-05-01.csv'` and store output as `docs/architecture/audits/dropped_consolidated_strategy_backup_2026-05-01.csv`. Preserves text in case it's ever needed. Adds ~5min and one decision artifact to the PR.

### Decision 2 — Coach prompt section at `coach-dal.js:1006-1007`

When `consolidated_strategy` is non-null, the coach prompt currently includes:
```
=== AI-GENERATED DAILY STRATEGY (8-12hr) ===
<text>
```

After column drop, this section disappears entirely. Options:

- **(a) Remove the block** — the section is dead. *Recommended.*
- **(b) Repurpose as a `strategy_for_now`-only section** (rename the heading) — would cosmetically preserve the prompt structure but change the meaning of what's shown to the coach. Likely overkill for 3 historic rows.

### Decision 3 — Sub-README handling

`server/`, `server/lib/ai/`, `server/lib/strategy/`, `server/lib/ai/providers/`, `server/api/strategy/`, `server/validation/`, `client/src/types/` all still have `README.md` files referencing the dead column, despite Rule 2 claiming all sub-READMEs were deleted. Options:

- **(a) Bundle into this PR — update all sub-README references** (~17 line changes across 7 files). Doesn't reconcile Rule 2's "all deleted" claim.
- **(b) Bundle into this PR — delete those sub-READMEs entirely** (per Rule 2's stated direction). Larger diff but reconciles doctrine.
- **(c) Defer to a separate "doctrine drift reconciliation" PR** — keeps this PR atomic-by-purpose. Requires logging a `claude_memory` row.
- **(d) Update CLAUDE.md Rule 2 to say "most sub-READMEs deleted; the following were retained: …"** — accepts that the deletion was partial and codifies it. Could combine with (a) or (c).

**Recommended:** (c) — defer. Rationale: this PR's scope is "drop the column"; reconciling doctrine drift is a separate concern. A `claude_memory` row preserves the breadcrumb.

### Decision 4 — Migration scope (one file or two)

- **(a) Single migration `20260501_drop_consolidated_strategy.sql`** — atomic transaction handles trigger rewrite + column drop together. *Recommended.*
- **(b) Two migrations** — first rewrites trigger, second drops column. More steps in deploy, no actual benefit since they must apply together anyway.

## 6. Proposed approach (assuming defaults: 1a, 2a, 3c, 4a)

### Step A — Code changes (committed first, deployed first)

1. `shared/schema.js:100` — delete the column declaration line
2. `server/lib/ai/coach-dal.js` — surgical edits at lines 176, 204, 206, 869, 1006-1007, 1188 (remove all references; collapse status ladder; remove daily-strategy prompt section)
3. `server/api/coach/schema.js:28` — remove `consolidated_strategy` from `key_columns` array
4. `scripts/seed-dev.js:82` — remove the seed-write line
5. `WORKFLOW_FILE_LISTING.md`, `docs/architecture/DB_SCHEMA.md`, `docs/architecture/ai-coach.md`, `docs/architecture/ai-pipeline.md`, `docs/architecture/database-schema.md`, `docs/melswork/needs-updating/architecture/urgent/MISMATCHED.md` — strip references

### Step B — Migration (`migrations/20260501_drop_consolidated_strategy.sql`)

```sql
-- migrations/20260501_drop_consolidated_strategy.sql
-- Phase 3 Schema Fix: drop strategies.consolidated_strategy column
--
-- The STRATEGY_DAILY AI role was retired on 2026-04-27 (doc references
-- swept on 2026-04-30 in commit adb981cb). This column is its dead
-- storage surface. Trigger trg_strategy_ready_v2 references the column
-- in its WHEN clause and function body, so we rewrite both inside the
-- same transaction before dropping the column.

BEGIN;

-- 1) Drop existing triggers and the function (same names will be recreated)
DROP TRIGGER IF EXISTS trg_strategy_ready_v2 ON strategies;
DROP TRIGGER IF EXISTS trg_strategy_ready_v2_insert ON strategies;
DROP FUNCTION IF EXISTS notify_strategy_ready_v2();

-- 2) Recreate function — only fires for strategy_for_now (NOW strategy)
CREATE OR REPLACE FUNCTION notify_strategy_ready_v2()
RETURNS trigger AS $$
BEGIN
  IF (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL) THEN
    IF (TG_OP = 'INSERT' OR OLD.strategy_for_now IS NULL OR OLD.strategy_for_now = '') THEN
      PERFORM pg_notify('strategy_ready', json_build_object(
        'snapshot_id', NEW.snapshot_id,
        'user_id',     NEW.user_id,
        'status',      NEW.status,
        'type',        'now'
      )::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) Recreate triggers without the consolidated_strategy OR-branch
CREATE TRIGGER trg_strategy_ready_v2
AFTER UPDATE ON strategies
FOR EACH ROW
WHEN (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL)
EXECUTE FUNCTION notify_strategy_ready_v2();

CREATE TRIGGER trg_strategy_ready_v2_insert
AFTER INSERT ON strategies
FOR EACH ROW
WHEN (NEW.status IN ('ok', 'pending_blocks') AND NEW.strategy_for_now IS NOT NULL)
EXECUTE FUNCTION notify_strategy_ready_v2();

-- 4) Drop the column (3 non-null rows out of 349 will lose their text)
ALTER TABLE strategies DROP COLUMN IF EXISTS consolidated_strategy;

COMMIT;

COMMENT ON FUNCTION notify_strategy_ready_v2() IS
'Phase 3 (2026-05-01): Fires strategy_ready SSE only for NOW strategy
(strategy_for_now). The consolidated_strategy column was dropped together
with the deprecated STRATEGY_DAILY role. Supersedes 20260110_fix_strategy_now_notify.sql.';
```

**Why `TG_OP = 'INSERT'` guard inside the function:** the original function used `OLD.strategy_for_now IS NULL` to detect the transition. On INSERT there is no `OLD`, so we explicitly handle that branch. The original code dodged this by using two separate trigger definitions (one for UPDATE, one for INSERT) — I'm preserving that pattern but making the function robust to either context.

### Step C — Apply to dev

```bash
psql "$DATABASE_URL" -f migrations/20260501_drop_consolidated_strategy.sql
psql "$DATABASE_URL" -c "\d strategies"   # verify column gone
psql "$DATABASE_URL" -c "\df notify_strategy_ready_v2"   # verify function present
```

### Step D — Smoke test in dev

See §7 (Test cases).

### Step E — Push code, deploy, inspect Replit's preview

Replit's deploy pipeline introspects dev + prod DB schemas at publish time, computes a diff, and dry-runs the generated migration on a Neon DB branch as a preview deployment before any change touches real prod. (Source: [Replit blog post on automated migrations](https://blog.replit.com/production-databases-automated-migrations).)

1. Push the feature branch and open a PR (or merge into `main` per repo convention).
2. Trigger the publish/deploy from the Replit Publishing panel.
3. **Inspect the preview deployment carefully.** Replit shows the migration statements it generated from the diff. Verify:
   - `DROP COLUMN consolidated_strategy` appears.
   - **Open question:** does the diff also include the trigger rewrite (`DROP TRIGGER trg_strategy_ready_v2 …; CREATE FUNCTION notify_strategy_ready_v2 …; CREATE TRIGGER …;`)? Drizzle Kit's standard diff handles columns/tables/constraints/indexes but typically NOT triggers/functions. If Replit's diff is Drizzle-Kit-shaped, the column drop would *fail on the Neon branch* because the trigger still references the column — which is the safety net working.
   - **If preview fails on trigger dependency:** apply the migration SQL manually via the Replit Database tool's SQL runner against the **Production database** first (paste the contents of `migrations/20260501_drop_consolidated_strategy.sql`, run, verify `\d strategies` no longer shows the column). Then re-trigger the deploy — Replit's diff finds nothing to migrate (already done) and proceeds.
   - **If preview succeeds:** approve and continue.
4. Approve the deploy → migrations apply to real prod.

**No `PROD_DATABASE_URL`, no shell `psql` against prod.** The dev migration in Step C populates dev's schema; Replit's pipeline reconciles prod against it. Application code uses `process.env.DATABASE_URL` and is environment-agnostic — same code, same variable name, runtime-resolved per context.

## 7. Test cases (must all pass before "All tests passed")

### T1 — Migration applies cleanly to dev
- Run `psql "$DATABASE_URL" -f migrations/20260501_drop_consolidated_strategy.sql`
- **Expected:** zero errors; transaction commits

### T2 — Schema state verified
- `psql "$DATABASE_URL" -c "\d strategies"`
- **Expected:** no `consolidated_strategy` column listed; trigger names unchanged but `WHEN` clauses no longer mention `consolidated_strategy`

### T3 — `node --check` passes
- `node --check shared/schema.js`
- `node --check server/lib/ai/coach-dal.js`
- `node --check server/api/coach/schema.js`
- `node --check scripts/seed-dev.js`

### T4 — Tree-wide grep returns zero residual references in live code
- `grep -rn "consolidated_strategy\|consolidatedStrategy" --include="*.js" --include="*.ts" --include="*.tsx" --include="*.mjs" server/ shared/ client/ scripts/` — should return zero hits *outside* historical artifacts (audits, archives, merge logs)

### T5 — Gateway boots cleanly
- Run dev server: gateway starts without import errors or schema-validation throws

### T6 — Live strategy path: snapshot → strategy → SSE notify
- Create a snapshot (POST `/api/location/snapshot` with valid GPS), wait for strategy_for_now to populate
- **Expected:** trigger fires `pg_notify('strategy_ready', ...)`; SSE channel receives the `strategy_ready` event; client UI populates strategy section
- Verifies the rewritten trigger still fires for the NOW path (the only path that ever fired in production for the last several months)

### T7 — Coach context loads without `consolidated_strategy`
- Open Coach tab on a snapshot that has `strategy_for_now` populated
- **Expected:** Coach loads context, status is `'ready'` (not `'pending_consolidation'`); prompt builds without the dropped DAILY STRATEGY section; no console errors

### T8 — Dev seed runs cleanly
- `node scripts/seed-dev.js`
- **Expected:** clean seed insert without column-doesn't-exist error

## 8. Rollback strategy

| Surface | Reversibility | Procedure |
|---|---|---|
| Code commits | Fully reversible via `git revert` | Standard revert; no data implications |
| Migration | **NOT cleanly reversible without data restoration** | Postgres does not store dropped column data. To revert: re-add column (`ALTER TABLE strategies ADD COLUMN consolidated_strategy text`), restore the 3 rows from the optional backup CSV (Decision #1). The trigger rewrite is symmetric and can be reverted by re-applying the original `20260110_fix_strategy_now_notify.sql`. |

**Rollback decision:** Once applied to prod, this is forward-only. The 3 historic rows' text is unrecoverable unless Decision #1 was option (b).

## 9. Doctrine references

- **Rule 1** (Plan before implement) — this document satisfies the planning requirement; no code lands until Melody approves.
- **Rule 2** (Doc sync, sub-READMEs deleted) — this PR surfaces drift; Decision #3 chooses what to do about it.
- **Rule 4** (Doc currency) — `shared/schema.js:100` comment drift will be resolved by the column drop itself.
- **Rule 9** (All findings high priority) — the trigger dependency is a blocker, not a "nice to have."
- **Rule 13** (DB env awareness) — Step E spells out the prod-then-code order.
- **Rule 15** (Use `claude_memory`) — once Melody approves, log a row to track in-progress status; flip to `resolved` after prod application.
- **Rule 16** (Melody is architect) — four explicit decision points are above; I will not pick defaults without confirmation.

## 10. Open questions — resolved

1. ~~**Approve defaults?**~~ **CONFIRMED 2026-05-01:** Melody approved defaults `1a, 2a, 3c, 4a`.
2. ~~**Branch strategy.**~~ **CONFIRMED:** feature branch `chore/drop-consolidated-strategy-2026-05-01` (matches `chore/ghost-buster-2026-04-30` precedent). Branch created.
3. ~~**Prod migration timing.**~~ **OBSOLETE 2026-05-01:** the `PROD_DATABASE_URL` shell-psql model is not how Replit handles prod migrations. Replaced by deploy-time diff (see Revision log + Step E).
4. ~~**Sub-README defer.**~~ **CONFIRMED:** write the `claude_memory` row immediately as part of this implementation (logged when sub-README references are intentionally left untouched).

---

**Implementation in progress.** Code changes follow §6 Step A; dev-side migration follows Step C; T1–T8 from §7 will be reported back. No prod-touching action until Melody's "All tests passed" sign-off.
