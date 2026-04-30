# PLAN — Retire `pending.md` and Migrate to `claude_memory`

**Date:** 2026-04-29
**Author:** Claude Opus 4.7 (1M context)
**Status:** DRAFT — awaiting Melody approval

---

## Objective

Retire the `docs/review-queue/` Markdown tracking surface (pending.md, history file, dated daily logs, ai-coach-enhancements.md, README.md). Migrate the genuinely-still-open items to `claude_memory` rows. Update `CLAUDE.md` Rule 12 row #3 to point future sessions at `claude_memory` queries instead of file reads.

Rationale: per the L1/L2/L3 architecture discussion (this session's tangent), `pending.md` was conflating event-log semantics with snapshot-doc semantics, and the Markdown surface required manual sweep discipline that was hit-and-miss. `claude_memory` provides queryability, status hygiene (active/resolved/superseded), parent_id threading, and survives session boundaries — all the structural enforcement that Markdown can't.

## Verification done (in prior session messages)

13 dated entries in `pending.md` verified against git/schema/file-content sources of truth. Summary:
- 11 entries are ✅ DONE (or DONE+EXCEEDED) at code+schema layer
- 1 entry is ✅ RESOLVED BY OBSOLESCENCE (today's substrate swap made the comment correct)
- 1 entry is ⚠️ SUPERSEDED (2026-04-04 audit replaced by 2026-04-27 audit)
- 1 entry is ❓ AMBIGUOUS (Analyze-Offer 2026-03-29; needs Melody decision)
- Multiple entries have prod-migration sub-items unverifiable from dev shell

Open feature-completeness flag (Entries 6/7/9 schema-vs-UI gap) is HELD per Melody's instruction, not migrated in this plan.

## Step 1: Insert 3 `claude_memory` rows BEFORE any deletion

### Row A — Prod-DB migration checklist

```
title:       Prod-DB migrations applied to dev — prod application unverified (as of 2026-04-29)
category:    audit
priority:    high
status:      active
session_id:  pending-md-retirement-2026-04-29
source:      claude-code
tags:        ["prod-migration", "schema", "deployment-checklist"]
content:
  Schema migrations applied to dev DB but unverified on prod (verify before treating
  as globally applied; dev/prod are isolated per Rule 13):

  1. app_feedback.user_id (uuid) — migration 20260416_app_feedback_user_link.sql
  2. ranking_candidates.beyond_deadhead, distance_from_home_mi —
     20260416_ranking_candidates_deadhead.sql
  3. driver_profiles.fuel_economy_mpg, earnings_goal_daily, shift_hours_target,
     max_deadhead_mi — 20260416_driver_preference_columns.sql
  4. claude_memory table — created via direct SQL on dev (2026-04-14)
  5. discovered_events.schema_version (integer NOT NULL DEFAULT 1) — direct SQL on dev
     (2026-04-14, Issue B)
  6. venue_capacity seed (top-50 DFW venues populated) — 20260416_venue_capacity_seed.sql
  7. claude_memory antecedent-check trigger — 20260429_claude_memory_antecedent_trigger.sql
     (applied to dev 2026-04-29)
  8. discovered_traffic table — pending Plan G (2026-04-29)

  Fallback paths exist for some columns (driver_profiles via DRIVER_PREF_DEFAULTS;
  graceful PG 42703 catch in consolidator.js:861) so prod doesn't crash, but feature
  parity differs between dev and prod until each migration runs.

  Action: Melody to confirm or apply each migration on prod, then flip this row to
  resolved (or split into per-migration rows if granularity needed).
```

### Row B — Analyze-Offer fate decision

```
title:       Decide fate: 2026-03-29 Analyze-Offer tier overhaul — 30 days pending, no clean ship commit
category:    audit
priority:    normal
status:      active
session_id:  pending-md-retirement-2026-04-29
source:      claude-code
tags:        ["analyze-offer", "decision-needed"]
related_files: ["server/api/hooks/analyze-offer.js"]
content:
  pending.md (now retired) tracked a 2026-03-29 entry: "Analyze-Offer Decision Logic
  Overhaul — Tier-aware decision rules, product type normalization, Phase 1/2 prompt
  rewrite. Three-tier system (share/standard/premium) with tier-specific prompts and
  deterministic fallback. Share short-circuits before AI call." Status was AWAITING
  TEST APPROVAL.

  Verification: no commit found that matches the tier-system spec. Either shipped
  silently under a different name, abandoned, or stalled. 30 days past entry date.

  Melody confirmed (2026-04-29 session): "I use Analyze Offer more than any other
  feature." Open work-stream pivot: Siri Shortcut + in-app preferences for iPhone
  users to invoke Analyze Offer with their saved preferences.

  Action: Investigate analyze-offer.js current state OR pivot the original 2026-03-29
  spec into the iOS Shortcut work-stream. Decision needed.
```

### Row C — pending.md retirement doctrine

```
title:       pending.md retired 2026-04-29 — claude_memory is now the canonical 'unfinished work' surface
category:    doctrine-candidate
priority:    high
status:      active
session_id:  pending-md-retirement-2026-04-29
source:      claude-code
tags:        ["doctrine", "process", "claude-memory", "L1-events"]
content:
  As of 2026-04-29, the Markdown tracking surface in docs/review-queue/ is retired.
  Future sessions: do NOT look for unfinished work in:
    - docs/review-queue/pending.md (deleted)
    - docs/review-queue/pending-history-2026-02.md (deleted)
    - docs/review-queue/2026-02-*.md daily logs (deleted)
    - docs/review-queue/ai-coach-enhancements.md (deleted, was self-marked legacy)

  Use instead:
    psql "$DATABASE_URL" -c "SELECT id, category, priority, status, title, created_at
    FROM claude_memory WHERE status = 'active' ORDER BY id DESC LIMIT 30;"

  Implementation plans (PLAN_*.md) remain in docs/review-queue/ as L3 snapshot docs
  per the L1/L2/L3 architecture discussion in the 2026-04-29 session. They are NOT
  part of the retired tracking layer.

  CLAUDE.md Rule 12 row #3 has been updated to reflect this retirement.

  Rationale: Markdown queue rotted because manual sweep discipline was hit-and-miss.
  claude_memory provides structural enforcement (status flips, parent_id threading,
  queryable categories) that Markdown can't. The L1 events layer is now load-bearing
  for cross-session memory, not a supplement to it.
```

## Step 2: Delete files

| File | Action |
|---|---|
| `docs/review-queue/pending.md` | DELETE |
| `docs/review-queue/pending-history-2026-02.md` | DELETE |
| `docs/review-queue/2026-02-17.md` | DELETE |
| `docs/review-queue/2026-02-18.md` | DELETE |
| `docs/review-queue/2026-02-19.md` | DELETE |
| `docs/review-queue/2026-02-25.md` | DELETE |
| `docs/review-queue/2026-02-26.md` | DELETE |
| `docs/review-queue/ai-coach-enhancements.md` | DELETE (self-marked LEGACY, consolidated into RIDESHARE_COACH.md §6-7 on 2026-04-14) |
| `docs/review-queue/README.md` | REPLACE — short stub: "This directory holds active implementation plans (PLAN_*.md). The change-analyzer + pending.md tracking system was retired on 2026-04-29 in favor of `claude_memory`. See CLAUDE.md Rule 12 row #3." |

**Kept:**
- `docs/review-queue/PLAN_briefing-fixes-2026-04-04.md` (active plan)
- `docs/review-queue/PLAN_events-pipeline-verification-2026-04-28.md` (active plan)
- `docs/review-queue/PLAN_pr-review-master-fixes-2026-04-28.md` (active plan)
- `docs/review-queue/PLAN_phase-f-restore-2026-04-29.md` (this session, new)
- `docs/review-queue/PLAN_phase-g-discovered-traffic-2026-04-29.md` (this session, new)
- `docs/review-queue/PLAN_tts-playback-speed-2026-04-29.md` (this session, new)
- `docs/review-queue/PLAN_coach-naming-sweep-2026-04-29.md` (this session, new)
- `docs/review-queue/PLAN_pending-md-retirement-2026-04-29.md` (this plan)

## Step 3: Update `CLAUDE.md` Rule 12

Current row #3:
```
| 3 | `docs/review-queue/pending.md` | Unfinished doc updates from prior sessions |
```

Replacement row #3:
```
| 3 | `claude_memory` active rows (canonical "unfinished work" surface) | Query: `psql "$DATABASE_URL" -c "SELECT ... WHERE status='active' ORDER BY id DESC LIMIT 30;"` per Rule 15. Replaces the retired `docs/review-queue/pending.md` (retired 2026-04-29). |
```

Also: scan `CLAUDE.md` for any other references to `pending.md` and update to point at `claude_memory` queries instead.

## Step 4: Verify no broken doc links

`grep -rln "review-queue/pending\|review-queue/2026-02\|ai-coach-enhancements" docs/ *.md` after deletion. Any hits get updated to point at memory or removed.

## Test plan

| # | Test | Expected |
|---|---|---|
| 1 | 3 memory rows insert | `SELECT id, title FROM claude_memory WHERE session_id = 'pending-md-retirement-2026-04-29';` returns 3 rows |
| 2 | All memory rows have correct shape | Each has non-null title, content, category, status='active' |
| 3 | Files deleted | `ls docs/review-queue/*.md` shows only PLAN_*.md and the new README stub |
| 4 | Old README stub redirects correctly | New README.md mentions claude_memory + CLAUDE.md Rule 12 |
| 5 | CLAUDE.md Rule 12 updated | `grep -n "pending.md" CLAUDE.md` returns at most one history reference (the retirement note); row #3 mentions claude_memory |
| 6 | No broken doc links | `grep -rln "review-queue/pending\|review-queue/2026-02\|ai-coach-enhancements" docs/ *.md` returns empty |
| 7 | A future session's Rule 12 read | Reads CLAUDE.md, sees Rule 12 row #3 points at claude_memory; runs the canonical query and gets the 3 new rows + existing 200+ rows |

## Risks

- **Loss of historical context** — pending-history-2026-02.md is 99KB of resolved/older items. Most was already addressed via subsequent commits, but if there's a buried still-relevant item not surfaced in the verification, we lose track of it. Mitigation: any genuinely unresolved fact buried in there can be rediscovered via git log; pure tracking metadata (status, dates) is what's being shed, and that has no future value.
- **Other docs link to pending.md** — Step 4 grep catches these. If found, update inline or note in commit message.
- **Future session protocol regression** — until Rule 12 update lands, a session reading the old doctrine could be confused. Mitigation: Rule 12 update happens in the same commit as the deletions.

## Out of scope

- Migrating LESSONS_LEARNED.md, DOC_DISCREPANCIES.md, coach-inbox.md to claude_memory — that's the broader L1 migration discussed in the tangent, deserves its own plan
- Renaming `docs/review-queue/` to `docs/plans/` — directory restructure is a separate concern
- Auto-snapshot generation (L2 layer) — separate plan
