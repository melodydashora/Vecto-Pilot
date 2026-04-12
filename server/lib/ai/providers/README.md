> **Last Verified:** 2026-04-11 (Strategist Data Enrichment: driver preferences, NEAR/FAR event distance annotation, 6-hour weather forecast timeline, structured traffic intel, earnings math, home base context — see STRATEGIST_ENRICHMENT_PLAN.md)

# AI Providers (`server/lib/ai/providers/`)

## Purpose

Strategy generation providers that produce specific outputs for the strategy pipeline. Each provider writes to specific tables/columns.

## Files

| File | Purpose | Output | Model |
|------|---------|--------|-------|
| `briefing.js` | Events, traffic, news, weather | `briefings` table | Gemini 3.0 Pro + Search |
| `consolidator.js` | Strategy generation | `strategies.strategy_for_now`, `strategies.consolidated_strategy` | Via callModel (STRATEGY_TACTICAL, STRATEGY_DAILY) |

## Provider Details

### briefing.js
```javascript
import { runBriefing } from './briefing.js';
await runBriefing(snapshotId, { snapshot });
// Writes to briefings table (events, traffic, news, weather, school_closures)
```
- Researches events, traffic, news, weather
- Uses Gemini with Google Search for real-time data
- Returns JSON with events[], news{}, traffic{}, weather{}
- Writes to separate `briefings` table (not strategies)

### consolidator.js

Two exported functions and several internal helpers for briefing data optimization.

#### runImmediateStrategy (Primary - used in blocks-fast pipeline)
```javascript
import { runImmediateStrategy } from './consolidator.js';
await runImmediateStrategy(snapshotId, { snapshot });
// Writes to strategies.strategy_for_now
```
- Analyzes ALL briefing data (traffic, events, news, closures, weather)
- Generates strategic brief (~500 chars) with structured fields:
  - **GO:** Area/zone to position now (clusters, not isolated spots)
  - **AVOID:** Roads with incidents
  - **WHEN:** Timing window (considers event END times for exit surge)
  - **WHY:** Which event/condition is driving demand
  - **IF NO PING:** Backup plan, or "head home with destination filter ON"
- Does NOT list specific venues (venue cards handle that)
- Uses STRATEGY_TACTICAL role via callModel (Claude Opus)
- Called automatically during POST /api/blocks-fast
- **2026-02-26:** Enhanced with time-of-day intelligence, event END time surge awareness, cluster logic, and "head home" guidance

#### runConsolidator (On-demand - user request only)
```javascript
import { runConsolidator } from './consolidator.js';
await runConsolidator(snapshotId, { snapshot });
// Writes to strategies.consolidated_strategy
```
- Generates 8-12 hour daily strategy organized as time-block plan
- Uses STRATEGY_DAILY role via callModel (with BRIEFING_FALLBACK on failure)
- Called on-demand via POST /api/strategy/daily/:snapshotId
- **2026-02-26:** Enhanced with time-block structure, event END time surge, cluster logic, and honest dead-hours guidance

#### Internal Data Optimization Helpers (2026-02-26)

These functions simplify raw briefing data before including it in strategy prompts, reducing token usage:

| Function | Change | Purpose |
|----------|--------|---------|
| `optimizeWeatherForLLM(weather)` | Returns `driverImpact` summary string | Replaces full weather JSON blob with 1-2 sentence summary |
| `optimizeNewsForLLM(news)` | Returns max 5 items with headline+impact only | Reduced from 8 items; strips summary/source/date |
| `optimizeAirportForLLM(airport)` | Returns `travelImpact` summary string | Replaces full airport JSON with delay/status summary |
| `formatNewsForPrompt(newsItems)` | Formats news as `- [HIGH] headline` strings | Human-readable prompt format instead of JSON |
| ~~`optimizeTrafficForLLM()`~~ | **Removed** | Both prompts now use `driverImpact` summary directly from traffic data |

**Bug fix (2026-02-26):** Tactical prompt used `snapshot.weather` (undefined -- snapshot has no weather). Fixed to `briefing.weather`.

## Pipeline Sequence

```
POST /api/blocks-fast Pipeline:

Phase 1: Briefing
└── briefing.js → briefings table (events, traffic, news, weather)

Phase 2: Immediate Strategy
└── consolidator.js (runImmediateStrategy) → strategies.strategy_for_now

Phase 3: Venue Generation
└── tactical-planner.js + enhanced-smart-blocks.js → rankings + ranking_candidates

(Optional) On-Demand Daily Strategy:
└── POST /api/strategy/daily → consolidator.js (runConsolidator) → strategies.consolidated_strategy
```

## Data Flow

```
snapshot (location, time, timezone)
    ↓
briefing.js → briefings table
    ↓
runImmediateStrategy() → strategy_for_now (1hr tactical)
    ↓
SmartBlocks generation
    ↓
(optional) runConsolidator() → consolidated_strategy (8-12hr daily)
```

## Strategy Prompt Intelligence (2026-02-26)

