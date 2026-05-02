> **Last Verified:** 2026-05-02 (Workstream 6 commit 10)

# Briefing Module (`server/lib/briefing/`)

## Purpose

Real-time briefing service for events, traffic, weather, news, airport conditions, and school closures. Provides the data shown in the Briefing tab and consumed by the Strategist AI.

## Architecture: Thin Facade / Orchestrator Inversion (2026-05-02, Workstream 6)

The briefing module follows a **thin facade + orchestrator inversion** pattern, decoupled from the legacy 3,683-line god-file in 11 commits across Workstream 6:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              External Callers                                │
│  server/api/briefing/briefing.js  •  server/api/location/snapshot.js  •      │
│  server/api/location/location.js (dynamic import)  •  dump-last-briefing.js  │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ (all imports go through the facade)
┌──────────────────────────────────────────────────────────────────────────────┐
│  briefing-service.js (38 lines) — THE FACADE                                 │
│  Pure re-export shim. 17 public symbols exposed:                             │
│    Orchestration (4):   generateAndStoreBriefing, getBriefingBySnapshotId,   │
│                         getOrGenerateBriefing, refreshEventsInBriefing       │
│    Pipeline contracts:  discoverSchools, discoverWeather, discoverAirport,   │
│                         discoverNews, discoverTraffic, discoverEvents        │
│    Legacy fetch* :      fetchSchoolClosures, fetchWeatherConditions,         │
│                         fetchRideshareNews, fetchTrafficConditions,          │
│                         fetchEventsForBriefing                               │
│    Events utilities:    deduplicateEvents (HASH dedup), filterInvalidEvents  │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  briefing-aggregator.js (710 lines) — THE ORCHESTRATOR                       │
│  Owns ALL cross-pipeline orchestration:                                      │
│    • inFlightBriefings concurrency Map (singleton per process)               │
│    • generateAndStoreBriefing — entry: dedup → advisory lock → placeholder   │
│    • generateBriefingInternal — schools cache → 5-pipeline allSettled →      │
│                                  final-assembly → DB write → pg_notify       │
│    • getBriefingBySnapshotId — DB read helper                                │
│    • getOrGenerateBriefing — smart cache-or-generate entry                   │
│    • refreshEventsInBriefing, refreshTrafficInBriefing, refreshNewsInBriefing│
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ (Promise.allSettled fan-out)
┌──────────────────────────────────────────────────────────────────────────────┐
│  pipelines/*.js — PER-PIPELINE DATA FETCHING                                 │
│  Each owns one section of the briefings row + its pg_notify channel.         │
│  All export a discover<Thing>({ snapshot, snapshotId }) pipeline contract.   │
│                                                                              │
│  pipelines/weather.js  → Google Weather API → weather_current + forecast     │
│  pipelines/traffic.js  → TomTom + analyzeTrafficWithAI → traffic_conditions  │
│  pipelines/events.js   → Gemini parallel-category discovery + venue          │
│                          resolution + discovered_events DB writes → events   │
│  pipelines/airport.js  → Gemini Google Search → airport_conditions           │
│  pipelines/news.js     → Gemini Google Search → news                         │
│  pipelines/schools.js  → Gemini (the pilot pipeline) → school_closures       │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  briefing-notify.js + shared/                                                │
│  briefing-notify.js: writeSectionAndNotify, CHANNELS (6 pg_notify channels), │
│                      errorMarker (failure sentinel)                          │
│  shared/safe-json-parse.js:           multi-attempt LLM JSON parser          │
│  shared/staleness.js:                 4 cache-staleness predicates           │
│  shared/get-market-for-location.js:   city/state → market_name DB lookup     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Why "thin facade + orchestrator inversion"?

The pre-Workstream-6 `briefing-service.js` was a 3,683-line monolith that mixed orchestration, per-pipeline data fetching, SSE write primitives, JSON parsing, cache predicates, and dead/legacy code. Three problems compounded:

1. **Cross-cutting concerns tangled** — adding a new pipeline meant editing the god-file; the orchestrator had to know every pipeline's internals.
2. **Tests were impossible** — the orchestrator and the per-pipeline logic shared so much state that you couldn't unit-test either independently.
3. **Dead code accumulated silently** — superseded LLM fallback paths (`fetchWeatherForecast`, `fetchNewsWithClaudeWebSearch`, `_fetchEventsWithGemini3ProPreviewLegacy`, `mapGeminiEventsToLocalEvents`, `LocalEventSchema`) were never deleted because no one knew if they were live.

Workstream 6 inverted the structure:

- **Pipelines own their data fetching** (per-section, per-channel, contract-bound)
- **Aggregator owns orchestration** (cross-pipeline `Promise.allSettled`, final-assembly, DB write)
- **Service is just a re-export facade** (zero logic, 38 lines)

This means: pipelines can be tested in isolation (mock `callModel` → test transformations); the aggregator can be tested with stubbed pipeline contracts; the facade is so trivial it doesn't need tests at all.

## Public API Surface (17 symbols)

All available via `import { ... } from '../../lib/briefing/briefing-service.js'`:

| Symbol | Source | Purpose |
|---|---|---|
| `generateAndStoreBriefing` | aggregator | Primary entry: full pipeline run + DB write |
| `getBriefingBySnapshotId` | aggregator | DB read helper |
| `getOrGenerateBriefing` | aggregator | Smart cache-or-generate entry |
| `refreshEventsInBriefing` | aggregator | Stale-events-only refresh |
| `discoverSchools` | pipelines/schools.js | Schools pipeline contract |
| `discoverWeather` | pipelines/weather.js | Weather pipeline contract |
| `discoverAirport` | pipelines/airport.js | Airport pipeline contract |
| `discoverNews` | pipelines/news.js | News pipeline contract |
| `discoverTraffic` | pipelines/traffic.js | Traffic pipeline contract |
| `discoverEvents` | pipelines/events.js | Events pipeline contract |
| `fetchSchoolClosures` | pipelines/schools.js | Legacy direct fetch (no SSE write) |
| `fetchWeatherConditions` | pipelines/weather.js | Legacy direct fetch (no SSE write) |
| `fetchRideshareNews` | pipelines/news.js | Legacy direct fetch (no SSE write) |
| `fetchTrafficConditions` | pipelines/traffic.js | Legacy direct fetch (no SSE write) |
| `fetchEventsForBriefing` | pipelines/events.js | Primary discovery + DB read |
| `deduplicateEvents` | pipelines/events.js | HASH dedup (Rule 16, distinct from `deduplicateEventsSemantic.js`) |
| `filterInvalidEvents` | pipelines/events.js | LIVE compatibility shim (distinct from `validateEventsHard`) |

**`index.js`** also exists as a wildcard barrel (`export * from './briefing-service.js'`) — defensive safety net for any bare-directory import. Currently has zero callers; all external consumers import from `briefing-service.js` directly.

## Pipeline Contract

Every pipeline exports a `discover<Thing>({ snapshot, snapshotId })` function with this contract:

```js
async function discoverThing({ snapshot, snapshotId }) {
  let value, reason = '<default no-data reason>';
  try {
    value = await fetchThing({ snapshot });
    reason = isEmpty(value) ? '<no-data reason>' : null;
    await writeSectionAndNotify(snapshotId, { <section>: value }, CHANNELS.<NAME>);
  } catch (err) {
    await writeSectionAndNotify(snapshotId, { <section>: errorMarker(err) }, CHANNELS.<NAME>);
    throw err;  // re-throw — orchestrator's allSettled captures via failedReasons
  }
  return { <section>: value, reason };
}
```

The pipeline owns **its own SSE write** (progressive streaming UX) and **its own errorMarker .catch wrapper**. The orchestrator owns the `Promise.allSettled` fan-out, the cross-pipeline failure aggregation (`failedReasons` map), the final-assembly write, and the `pg_notify('briefing_ready')` summary event.

### Two error pathways (preserved across the inversion)

- **Pathway A — thrown:** pipeline throws → `Promise.allSettled` captures → `failedReasons.<name>` populated → final-assembly fallback fires (using the `failedReasons` context).
- **Pathway B — graceful:** pipeline returns object with `reason` field → orchestrator reads `<thing>Result.<section>` directly.

Both pathways terminate in a NO-NULLS briefings row: every JSONB column gets a typed value with an explanatory `reason` string.

### Special cases

- **Weather** (only DUAL-section pipeline): `discoverWeather` writes BOTH `weather_current` AND `weather_forecast` in a single `writeSectionAndNotify` call. Returns `{ weather_current, weather_forecast, reason }`.
- **News** (only NESTED-reason pipeline): the `news` section IS itself `{ items, reason }`, so the wider contract becomes `{ news: { items, reason }, reason }` — outer reason for orchestrator-level failure messaging, inner reason for section content.
- **Events** (only POLYMORPHIC-section pipeline): the `events` column is the array directly when items > 0, OR a `{ items: [], reason }` object when empty. The pipeline preserves this polymorphism in its SSE write.
- **Schools** (the PILOT pipeline): catches its own errors internally and returns `[]` (no throw). Other 5 pipelines re-throw via `errorMarker .catch`.

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `briefing-service.js` | 38 | **Canonical facade** — pure re-export shim |
| `briefing-aggregator.js` | 710 | **Orchestrator** — cross-pipeline coordination + state |
| `briefing-notify.js` | ~80 | SSE write primitive + `CHANNELS` constant + `errorMarker` |
| `cleanup-events.js` | ~70 | Soft-deactivate past events (called from `pipelines/events.js`) |
| `dump-last-briefing.js` | ~270 | Debug utility: dump last briefing row to JSON file |
| `dump-latest.js` | ~30 | Debug utility: dump latest briefing |
| `dump-traffic-format.js` | ~25 | Debug utility: traffic format check |
| `filter-for-planner.js` | ~470 | Filter briefing for venue planner |
| `event-schedule-validator.js` | ~270 | Event verification (DISABLED) |
| `context-loader.js` | ~150 | Briefing context loading helper |
| `test-api.js` | ~45 | API testing utility |
| `index.js` | ~21 | Wildcard re-export barrel (safety net) |
| `pipelines/schools.js` | ~220 | Schools pipeline (the pilot) |
| `pipelines/weather.js` | ~290 | Weather pipeline (Google Weather API) |
| `pipelines/airport.js` | ~220 | Airport pipeline (Gemini + Google Search) |
| `pipelines/news.js` | ~280 | News pipeline (Gemini + Google Search) |
| `pipelines/traffic.js` | ~550 | Traffic pipeline (TomTom-first + Gemini fallback + analyzeTrafficWithAI) |
| `pipelines/events.js` | ~1090 | Events pipeline (Gemini parallel-category + venue resolution + DB writes) |
| `shared/safe-json-parse.js` | ~200 | Multi-attempt LLM JSON parser |
| `shared/staleness.js` | ~85 | 4 cache-staleness predicates |
| `shared/get-market-for-location.js` | ~50 | city/state → market_name DB lookup |

## AI Model Roles (Briefer Architecture)

All discovery uses the centralized `callModel()` adapter with these roles registered in `server/lib/ai/model-registry.js`:

| Role | Default Model | Pipeline | Purpose |
|------|-------|---------|---------|
| `BRIEFING_TRAFFIC` | Gemini 3 Pro | traffic | TomTom incident analysis → driver-focused briefing |
| `BRIEFING_EVENTS_DISCOVERY` | Gemini 3 Pro | events | Parallel-category event discovery + place_id resolution |
| `BRIEFING_AIRPORT` | Gemini 3 Pro | airport | Airport conditions + flight delays |
| `BRIEFING_NEWS` | Gemini 3 Pro | news | Rideshare-relevant news (last 2 days) |
| `BRIEFING_SCHOOLS` | Gemini 3 Pro | schools | School closures (15-mile radius) |

**Note:** `BRIEFING_WEATHER` was removed in Commit 4 (2026-05-02). The weather pipeline now uses Google Weather API directly (deterministic) — the LLM-based `fetchWeatherForecast` was dead code with zero callers, deleted along with its registry role.

## Behavioral Rules

### Event freshness — 2-hour post-event surge window (Commit 8.5, 2026-05-02)

**Events remain `is_active = true` for 2 hours after their `event_end_time`.** This window captures the post-event ride surge from attendees leaving the venue (large-venue dispersion + transit congestion delays mean drivers continue receiving rides up to ~2 hours after end_time).

The 2-hour window is **synchronized across two code paths**:

1. **Read-side freshness** (`server/lib/strategy/strategy-utils.js`): `POST_EVENT_SURGE_MS = 2 * 60 * 60 * 1000` controls `isEventFresh()` and `filterFreshEvents()`. Events stay visible in strategy outputs until `end_time + 2h`.
2. **Write-side deactivation** (`server/lib/briefing/cleanup-events.js`): `deactivatePastEvents()` computes `cutoff = now - 2h` in the driver's IANA timezone, then sets `is_active = false` for any event whose `(event_end_date, event_end_time)` is before that cutoff.

**Synchronization invariant:** the two windows MUST stay aligned. If they drift apart, the failure mode is read-side keeps events visible for X hours but write-side deactivates them after Y hours, causing events to disappear from the read path Y hours after end_time. Cross-reference comments in BOTH files explicitly call out this invariant.

### Hash dedup vs semantic dedup (Rule 16, CLAUDE.md)

Events run through two SEPARATE dedup passes in sequence:

1. **`deduplicateEvents` (HASH dedup)** — exported from `pipelines/events.js`. Groups by `(normalizeEventName(title), normalizeAddress(address), normalizeTime(start_time))` key. Cheap exact-key dedup. Catches "O by Cirque du Soleil" / "'O' by Cirque du Soleil (Shared Reality)" / "O by Cirque du Soleil at Cosm" variants.
2. **`deduplicateEventsSemantic` (semantic dedup)** — imported from `server/lib/events/pipeline/deduplicateEventsSemantic.js`. Title-similarity dedup. Catches "Jon Wolfe Concert" / "Jon Wolfe Live" / "Jon Wolfe" variants. Prefers specific venues over stadiums; longer titles over shorter.

Both run during `fetchEventsForBriefing`: hash-first (cheap, reduces input), then semantic (more expensive, catches what hash missed). Order matters. Re-exported from `briefing-service.js` for external API callers.

### Caching strategy

| Section | Cache policy |
|---|---|
| Weather | ALWAYS FRESH (Google API every request) |
| Traffic | ALWAYS FRESH (TomTom + Gemini every request) |
| News | ALWAYS FRESH (Gemini every request) |
| Airport | ALWAYS FRESH (Gemini every request) |
| School closures | 24-hour cache, city-level (cross-snapshot lookup in aggregator) |
| Events | DB-cached in `discovered_events` table, soft-deactivated when `event_end + 2h < now` |

## SSE Channels (briefing-notify.js)

Six pg_notify channels for progressive briefing-tab streaming:

```js
export const CHANNELS = Object.freeze({
  WEATHER:         'briefing_weather_ready',
  TRAFFIC:         'briefing_traffic_ready',
  EVENTS:          'briefing_events_ready',
  AIRPORT:         'briefing_airport_ready',
  NEWS:            'briefing_news_ready',
  SCHOOL_CLOSURES: 'briefing_school_closures_ready',
});
```

Each pipeline fires its channel as soon as its data is written; the briefing tab populates section-by-section as channels arrive. The aggregator fires a summary `briefing_ready` channel at the final atomic write.

## Workstream 6 Migration History

| Commit | Hash | Subject |
|---|---|---|
| 1/11 | `2c30edd6` | extract briefing-notify.js (writeSectionAndNotify + channels) |
| 2/11 | `b831b10a` | extract shared/ utilities (staleness, market lookup, JSON parser) |
| 3/11 | `5fd74087` | extract schools pipeline (pilot the per-pipeline contract) |
| 4/11 | `72dc30d8` | extract weather pipeline (deleted 1 dead code path) |
| 5/11 | `080a1c60` | extract airport pipeline |
| 6/11 | `582fa094` | extract news pipeline (deleted 2 dead code paths) |
| 7/11 | `fc400c15` | extract traffic pipeline (drift signal #2 — analyzeTrafficWithAI was misplaced, not cross-polluted) |
| 8/11 | `dc841ae3` | extract events pipeline THE BIG ONE (deleted 4 dead code paths) |
| 8.5/11 | `e7c17e80` | event freshness lifecycle 1h → 2h |
| 9/11 | `889660d4` | aggregator inversion + shim reduction (briefing-service.js: 802 → 38 lines) |
| 10/11 | (this commit) | architecture documentation and barrel |
| 11/11 | (pending) | parity tests |

**Cumulative briefing-service.js shrinkage across Commits 4-9:** 3,683 → 38 lines (-3,645 net, ~99.0% reduction).

For deeper context on any commit, see `claude_memory` rows #294 (Commit 4 dead-code precedent), #295 (Commit 6), #296 (Commit 7), #297 (Commit 8), #298 (Commit 8.5), #299 (Commit 9), and #300 (this Commit 10).
