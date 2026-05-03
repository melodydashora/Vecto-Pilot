# PLAN — Workstream 6 Step 3 — Tactical Planner API Cache Enforcement

**Created:** 2026-05-03
**Author:** Claude (drafted), Melody (approved)
**Branch:** `feat/workstream6-step3-cache-enforcement` (off `main` at `546973ac`)
**Related plans:** `PLAN_workstream6_briefing_split.md` (architecture, Phase 1), `PLAN_workstream6_step2_catalog-cleanup-2026-05-03.md` (drops `venue_catalog.source_model`)
**Status:** APPROVED 2026-05-03 — Phase 1 (Execution) in progress. See §8 for locked-in decisions.

---

## 1. Objective

Invert the current "Pass 1 = Places API text search → Pass 2 = catalog fallback by category" ordering inside `server/lib/strategy/tactical-planner.js` so that:

1. Every LLM-emitted venue name is **first** looked up in `venue_catalog` by exact normalized name + city + state.
2. The Places API text search (`searchPlaceByText`) only fires on **cache miss**.
3. Per-call structured logs (`matrixLog`) emit explicit `CACHE_HIT` / `CACHE_MISS` action verbs.
4. A rolled-up `{ hits, misses, hit_rate }` counter is persisted at the strategy level for production monitoring.

Net effect: API quota consumption drops as the catalog accumulates verified hits; observability surfaces the effect at the briefing/strategy record level instead of forcing operators to grep logs.

## 2. Background / Context

### 2.1 Current state (verified via 2026-05-03 audit)

**File:** `server/lib/strategy/tactical-planner.js` (684 lines)
**Function:** `generateTacticalPlan({ strategy, snapshot, briefingContext })`

Four `searchPlaceByText` call sites — all hit the Places API unconditionally (no cache short-circuit inside `searchPlaceByText` itself; verified at `server/lib/venue/venue-enrichment.js:569–649`):

| # | Line | Phase | Notes |
|---|------|-------|-------|
| 1 | `tactical-planner.js:448` | LLM venue resolve — Step 1 | Always fires for every LLM-emitted venue |
| 2 | `tactical-planner.js:453` | LLM venue resolve — Step 2 retry | Fires only if call #1 returned null AND `venue.district` is set |
| 3 | `tactical-planner.js:545` | LLM replacement venue resolve | Fires for each LLM-replacement venue when first batch was short |
| 4 | `tactical-planner.js:547` | LLM replacement retry | Same shape as #2 |

The single existing catalog touch (`tactical-planner.js:477`) calls `getVenuesByType({ venueTypes:[category], district, state, limit: 3 })` — this is a **category-bucket fallback**, not a name-keyed cache lookup. It only fires AFTER the Places API has already returned null twice.

### 2.2 Cache primitives already present

`server/lib/venue/venue-cache.js` exports the right tools:

| Function | Line | Lookup keys | Updates `access_count` + `last_accessed_at` on hit? |
|----------|------|-------------|-----|
| `lookupVenue(criteria)` | `:71` | place_id; OR `(normalized_name, city, state)`; OR `coord_key` | Yes — via `updateAccessStats(venue.venue_id)` at `:83`, `:102`, `:117` |
| `lookupVenueFuzzy(criteria)` | `:132` | falls through to `LIKE %normalized%` on state | Yes |
| `getVenuesByType(options)` | `:775` | category + district + state | Already used at line 477 |

`venue_catalog` (`shared/schema.js:234–334`) already has the columns we need:
- `normalized_name` (`:282`) — exact-match key
- `coord_key` (`:283`) — secondary
- `place_id` (`:236`, unique) — strongest key
- `access_count` (`:310`) — already incremented on every cache hit
- `last_accessed_at` (`:311`) — already maintained
- `last_known_status` (`:261`) + `status_checked_at` (`:262`) — for closure-aware freshness gates
- `district` (`:250`) + `district_slug` (`:251`) — for tie-breaking

### 2.3 Catalog-write path closes the loop

