# Strategy Module (`server/lib/strategy/`)

## Purpose

Strategy generation pipeline orchestration. Coordinates AI providers to generate driver positioning strategies.

## Structure

```
strategy/
├── strategy-generator.js          # Entry point - routes to parallel
├── strategy-generator-parallel.js # Main orchestrator (parallel pipeline)
├── strategy-utils.js              # Utility functions
├── strategyPrompt.js              # System prompts
├── strategy-triggers.js           # Trigger condition detection
├── planner-gpt5.js                # Venue planner (GPT-5.1)
├── tactical-planner.js            # Tactical guidance generation
└── strategies/
    ├── index.js                   # Provider registry
    └── assert-safe.js             # Safety assertions, cache warming
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `strategy-generator.js` | Entry point | `generateStrategyForSnapshot(snapshotId)` |
| `strategy-generator-parallel.js` | Parallel orchestrator | `generateMultiStrategy(params)` |
| `strategy-utils.js` | Utilities | `ensureStrategyRow()`, `fallbackStrategy()` |
| `strategyPrompt.js` | Prompts | Strategy system prompts |
| `strategy-triggers.js` | Trigger detection | `detectTriggers()` |
| `planner-gpt5.js` | Venue planning | `planVenues(snapshotId)` |
| `tactical-planner.js` | Tactical guidance | `generateTacticalPlan()` |
| `strategies/index.js` | Registry | Provider registration |
| `strategies/assert-safe.js` | Safety | `assertSafe()`, cache warming |

## Pipeline Flow

```
POST /api/blocks-fast
    ↓
strategy-generator.js (entry point)
    ↓
strategy-generator-parallel.js (orchestrator)
    │
    ├── Phase 1 (Parallel):
    │   ├── ai/providers/minstrategy.js → strategies.minstrategy
    │   ├── ai/providers/briefing.js → strategies.briefing
    │   └── Holiday detection
    │
    ├── Phase 2 (Sequential):
    │   └── ai/providers/consolidator.js
    │       ├── → strategies.consolidated_strategy (8-12hr)
    │       └── → strategies.strategy_for_now (1hr)
    │
    └── Phase 3:
        └── venue/enhanced-smart-blocks.js → rankings
```

## Usage

```javascript
import { generateStrategyForSnapshot } from './strategy-generator.js';

const strategy = await generateStrategyForSnapshot(snapshotId);
// Returns strategy text or null
```

## Connections

- **Imports from:** `../ai/` (adapters, providers), `../location/` (context), `../../db/`
- **Exported to:** `../../routes/blocks-fast.js`, `../../routes/strategy.js`
- **Triggers:** `../venue/enhanced-smart-blocks.js` after completion

## Database Writes

Writes to `strategies` table:
- `minstrategy` - Claude strategic overview
- `briefing` - Gemini research (JSON)
- `consolidated_strategy` - 8-12 hour strategy
- `strategy_for_now` - Immediate 1-hour guidance

## Import Paths

```javascript
// From server/api/*/
import { generateStrategyForSnapshot } from '../../lib/strategy/strategy-generator.js';
import { ensureStrategyRow } from '../../lib/strategy/strategy-utils.js';

// From server/lib/*/
import { generateStrategyForSnapshot } from '../strategy/strategy-generator.js';
import { detectTriggers } from '../strategy/strategy-triggers.js';
```
