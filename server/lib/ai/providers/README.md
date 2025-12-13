# AI Providers (`server/lib/ai/providers/`)

## Purpose

Strategy generation providers that produce specific outputs for the strategy pipeline. Each provider writes to specific tables/columns.

## Files

| File | Purpose | Output | Model |
|------|---------|--------|-------|
| `briefing.js` | Events, traffic, news, weather | `briefings` table | Gemini 3.0 Pro + Search |
| `consolidator.js` | Strategy generation | `strategies.strategy_for_now`, `strategies.consolidated_strategy` | GPT-5.1 / Gemini |

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

Two exported functions:

#### runImmediateStrategy (Primary - used in blocks-fast pipeline)
```javascript
import { runImmediateStrategy } from './consolidator.js';
await runImmediateStrategy(snapshotId, { snapshot });
// Writes to strategies.strategy_for_now
```
- Generates tactical intelligence from briefing data (traffic, events, news, closures)
- Focuses on EMERGENT conditions - what's happening RIGHT NOW
- Does NOT list specific venues (SmartBlocks handles venue recommendations)
- Identifies hot zones/areas based on events, traffic patterns, timing
- Uses GPT-5.2 with snapshot + ALL briefing fields
- Called automatically during POST /api/blocks-fast

#### runConsolidator (On-demand - user request only)
```javascript
import { runConsolidator } from './consolidator.js';
await runConsolidator(snapshotId, { snapshot });
// Writes to strategies.consolidated_strategy
```
- Generates 8-12 hour daily strategy
- Uses Gemini 3 Pro (with Claude Opus fallback)
- Called on-demand via POST /api/strategy/daily/:snapshotId

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
snapshot (location, time, weather)
    ↓
briefing.js → briefings table
    ↓
runImmediateStrategy() → strategy_for_now (1hr tactical)
    ↓
SmartBlocks generation
    ↓
(optional) runConsolidator() → consolidated_strategy (8-12hr daily)
```

## Connections

- **Imports from:** `../adapters/` (model adapters), `../../../db/drizzle.js`
- **Writes to:** `briefings` table, `strategies` table
- **Called by:** `server/api/strategy/blocks-fast.js`, `server/api/strategy/strategy.js`
