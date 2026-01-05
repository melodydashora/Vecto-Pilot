# AI Pipeline Architecture

## Overview

Vecto Pilot uses a multi-model AI pipeline called TRIAD (Three-model Intelligence and Analysis Design) for generating strategic recommendations.

## Models Used

| Role | Model | Provider | Purpose |
|------|-------|----------|---------|
| Strategist | Claude Opus 4.5 | Anthropic | Generate strategic overview |
| Events | SerpAPI + GPT-5.2 | OpenAI | Event discovery (daily sync) |
| News (Dual-Model) | Gemini 3.0 Pro + GPT-5.2 | Google + OpenAI | Parallel news fetch (both run, results merged) |
| Traffic (Primary) | TomTom | TomTom | Real-time traffic data |
| Traffic (Analysis) | Gemini 3.0 Flash | Google | Analyze traffic data for driver briefing |
| Weather | Google Weather API | Google | 4-hour forecast |
| Airport | Gemini 3.0 Pro | Google | Flight delays, airport conditions |
| School Closures | Gemini 3.0 Pro | Google | School calendar data |
| Holiday Checker | Gemini 3.0 Pro | Google | Holiday detection |
| Daily Consolidator | Gemini 3.0 Pro | Google | 8-12hr strategy |
| Immediate Consolidator | GPT-5.2 | OpenAI | 1hr tactical strategy |
| Venue Planner | GPT-5.2 | OpenAI | Smart Blocks generation |

**Note (Updated 2026-01-05):**
- News uses dual-model parallel fetch (Gemini + GPT-5.2) with result consolidation
- Events are discovered via SerpAPI + GPT-5.2 and stored in `discovered_events` table
- Traffic uses TomTom for raw data, then Gemini Flash for driver-focused analysis

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
│   strategy         events,news    holiday │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│           PHASE 2 (PARALLEL)               │
│                                            │
│  ┌──────────────────┐ ┌─────────────────┐ │
│  │ Daily Consolid.  │ │Immediate Consol.│ │
│  │  Gemini 3.0 Pro  │ │    GPT-5.2      │ │
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
│  │        Venue Planner (GPT-5.2)       │ │
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

Total pipeline: ~90-130 seconds (updated Dec 2025)

| Phase | Duration | Notes |
|-------|----------|-------|
| Phase 1 | 25-30s | Strategist + Briefer + Holiday in parallel |
| Phase 2 | 8-12s | Daily + Immediate consolidators in parallel |
| Phase 3 | 60-90s | Venue planning (GPT-5.2) is the slowest phase |
| Phase 4 | 3-5s | Event validation + Places/Routes enrichment |

### Detailed Phase Timing

Progress is tracked via SSE with these expected durations (from `server/lib/strategies/strategy-utils.js`):

| Phase | Expected (ms) | Description |
|-------|--------------|-------------|
| `starting` | 500 | Strategy row creation |
| `resolving` | 2,000 | Location resolution |
| `analyzing` | 25,000 | Briefing (Gemini + traffic) |
| `immediate` | 8,000 | GPT-5.2 immediate strategy |
| `venues` | 90,000 | GPT-5.2 tactical planner (**slowest**) |
| `routing` | 2,000 | Google Routes API batch |
| `places` | 2,000 | Event matching + Places lookup |
| `verifying` | 1,000 | Event verification |
| `complete` | 0 | Done |

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
- Traffic: TomTom (primary) → Claude analysis → Gemini (secondary) → Static fallback
- Airport: Gemini with Google Search → Static fallback

**Traffic Analysis Pipeline:**
1. TomTom provides raw incidents with priority scoring
2. Claude Opus analyzes and produces human-readable briefing:
   - `headline`: One sentence overview
   - `keyIssues`: Top 3 problems with specific roads
   - `avoidAreas`: Roads to avoid and why
   - `driverImpact`: How it affects earnings/routes
   - `closures`: Expandable list of all road closures

**Strategy Fallbacks:**
- Daily Consolidator: Gemini 3 Pro → Claude Opus fallback
- Adapter-level: When `callModel()` returns `!result.ok`, automatically retries with Claude Opus

## Model Parameters

### GPT-5.2 (Critical)
```javascript
// CORRECT
{
  model: "gpt-5.2",
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
STRATEGY_CONSOLIDATOR=gpt-5.2
STRATEGY_HOLIDAY_CHECKER=gemini-3-pro-preview
STRATEGY_EVENT_VALIDATOR=claude-opus-4-5-20251101  # Event validation with web search

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
| `server/lib/ai/adapters/openai-adapter.js` | GPT-5.2 adapter |
| `server/lib/ai/adapters/gemini-adapter.js` | Gemini adapter |
| `server/lib/ai/providers/briefing.js` | Briefer provider (events, news, traffic) |
| `server/lib/ai/providers/consolidator.js` | Strategy consolidator (daily + immediate) |
| `server/lib/strategies/strategy-utils.js` | Phase timing, strategy row management |
| `server/lib/strategy/tactical-planner.js` | Venue planner (GPT-5.2) |
| `server/lib/briefing/event-schedule-validator.js` | Event validator |

**Note:** The minstrategy table and provider were removed in Dec 2025. Strategies are now written directly to the `strategies` table via `briefing` table data.

## SSE Events

Strategy status updates are sent via Server-Sent Events:

```javascript
// Subscribe to strategy updates
const eventSource = new EventSource('/api/strategy/subscribe?snapshotId=xxx');

// Phase changes (for progress bar)
eventSource.addEventListener('phase_change', (event) => {
  const { snapshot_id, phase, phase_started_at, expected_duration_ms } = JSON.parse(event.data);
  // Update progress bar
});

// Strategy ready
eventSource.addEventListener('strategy_ready', (event) => {
  const { snapshot_id } = JSON.parse(event.data);
  // Refetch strategy data
});

// Blocks ready
eventSource.addEventListener('blocks_ready', (event) => {
  const { snapshot_id, blocks } = JSON.parse(event.data);
  // Display Smart Blocks
});
```

**Last Updated:** 2026-01-04