Both STRATEGY_TACTICAL and STRATEGY_DAILY prompts include contextual intelligence:

- **Time-of-day awareness:** Prompt includes a time-of-day matrix (morning commuters, midday airport arrivals, evening events, late-night bar closings, dead hours)
- **Event END time surge:** Explicitly tells the LLM that crowds LEAVING events create bigger surge than arrivals
- **Cluster logic:** Prefers nightlife districts, hotel zones, and event complexes over isolated one-off venues
- **"Head home" option:** When nothing is nearby and demand is low, the LLM is allowed to recommend heading home with destination filter on
- **System messages:** Updated for both prompts to reflect an experienced driver mindset (not generic AI assistant)

## Strategist Data Enrichment (2026-04-11)

**The most significant change ever made to the strategist pipeline.** Both
STRATEGY_TACTICAL and STRATEGY_DAILY prompts now receive dispatcher-quality
data instead of the stripped-down summaries they received prior to this date.
See `STRATEGIST_ENRICHMENT_PLAN.md` for the full design rationale.

### What changed

Before 2026-04-11, the strategist received:
- Traffic as a 1-line summary (`driverImpact` only)
- Weather as a 1-line summary (`driverImpact` only — `weather_forecast` was populated but never read)
- Events as an unstructured list with no distance signal
- **ZERO driver preferences** (vehicle class, fuel cost, earnings goal, home base — all invisible)

After 2026-04-11, the strategist receives:

| Enrichment | Details |
|------------|---------|
| **1. Driver preferences** | Vehicle class (derived from `driver_profiles.elig_*`), fuel economy mpg, gas/EV fuel cost per mile, earnings goal, shift hours target, max deadhead distance, home base. Loaded via `loadDriverPreferences(userId)` — single indexed lookup on `driver_profiles`. |
| **2. Full traffic intelligence** | Structured `incidents[]` (top 5 by severity), `closures[]` (top 5 by distance), `highDemandZones[]`, `congestionLevel`, and `avoidAreas[]` — all with road names and distances from driver. Reads the additive fields `analyzeTrafficWithGemini` now preserves from raw TomTom data. |
| **3. Event distance annotation (NEAR/FAR)** | Every event gets `distance_mi` and a `[NEAR X.Xmi]` or `[FAR X.Xmi]` tag. NEAR = within 15 mi (candidate venue), FAR = beyond 15 mi (surge flow intelligence only, not a destination). NEAR events prioritized in the slice. Uses `venue_lat`/`venue_lng` already present in `briefings.events` — no new DB query. |
| **4. Weather forecast timeline** | Compact 6-hour forecast line (`76°F now → 75°F@7pm (14% precip) → ...`) plus conditional `⚠️ STORM RISK` line when any hour has precipitation probability > 30%. Reads `briefings.weather_forecast` which was populated upstream but previously unused. |
| **5. Event capacity heuristic** | Each event gets an `estimated_attendance` number from a venue-type + category heuristic (stadium→18k, amphitheater→12k, theater→2k, comedy club→350, nightclub→1000). Prompt renders as `~X expected` so the LLM can distinguish a 500-person show from a 20k-person sold-out concert. |
| **6. Home base context** | Explicit `Home base:` line in DRIVER CONTEXT with distance from current position. Driver's home lat/lng are read from `driver_profiles`. Lets the strategist reason about "stay close vs go far" against the `max_deadhead_mi` preference. |
| **7. Earnings math context** | Pre-computed block with vehicle class rate card, gas or EV fuel cost per mile, net per mile, and (when goal + hours are set) required `$/hour gross`. Lets the strategist quote "Drive to X (12mi, ~$2.40 fuel) for $40-60 surge rides" instead of generic "go north." |

### The helper function catalog

All new helpers live at the top of `consolidator.js` in a clearly-delimited
block (`=== STRATEGIST ENRICHMENT HELPERS ===`). They are all **additive and
defensive** — every helper degrades gracefully when a field is null, a row
is missing, or the driver_profiles schema migration hasn't been applied.

