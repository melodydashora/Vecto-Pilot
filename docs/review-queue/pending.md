# Pending Documentation Review

Items requiring action. For completed session logs and historical analysis, see [`pending-history-2026-02.md`](pending-history-2026-02.md).

---

## 2026-04-16: Strategy Hallucination Session (H-1/H-2/H-3)

**Doctrine rules added:** DECISIONS.md #17 (heuristic-as-fact), #18 (driver-local time), #19 (capacity ceiling)

**Commits:** c605eabb (H-1), d6ce19e8 (H-2), ceeb62b6 (H-3)

- **Source bug:** Rideshare Coach live verification caught Comerica 15k (real ~5k), Riders Field 15k (real ~10k), Omni PGA 10k (real ~2.5k), + Dallas Pulse date drift Apr 17 → Apr 16
- **Pending prod actions (Melody approval required):**
  1. Run `migrations/20260416_venue_capacity_seed.sql` on prod (30 venues populated)
  2. Monitor next strategy block for absence of fabricated attendance numbers
  3. Verify Dallas Pulse does NOT appear in Apr 16 prod strategy, DOES appear in Apr 17
- **Follow-ups (not blocking):**
  - Extend capacity seed beyond 30 venues as Coach surfaces more during live drives
  - Consider a `verified_source` boolean on venue_catalog for confidence gating
  - Pass F (observability lane audit) still outstanding — this session's SYSTEM_NOTE bug report is live test data

---

## 2026-04-16: ranking_candidates Deadhead Columns — ✅ APPLIED (Dev)

**Author:** Claude Opus 4.6 | **Scope:** `ranking_candidates` — add 2 columns for driver preference scoring visibility

**Migration applied to dev DB on 2026-04-16.** File: `migrations/20260416_ranking_candidates_deadhead.sql`. The strategy pipeline now persists `beyond_deadhead` and `distance_from_home_mi` through to the API response via `toApiBlock()`.

### Migration SQL

```sql
ALTER TABLE ranking_candidates
  ADD COLUMN IF NOT EXISTS beyond_deadhead boolean,
  ADD COLUMN IF NOT EXISTS distance_from_home_mi double precision;
```

### Status: APPLIED on dev (2026-04-16) — prod pending Melody's approval

---

## 2026-04-14: Claude Memory Table System

**Author:** Claude Opus 4.6 | **Scope:** `claude_memory` table, `/api/memory` API, memory-keeper agent

### README Updates Needed
- [ ] `server/api/README.md` — add memory API section
- [ ] `server/middleware/README.md` — note bot-blocker update
- [ ] `.claude/agents/README.md` or equivalent — document memory-keeper agent
- [ ] `docs/guides/README.md` — create if needed for guides directory

### Migration Note
- Table created via direct SQL on dev DB only
- **Prod DB migration still needed** — run the same SQL on production when deploying

---

## 2026-04-11: Driver Preferences Schema Migration — ✅ APPLIED (Dev)

**Author:** Claude Opus 4.6 | **Scope:** `driver_profiles` — add 4 columns for strategist enrichment

**Migration applied to dev DB on 2026-04-16.** File: `migrations/20260416_driver_preference_columns.sql`. The consolidator and tactical planner now read real column values (falling back to `DRIVER_PREF_DEFAULTS` when null).

### Migration SQL

```sql
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS fuel_economy_mpg integer,
  ADD COLUMN IF NOT EXISTS earnings_goal_daily numeric(10,2),
  ADD COLUMN IF NOT EXISTS shift_hours_target numeric(4,1),
  ADD COLUMN IF NOT EXISTS max_deadhead_mi integer;
```

### Verification Checklist
- [x] **Run migration on dev DB** → applied 2026-04-16 via `psql $DATABASE_URL -f migrations/20260416_driver_preference_columns.sql`
- [ ] **Melody: Run migration on prod DB** → after dev verification
- [ ] **Melody: Update a real driver profile** with non-null values for all four fields
- [ ] **Melody: Monitor server logs** for `[strategist-enrichment] loadDriverPreferences failed` warnings

### Status: APPLIED on dev (2026-04-16) — prod pending Melody's approval

### PROD BEHAVIOR UNTIL MIGRATION APPLIED

Until Melody runs `migrations/20260416_driver_preference_columns.sql` on prod, the following fallback behavior is active:

| Column | Exists in Prod? | Fallback | Effect on Driver |
|--------|----------------|----------|-----------------|
| `max_deadhead_mi` | **NO** | Defaults to `15` via `DRIVER_PREF_DEFAULTS` | Every driver gets 15mi deadhead threshold; `beyond_deadhead` flag triggers at 15mi regardless of preference |
| `fuel_economy_mpg` | **NO** | Defaults to `25` via `DRIVER_PREF_DEFAULTS` | Strategy prompt shows "25 mpg (default)" for all drivers |
| `earnings_goal_daily` | **NO** | Defaults to `null` | Earnings pacing line omitted from strategy prompt |
| `shift_hours_target` | **NO** | Defaults to `null` | Shift hours line omitted from strategy prompt |
| `home_lat` / `home_lng` | **YES** (already in schema) | N/A — reads real values | Home-base distance calculation works today if driver has entered an address |

**Mechanism:** `loadDriverPreferences()` in `consolidator.js:861` catches PG error `42703` ("column does not exist") on the full SELECT, falls back to a safe column set, and sets `prefs.migration_applied = false`. The 4 new columns are only read when `migration_applied === true`. No code change needed when the migration runs — the fallback path simply stops firing.

---

## 2026-04-04: Full Repository Audit — Awaiting Implementation

**Scope:** 37 findings from 5-agent parallel analysis. See `docs/architecture/full-audit-2026-04-04.md`.

### Prior Unfixed Items Confirmed Still Open
1. **Offer tier overhaul** — AWAITING TEST APPROVAL since 2026-03-29
2. **25 briefing bugs** — DOCUMENTED since 2026-03-09, UNFIXED
3. **Research P0 features** — NOT IMPLEMENTED
4. **Dependabot vulnerabilities** — FLAGGED

### Status: AWAITING PRIORITIZED IMPLEMENTATION

---

## 2026-03-29: Analyze-Offer Decision Logic Overhaul

**Scope:** Tier-aware decision rules, product type normalization, Phase 1/2 prompt rewrite

Three-tier system (share/standard/premium) with tier-specific prompts and deterministic fallback. Share short-circuits before AI call. Full details in history file.

### Status: AWAITING TEST APPROVAL

---

## 2026-04-04: Frontend "undefined is not iterable" Crash Fix

**Scope:** Client-side crash when API returns `success: false` or null array fields

Three-layer defense-in-depth: utility guards, API boundary checks, context array validation. Full details in history file.

### Status: AWAITING TEST APPROVAL

---

## 2026-04-04: MapTab/EventFilter Infinite Loop Fix

**Scope:** Map tab re-processing event markers every ~500ms even when data unchanged

Root cause: inline `.map()` created new array reference every render. Fixed with `useMemo` + `lastEventKeyRef` dedup. Full details in history file.

### Status: AWAITING TEST APPROVAL
