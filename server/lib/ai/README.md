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
│   └── consolidator.js # Strategy generation (GPT-5.1 + Gemini)
├── coach-dal.js        # Data access layer for AI Coach chat
├── llm-router-v2.js    # LLM status/routing (used by health endpoint)
├── models-dictionary.js # Model metadata registry
└── unified-ai-capabilities.js # AI capability manager
```

## Key Pattern: Use Adapters, Not Direct API Calls

**Always use `callModel()` from adapters/index.js** - never call AI APIs directly:

```javascript
import { callModel } from './adapters/index.js';

// Role-based dispatch - adapter handles model selection, params, fallbacks
const result = await callModel('strategist', { system, user });
// Returns: { ok: boolean, output: string, citations?: array }
```

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `adapters/index.js` | Model dispatcher with fallback | `callModel(role, {system, user})` |
| `providers/briefing.js` | Events/traffic/news research | `runBriefing(snapshotId, { snapshot })` |
| `providers/consolidator.js` | Strategy generation | `runImmediateStrategy()`, `runConsolidator()` |
| `coach-dal.js` | Chat data access layer | `CoachDAL` class |
| `llm-router-v2.js` | LLM status for health checks | `getLLMStatus()` |
| `models-dictionary.js` | Model metadata registry | `MODELS` dictionary |
| `unified-ai-capabilities.js` | AI capability manager | `unifiedCapabilities` |

## Connections

- **Imports from:** `../location/`, `../../db/`, `shared/schema.js`
- **Exported to:** `../strategy/`, `../briefing/`, `../../api/strategy/`

## Model-Role Mapping

Configured via environment variables:

| Role | Env Variable | Default Model |
|------|--------------|---------------|
| `briefer` | `STRATEGY_BRIEFER` | Gemini 3.0 Pro |
| `consolidator` | `STRATEGY_CONSOLIDATOR` | GPT-5.1 |
| `event_validator` | `STRATEGY_EVENT_VALIDATOR` | Claude Opus 4.5 (with web search) |

## Strategy Pipeline

```
POST /api/blocks-fast:
1. briefing.js (Gemini) → briefings table
2. consolidator.js/runImmediateStrategy (GPT-5.1) → strategies.strategy_for_now
3. SmartBlocks generation → rankings + ranking_candidates

POST /api/strategy/daily (on-demand):
4. consolidator.js/runConsolidator (Gemini) → strategies.consolidated_strategy
```

## Fallback System

When primary model fails, certain roles automatically fall back to Claude Opus:
- Roles with fallback: `consolidator`
- Fallback model: `claude-opus-4-5-20251101`
- Logs: `[consolidator] 🔄 Trying Claude Opus fallback...`

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
