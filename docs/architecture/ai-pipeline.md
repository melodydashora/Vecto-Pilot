# AI Pipeline Architecture

## Overview

Vecto Pilot uses a multi-model AI pipeline called TRIAD (Three-model Intelligence and Analysis Design) for generating strategic recommendations.

## Models Used

| Role | Model | Provider | Purpose |
|------|-------|----------|---------|
| Strategist | Claude Opus 4.6 | Anthropic | Generate strategic overview |
| Events | Gemini 3.0 Pro | Google | Event discovery via BRIEFING_EVENTS_DISCOVERY role |
| News | Gemini 3.0 Pro | Google | News briefing via BRIEFING_NEWS role (single model) |
| Traffic (Primary) | TomTom | TomTom | Real-time traffic data |
| Traffic (Analysis) | Gemini 3.0 Pro | Google | Analyze traffic data for driver briefing |
| Weather | Google Weather API | Google | 4-hour forecast |
| Airport | Gemini 3.0 Pro | Google | Flight delays, airport conditions |
| School Closures | Gemini 3.0 Pro | Google | School calendar data |
| Holiday Checker | Gemini 3.0 Pro | Google | Holiday detection |
| Daily Consolidator | Gemini 3.0 Pro | Google | 8-12hr strategy |
| Immediate Consolidator | GPT-5.2 | OpenAI | 1hr tactical strategy |
| Venue Planner | GPT-5.2 | OpenAI | Smart Blocks generation |

**Model Changes (Updated 2026-02-01):**
- **2026-01-10:** Dual-model news fetch removed - now uses Gemini 3 Pro only via BRIEFING_NEWS role
- **2026-01-14:** SerpAPI + GPT-5.2 event discovery removed - now Gemini 3 Pro via BRIEFING_EVENTS_DISCOVERY
- **2026-01-15:** Traffic analysis upgraded from Gemini Flash to Gemini 3 Pro for complex spatial analysis
- **ETL Pipeline (2026-01-09):** Event discovery uses canonical modules in `server/lib/events/pipeline/` with 5-phase workflow logging. See [ETL Pipeline Refactoring](etl-pipeline-refactoring-2026-01-09.md) for details.

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

Claude Opus 4.6 with web search serves as automatic fallback when primary models fail:

**Briefing Fallbacks (Updated 2026-02-01):**
- Events: Gemini 3 Pro (primary) → Gemini 3 Flash (fallback) → Static fallback
- News: Gemini 3 Pro (primary) → Gemini 3 Flash (fallback) → Static fallback
- Traffic: TomTom (data) → Gemini 3 Pro (analysis) → Gemini 3 Flash (fallback) → Static fallback
- Airport: Gemini with Google Search → Static fallback

> **Curated Driver Resources:** In addition to AI-discovered news, see `server/lib/briefing/README.md` for authoritative driver resources including Lyft Driver Hub (`lyft.com/driver/hub`) and AAA Gas Prices (`gasprices.aaa.com/?state={STATE}`).

**Traffic Analysis Pipeline (Updated 2026-01-15):**
1. TomTom provides raw incidents with priority scoring
2. Gemini 3 Pro analyzes and produces human-readable briefing:
   - `headline`: One sentence overview
   - `keyIssues`: Top 3 problems with specific roads
   - `avoidAreas`: Roads to avoid and why
   - `driverImpact`: How it affects earnings/routes
   - `closures`: Expandable list of all road closures

> **Note:** Claude was previously in the traffic analysis path but was replaced by Gemini 3 Pro per "Single Briefer Model" architecture (2026-01-15). Traffic requires complex synthesis of TomTom JSON into actionable advice - Pro's reasoning handles this better than Flash.

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

### Claude Opus 4.6
```javascript
// Standard Anthropic format
{
  model: "claude-opus-4-6-20260201",
  max_tokens: 8000,
  temperature: 0.3
}
```

## Environment Variables

```bash
# Model configuration
STRATEGY_STRATEGIST=claude-opus-4-6-20260201
STRATEGY_BRIEFER=gemini-3-pro-preview
STRATEGY_CONSOLIDATOR=gpt-5.2
STRATEGY_HOLIDAY_CHECKER=gemini-3-pro-preview
STRATEGY_EVENT_VALIDATOR=claude-opus-4-6-20260201  # Event validation with web search

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
| `server/lib/events/pipeline/` | ETL pipeline modules (normalize, validate, hash) |
| `server/scripts/sync-events.mjs` | Event discovery script (daily sync) |

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

## Event ETL Pipeline (2026-01-09, Updated 2026-01-10)

Events are processed through a 5-phase ETL pipeline with canonical modules in `server/lib/events/pipeline/`:

```
RawEvent (providers) → NormalizedEvent → ValidatedEvent → StoredEvent (DB)
                                                              ↓
BriefingEvent ← (DB read) ← discovered_events ← (DB write)
```

**Key Invariant:** Strategy LLMs ONLY receive BriefingEvent from DB rows. Raw provider payloads are NEVER passed to strategy LLMs.

### ETL Phases

| Phase | Label | Operation |
|-------|-------|-----------|
| 1 | Extract\|Providers | Gemini with Google Search discovery |
| 2 | Transform\|Normalize | normalizeEvent + validateEvent |
| 3 | Transform\|Geocode | Geocode + venue linking (venue_catalog) |
| 4 | Load\|Store | Upsert to discovered_events with event_hash |
| 5 | Assemble\|Briefing | Query from DB + shape for briefings |

### Canonical Field Names (2026-01-10)

Event date/time fields use symmetric naming:

| Field | Format | Description |
|-------|--------|-------------|
| `event_start_date` | YYYY-MM-DD | Event start date (required) |
| `event_start_time` | HH:MM or "7:00 PM" | Event start time |
| `event_end_date` | YYYY-MM-DD | Event end date (defaults to start_date) |
| `event_end_time` | HH:MM or "10:00 PM" | Event end time |

**Note:** Old field names (`event_date`, `event_time`) are no longer used. The normalization layer maps legacy inputs to canonical names.

### Canonical Modules

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `types.js` | JSDoc type definitions | RawEvent, NormalizedEvent, ValidatedEvent, StoredEvent, BriefingEvent |
| `normalizeEvent.js` | Raw → Normalized transformation | normalizeEvent, normalizeTitle, normalizeDate, normalizeTime |
| `validateEvent.js` | Hard filter validation | validateEvent, validateEventsHard, needsReadTimeValidation |
| `hashEvent.js` | MD5 hash for deduplication | generateEventHash, buildHashInput, eventsHaveSameHash |

### Freshness Filtering

Events are filtered for freshness in `server/lib/strategy/strategy-utils.js`:

- `filterFreshEvents()` - Removes stale events (already ended) based on timezone-aware date/time parsing
- `filterFreshNews()` - Removes news older than 3 days
- Events without valid date/time info are rejected (not included in briefings)

See [ETL Pipeline Refactoring](etl-pipeline-refactoring-2026-01-09.md) for complete verification matrix.

**Last Updated:** 2026-01-14
