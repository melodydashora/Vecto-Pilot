# AI Providers (`server/lib/ai/providers/`)

## Purpose

Strategy generation providers that produce specific outputs for the strategy pipeline. Each provider writes to a specific column in the `strategies` table.

## Files

| File | Purpose | Output Column | Model |
|------|---------|---------------|-------|
| `minstrategy.js` | Strategic overview | `minstrategy` | Claude Opus 4.5 |
| `briefing.js` | Events, traffic, news | `briefing` (JSON) | Gemini 3.0 Pro + Search |
| `consolidator.js` | Final strategy | `consolidated_strategy`, `strategy_for_now` | Gemini/GPT-5.1 |

## Provider Details

### minstrategy.js
```javascript
import { runMinStrategy } from './minstrategy.js';
await runMinStrategy(snapshotId);
// Writes to strategies.minstrategy
```
- Analyzes driver location, time, weather
- Returns 2-3 sentence strategic positioning advice
- Uses `callModel('strategist', ...)`

### briefing.js
```javascript
import { runBriefing } from './briefing.js';
await runBriefing(snapshotId);
// Writes to strategies.briefing (JSON)
```
- Researches events, traffic, news, weather
- Uses Gemini with Google Search for real-time data
- Returns JSON with events[], news[], traffic{}, weather{}

### consolidator.js
```javascript
import { consolidateStrategy } from './consolidator.js';
await consolidateStrategy(snapshotId);
// Writes to strategies.consolidated_strategy AND strategies.strategy_for_now
```
- Combines minstrategy + briefing
- Produces two outputs:
  - `consolidated_strategy`: 8-12 hour daily strategy (Briefing tab)
  - `strategy_for_now`: 1-hour immediate guidance (Strategy tab)

## Pipeline Sequence

```
Phase 1 (Parallel):
├── minstrategy.js → strategies.minstrategy
└── briefing.js → strategies.briefing

Phase 2 (After Phase 1 completes):
└── consolidator.js → strategies.consolidated_strategy
                   → strategies.strategy_for_now
```

## Connections

- **Imports from:** `../adapters/index.js` (callModel), `../../location/` (context)
- **Writes to:** `strategies` table via Drizzle ORM
- **Called by:** `../../strategy/strategy-generator-parallel.js`
