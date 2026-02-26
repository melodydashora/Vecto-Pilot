> **Last Verified:** 2026-02-26

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

## Connections

- **Imports from:** `../adapters/` (callModel), `../../../db/drizzle.js`
- **Writes to:** `briefings` table, `strategies` table
- **Called by:** `server/api/strategy/blocks-fast.js`, `server/api/strategy/strategy.js`
