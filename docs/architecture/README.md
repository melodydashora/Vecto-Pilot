# Architecture Documentation

This folder contains focused, readable technical documentation for Vecto Pilot's architecture. Each document is designed to be read in a single pass (<300 lines).

## Document Index

### Core System (Start Here)

| Document | Lines | Purpose | Read When... |
|----------|-------|---------|--------------|
| [server-structure.md](server-structure.md) | ~190 | Backend organization, 37 folder READMEs | Modifying server code |
| [client-structure.md](client-structure.md) | ~220 | Frontend organization, 16 folder READMEs | Modifying client code |
| [database-schema.md](database-schema.md) | ~200 | PostgreSQL tables and relationships | Working with DB |
| [api-reference.md](api-reference.md) | ~150 | Complete API endpoint documentation | Adding/modifying API routes |

### AI System

| Document | Lines | Purpose | Read When... |
|----------|-------|---------|--------------|
| [ai-pipeline.md](ai-pipeline.md) | ~200 | TRIAD pipeline, model configuration | Modifying AI flow |
| [strategy-framework.md](strategy-framework.md) | ~400 | 13-component recommendation pipeline | Understanding how recommendations work |
| [event-discovery.md](event-discovery.md) | ~300 | Multi-model AI event search | Modifying event detection |
| [google-cloud-apis.md](google-cloud-apis.md) | ~250 | Places, Routes, Weather, Geocoding | Using Google APIs |

### System Rules

| Document | Lines | Purpose | Read When... |
|----------|-------|---------|--------------|
| [constraints.md](constraints.md) | ~150 | Critical rules that cannot be violated | **Before ANY code change** |
| [decisions.md](decisions.md) | ~200 | WHY choices were made, fix capsules | Questioning architecture |
| [deprecated.md](deprecated.md) | ~100 | Removed features - DO NOT re-implement | Before adding features |

### Infrastructure

| Document | Lines | Purpose | Read When... |
|----------|-------|---------|--------------|
| [auth-system.md](auth-system.md) | ~100 | JWT authentication, security | Modifying auth |
| [logging.md](logging.md) | ~100 | Workflow logging conventions | Adding logging |

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

### New to the Codebase?

Read in this order:
1. [constraints.md](constraints.md) - What you cannot do
2. [server-structure.md](server-structure.md) or [client-structure.md](client-structure.md) - Where things are
3. [ai-pipeline.md](ai-pipeline.md) - How AI works
4. [decisions.md](decisions.md) - Why things are the way they are

### Before Making Changes

Always check:
1. [constraints.md](constraints.md) - Critical rules
2. [deprecated.md](deprecated.md) - Don't re-implement removed features
3. Relevant domain doc (AI, database, auth, etc.)

### Finding the Right README

The codebase has **68 folder README files**. Key entry points:

| What You're Looking For | README |
|------------------------|--------|
| Server overview | [server/README.md](../../server/README.md) |
| API routes | [server/api/README.md](../../server/api/README.md) |
| AI layer | [server/lib/ai/README.md](../../server/lib/ai/README.md) |
| Client overview | [client/src/README.md](../../client/src/README.md) |
| Route pages | [client/src/pages/co-pilot/](../../client/src/pages/co-pilot/) |
| Layouts | [client/src/layouts/](../../client/src/layouts/) |
| Contexts | [client/src/contexts/README.md](../../client/src/contexts/README.md) |
| Hooks | [client/src/hooks/README.md](../../client/src/hooks/README.md) |
| Components | [client/src/components/README.md](../../client/src/components/README.md) |
| Database | [server/db/README.md](../../server/db/README.md) |
| Tests | [tests/README.md](../../tests/README.md) |

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the complete folder README index.

## Related Documentation

- [CLAUDE.md](../../CLAUDE.md) - AI assistant quick reference
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Pointer file with complete folder index
- [LESSONS_LEARNED.md](../../LESSONS_LEARNED.md) - Historical issues and fixes
- [AI_PARTNERSHIP_PLAN.md](../AI_PARTNERSHIP_PLAN.md) - Documentation improvement roadmap

## Document Statistics

| Category | Count | Total Lines |
|----------|-------|-------------|
| Core System | 4 | ~760 |
| AI System | 4 | ~1150 |
| System Rules | 3 | ~450 |
| Infrastructure | 2 | ~200 |
| **Total** | **13** | **~2560** |

All documents are under 400 lines (most under 200), making them readable in a single pass.
