# PLAN — Workstream 6: Pipeline Decoupling & Venue Deduplication

**Date:** 2026-05-02
**Author:** Claude Code (proposed, awaiting Melody approval per Rule 16)
**Status:** Phase 0 — implementation plan, no code yet
**Origin:** LESSONS_LEARNED.md "2026-05-02: Tier 3 logger migration surfaced architectural debt" (commit `a62ecb31` on `feat/logger-tier3-auth-loc`)
**Companion docs:**
- `LESSONS_LEARNED.md:5` — discovery story
- `docs/MASTER_ROADMAP.md` — high-level workstream index (this doc is the granular detail; index-only updates land there)

---

## 1. Three Objectives (Workstream 6)

1. **God-File Split** — shatter `server/lib/briefing/briefing-service.js` (3,683 lines, 6 entangled pipelines) into pipeline-pure modules + lightweight aggregator. Enforce the 9-stage pipeline taxonomy in *code structure*, not just in log tags.
2. **Catalog Schema Cleanup** — remove operational/telemetry columns (`venue_catalog.source_model`) from the catalog. The catalog is physical reality (lat/lng, address, place_id); LLM-version-that-surfaced-the-venue is event-telemetry and belongs on `discovered_events`. Zero-downtime: backfill + dual-write first, drop after soak.
3. **API Cache Enforcement (Venue Deduplication)** — flip `tactical-planner.js` from "Places Text Search → catalog lookup" (Pass 1 / Pass 2 asymmetry burning quota) to "catalog-first → Places only on miss". Add behavioral tests asserting `placesApi.calls === 0` when a query string matches an existing catalog anchor.

This document details **Step 1 (God-File Split)** in full. Steps 2 and 3 get their own Phase 0 plans before execution; this doc only sketches their high-level shape.

---

## 2. Verified Ground Truth (from grep, 2026-05-02)

### 2.1. `briefing-service.js` shape

- **Size:** 3,683 lines / 164 KB
- **Exports (12):** `deduplicateEvents`, `filterInvalidEvents`, `fetchEventsForBriefing`, `fetchWeatherForecast`, `fetchWeatherConditions`, `fetchSchoolClosures`, `fetchTrafficConditions`, `fetchRideshareNews`, `generateAndStoreBriefing`, `getBriefingBySnapshotId`, `refreshEventsInBriefing`, `getOrGenerateBriefing`
- **LLM call sites (10):** 1× `BRIEFING_FALLBACK` (events), 2× `BRIEFING_TRAFFIC`, 1× `BRIEFING_FALLBACK` (news), 2× `BRIEFING_EVENTS_DISCOVERY`, 1× `BRIEFING_WEATHER`, 1× `BRIEFING_SCHOOLS`, 1× `BRIEFING_AIRPORT`, 1× `BRIEFING_NEWS`
- **Internal async helpers (~15):** `fetchEventsWithClaudeWebSearch`, `fetchEventsWithGemini3ProPreview`, `_fetchEventsWithGemini3ProPreviewLegacy` (legacy/dead?), `analyzeTrafficWithAI`, `fetchNewsWithClaudeWebSearch`, `fetchEventCategory`, `fetchAirportConditions`, `mapGeminiEventsToLocalEvents`, `generateBriefingInternal`, `writeSectionAndNotify`, `refreshTrafficInBriefing`, `refreshNewsInBriefing`, etc.
- **Internal sync helpers (~20):** `withTimeout` (DUPLICATE of `server/api/utils/http-helpers.js`), `safeJsonParse` (likely duplicate), `getMarketForLocation`, `getSchoolSearchTerms`, `usesMetric`, `formatTemperature`, `formatWindSpeed`, `generateWeatherDriverImpact`, `extractAirportJson`, `filterRecentNews`, `consolidateNewsItems`, `buildNewsPrompt`, `isDailyBriefingStale`, `isEventsStale`, `isTrafficStale`, `areEventsEmpty`, etc.

### 2.2. SSE / progressive-write pattern (LOAD-BEARING)

