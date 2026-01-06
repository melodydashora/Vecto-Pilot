> **Last Verified:** 2026-01-06

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
├── planner-gpt5.js                # Venue planner (GPT-5.2)
├── tactical-planner.js            # Tactical guidance generation
├── providers.js                   # Strategy provider registry
├── assert-safe.js                 # Async validation, cache warming
├── dump-last-strategy.js          # Debug utility: dump last strategy
└── index.js                       # Module barrel exports
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `strategy-generator.js` | Entry point | `generateStrategyForSnapshot(snapshotId, options)` |
| `strategy-generator-parallel.js` | Parallel orchestrator | `runSimpleStrategyPipeline(params)` |
| `strategy-utils.js` | Utilities | `ensureStrategyRow()`, `filterFreshEvents()`, `filterFreshNews()` |
| `strategyPrompt.js` | Prompts | Strategy system prompts |
| `strategy-triggers.js` | Trigger detection | `detectTriggers()` |
| `planner-gpt5.js` | Venue planning | `planVenues(snapshotId)` |
| `tactical-planner.js` | Tactical guidance | `generateTacticalPlan()` |
| `providers.js` | Registry | `providers`, `getStrategyProvider()` |
| `assert-safe.js` | Async validation | `safeAssertStrategies()`, `maybeWarmCaches()` |
| `dump-last-strategy.js` | Debug utility | CLI script for debugging |
| `index.js` | Barrel exports | Module re-exports |

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
    │   └── consolidator.js/runImmediateStrategy (GPT-5.2)
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
- `strategy_for_now` - Immediate 1-hour guidance (GPT-5.2)
- `consolidated_strategy` - 8-12 hour daily strategy (Gemini, on-demand)
- `status` - Pipeline status
- `phase` - Current pipeline phase

Writes to `briefings` table:
- `events` - Local events
- `traffic_conditions` - Traffic data
- `news` - Rideshare news
- `weather_current` - Current weather
- `school_closures` - School closure info

## Event Freshness Filtering

**Added 2026-01-05**: Prevents stale events (e.g., Christmas events in January) from appearing in briefings.

```javascript
import { filterFreshEvents, isEventFresh } from './strategy-utils.js';

// Filter an array of events - removes stale + events without dates
const freshEvents = filterFreshEvents(allEvents);

// Check a single event
if (isEventFresh(event)) {
  // Event hasn't ended yet
}
```

**Key behaviors:**
- **Rejects events without date info** - Events must have at least a `start_time`, `event_date`, or equivalent
- **Filters already-ended events** - Uses `end_time` if present, or `start_time + 4 hours` as default
- **Handles multiple field names** - Supports `end_time`, `endTime`, `ends_at`, `event_end_date`, etc.

**Applied in:**
- `server/api/briefing/briefing.js` - All endpoints returning events
- See `docs/EVENT_FRESHNESS_AND_TTL.md` for full architecture

## News Freshness Filtering

**Added 2026-01-05**: Ensures only today's news with valid publication dates appears in briefings.

```javascript
import { filterFreshNews, isNewsFromToday } from './strategy-utils.js';

// Filter an array of news items - removes stale + news without publication dates
const freshNews = filterFreshNews(allNews, new Date(), 'America/Chicago');

// Check a single news item
if (isNewsFromToday(newsItem, new Date(), 'America/Chicago')) {
  // News was published today
}
```

**Key behaviors:**
- **Rejects news without publication date** - News must have `published_date`, `pubDate`, or equivalent
- **Filters non-today news** - Only returns news from the current calendar date
- **Timezone-aware** - Uses snapshot timezone for accurate date comparison
- **Handles multiple field names** - Supports `published_date`, `publishedDate`, `pubDate`, `pub_date`, etc.

**Applied in:**
- `server/api/briefing/briefing.js` - All endpoints returning news (`/current`, `/generate`, `/snapshot/:snapshotId`, `/refresh`, `/rideshare-news/:snapshotId`, `/refresh-daily/:snapshotId`)

## Import Paths

```javascript
// From server/api/*/
import { generateStrategyForSnapshot } from '../../lib/strategy/strategy-generator.js';
import { ensureStrategyRow, filterFreshEvents, filterFreshNews } from '../../lib/strategy/strategy-utils.js';

// From server/lib/*/
import { generateStrategyForSnapshot } from '../strategy/strategy-generator.js';
import { detectTriggers } from '../strategy/strategy-triggers.js';
```
