# Pending Documentation Review

Items requiring action. For completed session logs and historical analysis, see [`pending-history-2026-02.md`](pending-history-2026-02.md).

---

## 2026-04-26: Strategy Map Consolidation — ✅ PHASES A + B SHIPPED on `feat/strategy-map-phase-b` (visually approved; awaiting merge)

**Author:** Claude Opus 4.7 (1M context) | **Scope:** Comprehensive plan to consolidate ALL Google-Maps surfaces into a single StrategyMap inside the Strategy tab. **No code changes yet** — Rule 1 hold.

**Revision history:**
- 2026-04-26 initial plan
- 2026-04-26 revised after `.claude/plans/MapResearch.md` peer review caught 9 contract bugs + 1 new finding from verification pass (now plan §0)

**Deliverables:**
- [`docs/strategy-map-consolidation-plan.md`](../strategy-map-consolidation-plan.md) — phased implementation plan, now Phases A–F (added Phase F TomTom incidents)
- [`docs/strategy-map-consolidation-findings.md`](../strategy-map-consolidation-findings.md) — raw inventory + 10 verification commands
- `.claude/plans/MapResearch.md` — peer-review audit (external)
- `claude_memory` rows #185, #186 — cross-session pointers

**Headline decisions in plan (all reversible until approval):**
- KEEP & rename `MapTab.tsx` → `client/src/components/strategy/StrategyMap.tsx`
- DELETE 3 files (verified zero consumers): `MapPage.tsx`, `ConciergeMap.tsx`, `EventsExplorer.tsx`
- FOLD `TacticalStagingMap.tsx` capabilities (mission selector + staging/avoid zones) into StrategyMap, then delete
- ADD new layers via verified endpoint contracts: `market_intelligence` zone overlays (5 supported subtypes), staging-areas (snapshot-scoped), demand-patterns, market boundary + Code 6 warning, TomTom incidents
- ZERO required server-side changes (all data sources already exist; one fork could trigger an optional server change)
- Architectural fixes: singleton Google Maps loader, `loading=async`, `AdvancedMarkerElement`, `mapId`, per-layer `lastXKeyRef` dedup, `escapeHtml` for ALL InfoWindows, layer-aware `fitBounds`

**4 open design forks for Melody (plan §4.6) — pick or accept all defaults:**
1. Market boundary source (default: hardcode in client config)
2. `zone_intelligence` vs `market_intelligence` table fate (default: deprecate `zone_intelligence`)
3. Dormant Intel components — `MarketBoundaryGrid` + `MarketDeadheadCalculator` (default: delete)
4. TomTom incidents routing (default: piggyback briefing payload)

**Status (2026-04-26 update):** Phases A + B implemented on branch `feat/strategy-map-phase-b` (6 commits, +1300/−1000 vs main). Two follow-up CSP commits unblocked Google Maps Platform vector tile rendering (worker-src blob:, connect-src wildcard + data:, script-src unsafe-eval for WASM label engine). Melody confirmed visuals all clear on 2026-04-26. Awaiting merge instruction. Phase C (TacticalStagingMap fold-and-delete) ready to start.

---

## 2026-04-24: Commit C (db connection-manager comment) queued behind 57P01 work — ⏸️ DEPENDENCY NOTE

**Author:** Claude Opus 4.7 (1M context) | **Scope:** Dependency note, not a code change.

As part of Phase 0.11 doc reconciliation from `docs/architecture/full-audit-2026-04-23-REMEDIATION-PLAN.md`, three of four intended commits shipped on 2026-04-24:

- ✅ Commit D (`docs(rule-12)`: contested-fact read-order amendment) — `0002b20c`
- ✅ Commit A (`docs(rule-13)`: correct DB provider — dev=Helium, prod=Neon) — `1eae0a14`
- ✅ Commit B (`docs(database-environments)`: correct record; prod is Neon) — `95c69833`
- ⏸️ **Commit C** (`chore(db)`: `connection-manager.js` inline comment fix) — **DEFERRED**

**Why Commit C was deferred:** `server/db/connection-manager.js` carries the uncommitted 2026-04-23 57P01 retry + `idleTimeoutMillis` changes described in the entry below. Staging the file for a comment-only fix would sweep those unreviewed changes into the commit, violating Rule 1. **Option Z** was chosen (see remediation plan Appendix A "Deferred items from Phase 0" section).

**Acceptable interim state:** CLAUDE.md Rule 13, `DATABASE_ENVIRONMENTS.md`, and the remediation plan all agree prod is Neon. The `connection-manager.js` inline comment temporarily lags, still reading `Helium PostgreSQL 16`. Low-urgency inconsistency, explicit and tracked here.

**Next action:** Melody test-approves the 2026-04-23 entry below → commit the 57P01 / CORS / venue work → immediately land Commit C (comment fix) as its own micro-commit. Plan's Phase 0.11 section will then read "3+1 shipped" after both commits land.

---

## 2026-04-23: Three Server-Log Fixes — ⚠️ AWAITING TEST APPROVAL

**Author:** Claude Opus 4.7 (1M context) | **Scope:** 23505 venue promotion, CORS error propagation, 57P01 pool resilience

### What changed

