# Strategy Workflow

This document describes the AI strategy generation workflow in Vecto Pilot.

## Overview

The strategy workflow generates tactical recommendations for rideshare drivers using a multi-model AI pipeline (TRIAD). It produces:
- **NOW Strategy**: Immediate 1-hour recommendations
- **Daily Strategy**: 8-12 hour consolidated plan (optional, on-demand)
- **Smart Blocks**: Venue recommendations with routing

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (Client)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. Snapshot Event                 2. Strategy Polling                      │
│   ┌─────────────────┐              ┌─────────────────────────────────┐      │
│   │ 'vecto-snapshot-│              │ useStrategyPolling hook          │      │
│   │  saved' event   │───trigger───→│   - GET /api/blocks-fast/:id     │      │
│   │                 │              │   - SSE: /events/strategy         │      │
│   └─────────────────┘              │   - SSE: /events/blocks           │      │
│                                    └─────────────────────────────────┘      │
│                                                  │                          │
│                                                  ▼                          │
│   3. Display Strategy               4. Display Smart Blocks                 │
│   ┌──────────────────────┐         ┌──────────────────────┐                │
│   │ StrategyPage         │         │ VenueCards           │                │
│   │   - NOW strategy     │         │   - Venue name       │                │
│   │   - Confidence       │         │   - Drive time       │                │
│   │   - Key insights     │         │   - Value grade      │                │
│   └──────────────────────┘         │   - Pro tips         │                │
│                                    └──────────────────────┘                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         SERVER (Node.js - TRIAD Pipeline)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Phase 1: Strategist + Briefer (Parallel)                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   STRATEGIST (Claude Opus 4.6)         BRIEFER (Gemini 3.0 Pro)     │   │
│   │   ┌───────────────────────────┐       ┌───────────────────────────┐ │   │
│   │   │ Input: Location, time,    │       │ Input: Location, date     │ │   │
│   │   │   weather, events         │       │                           │ │   │
│   │   │                           │       │ Output: Traffic, events,  │ │   │
│   │   │ Output: Strategic         │       │   news, school closures,  │ │   │
│   │   │   analysis, demand zones  │       │   airport conditions      │ │   │
│   │   └───────────────────────────┘       └───────────────────────────┘ │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│   Phase 2: Consolidators (Parallel)                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   NOW CONSOLIDATOR (GPT-5.2)       DAILY CONSOLIDATOR (GPT-5.2)     │   │
│   │   ┌───────────────────────────┐   ┌───────────────────────────────┐ │   │
│   │   │ Input: Strategist +       │   │ Input: Same + daily schedule  │ │   │
│   │   │   Briefer outputs         │   │                               │ │   │
│   │   │                           │   │ Output: 8-12 hour plan        │ │   │
│   │   │ Output: 1-hour NOW plan   │   │   (on-demand only)            │ │   │
│   │   └───────────────────────────┘   └───────────────────────────────┘ │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│   Phase 3: Venue Planner + Enrichment                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   TACTICAL PLANNER (GPT-5.2)              ENRICHMENT                │   │
│   │   ┌───────────────────────────┐          ┌────────────────────────┐ │   │
│   │   │ Input: Strategy + location│          │ Google Places API      │ │   │
│   │   │                           │          │   - Business hours     │ │   │
│   │   │ Output: Top venues,       │          │   - Place IDs          │ │   │
│   │   │   coordinates, staging    │          │                        │ │   │
│   │   │   tips, pro tips          │          │ Google Routes API      │ │   │
│   │   └───────────────────────────┘          │   - Drive times        │ │   │
│   │                                          │   - Distance           │ │   │
│   │                                          └────────────────────────┘ │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│   Phase 4: Event Validator (Claude Opus 4.6)                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Validates discovered events, removes duplicates, confirms times     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                        │                                     │
│                                        ▼                                     │
│   Notify: pg_notify('strategy_ready'), pg_notify('blocks_ready')             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### Client
| File | Purpose |
|------|---------|
| `client/src/pages/co-pilot/StrategyPage.tsx` | Main strategy display page |
| `client/src/hooks/useStrategyPolling.ts` | Polls for strategy completion |
| `client/src/hooks/useStrategy.ts` | Strategy state management |
| `client/src/contexts/co-pilot-context.tsx` | Shared state (persistentStrategy) |
| `client/src/utils/co-pilot-helpers.ts` | SSE subscription helpers |