`writeSectionAndNotify(snapshotId, updates, notifyChannel)` at line 2991 fires `pg_notify` per section so the SSE forwarder at `server/api/strategy/strategy-events.js /events/briefing` can stream weather → traffic → events → airport → news to the client as each provider resolves. Channels in use:

| Channel | Pipeline |
|---------|----------|
| `briefing_weather_ready` | weather |
| `briefing_traffic_ready` | traffic |
| `briefing_events_ready` | events |
| `briefing_airport_ready` | airport |
| `briefing_news_ready` | news |
| (none for schools — written into the row but no separate SSE channel) | schools |

The 2026-02-17 incident regressed this progressive-write pattern; it was restored deliberately. **The split must preserve it.** Aggregator design therefore is NOT "fetch all → merge → single write"; it is "kick off 6 pipelines in parallel; each writes its own section via `briefing-notify.js` as it completes; aggregator awaits the lot and returns the assembled row for the caller." Each pipeline owns the call to its own `pg_notify` channel.

### 2.3. Sibling files already in `server/lib/briefing/`

```
briefing-service.js          164 KB  ← target of split
cleanup-events.js              2 KB  ← keep, unchanged
context-loader.js              6 KB  ← keep, unchanged
dump-last-briefing.js         13 KB  ← debug dumper, keep
dump-latest.js                 1 KB  ← debug dumper, keep
dump-traffic-format.js         1 KB  ← debug dumper, keep
event-schedule-validator.js    9 KB  ← keep, unchanged
filter-for-planner.js         19 KB  ← keep, unchanged
index.js                     <1 KB  ← re-export barrel, will get new entries
README.md                     12 KB  ← updated to reflect new structure
test-api.js                    1 KB  ← keep, unchanged
```

### 2.4. External callers of `briefing-service.js` exports

| Caller | Imports |
|--------|---------|
| `server/lib/ai/providers/briefing.js` | `generateAndStoreBriefing` |
| `server/api/location/snapshot.js` | `generateAndStoreBriefing` |
| `server/api/briefing/briefing.js` | `generateAndStoreBriefing`, `getBriefingBySnapshotId`, `getOrGenerateBriefing`, `filterInvalidEvents`, `fetchWeatherConditions`, `fetchTrafficConditions`, `fetchRideshareNews` |
| `server/lib/briefing/dump-last-briefing.js` | `filterInvalidEvents` |
| `server/lib/briefing/index.js` | re-exports |
| `server/lib/briefing/test-api.js` | `getBriefingBySnapshotId` |

**The shim must re-export every existing export by name.** No caller migration in Phase 1.

### 2.5. Existing utilities to import (do not duplicate)

- `withTimeout` / `safeJsonParse` — already at `server/api/utils/http-helpers.js`. Pipelines and aggregator import from there; the duplicates inside `briefing-service.js` get deleted, not relocated.

### 2.6. Drift to verify before extraction (not blocking the plan, but blocking code)

- **Two weather entry points:** `fetchWeatherForecast` (line 1729) and `fetchWeatherConditions` (line 1830). Same provider? Different scope (forecast vs current)? Need to read both before deciding whether `pipelines/weather.js` exposes one or two functions.
- **Two `BRIEFING_TRAFFIC` LLM sites:** `analyzeTrafficWithAI` (line 549, called inside fetchEventsWithClaudeWebSearch) and `fetchTrafficConditions` (line 2360). The first looks like cross-pollution (events pipeline calling traffic LLM?) and may itself be a taxonomy violation worth flagging.
- **`_fetchEventsWithGemini3ProPreviewLegacy`** (underscore prefix at line 1257) — likely dead code; verify before move-or-delete.

These verifications happen inside Phase 1 (Step 1 execution), not as blockers to plan approval. They are flagged so reviewers know they exist and the plan accommodates either resolution.

---

## 3. Step 1 — God-File Split

### 3.1. Final proposed file structure