1. **`server/lib/venue/venue-cache.js` — `insertVenue`**
   Root cause: `venue_catalog` has three unique constraints (`venue_id` PK, `coord_key`, `place_id`) but Postgres only supports one `ON CONFLICT` target per INSERT. When Google Places returned drifted coords for the same `place_id`, the existing `ON CONFLICT (coord_key) DO UPDATE` clause didn't match the conflict dimension and `place_id` fired 23505.
   Fix: wrap the insert in try/catch; on 23505 fall back to a `place_id` lookup, update access stats on the existing row, and return it. Happy path unchanged.

2. **`server/lib/ai/rideshare-coach-dal.js` — `saveVenueCatalogEntry`**
   The coach's pre-check + insert had a race window where two concurrent saves of the same `place_id` both saw "no existing" and both attempted INSERT; loser threw 23505.
   Fix: added `.onConflictDoNothing()` to the INSERT and a post-conflict `SELECT ... WHERE place_id = ?` that returns the winner's row. No data change; just eliminates the raised error under concurrency.

3. **`server/bootstrap/middleware.js` — CORS origin callback**
   Root cause: `callback(new Error(\`CORS blocked: ${origin}\`))` was being forwarded by the `cors` package through `next(err)` and landed in the global error handler, producing 500s for scanner traffic from origins like `https://prodguard.invalid`.
   Fix: extracted an `isAllowedOrigin(origin)` predicate, added a pre-middleware that returns a clean `403 {error:'Origin not allowed', code:'cors_blocked'}` for blocked origins, and reduced the `cors()` callback to `callback(null, isAllowedOrigin(origin))` which never throws. Per-unique-origin log dedup prevents log spam under scanner floods.

4. **`server/db/connection-manager.js` — pool tuning + transient-error retry**
   - `idleTimeoutMillis`: 10000 → **30000** (10s churned connections aggressively against server-side idle timeouts; with `keepAlive` already enabled, 30s keeps warm connections without eviction thrash).
   - `allowExitOnIdle: false` made explicit.
   - Monkey-patched `pool.query` to retry once on transient Postgres error codes (`57P01`, `57P02`, `57P03`, `08000`, `08001`, `08003`, `08004`, `08006`). Callback-style invocations pass through unchanged to preserve pg's contract. Drizzle (via `server/db/drizzle.js` which imports `getPool()`) inherits this because we patch the instance method on the shared pool object.

### Test plan — Melody to verify after workflow restart

| Test | Command | Expected |
|------|---------|----------|
| Gateway boots clean | Press Play, watch logs for `[gateway] ✅ Middleware configured` | No errors |
| CORS blocks invalid origin with 403 | `curl -si -H "Origin: https://prodguard.invalid" http://localhost:5000/api/health` | `HTTP/1.1 403`, body `{"error":"Origin not allowed","code":"cors_blocked"}`; no `http.500` line in ndjson |
| CORS allows Replit domain | `curl -si -H "Origin: https://workspace.replit.dev" http://localhost:5000/api/health` | `HTTP/1.1 200`, `access-control-allow-origin` header present |
| CORS allows no-origin (curl default) | `curl -si http://localhost:5000/api/health` | `HTTP/1.1 200` |
| Pool survives a 57P01 | `psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'node-postgres' AND pid != pg_backend_pid();"` then hit any DB-backed endpoint | Logs show `[pool] Transient 57P01 on query; retrying once`, request succeeds (no 500) |
| Venue promotion tolerates place_id drift | Monitor briefing pipeline logs during normal traffic | No more `Catalog promotion failed for "…": 23505` lines; instead (at most) `[venue-cache] insertVenue 23505 on … — falling back to existing venue …` warnings |

### Residual risks / follow-ups

- **`upsertVenue` UPDATE path (venue-cache.js:312–338)** still overwrites `coord_key` unconditionally. If the new coord_key collides with another row's coord_key, the UPDATE would throw 23505. Not fixed in this batch because no logs point at it; flagged for a future tighten-up.
- **Other INSERT sites into venue_catalog** (`venue-address-resolver.js:330`, `venue-intelligence.js:934`) already have `.onConflictDoNothing()`. Verified, no change.
- **`seed-dfw-venues.js:252`** is a one-shot seed script with a pre-check; left alone.
- **Test approval required per Rule 1 before marking these resolved.**

### Commits: (pending Melody's test approval before commit)

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

## 2026-04-16: app_feedback user_id Column — ✅ APPLIED (Dev)

**Author:** Claude Opus 4.6 | **Scope:** `app_feedback` — add user_id column (Pass F bug fix)
**Migration:** `migrations/20260416_app_feedback_user_link.sql` — `ADD COLUMN IF NOT EXISTS user_id uuid`
**Status:** APPLIED on dev (2026-04-16) — prod pending Melody's approval

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

## 2026-04-11: Driver Preferences Schema Migration — ✅ APPLIED (Dev) + ✅ Drizzle schema synced 2026-04-18

**Author:** Claude Opus 4.6 | **Scope:** `driver_profiles` — add 4 columns for strategist enrichment

**Migration applied to dev DB on 2026-04-16.** File: `migrations/20260416_driver_preference_columns.sql`. The consolidator and tactical planner now read real column values (falling back to `DRIVER_PREF_DEFAULTS` when null).

**2026-04-18 update:** `shared/schema.js:1028-1031` now declares these four columns in Drizzle so the ORM can read/write them. Previously the migration existed on disk but the Drizzle schema file wasn't updated — the runtime graceful fallback (PG 42703 → defaults) masked the drift. No behaviour change for prod until prod migration is run; the Drizzle sync just makes TypeScript/Drizzle aware of columns that dev already has.

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
