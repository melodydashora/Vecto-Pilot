# Architecture Documentation

## Overview

This folder contains detailed technical documentation for Vecto Pilot's architecture.

## Documents

| Document | Purpose | Key Topics |
|----------|---------|------------|
| [ai-pipeline.md](ai-pipeline.md) | TRIAD AI pipeline architecture | Model configuration, phase timing, fallbacks |
| [api-reference.md](api-reference.md) | Complete API endpoint documentation | Routes, parameters, responses |
| [database-schema.md](database-schema.md) | PostgreSQL tables and relationships | Snapshots, strategies, rankings |
| [constraints.md](constraints.md) | Critical rules and limitations | Model parameters, GPS rules, security |
| [google-cloud-apis.md](google-cloud-apis.md) | Google APIs reference | Places, Routes, Weather, Geocoding |

## Quick Reference

### TRIAD Pipeline Phases

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
├── Phase 2 (Parallel): Daily + Immediate Consolidator
├── Phase 3: Venue Planner + Enrichment
└── Phase 4: Event Validator (disabled)
```

### Model Configuration

| Role | Default Model | Purpose |
|------|---------------|---------|
| Strategist | Claude Opus 4.5 | Long-term strategy analysis |
| Briefer | Gemini 3.0 Pro | Real-time events, traffic, news |
| Consolidator | GPT-5.2 | Immediate tactical strategy |

### Database Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `snapshots` | Location moment-in-time | `snapshot_id`, `formatted_address`, `user_id` |
| `strategies` | AI-generated strategies | `strategy_for_now`, `consolidated_strategy`, `phase` |
| `briefings` | Real-time briefing data | `events`, `traffic_conditions`, `news` |
| `rankings` | Venue sessions | `snapshot_id`, `ranking_id` |
| `ranking_candidates` | Individual venues | `features`, `business_hours`, `distance_miles` |

## Related Documentation

- [CLAUDE.md](../../CLAUDE.md) - AI assistant quick reference
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Full system overview
- [LESSONS_LEARNED.md](../../LESSONS_LEARNED.md) - Historical issues and fixes
- [server/lib/ai/README.md](../../server/lib/ai/README.md) - AI module details