```
server/lib/briefing/
├── briefing-aggregator.js          # NEW — orchestrator (the new generateAndStoreBriefing home)
├── briefing-notify.js              # NEW — owns writeSectionAndNotify + pg_notify channel constants
├── briefing-service.js             # SHRUNK to a re-export shim (Phase 1); deleted in Phase 2
├── pipelines/                      # NEW directory
│   ├── events.js                   # owns: fetchEventsForBriefing + 5 private helpers + dedup utilities
│   ├── weather.js                  # owns: fetchWeatherForecast + fetchWeatherConditions + 4 formatters
│   ├── traffic.js                  # owns: fetchTrafficConditions + analyzeTrafficWithAI (TBD: see §2.6)
│   ├── news.js                     # owns: fetchRideshareNews + 4 helpers (filter/build/consolidate prompts)
│   ├── schools.js                  # owns: fetchSchoolClosures + getSchoolSearchTerms
│   └── airport.js                  # owns: fetchAirportConditions + extractAirportJson
├── shared/                         # NEW directory
│   ├── briefing-row-shape.js       # canonical type/contract for the assembled row + per-section partial shapes
│   ├── staleness.js                # isDailyBriefingStale, isEventsStale, isTrafficStale, areEventsEmpty
│   └── get-market-for-location.js  # market lookup helper used by ≥2 pipelines
├── cleanup-events.js               # UNCHANGED
├── context-loader.js               # UNCHANGED
├── dump-*.js                       # UNCHANGED
├── event-schedule-validator.js     # UNCHANGED
├── filter-for-planner.js           # UNCHANGED
├── index.js                        # UPDATED — re-exports from aggregator + pipelines
├── test-api.js                     # UNCHANGED
└── README.md                       # UPDATED — documents new structure + 9-stage taxonomy mapping
```

