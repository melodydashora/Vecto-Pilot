# AI Pipeline Architecture

## Overview

Vecto Pilot uses a multi-model AI pipeline called TRIAD (Three-model Intelligence and Analysis Design) for generating strategic recommendations.

## Models Used

| Role | Model | Provider | Purpose |
|------|-------|----------|---------|
| Strategist | Claude Opus 4.5 | Anthropic | Generate minstrategy |
| Briefer (Primary) | Gemini 3.0 Pro | Google | Events, traffic, news, airport (with Google Search grounding) |
| Briefer (Fallback) | Claude Opus 4.5 | Anthropic | Web search fallback when Gemini fails |
| Traffic (Primary) | TomTom | TomTom | Real-time traffic data |
| Holiday Checker | Gemini 3.0 Pro | Google | Holiday detection |
| Daily Consolidator | Gemini 3.0 Pro | Google | 8-12hr strategy |
| Immediate Consolidator | GPT-5.2 | OpenAI | 1hr tactical strategy |
| Venue Planner | GPT-5.1 | OpenAI | Smart Blocks generation |

**Note:** Perplexity was replaced with Gemini 3 Pro Preview (with Google Search tool) as the primary briefing provider in December 2024. Claude web search serves as the fallback when Gemini fails.

## Pipeline Flow

```
POST /api/blocks-fast (triggers waterfall)
        │
        ▼
┌───────────────────────────────────────────┐
│           PHASE 1 (PARALLEL)               │
│                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌────┐ │
│  │ Strategist  │  │   Briefer   │  │Hol │ │
│  │Claude Opus  │  │ Gemini 3.0  │  │iday│ │
│  │             │  │+ Google Srch│  │    │ │
│  └──────┬──────┘  └──────┬──────┘  └──┬─┘ │
│         │                │            │   │
│         ▼                ▼            ▼   │
│   minstrategy      events,news    holiday │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│           PHASE 2 (PARALLEL)               │
│                                            │
│  ┌──────────────────┐ ┌─────────────────┐ │
│  │ Daily Consolid.  │ │Immediate Consol.│ │
│  │  Gemini 3.0 Pro  │ │    GPT-5.1      │ │
│  └────────┬─────────┘ └────────┬────────┘ │
│           │                    │          │
│           ▼                    ▼          │
│  consolidated_strategy   strategy_for_now │
│     (8-12hr plan)         (1hr tactics)   │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│           PHASE 3 (SEQUENTIAL)             │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │        Venue Planner (GPT-5.1)       │ │
│  │  Generates Top 6 venue recommendations│ │
│  └────────────────┬─────────────────────┘ │
│                   │                        │
│                   ▼                        │
│  ┌──────────────────────────────────────┐ │
│  │      Venue Enrichment (Google)       │ │
│  │  - Places API (hours, status)        │ │
│  │  - Routes API (distance, drive time) │ │
│  └────────────────┬─────────────────────┘ │
│                   │                        │
│                   ▼                        │
│           Smart Blocks (Top 6)             │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│           PHASE 4 (OPTIONAL)               │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │   Event Validator (Claude + Web)     │ │
│  │   Verifies event schedules           │ │
│  └──────────────────────────────────────┘ │
└───────────────────────────────────────────┘
        │
        ▼
    Response to Client
```

## Timing

Total pipeline: ~35-50 seconds

| Phase | Duration | Notes |
|-------|----------|-------|
| Phase 1 | 10-15s | All three run in parallel |
| Phase 2 | 8-12s | Both consolidators run in parallel |
| Phase 3 | 15-20s | Venue planning + enrichment |
| Phase 4 | 3-5s | Optional event validation |

## Model Adapter Pattern

**Always use the adapter** - never call AI APIs directly:

```javascript
import { callModel } from './lib/ai/adapters/index.js';

const result = await callModel('strategist', {
  system: 'System prompt here',
  user: 'User message here'
});
```

The adapter at `server/lib/ai/adapters/index.js` handles:
- Model selection based on role
- Parameter normalization
- Provider-specific quirks
- Automatic fallback to Claude Opus

## Fallback System

Claude Opus 4.5 with web search serves as automatic fallback when primary models fail:

**Briefing Fallbacks (Gemini → Claude):**
- Events: If Gemini returns 0 events → Claude web search with parallel category searches
- News: If Gemini fails/returns empty → Claude web search for rideshare news
- Traffic: TomTom (primary) → Gemini (secondary) → Static fallback
- Airport: Gemini with Google Search → Static fallback

**Strategy Fallbacks:**
- Daily Consolidator: Gemini 3 Pro → Claude Opus fallback
- Adapter-level: When `callModel()` returns `!result.ok`, automatically retries with Claude Opus

## Model Parameters

### GPT-5.1 (Critical)
```javascript
// CORRECT
{
  model: "gpt-5.1",
  reasoning_effort: "medium",  // FLAT string, not nested
  max_completion_tokens: 32000
}

// WRONG - causes 400 error
{ reasoning: { effort: "medium" } }  // Nested format
{ temperature: 0.7 }  // Temperature not supported
```

### Gemini 3 Pro
```javascript
// CORRECT
{
  generationConfig: {
    thinkingConfig: { thinkingLevel: "HIGH" }
  }
}

// WRONG
{ thinking_budget: 8000 }  // Flat format not supported
```

### Claude Opus 4.5
```javascript
// Standard Anthropic format
{
  model: "claude-opus-4-5-20251101",
  max_tokens: 8000,
  temperature: 0.3
}
```

## Environment Variables

```bash
# Model configuration
STRATEGY_STRATEGIST=claude-opus-4-5-20251101
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.1
STRATEGY_HOLIDAY_CHECKER=gemini-3-pro-preview
STRATEGY_VALIDATOR=gemini-2.5-pro
STRATEGY_EVENT_VALIDATOR=claude-opus-4-5-20251101

# API keys
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
```

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/ai/adapters/index.js` | Model adapter dispatcher |
| `server/lib/ai/adapters/anthropic-adapter.js` | Claude adapter |
| `server/lib/ai/adapters/openai-adapter.js` | GPT-5.1 adapter |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini adapter |
| `server/lib/ai/providers/minstrategy.js` | Strategist provider |
| `server/lib/ai/providers/briefing.js` | Briefer provider |
| `server/lib/ai/providers/consolidator.js` | Consolidator provider |
| `server/lib/strategy/tactical-planner.js` | Venue planner |
| `server/lib/briefing/event-schedule-validator.js` | Event validator |

## SSE Events

Strategy status updates are sent via Server-Sent Events:

```javascript
// Subscribe to strategy_ready
const eventSource = new EventSource('/api/events');
eventSource.addEventListener('strategy_ready', (event) => {
  const { snapshot_id } = JSON.parse(event.data);
  // Refetch strategy data
});
```