After `tactical-planner.js` returns its resolved venues, `enhanced-smart-blocks.js:promoteToVenueCatalog` (`:321`) calls `upsertVenue` with `source: 'smart_blocks_promotion'` (`:338`) for every Places-verified venue. The catalog therefore accumulates verified hits over time — **this is what makes a cache-first inversion correct** rather than a no-op against an empty cache.

## 3. Approach

### 3.1 Resolve-chain inversion (proposal)

Replace the four bare `searchPlaceByText(...)` call sites with a thin helper `resolveVenueWithCache(venue, { city, state, tz })` that owns the full chain:

```text
For each LLM-emitted venue:
  1a. CACHE LOOKUP — lookupVenue({ venueName, city, state })
      → if hit: emit CACHE_HIT; freshness gate (3.3); return cached row → DONE
      → if miss: emit CACHE_MISS, fall through
  1b. PLACES API — searchPlaceByText(name, district, city, state, tz)
      → if hit: return result → DONE (downstream upsert via promoteToVenueCatalog will populate cache)
      → if null && district: PLACES API retry (drop district)
      → if still null: fall through to Step 2 (catalog category fallback)
  2. CATALOG CATEGORY FALLBACK — unchanged: getVenuesByType(...)
  3. LLM REPLACEMENT — unchanged
```

