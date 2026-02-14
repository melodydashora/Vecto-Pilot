> **Gemini Analysis (2026-02-11):**
> **Core Function:** This directory manages all AI interactions, enforcing the "Adapter Pattern" to decouple application logic from specific providers (OpenAI, Anthropic, Google).
> **Key Architecture:** It houses the **TRIAD Pipeline** (Strategist -> Planner -> Validator), which orchestrates multi-model strategy generation.
> **Critical Rule:** Direct LLM API calls are forbidden here; all calls must route through `adapters/index.js` using semantic roles (e.g., `STRATEGY_CORE`).
> **Recent Updates:** Integrated `Gemini 3.0 Pro` for high-volume data synthesis and `Claude Opus 4.6` as the primary strategist.

> **Last Verified:** 2026-01-10

# AI Module (`server/lib/ai/`)

## Purpose

Centralized AI model management: adapters for different providers (Anthropic, OpenAI, Google), strategy providers, and supporting utilities.

## Structure

```
ai/
├── adapters/           # Model API adapters (call these, not providers directly)
│   └── index.js        # Main dispatcher: callModel(role, {system, user})
├── context/            # Shared context gathering logic (Agent, Assistant, Eidolon)
├── providers/          # Strategy generation providers
│   ├── briefing.js     # Events, traffic, news (Gemini + Search)
│   └── consolidator.js # Strategy generation (GPT-5.2 + Gemini)
├── router/             # Hedged routing and fallback logic
├── coach-dal.js        # Data access layer for AI Coach chat
├── index.js            # Barrel exports for ai module
├── model-registry.js   # Model configuration registry (+ LLM diagnostics)
├── models-dictionary.js # Model metadata registry
└── unified-ai-capabilities.js # AI capability manager
```

## Key Updates (2026-02-10)

- **Context Refactor:** Consolidated `enhanced-context.js` logic into `context/enhanced-context-base.js` to reduce duplication across Agent, Assistant, and Eidolon.
- **Model Parameters:** Updated OpenAI models (GPT-5.2, o1) to use `max_completion_tokens` instead of the deprecated `max_tokens`.
- **Hedged Routing:** Added `server/lib/ai/router/` for advanced model fallback and concurrency management.

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
| `model-registry.js` | Model configuration + LLM diagnostics | `getRoleConfig()`, `getLLMStatus()`, `getLLMDiagnostics()` |
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

**Key Roles (updated 2026-02-13):**

| Role | Env Variable | Default Model | Purpose |
|------|--------------|---------------|---------|
| `STRATEGY_CORE` | `STRATEGY_CORE_MODEL` | Gemini 3 Pro | Core strategic plan generation |
| `STRATEGY_CONTEXT` | `STRATEGY_CONTEXT_MODEL` | Gemini 3 Pro | Real-time context gathering |
| `STRATEGY_TACTICAL` | `STRATEGY_TACTICAL_MODEL` | GPT-5.2 | Immediate 1hr tactical strategy |
| `STRATEGY_DAILY` | `STRATEGY_DAILY_MODEL` | Gemini 3 Pro | Long-term 8-12hr daily strategy |
| `BRIEFING_EVENTS_VALIDATOR` | `BRIEFING_VALIDATOR_MODEL` | Claude Opus 4.6 | Event schedule verification |
| `BRIEFING_HOLIDAY` | `BRIEFING_HOLIDAY_MODEL` | Gemini 3 Pro | Holiday detection with search |
| `VENUE_SCORER` | `VENUE_SCORER_MODEL` | GPT-5.2 | Smart Blocks venue scoring |
| `VENUE_FILTER` | `VENUE_FILTER_MODEL` | Claude Haiku | Fast venue filtering |
| `VENUE_TRAFFIC` | `VENUE_TRAFFIC_MODEL` | Gemini 3 Pro | Venue-specific traffic intelligence |
| `VENUE_REASONING` | `VENUE_REASONING_MODEL` | GPT-5.2 | Closed venue staging reasoning |
| `VENUE_EVENTS_SEARCH` | `VENUE_EVENTS_SEARCH_MODEL` | Gemini 3 Pro | Venue event search |
| `UTIL_WEATHER_VALIDATOR` | `UTIL_WEATHER_VALIDATOR_MODEL` | Gemini 3 Pro | Weather safety validation |
| `UTIL_TRAFFIC_VALIDATOR` | `UTIL_TRAFFIC_VALIDATOR_MODEL` | Gemini 3 Pro | Traffic condition validation |

**Legacy Support:** Old role names (`strategist`, `briefer`, `consolidator`) are automatically mapped to new names. See `model-registry.js` for the complete mapping.

**Adapter Compliance (2026-02-13):** All production AI calls now route through `callModel()`. Zero direct `callGemini/callOpenAI/callAnthropic` calls exist outside the adapter layer (except `enhanced-context-base.js` which uses `callAnthropicWithWebSearch` for the isolated agent system).

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
- Fallback model: `claude-opus-4-6`
- Configured in: `model-registry.js` → `FALLBACK_ENABLED_ROLES`

## LLM Settings Optimization (D-028)

**Updated 2026-01-10** - Gemini roles now use `thinkingLevel: 'HIGH'` for deeper analysis:

| Role | Temperature | thinkingLevel | Token Budget |
|------|-------------|---------------|--------------|
| `STRATEGY_CORE` | 0.5 | N/A (Claude) | 4096 |
| `STRATEGY_CONTEXT` | 0.4 | HIGH | 8192 |
| `STRATEGY_DAILY` | 0.4 | HIGH | 16000 |
| `BRIEFING_NEWS` | 0.4 | HIGH | 8192 |
| `BRIEFING_EVENTS_DISCOVERY` | 0.4 | HIGH | 8192 |

**Token Budget Rule:** `thinkingLevel: 'HIGH'` requires 8192+ `maxOutputTokens` because thinking consumes tokens from the output budget. Roles with smaller budgets (e.g., BRIEFING_TRAFFIC at 2048) do not use thinking.

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
import { getLLMStatus, getLLMDiagnostics } from '../../lib/ai/model-registry.js';
import { CoachDAL } from '../../lib/ai/coach-dal.js';

// From server/lib/*/
import { callModel } from '../ai/adapters/index.js';
import { runBriefing } from '../ai/providers/briefing.js';
import { runImmediateStrategy, runConsolidator } from '../ai/providers/consolidator.js';
```

---
*Updated 2026-01-05: Removed deprecated llm-router-v2.js and gemini-2.5-pro.js. LLM diagnostics now in model-registry.js.*