### Server
| File | Purpose |
|------|---------|
| `server/api/strategy/blocks-fast.js` | Main `/api/blocks-fast/:snapshotId` endpoint |
| `server/api/strategy/content-blocks.js` | Smart blocks endpoint |
| `server/api/strategy/strategy-events.js` | SSE endpoints (`/events/strategy`, `/events/blocks`) |
| `server/lib/strategy/strategy-generator-parallel.js` | TRIAD pipeline orchestration |
| `server/lib/strategy/providers.js` | AI model provider configuration |
| `server/jobs/triad-worker.js` | Background job processor |

### AI Adapters
| File | Purpose |
|------|---------|
| `server/lib/ai/adapters/index.js` | Model dispatcher (`callModel()`) |
| `server/lib/ai/adapters/anthropic.js` | Claude Opus 4.6 adapter |
| `server/lib/ai/adapters/openai.js` | GPT-5.2 adapter |
| `server/lib/ai/adapters/gemini.js` | Gemini 3.0 Pro adapter |

## Database Tables

### strategies
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| snapshot_id | uuid | Links to snapshot |
| status | text | pending/ok/failed |
| phase | text | Current pipeline phase |
| phase_started_at | timestamp | For progress calculation |
| strategy_for_now | text | 1-hour NOW strategy |
| consolidated_strategy | text | Daily strategy (optional) |
| latency_ms | int | Total generation time |
| model_name | text | Models used (for A/B testing) |

### rankings
| Column | Type | Description |
|--------|------|-------------|
| ranking_id | uuid | Primary key |
| snapshot_id | uuid | Links to snapshot |
| ui | jsonb | Smart blocks configuration |

### ranking_candidates
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| ranking_id | uuid | Links to ranking |
| name | text | Venue name |
| lat, lng | double | Venue coordinates |
| drive_time_min | int | Drive time from driver |
| value_grade | text | A/B/C value rating |
| pro_tips | text[] | Tactical recommendations |

## SSE (Server-Sent Events)

Strategy completion is notified via SSE for instant UI updates:

```
Client                              Server
   │                                   │
   │──GET /events/strategy────────────→│
   │                                   │
   │←─event: strategy_ready────────────│
   │  data: {"snapshot_id": "abc123"}  │
   │                                   │
   │──GET /events/blocks──────────────→│
   │                                   │
   │←─event: blocks_ready──────────────│
   │  data: {"snapshot_id": "abc123"}  │
```

SSE uses PostgreSQL LISTEN/NOTIFY for real-time event delivery:

```javascript
// Server: Notify when strategy is complete
await db.query(`SELECT pg_notify('strategy_ready', '${JSON.stringify({ snapshot_id })}')`);

// Client: Subscribe to SSE
const eventSource = new EventSource('/events/strategy');
eventSource.addEventListener('strategy_ready', (event) => {
  const { snapshot_id } = JSON.parse(event.data);
  refetchStrategy(snapshot_id);
});
```

## Pipeline Timing

| Phase | Model | Expected Duration |
|-------|-------|-------------------|
| 1. Strategist | Claude Opus 4.6 | 8-12s |
| 1. Briefer | Gemini 3.0 Pro | 10-15s |
| 2. NOW Consolidator | GPT-5.2 | 5-8s |
| 3. Venue Planner | GPT-5.2 | 6-10s |
| 3. Enrichment | Google APIs | 2-5s |
| 4. Event Validator | Claude Opus 4.6 | 5-8s |
| **Total** | | **35-50s** |

## Model Parameters

### GPT-5.2 (Consolidator, Planner)
```javascript
{
  model: "gpt-5.2",
  reasoning_effort: "medium",
  max_completion_tokens: 32000
}
// WRONG - causes 400 error:
// { reasoning: { effort: "medium" } }  // Nested format
// { temperature: 0.7 }  // Not supported
```

### Gemini 3.0 Pro (Briefer)
```javascript
{
  generationConfig: {
    thinkingConfig: { thinkingLevel: "HIGH" }  // or "LOW" only
  }
}
// WRONG:
// thinkingLevel: "MEDIUM"  // MEDIUM is Flash-only
```

### Claude Opus 4.6 (Strategist, Validator)
```javascript
{
  model: "claude-opus-4-6-20260201",
  max_tokens: 16000
}
```

## Related Documents

- [AI Pipeline](ai-pipeline.md) - Detailed pipeline architecture
- [Location.md](Location.md) - Location workflow (triggers strategy)
- [Briefing.md](Briefing.md) - Briefing data workflow