**Net file delta:** +10 new files (1 aggregator + 1 notify + 6 pipelines + 3 shared utilities — wait, that's +11; the row-shape, staleness, get-market are 3 shared files), `briefing-service.js` shrinks from 3,683 lines to ~50 (re-export shim), `index.js` grows by ~10 lines, `README.md` rewritten.

### 3.2. Per-pipeline module contract (uniform)

Every pipeline module under `pipelines/` follows this contract:

```js
// pipelines/<name>.js
import { db } from '../../../db/drizzle.js';
import { briefings } from '../../../../shared/schema.js';
import { writeSectionAndNotify, CHANNELS } from '../briefing-notify.js';
import { briefingLog, OP, matrixLog } from '../../../logger/workflow.js';
import { callModel } from '../../ai/adapters/index.js';

/**
 * Discover <thing> for a snapshot. Writes its own section to the briefing row
 * and fires the corresponding pg_notify channel for SSE forwarding.
 *
 * @param {object} args
 * @param {object} args.snapshot   - resolved snapshot row (lat/lng/city/state/timezone)
 * @param {string} args.snapshotId - snapshot UUID
 * @param {object} [args.ctx]      - optional cross-pipeline context (e.g., shared market lookup)
 * @returns {Promise<{<section>: object, _telemetry: { stage, durationMs, providerCalls }}>}
 *          partial row contribution. Caller (aggregator) merges into final row.
 *          Pipeline has ALREADY written the section + fired pg_notify before returning.
 */
export async function discover<Thing>({ snapshot, snapshotId, ctx }) {
  // 1. Fetch from provider(s)
  // 2. Normalize / validate
  // 3. await writeSectionAndNotify(snapshotId, { <section>: result }, CHANNELS.<NAME>)
  // 4. return { <section>: result, _telemetry }
}
```

**Function naming:**
- `pipelines/events.js` exports `discoverEvents` (wraps `fetchEventsForBriefing` semantics)
- `pipelines/weather.js` exports `discoverWeather` (single function unifying current+forecast — pending §2.6 verification)
- `pipelines/traffic.js` exports `discoverTraffic`
- `pipelines/news.js` exports `discoverNews`
- `pipelines/schools.js` exports `discoverSchools`
- `pipelines/airport.js` exports `discoverAirport`

**Plus legacy-shape exports for caller compatibility:** since `server/api/briefing/briefing.js` directly imports `fetchWeatherConditions`, `fetchTrafficConditions`, `fetchRideshareNews`, each pipeline module also exports the legacy-named function as an alias until those callers are migrated in Phase 2.

```js
// pipelines/weather.js (last lines)
export { discoverWeather as fetchWeatherConditions };  // legacy alias; remove in Phase 2
```

### 3.3. Aggregator design (`briefing-aggregator.js`)

```js
// briefing-aggregator.js — replaces generateAndStoreBriefing in briefing-service.js
import { discoverEvents } from './pipelines/events.js';
import { discoverWeather } from './pipelines/weather.js';
import { discoverTraffic } from './pipelines/traffic.js';
import { discoverNews } from './pipelines/news.js';
import { discoverSchools } from './pipelines/schools.js';
import { discoverAirport } from './pipelines/airport.js';
import { writeSectionAndNotify, CHANNELS } from './briefing-notify.js';
import { briefingLog, OP } from '../../logger/workflow.js';

/**
 * Generate a complete briefing row for a snapshot.
 * Each pipeline runs in parallel, writes its own section via pg_notify as it completes
 * (preserving the progressive-SSE pattern restored 2026-02-17), and returns a partial
 * row. Aggregator awaits all, assembles the final row, and returns it.
 *
 * Aggregator contains ZERO provider calls, ZERO LLM calls, ZERO DB writes (other than
 * an initial "row exists" marker). All I/O lives in pipelines.
 */
export async function generateAndStoreBriefing({ snapshotId, snapshot }) {
  briefingLog.phase(0, `Aggregator start: ${snapshotId.slice(0, 8)}`, OP.START);

  // Insert empty briefing row first so SSE channel writes have a target
  await initializeBriefingRow(snapshotId);

  // Fan out 6 pipelines in parallel; each writes its section as it completes
  const [events, weather, traffic, news, schools, airport] = await Promise.allSettled([
    discoverEvents({ snapshot, snapshotId }),
    discoverWeather({ snapshot, snapshotId }),
    discoverTraffic({ snapshot, snapshotId }),
    discoverNews({ snapshot, snapshotId }),
    discoverSchools({ snapshot, snapshotId }),
    discoverAirport({ snapshot, snapshotId }),
  ]);

  // Assemble final row from settled results (errors → errorMarker per existing pattern)
  const row = assembleBriefingRow({ events, weather, traffic, news, schools, airport });

  briefingLog.phase(0, `Aggregator done: ${snapshotId.slice(0, 8)}`, OP.DONE);
  return row;
}
```

**Why `Promise.allSettled` (not `Promise.all`):** existing pattern wraps individual failures in `errorMarker(err)` per section so partial briefings still ship. `allSettled` preserves that — one pipeline failing doesn't poison the briefing.

**Aggregator size budget:** ≤ 200 lines including imports, the assembler helper, and the row initializer. If it grows beyond that, something pipeline-shaped leaked in — refactor before merging.

### 3.4. `briefing-notify.js` scope

Owns:
- `writeSectionAndNotify(snapshotId, updates, notifyChannel)` — moved verbatim from `briefing-service.js:2991`
- `CHANNELS` — frozen object of canonical pg_notify channel names:
  ```js
  export const CHANNELS = Object.freeze({
    WEATHER: 'briefing_weather_ready',
    TRAFFIC: 'briefing_traffic_ready',
    EVENTS:  'briefing_events_ready',
    AIRPORT: 'briefing_airport_ready',
    NEWS:    'briefing_news_ready',
  });
  ```
- `errorMarker(err)` — the per-section error wrapper used by all 5 progressive writes
- (Possibly) `initializeBriefingRow(snapshotId)` — the empty-row insert that must happen before per-section writes can target it. Could live in aggregator instead; placement to be decided in Phase 1 by what minimizes coupling.

Does NOT own: SSE forwarding (that lives in `strategy-events.js` and stays there — `briefing-notify.js` is the *emission* side only).

### 3.5. `shared/` contents

| File | Source lines in briefing-service.js | Purpose |
|------|-------------------------------------|---------|
| `briefing-row-shape.js` | NEW (no source) | Canonical contract: per-section partial shapes + assembled row shape. Pipelines and aggregator import the same types. |
| `staleness.js` | 3416-3490 (`isDailyBriefingStale`, `isEventsStale`, `isTrafficStale`, `areEventsEmpty`) | Pure predicates. Used by `getOrGenerateBriefing` cache logic. |
| `get-market-for-location.js` | 111-140 (`getMarketForLocation`) | Used by ≥2 pipelines (events, traffic at minimum). |

NOT in shared: LLM prompts (per architectural principle from §3.3 of original proposal — keep prompts localized to pipeline identity); `withTimeout` / `safeJsonParse` (already at `server/api/utils/http-helpers.js`).

### 3.6. Migration strategy (re-export shim)

After Phase 1, `briefing-service.js` becomes:

```js
// server/lib/briefing/briefing-service.js
//
// 2026-05-02: This file was split into pipeline-pure modules per Workstream 6.
// It survives only as a re-export shim to avoid a flag-day rename across all callers.
// To be deleted in Phase 2 once callers migrate to direct imports from:
//   - ./briefing-aggregator.js
//   - ./pipelines/<name>.js
// See docs/review-queue/PLAN_workstream6_briefing_split.md

export { generateAndStoreBriefing, getBriefingBySnapshotId, getOrGenerateBriefing, refreshEventsInBriefing }
  from './briefing-aggregator.js';
export { fetchEventsForBriefing, deduplicateEvents, filterInvalidEvents }
  from './pipelines/events.js';
export { fetchWeatherForecast, fetchWeatherConditions }
  from './pipelines/weather.js';
export { fetchTrafficConditions }
  from './pipelines/traffic.js';
export { fetchRideshareNews }
  from './pipelines/news.js';
export { fetchSchoolClosures }
  from './pipelines/schools.js';
```

That's the entire file in Phase 1. Every existing caller continues to work without modification.

### 3.7. Phasing (commit-by-commit)

Each commit must independently pass `npm run typecheck` + a smoke test of `/api/blocks-fast`. Order minimizes blast radius.

| # | Commit | What it does | Why this order |
|---|--------|--------------|----------------|
| 1 | `feat(briefing): extract briefing-notify.js (writeSectionAndNotify + channels)` | Move only the notify primitives; `briefing-service.js` imports from new file. Pure relocation, zero behavior change. | First because every pipeline depends on it. |
| 2 | `feat(briefing): extract shared/staleness.js + shared/get-market-for-location.js` | Pure-function relocations. | Second because pipelines + aggregator both depend on these. |
| 3 | `feat(briefing): extract pipelines/schools.js` | Smallest pipeline (1 LLM call, ~120 lines), least risk. | Pilot the contract on the easiest pipeline first. |
| 4 | `feat(briefing): extract pipelines/weather.js` | Includes 4 formatter helpers. Resolves §2.6 weather drift (one function or two?). | Build confidence with second pipeline. |
| 5 | `feat(briefing): extract pipelines/airport.js` | Small, self-contained. | Quick win. |
| 6 | `feat(briefing): extract pipelines/news.js` | Includes 4 helpers + Claude WebSearch fallback. | Mid-complexity. |
| 7 | `feat(briefing): extract pipelines/traffic.js` | Resolves §2.6 dual `BRIEFING_TRAFFIC` site question. | Higher complexity. |
| 8 | `feat(briefing): extract pipelines/events.js` | Largest, ~1,200 lines including dedup, geocoding, validation. Verifies `_fetchEventsWithGemini3ProPreviewLegacy` (delete or keep). | Last because biggest. |
| 9 | `feat(briefing): extract briefing-aggregator.js (replaces generateAndStoreBriefing)` | All pipelines exist; aggregator wires them. `briefing-service.js` becomes re-export shim. | Final composition step. |
| 10 | `chore(briefing): update README + briefing/index.js for new structure` | Doc + barrel sync. | Wrap-up. |
| 11 | `test(briefing): add parity golden snapshot + per-pipeline unit tests` | Behavior verification. | Lands separately so test failures don't block the structural split. |

**Phase 2 (separate PR, after soak ≥ 7 days):**
- 12. Migrate callers (`server/api/briefing/briefing.js` etc.) to import directly from new locations
- 13. Delete `briefing-service.js` shim and remove legacy function aliases from pipelines

### 3.8. Test cases

**Parity (load-bearing):**
- Golden-snapshot diff of assembled `briefings` row before/after the entire split, for a fixed snapshot input. Must be byte-identical (allowing for explicit `_telemetry` additions).
- SSE channel emission order: assert all 5 channels (`briefing_*_ready`) fire during a briefing generation. Order is non-deterministic but the *set* must match.

**Per-pipeline isolation:**
- Each `pipelines/<name>.js` unit-testable with mocked `callModel`, mocked Places client, mocked DB. Tests live in `tests/briefing/pipelines/`.
- Tests assert: pipeline emits its own log tag (`[BRIEFING][TRAFFIC]` etc.), pipeline calls `writeSectionAndNotify` exactly once with the correct channel, pipeline returns the documented partial-row shape.

**Log shape (the structural enforcement):**
- Capture log output during a briefing generation, assert presence of `[BRIEFING][TRAFFIC]`, `[BRIEFING][EVENTS]`, `[BRIEFING][NEWS]`, `[BRIEFING][WEATHER]`, `[BRIEFING][SCHOOLS]`, `[BRIEFING][AIRPORT]` tagged lines.
- Assert NO ambiguous-source `[BRIEFING] <pipeline-specific message>` lines remain — this is the "9-stage taxonomy enforced in code" assertion.

**Caller compatibility:**
- Smoke test: `POST /api/blocks-fast` with a real snapshot, assert response shape unchanged.
- Smoke test: `GET /api/briefing/:snapshotId` returns identical row shape.
- Smoke test: `/events/briefing` SSE stream emits the same 5 channel events.

### 3.9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Progressive SSE write order changes, breaking client UX | Medium | High | Per-pipeline write happens at the same point in the lifecycle as today (after fetch+validate, before return). Tests assert all 5 channels fire. |
| Caller import breaks because shim missed an export | Low | High | Shim re-exports every existing export by name; grep verifies. |
| Two `BRIEFING_TRAFFIC` sites turn out to be a real bug being preserved | Medium | Medium | Phase 1 commit 7 explicitly investigates `analyzeTrafficWithAI` (called from events code path) and either preserves cross-pollution with a documented note or surfaces it as a separate ticket. Plan does not pre-decide. |
| `_fetchEventsWithGemini3ProPreviewLegacy` is actually live fallback | Low | High | Verify with `git log -p -S "_fetchEventsWithGemini3ProPreviewLegacy"` and grep for callers before deleting. Default: keep, mark as deprecated. |
| Drizzle schema imports get spread across 6 files, slowing build | Low | Low | Each pipeline imports only the tables it needs; total import surface decreases vs current god-file. |
| Test-suite latency increases (6 isolated test files vs 1) | Low | Low | Modern test runners parallelize; net wall-clock should be lower. |

### 3.10. What this does NOT change (anti-scope)

To keep the diff reviewable:
- No prompt changes
- No model swaps
- No new LLM calls
- No new DB columns
- No new SSE channels
- No behavioral changes to events dedup, validation, or geocoding
- No removal of `briefing-service.js` (deferred to Phase 2)
- No caller migration (deferred to Phase 2)

---

## 4. Step 2 — Catalog Schema Cleanup (high-level only)

Detailed Phase 0 plan to be written before execution. Sketch:

- **Migration A (this PR):** Add `discovered_events.source_model` column. Backfill from `venue_catalog.source_model` joined on `place_id`. Dual-write: `tactical-planner.js` (or wherever venues are surfaced) writes `source_model` to BOTH `venue_catalog` (legacy) AND `discovered_events` (new) for ≥7 days.
- **Migration B (separate PR after soak):** Drop `venue_catalog.source_model` column. Stop dual-writing.
- **Test cases:** Backfill row count matches expectations; new events get `source_model` populated; reads of historical events return correct attribution.
- **Why TWO migrations (Melody's directive):** zero-downtime — Migration B can roll back independently if dual-write data divergence appears in soak.

---

## 5. Step 3 — API Cache Enforcement / Venue Deduplication (high-level only)

Detailed Phase 0 plan to be written before execution. Sketch:

- **Behavioral change in `tactical-planner.js`:** today does Places Text Search → catalog lookup. Reverse: catalog lookup (by normalized name + city) → Places Text Search ONLY on miss → write hit back to catalog.
- **Behavioral tests:** seed catalog with anchor "Legacy Hall" + city "Frisco". Run `tactical-planner` query for "Legacy Hall, Frisco". Assert `placesApi.calls === 0`. Assert venue resolved from catalog.
- **Backfill:** the current ~13 known dup clusters in `venue_catalog` (e.g., Legacy Hall with 5 rows under 5 distinct `place_id`s) need consolidation. Strategy TBD: pick canonical row, repoint event FKs, delete duplicates. Possibly its own micro-migration before behavior change lands.
- **Risk:** false-positive catalog hits (catalog says "Legacy Hall, Frisco" but user meant a different venue with a similar name). Mitigation: catalog match requires normalized-name + city + state exact match; address-similarity threshold for tie-breaking.

---

## 6. Open items needing Melody's input before Phase 1 starts

1. **Branch strategy.** Step 1 lives where? Options:
   - (a) New branch off `main`: `feat/workstream6-briefing-split` — clean, isolated.
   - (b) New worktree at `.worktrees/ws6-briefing/` mirroring the Tier 3 worktree pattern.
   - (c) Continue on `feat/logger-tier3-auth-loc` — NOT recommended, Tier 3 is logging, this is structural.

   **Recommendation:** (a) new branch `feat/workstream6-briefing-split` off latest `main`, optionally with worktree if you want parallel sessions.

2. **PR granularity.** Step 1 has 11 commits. Options:
   - (a) Single PR with all 11 commits, reviewed by commit
   - (b) PR per pipeline (6 PRs) + 1 wrapper PR for aggregator+notify+shared
   - (c) Two PRs: (notify + shared + 3 pilot pipelines) then (3 remaining pipelines + aggregator + tests)

   **Recommendation:** (a) — the commit boundaries already provide review structure, and parity tests only become meaningful at the end. Splitting to multiple PRs forces partial parity assertions that aren't load-bearing.

3. **Step 2 / Step 3 ordering.** After Step 1 lands, do Steps 2 and 3 run in parallel (different branches) or strictly sequential? Step 3 (catalog-first lookup) interacts with Step 2 (catalog schema) — Step 2 first feels safer.

4. **Test-suite location.** `tests/briefing/pipelines/` does not exist today. Should I follow the existing test layout (where? — need to grep) or propose this directory? Will confirm during Phase 1 commit 11.

5. **Phase 2 timing.** "After ≥ 7 days soak" — start the clock from merge-to-main of Phase 1, or from deployment-to-prod? (Affects when caller migration + shim deletion lands.)

---

## 7. Sanity-check checklist (for Melody's final approval)

Before I create a single file:
- [ ] File structure approved (§3.1)
- [ ] Per-pipeline contract approved (§3.2)
- [ ] Aggregator design approved, including `Promise.allSettled` + progressive-write preservation (§3.3)
- [ ] `briefing-notify.js` scope approved, channel constants location approved (§3.4)
- [ ] `shared/` contents approved (§3.5)
- [ ] Re-export shim strategy approved (§3.6)
- [ ] 11-commit phasing approved (§3.7)
- [ ] Test cases approved as load-bearing parity criteria (§3.8)
- [ ] Anti-scope (§3.10) understood and accepted (no behavior changes; structural split only)
- [ ] Open items §6.1–6.5 answered

Once approved, Phase 1 begins on the branch chosen in §6.1.
