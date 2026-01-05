# AI Module (`server/lib/ai/`)

## Purpose

Centralized AI model management: adapters for different providers (Anthropic, OpenAI, Google), strategy providers, and supporting utilities.

## Structure

```
ai/
├── adapters/           # Model API adapters (call these, not providers directly)
│   └── index.js        # Main dispatcher: callModel(role, {system, user})
├── providers/          # Strategy generation providers
│   ├── briefing.js     # Events, traffic, news (Gemini + Search)
│   └── consolidator.js # Strategy generation (GPT-5.2 + Gemini)
├── coach-dal.js        # Data access layer for AI Coach chat
├── index.js            # Barrel exports for ai module
├── llm-router-v2.js    # LLM status/routing (used by health endpoint)
├── model-registry.js   # Model configuration registry
├── models-dictionary.js # Model metadata registry
└── unified-ai-capabilities.js # AI capability manager
```

## Key Pattern: Use Adapters, Not Direct API Calls

**Always use `callModel()` from adapters/index.js** - never call AI APIs directly:

```javascript
import { callModel } from './adapters/index.js';

// Use {TABLE}_{FUNCTION} role names for clarity
const result = await callModel('STRATEGY_CORE', { system, user });
const events = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user });

// Legacy names still work (auto-mapped to new names)
const legacy = await callModel('strategist', { system, user }); // → STRATEGY_CORE

// Returns: { ok: boolean, output: string, citations?: array }
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `adapters/index.js` | Model dispatcher with fallback | `callModel(role, {system, user})` |
| `providers/briefing.js` | Events/traffic/news research | `runBriefing(snapshotId, { snapshot })` |
| `providers/consolidator.js` | Strategy generation | `runImmediateStrategy()`, `runConsolidator()` |
| `coach-dal.js` | Chat data access layer | `CoachDAL` class |
| `index.js` | Barrel exports for ai module | Module re-exports |
| `llm-router-v2.js` | LLM status for health checks | `getLLMStatus()` |
| `model-registry.js` | Model configuration registry | Model config lookup |
| `models-dictionary.js` | Model metadata registry | `MODELS` dictionary |
| `unified-ai-capabilities.js` | AI capability manager | `unifiedCapabilities` |

## Connections

- **Imports from:** `../location/`, `../../db/`, `shared/schema.js`
- **Exported to:** `../strategy/`, `../briefing/`, `../../api/strategy/`

## Model-Role Mapping (`{TABLE}_{FUNCTION}` Convention)

Roles follow the `{TABLE}_{FUNCTION}` naming convention where the prefix indicates the output destination:
- `BRIEFING_*` → `briefings` table
- `STRATEGY_*` → `strategies` table
- `VENUE_*` → `ranking_candidates` table
- `COACH_*` → `coach_conversations` table
- `UTIL_*` → Validation/parsing (no direct DB write)

**Key Roles:**

| Role | Env Variable | Default Model | Purpose |
|------|--------------|---------------|---------|
| `STRATEGY_CORE` | `STRATEGY_CORE_MODEL` | Claude Opus 4.5 | Core strategic plan generation |
| `STRATEGY_CONTEXT` | `STRATEGY_CONTEXT_MODEL` | Gemini 3 Pro | Real-time context gathering |
| `STRATEGY_TACTICAL` | `STRATEGY_TACTICAL_MODEL` | GPT-5.2 | Immediate 1hr tactical strategy |
| `STRATEGY_DAILY` | `STRATEGY_DAILY_MODEL` | Gemini 3 Pro | Long-term 8-12hr daily strategy |
| `BRIEFING_EVENTS_VALIDATOR` | `BRIEFING_VALIDATOR_MODEL` | Claude Opus 4.5 | Event schedule verification |
| `VENUE_SCORER` | `VENUE_SCORER_MODEL` | GPT-5.2 | Smart Blocks venue scoring |
| `VENUE_FILTER` | `VENUE_FILTER_MODEL` | Claude Haiku | Fast venue filtering |

**Legacy Support:** Old role names (`strategist`, `briefer`, `consolidator`) are automatically mapped to new names. See `model-registry.js` for the complete mapping.

## TRIAD Pipeline (Strategy Generation)

The TRIAD pipeline generates strategies in 4 phases:

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): STRATEGY_CORE + STRATEGY_CONTEXT + Holiday Check
│   ├── STRATEGY_CORE → strategies.minstrategy
│   ├── STRATEGY_CONTEXT → briefings table
│   └── holiday-checker → holiday context
│
├── Phase 2 (Parallel): STRATEGY_DAILY + STRATEGY_TACTICAL
│   ├── STRATEGY_DAILY → strategies.consolidated_strategy
│   └── STRATEGY_TACTICAL → strategies.strategy_for_now
│
├── Phase 3: VENUE_SCORER + Enrichment
│   └── VENUE_SCORER → rankings + ranking_candidates
│
└── Phase 4: BRIEFING_EVENTS_VALIDATOR
    └── Event schedule verification with web search
```

**Phase Timing (expected durations):**
- `starting`: 500ms
- `resolving`: 1500ms
- `analyzing` (briefing): 12000ms
- `immediate` (GPT-5.2): 8000ms
- `venues`: 3000ms
- `enriching` (Google APIs): 15000ms

## Fallback System

When primary model fails, certain roles automatically fall back to Claude Opus:
- Roles with fallback: `STRATEGY_TACTICAL`, `STRATEGY_CONTEXT`, `STRATEGY_DAILY`, `BRIEFING_EVENTS_DISCOVERY`, `BRIEFING_NEWS`
- Fallback model: `claude-opus-4-5-20251101`
- Configured in: `model-registry.js` → `FALLBACK_ENABLED_ROLES`

## CoachDAL (AI Coach Data Access)

The `coach-dal.js` provides data access for the AI Coach chat, including context retrieval and action execution.

### Key Methods

| Method | Purpose |
|--------|---------|
| `getCompleteContext(snapshotId)` | Full context for AI Coach prompt |
| `formatContextForPrompt(context)` | Format context as prompt text |
| `saveUserNote(noteData)` | Save coach note about driver |
| `deactivateEvent({ event_title, reason })` | Deactivate event by title (title-based lookup) |
| `reactivateEvent({ event_title, reason })` | Reactivate mistakenly deactivated event |
| `deactivateNews({ news_title, reason })` | Deactivate news item (hash-based) |
| `saveZoneIntelligence(zoneData)` | Save crowd-sourced zone intel |
| `getZoneIntelligenceSummary(marketSlug)` | Get zone intel for AI prompt |

### Event Deactivation/Reactivation

Events are looked up by title (case-insensitive), not ID:
```javascript
// Deactivate (sets is_active = false on discovered_events)
await coachDAL.deactivateEvent({
  event_title: "Holiday Lights at Legacy West",
  reason: "event_ended",
  notes: "Ended December 31st"
});

// Reactivate (sets is_active = true, clears deactivation fields)
await coachDAL.reactivateEvent({
  event_title: "Holiday Lights at Legacy West",
  reason: "wrong date assumed"
});
```

## Import Paths

```javascript
// From server/api/*/
import { callModel } from '../../lib/ai/adapters/index.js';
import { getLLMStatus } from '../../lib/ai/llm-router-v2.js';
import { CoachDAL } from '../../lib/ai/coach-dal.js';

// From server/lib/*/
import { callModel } from '../ai/adapters/index.js';
import { runBriefing } from '../ai/providers/briefing.js';
import { runImmediateStrategy, runConsolidator } from '../ai/providers/consolidator.js';
```