Step 2 (the existing `getVenuesByType` category fallback) stays where it is — it solves a different problem (LLM hallucinated a venue that doesn't exist in either the catalog OR Places). We're inserting a name-keyed cache check IN FRONT of the API, not replacing the existing fallback chain.

**Placement:** the gate lives in `tactical-planner.js` (or a new `tactical-planner.cache.js` if the helper grows beyond ~30 lines), NOT inside `searchPlaceByText`. Justification:
- `searchPlaceByText` literally names the API; hiding a DB lookup behind it violates least-surprise.
- The other caller (`server/lib/venue/venue-enrichment.js:691` inside `getPlaceDetailsWithFallback`) is itself a fallback chain that already does a coordinate search first — adding a cache check at that text-search step is a different question Melody hasn't asked for.
- Caller-scoped placement keeps Step 3's blast radius surgical.

### 3.2 Lookup function choice (proposal)

Use `lookupVenue` (exact normalized name + city + state) as the **only** cache key. Do NOT use `lookupVenueFuzzy`. Reasoning:
- LLM emits a venue name → we look it up by exact normalized form (lowercase alphanumeric).
- Fuzzy matching by `LIKE '%normalized%'` risks wrong-venue collisions (`"The Mitchell"` ≠ `"Mitchell's Steakhouse"` even though the substring matches).
- On miss, the Places API resolves the canonical form, downstream `upsertVenue` writes it to the catalog under the canonical normalized name, and the next snapshot's identical LLM emission will hit cleanly.
- `lookupVenueFuzzy`'s docstring (`venue-cache.js:126`) says it's for "LLM-generated event names" — a different domain (event titles, not venue names).

If empirical hit-rate is low after rollout (e.g., LLM names venues differently than the canonical form), revisit `lookupVenueFuzzy` as a **separate** plan with explicit guardrails (e.g., similarity-score threshold, district must match).

### 3.3 Coordinate freshness (proposal)

Trust the cached row UNLESS `last_known_status` is `'permanently_closed'` or `'temporarily_closed'`. Logic:

```js
if (cached) {
  if (cached.last_known_status === 'permanently_closed' || cached.last_known_status === 'temporarily_closed') {
    // Treat as miss; fall through to Places API to re-verify or replace
    return null;
  }
  return cached;
}
```

Rationale:
- Re-validating every hit defeats the whole point of caching.
- `last_known_status` is already maintained by existing closure tracking (`venue_catalog.last_known_status`, `consecutive_closed_checks`, `auto_suppressed`).
- Coordinates don't move; venues that are operational stay operational.
- If closure-state staleness becomes an issue, that's a separate background-refresh job — out of scope for Step 3.

### 3.4 District handling (proposal)

`lookupVenue` already keys on `(normalized_name, city, state)`. District is **not** part of the cache key.

If multiple catalog rows match (unlikely under exact normalized name + city + state — it would imply two different physical venues with identical normalized names, which `insertVenue` partially guards against via `coord_key` uniqueness), `lookupVenue` returns the first row. To handle this edge case cleanly:
- If LLM provided a district AND the cache returns multiple candidates, prefer the row whose `district_slug` matches `normalizeDistrictSlug(venue.district)`.
- Otherwise return the first row.

Concretely: extend `lookupVenue` (or wrap its call in `resolveVenueWithCache`) with an optional `preferredDistrict` parameter. Implementation TBD pending Melody's approval; lowest-risk path is a wrapper in `tactical-planner.js` that calls `lookupVenue` and then refines the result, leaving `lookupVenue`'s contract unchanged.

### 3.5 Metrics — per-call + rolled-up

**Per-call structured logs** (matrixLog) — fired inside `resolveVenueWithCache`:

```js
// On cache hit:
matrixLog.info({
  category: 'VENUE',
  connection: 'DB',
  action: 'CACHE_HIT',
  tableName: 'VENUE_CATALOG',
  location: 'tactical-planner.js:resolveVenueWithCache',
}, `Cache hit for "${venue.name}" (place_id: ${cached.place_id})`);

// On cache miss (fired BEFORE the API call):
matrixLog.info({
  category: 'VENUE',
  connection: 'DB',
  action: 'CACHE_MISS',
  tableName: 'VENUE_CATALOG',
  secondaryCat: 'PLACES',
  location: 'tactical-planner.js:resolveVenueWithCache',
}, `Cache miss for "${venue.name}" — calling Places API`);
```

**Rolled-up counter** — per `generateTacticalPlan` call:

```js
const cacheMetrics = { hits: 0, misses: 0 };
// resolveVenueWithCache mutates cacheMetrics on each call
// At end of generateTacticalPlan:
cacheMetrics.hit_rate = (cacheMetrics.hits + cacheMetrics.misses) > 0
  ? cacheMetrics.hits / (cacheMetrics.hits + cacheMetrics.misses)
  : null;
return { ...result, cache_metrics: cacheMetrics };
```

**Persistence — DECISION POINT for Melody:** the strategies table (`shared/schema.js:85–104`) and rankings table (`shared/schema.js:131–148`) are both candidates. Recommendation:

| Option | Where | Pros | Cons |
|--------|-------|------|------|
| **A (recommended)** | New `venue_cache_metrics jsonb` column on `strategies` | 1:1 with snapshot/strategy run; logically belongs to the strategy phase that owns tactical-planner | Requires a small migration |
| B | New `venue_cache_metrics jsonb` column on `rankings` | Already collects per-run scoring metadata (`scoring_ms`, `planner_ms`, `path_taken`) | A snapshot can produce 0 rankings on failure; metric would be lost |
| C | New `cache_metrics` field inside an existing JSONB on `briefings` | No migration | Cache hits/misses aren't briefing data — semantic mismatch |

I'll mark Option A as the proposal pending Melody's call. If Option A is chosen, the migration adds a single nullable JSONB column to `strategies`.

## 4. Files Affected

| File | Change | Magnitude |
|------|--------|-----------|
| `server/lib/strategy/tactical-planner.js` | Add `resolveVenueWithCache` helper; replace 4 bare `searchPlaceByText` calls; thread `cache_metrics` through return value | ~50 lines added, ~12 lines moved |
| `server/lib/venue/venue-cache.js` | Possibly extend `lookupVenue` with `preferredDistrict` (optional — could live in helper instead) | 0–10 lines |
| `migrations/<next>_add_venue_cache_metrics.sql` | If Option A: add `venue_cache_metrics jsonb` column to `strategies` | New file, ~5 lines |
| `shared/schema.js` | If Option A: add `venue_cache_metrics: jsonb('venue_cache_metrics')` to `strategies` table definition | 1 line |
| `server/lib/venue/enhanced-smart-blocks.js` | If Option A: write `cache_metrics` from tactical-planner result into the strategy row | 3–5 lines, depending on how strategies row is currently updated |
| `tests/strategy/tactical-planner-cache.test.js` (new) | Unit tests per §5 | New file |

**No changes** to: `searchPlaceByText`, `getVenuesByType`, `lookupVenueFuzzy`, the LLM replacement logic, or the catalog-write path.

## 5. Test Cases

Tests live at `tests/strategy/tactical-planner-cache.test.js` (new). All tests use a real Postgres connection (per LESSONS_LEARNED.md "no DB mocks").

### 5.1 Unit — cache hit short-circuits API
- Seed `venue_catalog` with a known venue (normalized name + city + state).
- Call `resolveVenueWithCache(...)` with that venue's name.
- Assert: `searchPlaceByText` was NOT called (spy/mock at the module boundary).
- Assert: `cacheMetrics.hits === 1, cacheMetrics.misses === 0`.
- Assert: matrixLog received a `CACHE_HIT` action.

### 5.2 Unit — cache miss falls through to Places API
- Catalog is empty for the queried venue.
- Call `resolveVenueWithCache(...)`.
- Assert: `searchPlaceByText` was called exactly once with the expected args.
- Assert: `cacheMetrics.misses === 1, cacheMetrics.hits === 0`.
- Assert: matrixLog received a `CACHE_MISS` action.

### 5.3 Unit — closure status forces re-validation
- Seed catalog row with `last_known_status = 'temporarily_closed'`.
- Call `resolveVenueWithCache(...)`.
- Assert: treated as miss; Places API IS called.
- Assert: `cacheMetrics.misses === 1`.

### 5.4 Unit — district tie-breaking
- Seed two catalog rows with identical normalized name + city + state but different `district_slug`.
- Call with `venue.district = "Legacy West"`.
- Assert: returned row has matching `district_slug`.

### 5.5 Integration — full `generateTacticalPlan` run with mixed hit/miss
- Seed 3 of 6 expected LLM venues into the catalog.
- Run `generateTacticalPlan(...)` end-to-end with a stubbed VENUE_SCORER LLM that returns 6 known names.
- Assert: 3 cache hits, 3 cache misses (= Places API calls).
- Assert: `cacheMetrics.hit_rate === 0.5`.
- Assert: returned tactical plan still has 6 venues with valid lat/lng.

### 5.6 Integration — rolled-up counter persists to strategies row (Option A)
- Run `generateTacticalPlan(...)`, then assert the corresponding `strategies` row has `venue_cache_metrics` populated.

### 5.7 Regression — degraded path unchanged
- Force all LLM venues to fail Places API resolution.
- Assert: existing `failedVenues` → LLM replacement chain still runs.
- Assert: degradation memory entry still fires (`tactical-planner.js:597–610`).

## 6. Rollout & Risk

### 6.1 Rollout
1. Land this plan + Melody's approval as commit 1 (docs only).
2. Migration commit (Option A only).
3. Helper introduction + test scaffolding (commit 2).
4. Replace the 4 call sites (commit 3).
5. Wire metrics persistence through `enhanced-smart-blocks.js` (commit 4).
6. Verify in dev: run `npm run dev`, trigger a snapshot, inspect a) matrixLog output for `CACHE_HIT` / `CACHE_MISS` lines, b) the strategies row for `venue_cache_metrics`.

