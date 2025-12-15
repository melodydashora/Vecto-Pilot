# Vecto Pilot - Architecture Reference

**Last Updated:** 2025-12-15 UTC

This file provides navigation to focused architecture documentation. Each linked document is designed to be readable in a single pass.

## Quick Navigation

**Start here:** [docs/architecture/README.md](docs/architecture/README.md) - Master index with navigation guide

## Document Map

### Core System Documentation

| What | Document | When to Read |
|------|----------|--------------|
| **Where things are** | [server-structure.md](docs/architecture/server-structure.md) | Modifying backend code |
| | [client-structure.md](docs/architecture/client-structure.md) | Modifying frontend code |
| **Database** | [database-schema.md](docs/architecture/database-schema.md) | Working with tables |
| **API** | [api-reference.md](docs/architecture/api-reference.md) | Adding/modifying endpoints |

### AI System Documentation

| What | Document | When to Read |
|------|----------|--------------|
| **AI Pipeline** | [ai-pipeline.md](docs/architecture/ai-pipeline.md) | Modifying AI flow, model config |
| **13-Component Pipeline** | [strategy-framework.md](docs/architecture/strategy-framework.md) | Understanding recommendations |
| **Event Discovery** | [event-discovery.md](docs/architecture/event-discovery.md) | Modifying event detection |
| **Google APIs** | [google-cloud-apis.md](docs/architecture/google-cloud-apis.md) | Places, Routes, Weather |

### Rules & Decisions

| What | Document | When to Read |
|------|----------|--------------|
| **Critical Rules** | [constraints.md](docs/architecture/constraints.md) | Before ANY code change |
| **Why We Did X** | [decisions.md](docs/architecture/decisions.md) | Questioning architecture |
| **Don't Re-implement** | [deprecated.md](docs/architecture/deprecated.md) | Before adding features |

### Infrastructure

| What | Document | When to Read |
|------|----------|--------------|
| **Authentication** | [auth-system.md](docs/architecture/auth-system.md) | Modifying auth flow |
| **Logging** | [logging.md](docs/architecture/logging.md) | Adding logging |

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         REPLIT DEPLOYMENT                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Gateway Server (Port 5000)                     │ │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐   │ │
│  │  │   SDK Routes     │  │    Agent Routes (43717)       │   │ │
│  │  │   /api/*         │  │    /agent/*                   │   │ │
│  │  └──────────────────┘  └──────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                PostgreSQL Database                          │ │
│  │   (Replit Built-in, Drizzle ORM)                           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL AI/API SERVICES                      │
│  • Anthropic (Claude Opus 4.5)                                  │
│  • OpenAI (GPT-5.2, Realtime API)                               │
│  • Google (Gemini 3.0 Pro, Places, Routes, Weather, AQ)         │
└─────────────────────────────────────────────────────────────────┘
```

## TRIAD Pipeline Summary

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
├── Phase 2 (Parallel): Daily + Immediate Consolidator
├── Phase 3: Venue Planner + Enrichment
└── Phase 4: Event Validator
```

See [ai-pipeline.md](docs/architecture/ai-pipeline.md) for details.

## Folder Documentation

Every folder has a README.md. Key entry points:

| Area | README |
|------|--------|
| Server Business Logic | [server/lib/README.md](server/lib/README.md) |
| Server API Routes | [server/api/README.md](server/api/README.md) |
| AI Adapters/Providers | [server/lib/ai/README.md](server/lib/ai/README.md) |
| Client Overview | [client/src/README.md](client/src/README.md) |
| Hooks | [client/src/hooks/README.md](client/src/hooks/README.md) |
| Components | [client/src/components/README.md](client/src/components/README.md) |

## Related Files

- [CLAUDE.md](CLAUDE.md) - AI assistant quick reference
- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) - Historical issues and fixes
- [docs/AI_PARTNERSHIP_PLAN.md](docs/AI_PARTNERSHIP_PLAN.md) - Documentation improvement roadmap

---

**Note:** This file was restructured on 2025-12-15 as part of the AI Partnership Plan Phase 1. Detailed content was split into focused documents in `docs/architecture/` for better readability.
