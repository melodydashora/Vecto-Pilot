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
├── providers.js                   # Strategy provider registry
└── assert-safe.js                 # Async validation, cache warming
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `strategy-generator.js` | Entry point | `generateStrategyForSnapshot(snapshotId, options)` |
| `strategy-generator-parallel.js` | Parallel orchestrator | `runSimpleStrategyPipeline(params)` |
| `strategy-utils.js` | Utilities | `ensureStrategyRow()`, `fallbackStrategy()` |
| `strategyPrompt.js` | Prompts | Strategy system prompts |
| `strategy-triggers.js` | Trigger detection | `detectTriggers()` |
| `planner-gpt5.js` | Venue planning | `planVenues(snapshotId)` |
| `tactical-planner.js` | Tactical guidance | `generateTacticalPlan()` |
| `providers.js` | Registry | `providers`, `getStrategyProvider()` |
| `assert-safe.js` | Async validation | `safeAssertStrategies()`, `maybeWarmCaches()` |

## CRITICAL: Pass Full Snapshot Row

**LLMs cannot reverse geocode.** Always pass the full snapshot object:

```javascript
// CORRECT - Pass full snapshot row with formatted_address
await generateStrategyForSnapshot(snapshotId, { snapshot: fullSnapshotRow });

// WRONG - Forces DB fetch, may fail if formatted_address missing
await generateStrategyForSnapshot(snapshotId);
```

The snapshot **MUST** have `formatted_address`. The function will fail if missing.

## Location Data Flow

```
coords_cache.formatted_address (resolved by Google API)
       ↓
users.formatted_address (populated from coords_cache)
       ↓
snapshots.formatted_address (populated from users)
       ↓
generateStrategyForSnapshot({ snapshot })
       ↓
runBriefing({ snapshot }) → briefings table
       ↓
runImmediateStrategy({ snapshot }) → strategies.strategy_for_now
       ↓
LLM prompt: "LOCATION: 1753 Saddle Tree Rd, Frisco, TX"
```

**Never send raw coordinates to LLMs** - they cannot determine the address.

## Pipeline Flow

```
POST /api/blocks-fast
    ↓
blocks-fast.js (validates formatted_address exists)
    ↓
    │
    ├── Phase 1: Briefing
    │   └── briefing.js (Gemini) → briefings table
    │
    ├── Phase 2: Immediate Strategy
    │   └── consolidator.js/runImmediateStrategy (GPT-5.1)
    │       └── → strategies.strategy_for_now (1hr tactical)
    │
    └── Phase 3: Venue Generation
        └── enhanced-smart-blocks.js → rankings + ranking_candidates

POST /api/strategy/daily (on-demand):
    └── consolidator.js/runConsolidator (Gemini)
        └── → strategies.consolidated_strategy (8-12hr daily)
```

## Usage

```javascript
import { generateStrategyForSnapshot } from './strategy-generator.js';

// RECOMMENDED: Pass full snapshot to avoid DB fetch
const snapshot = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, id));
const strategy = await generateStrategyForSnapshot(id, { snapshot });

// Fallback: Will fetch from DB (logs warning)
const strategy = await generateStrategyForSnapshot(id);
```

## Snapshot Row Propagation

The full snapshot row is passed through the entire pipeline:

```
snapshot.js
    └── generateStrategyForSnapshot(id, { snapshot: dbSnapshot })
              │
              └── runSimpleStrategyPipeline({ snapshot })
                        │
                        ├── runBriefing(id, { snapshot })
                        └── runImmediateStrategy(id, { snapshot })

blocks-fast.js
    └── runBriefing(snapshotId, { snapshot })
    └── runImmediateStrategy(snapshotId, { snapshot })
```

## Connections

- **Imports from:** `../ai/` (adapters, providers), `../location/` (context), `../../db/`
- **Exported to:** `../../api/strategy/blocks-fast.js`, `../../api/strategy/strategy.js`
- **Triggers:** `../venue/enhanced-smart-blocks.js` after completion

## Database Writes

Writes to `strategies` table:
- `strategy_for_now` - Immediate 1-hour guidance (GPT-5.1)
- `consolidated_strategy` - 8-12 hour daily strategy (Gemini, on-demand)
- `status` - Pipeline status
- `phase` - Current pipeline phase

Writes to `briefings` table:
- `events` - Local events
- `traffic_conditions` - Traffic data
- `news` - Rideshare news
- `weather_current` - Current weather
- `school_closures` - School closure info

## Import Paths

```javascript
// From server/api/*/
import { generateStrategyForSnapshot } from '../../lib/strategy/strategy-generator.js';
import { ensureStrategyRow } from '../../lib/strategy/strategy-utils.js';

// From server/lib/*/
import { generateStrategyForSnapshot } from '../strategy/strategy-generator.js';
import { detectTriggers } from '../strategy/strategy-triggers.js';
```
