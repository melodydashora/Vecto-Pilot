# Architecture Documentation

This folder contains focused, readable technical documentation for Vecto Pilot's architecture. Each document is designed to be read in a single pass (<300 lines).

## Document Index

### Core System

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [server-structure.md](server-structure.md) | Backend organization, API routes, libs | Modifying server code |
| [client-structure.md](client-structure.md) | Frontend organization, components, hooks | Modifying client code |
| [database-schema.md](database-schema.md) | PostgreSQL tables and relationships | Working with DB |
| [api-reference.md](api-reference.md) | Complete API endpoint documentation | Adding/modifying API routes |

### AI System

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [ai-pipeline.md](ai-pipeline.md) | TRIAD pipeline, model configuration | Modifying AI flow |
| [strategy-framework.md](strategy-framework.md) | 13-component recommendation pipeline | Understanding how recommendations work |
| [event-discovery.md](event-discovery.md) | Multi-model AI event search | Modifying event detection |
| [google-cloud-apis.md](google-cloud-apis.md) | Places, Routes, Weather, Geocoding | Using Google APIs |

### System Rules

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [constraints.md](constraints.md) | Critical rules that cannot be violated | Before any code change |
| [decisions.md](decisions.md) | WHY choices were made, fix capsules | Questioning architecture decisions |
| [deprecated.md](deprecated.md) | Removed features - DO NOT re-implement | Before adding "new" features |

### Infrastructure

| Document | Purpose | Read When... |
|----------|---------|--------------|
| [auth-system.md](auth-system.md) | JWT authentication, security | Modifying auth |
| [logging.md](logging.md) | Workflow logging conventions | Adding logging |

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

## Navigation Guide

**Starting point**: New to the codebase? Read in this order:
1. [constraints.md](constraints.md) - What you cannot do
2. [server-structure.md](server-structure.md) or [client-structure.md](client-structure.md) - Where things are
3. [ai-pipeline.md](ai-pipeline.md) - How AI works
4. [decisions.md](decisions.md) - Why things are the way they are

**Before making changes**: Always check:
1. [constraints.md](constraints.md) - Critical rules
2. [deprecated.md](deprecated.md) - Don't re-implement removed features
3. Relevant domain doc (AI, database, auth, etc.)

## Related Documentation

- [CLAUDE.md](../../CLAUDE.md) - AI assistant quick reference
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - System overview (points here)
- [LESSONS_LEARNED.md](../../LESSONS_LEARNED.md) - Historical issues and fixes
- [AI_PARTNERSHIP_PLAN.md](../AI_PARTNERSHIP_PLAN.md) - Documentation improvement roadmap