| Helper | Purpose |
|--------|---------|
| `haversineMiles(lat1, lon1, lat2, lon2)` | Distance in miles; returns `Infinity` for null coords. |
| `DRIVER_PREF_DEFAULTS` | Frozen const: `vehicle_class='UberX'`, `fuel_economy_mpg=25`, `earnings_goal_daily=null`, `shift_hours_target=null`, `max_deadhead_mi=15`. |
| `RATE_DEFAULTS` | Per-class rate cards (perMile + perMin) for UberX / UberXL / UberXXL / Comfort / Black / Black SUV. Illustrative baselines labeled as "estimated" in the prompt. |
| `DEFAULT_GAS_PRICE` | Default gas price per gallon, overridable via `process.env.GAS_PRICE_DEFAULT`. |
| `EV_COST_PER_MILE` | Flat cost per mile for electric vehicles (~$0.04/mi). |
| `NEAR_EVENT_RADIUS_MILES` | 15 — matches the VENUE_SCORER supreme distance rule so strategist and Smart Blocks share a mental model. |
| `deriveVehicleClass(profile)` | Maps `driver_profiles.elig_*` booleans to a vehicle class string. Highest-tier-eligible wins. |
| `loadDriverPreferences(userId)` | Fetches driver_profiles row with defensive PG error `42703` fallback (column does not exist — migration pending). Always returns a well-formed prefs object. |
| `computeFuelCostPerMile(prefs)` | Branches on `is_electric`; returns gas-cost-per-mile OR EV-cost-per-mile. |
| `buildDriverPreferencesSection(prefs)` | Single-line DRIVER PREFERENCES prompt block. |
| `buildEarningsContextSection(prefs)` | Multi-line EARNINGS CONTEXT block. Omits `need $X/hr gross` line when goal/hours missing. |
| `buildHomeBaseLine(snapshot, prefs)` | Returns home-base line or null when home data is unpopulated. |
| `estimateEventCapacity(event)` | Venue-type + category heuristic for attendance numbers. |
| `annotateAndBucketEvents(events, lat, lng)` | Attaches `distance_mi` + `estimated_attendance`, sorts into `{near, far, unknown}` buckets. |
| `formatEventsForStrategist(events, snapshot, limit)` | Async. Filter → bucket → prioritize (NEAR first, then FAR by impact+distance, then unknown) → batch-lookup venue hours → render. |
| `formatTrafficIntelForStrategist(traffic)` | Graceful degradation: structured incidents/closures → Gemini `keyIssues`/`avoidAreas` → `driverImpact` line. |
| `formatWeatherForStrategist(current, forecast, timezone)` | Current driverImpact + 6-hour timeline + optional storm risk warning. |

### Graceful degradation ladders

The three enriched data blocks each have a multi-tier fallback so the
strategist is NEVER deprived of information it used to have. Every enrichment
is additive — legacy briefings keep working.

**Traffic:**
1. Best case: structured `incidents`, `closures`, `highDemandZones`, `congestionLevel`, `avoidAreas` — full structured block
2. Middle: only Gemini analysis (`avoidAreas[]`, `keyIssues[]`, `closuresSummary`) — labeled `KEY ISSUES:`
3. Worst case: only `driverImpact` 1-liner — current behavior pre-enrichment

**Weather:**
1. Best case: `driverImpact` + 6-hour forecast timeline + optional storm warning
2. Worst case: only `driverImpact` 1-liner — current behavior pre-enrichment

**Events:**
1. Best case: events with `venue_lat`/`venue_lng` → distance annotated → NEAR/FAR bucketed → capacity estimated → venue-hours augmented
2. Middle: events without coords → `[?mi]` tag, still bucketed by impact
3. Worst case: no events → "No relevant events in the next 6 hours"

### Schema migration — pending follow-up

Four new columns are required on `driver_profiles` to capture all seven
enrichments. The migration is documented in `STRATEGIST_ENRICHMENT_PLAN.md`
section 5 and flagged in `docs/review-queue/pending.md`:

```sql
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS fuel_economy_mpg integer,
  ADD COLUMN IF NOT EXISTS earnings_goal_daily numeric(10,2),
  ADD COLUMN IF NOT EXISTS shift_hours_target numeric(4,1),
  ADD COLUMN IF NOT EXISTS max_deadhead_mi integer;
```

Until this runs, `loadDriverPreferences` catches PG error `42703` and falls
back to defaults. After it runs, real values flow through automatically
with **zero code changes**. This decoupling lets the strategist enrichment
ship without waiting for schema review.

### Token budget

The seven enrichments add roughly **575–665 tokens** to the prompt, well
within the target of 500–800. Pre-enrichment prompt size: 800–1500 tokens.
Post-enrichment: 1400–2200 tokens. Every modern model handles this with
headroom to spare.

### Why this matters

A driver is trying to put food on the table. Before 2026-04-11, the
strategist spoke in generalities — "position near events," "watch for
surge." That's the advice of a stranger. After 2026-04-11, the strategist
speaks as a dispatcher who knows this specific driver — their vehicle,
their fuel cost, their earnings goal, their home base, which events are
actually reachable, which are intel about surge flow, and how the weather
will shift in the next three hours. That's the advice of a colleague.

### See also

- `STRATEGIST_ENRICHMENT_PLAN.md` — full plan with design rationale, schema
  migration SQL, test strategy, risks, and the master-architect pushback on
  snapshot-level field placement.
- `../briefing/README.md` § "Traffic Intelligence Persistence (2026-04-11)" —
  the additive `analyzeTrafficWithGemini` return-shape change.
- `CHANGELOG.md` — `[Unreleased] — 2026-04-11 (Strategist Data Enrichment — "Change Lives")`.

## Connections

- **Imports from:** `../adapters/` (callModel), `../../../db/drizzle.js`
- **Writes to:** `briefings` table, `strategies` table
- **Called by:** `server/api/strategy/blocks-fast.js`, `server/api/strategy/strategy.js`