### 6.2 Risk profile
- **Low** — the change adds a check before existing logic; existing logic is untouched on cache miss.
- **Cold-cache regression**: on an empty catalog, behavior is identical to today (every call is a miss → API call). No regression risk for fresh dev databases.
- **Cache poisoning**: if `venue_catalog` contains stale or wrong rows (e.g., venue moved address), the cache hit returns wrong coordinates. Mitigation: closure-aware freshness gate (§3.3). If we observe address-staleness bugs in production, the follow-up is a `validated_at` TTL gate, not a Step 3 change.
- **Metric noise on cold start**: hit_rate will be near-zero on day 1 and grow over weeks. Document this expectation in the operations runbook so reviewers don't read low hit-rate as a regression.

### 6.3 Rollback
- Revert commits in reverse order. The migration (Option A) leaves a nullable column — safe to leave in place even after revert.

## 7. Open Questions for Melody

1. **Option A/B/C for rolled-up metric storage** (§3.5) — recommendation is A (`strategies.venue_cache_metrics`).
2. **Lookup function** (§3.2) — confirm `lookupVenue` exact-only is the right call; defer fuzzy as a separate plan.
3. **Freshness gate** (§3.3) — confirm closure-status check is sufficient; defer TTL freshness to follow-up.
4. **District tie-breaking** (§3.4) — confirm the wrapper-level approach (vs. extending `lookupVenue`'s contract).
5. **Test framework** — `tests/strategy/` doesn't exist yet; confirm I should create it or place tests under an existing suite directory.

---

## 8. Decisions Locked In (2026-05-03)

Melody approved the plan and resolved §7's open questions definitively. The five decisions below freeze the architectural surface for Step 3 execution; any deviation requires a new plan revision.

| # | Question | Decision | Rationale (Melody) |
|---|----------|----------|---------------------|
| 1 | Rolled-up metric storage (§3.5) | **Option A — `strategies.venue_cache_metrics jsonb`** | Instrumentation must survive degraded runs; coupling metric storage to rankings success would lose the metric exactly when it matters most. The strategies row is 1:1 with the snapshot, so the metric always lands somewhere. |
| 2 | Lookup function (§3.2) | **`lookupVenue` exact-only; defer fuzzy entirely** | False-positive fuzzy match is catastrophic in the rideshare domain — dispatching a driver to "The Mitchell" when the actual venue is "Mitchell's Steakhouse" 0.5 miles away costs an entire ride's earnings. Ship exact-only, measure miss rate, only revisit if telemetry justifies it. |
| 3 | Freshness gate (§3.3) | **Closure-status check sufficient; no TTL in Step 3** | Validate the baseline enforcement logic first. TTL-based invalidation is a separate dedicated step to avoid scope creep. |
| 4 | District tie-breaking (§3.4) | **Wrapper-level approach; do NOT mutate `lookupVenue` contract** | Keep the base lookup pure. Domain-specific district collision logic belongs inside the wrapper, not in the shared cache primitive. |
| 5 | Test framework (§5) | **Create new `tests/strategy/` directory** | Cache enforcement lives specifically within `tactical-planner.js` (the strategy domain); a dedicated test boundary mirrors the architecture cleanly. |

**Side-finding handling:** the schema-vs-doctrine drift on `venue_catalog.source_model` (verified 2026-05-03 against live dev DB — column IS gone from the table, but `shared/schema.js:309` still declares it, which IS a Drizzle drift bug) and the `briefing-service.js` stale references are deferred to a single dedicated cleanup commit. They do NOT enter Step 3's scope.

**Approval marker:** Melody — 2026-05-03 — "You are fully approved to move from Phase 0 (Planning) into Phase 1 (Execution) for Step 3 API Cache Enforcement. Please proceed!"

---

## Appendix A — Side-findings logged to claude_memory (NOT in scope for Step 3)

Per Melody's 2026-05-03 direction, the following stale-doc findings will be logged as a single `claude_memory` row (`category='audit'`, `priority='high'`, `status='active'`) and resolved in a follow-up commit:

- **CLAUDE.md** lines 66, 96, 152 reference deleted `briefing-service.js`
- **LESSONS_LEARNED.md** lines 9, 14, 20, 37, 40, 119 reference deleted `briefing-service.js`
- **Code comments** in `server/lib/ai/providers/{briefing,consolidator}.js`, `server/lib/briefing/{index.js,briefing-aggregator.js,event-schedule-validator.js}`, and the pipeline files all carry stale `briefing-service.js` mentions
- **Schema-vs-doctrine drift:** `shared/schema.js:309` still defines `venue_catalog.source_model: text("source_model")` despite commits `9579460f` ("drop dead venue_catalog.source_model column") and `77a3c2e6` ("remove source_model from Drizzle schema + venue-cache writer") and the 2026-05-03 catalog provenance doctrine in CLAUDE.md asserting it is gone. Per Rule 12 contested-fact rule, the doctrine wins; the schema needs to converge. The `discovered_events.source_model` removal at line 611 is correctly applied — only the venue_catalog row remains.
