# Vecto Pilot - Architecture Reference

**Last Updated:** 2025-12-15 UTC

This file provides navigation to focused architecture documentation. Each linked document is designed to be readable in a single pass.

## Quick Navigation

**Start here:** [docs/architecture/README.md](docs/architecture/README.md) - Master index with navigation guide

## Document Map

### Core System Documentation

| What | Document | When to Read |
|------|----------|--------------|
| **Server Organization** | [server-structure.md](docs/architecture/server-structure.md) | Modifying backend code |
| **Client Organization** | [client-structure.md](docs/architecture/client-structure.md) | Modifying frontend code |
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

## Complete Folder README Index

Every folder has a README.md. Total: **68 README files**.

### Root Level

| Folder | README |
|--------|--------|
| `/` | [README.md](README.md) |
| `docs/` | [README.md](docs/README.md) |
| `docs/architecture/` | [README.md](docs/architecture/README.md) |
| `shared/` | [README.md](shared/README.md) |
| `scripts/` | [README.md](scripts/README.md) |
| `tools/` | [README.md](tools/README.md) |
| `tools/research/` | [README.md](tools/research/README.md) |
| `mcp-server/` | [README.md](mcp-server/README.md) |

### Server Folders (37 READMEs)

| Folder | README | Purpose |
|--------|--------|---------|
| `server/` | [README](server/README.md) | Server overview |
| `server/agent/` | [README](server/agent/README.md) | Workspace agent |
| `server/api/` | [README](server/api/README.md) | API routes index |
| `server/api/auth/` | [README](server/api/auth/README.md) | JWT authentication |
| `server/api/briefing/` | [README](server/api/briefing/README.md) | Events, traffic, news |
| `server/api/chat/` | [README](server/api/chat/README.md) | AI Coach, voice, TTS |
| `server/api/feedback/` | [README](server/api/feedback/README.md) | User feedback |
| `server/api/health/` | [README](server/api/health/README.md) | Health checks |
| `server/api/location/` | [README](server/api/location/README.md) | GPS, geocoding |
| `server/api/mcp/` | [README](server/api/mcp/README.md) | MCP protocol |
| `server/api/research/` | [README](server/api/research/README.md) | Vector search |
| `server/api/strategy/` | [README](server/api/strategy/README.md) | Strategy generation |
| `server/api/utils/` | [README](server/api/utils/README.md) | HTTP helpers |
| `server/api/venue/` | [README](server/api/venue/README.md) | Venue intelligence |
| `server/assistant/` | [README](server/assistant/README.md) | Assistant proxy |
| `server/bootstrap/` | [README](server/bootstrap/README.md) | Server startup |
| `server/config/` | [README](server/config/README.md) | Configuration |
| `server/db/` | [README](server/db/README.md) | Database connection |
| `server/eidolon/` | [README](server/eidolon/README.md) | Enhanced SDK |
| `server/eidolon/memory/` | [README](server/eidolon/memory/README.md) | Memory management |
| `server/eidolon/tools/` | [README](server/eidolon/tools/README.md) | Tool definitions |
| `server/gateway/` | [README](server/gateway/README.md) | Gateway proxy |
| `server/jobs/` | [README](server/jobs/README.md) | Background workers |
| `server/lib/` | [README](server/lib/README.md) | Business logic |
| `server/lib/ai/` | [README](server/lib/ai/README.md) | AI layer |
| `server/lib/ai/adapters/` | [README](server/lib/ai/adapters/README.md) | Model adapters |
| `server/lib/ai/providers/` | [README](server/lib/ai/providers/README.md) | AI providers |
| `server/lib/briefing/` | [README](server/lib/briefing/README.md) | Briefing service |
| `server/lib/external/` | [README](server/lib/external/README.md) | Third-party APIs |
| `server/lib/infrastructure/` | [README](server/lib/infrastructure/README.md) | Job queue |
| `server/lib/location/` | [README](server/lib/location/README.md) | Location services |
| `server/lib/strategy/` | [README](server/lib/strategy/README.md) | Strategy pipeline |
| `server/lib/venue/` | [README](server/lib/venue/README.md) | Venue intelligence |
| `server/logger/` | [README](server/logger/README.md) | Workflow logging |
| `server/middleware/` | [README](server/middleware/README.md) | Express middleware |
| `server/scripts/` | [README](server/scripts/README.md) | Server scripts |
| `server/types/` | [README](server/types/README.md) | TypeScript types |
| `server/util/` | [README](server/util/README.md) | Utilities |
| `server/validation/` | [README](server/validation/README.md) | Schema validation |

### Client Folders (16 READMEs)

| Folder | README | Purpose |
|--------|--------|---------|
| `client/` | [README](client/README.md) | Client overview |
| `client/src/` | [README](client/src/README.md) | Source overview |
| `client/src/components/` | [README](client/src/components/README.md) | Components index |
| `client/src/components/co-pilot/` | [README](client/src/components/co-pilot/README.md) | Co-pilot specific |
| `client/src/components/strategy/` | [README](client/src/components/strategy/README.md) | Strategy display |
| `client/src/components/ui/` | [README](client/src/components/ui/README.md) | shadcn/ui primitives |
| `client/src/contexts/` | [README](client/src/contexts/README.md) | React contexts |
| `client/src/features/` | [README](client/src/features/README.md) | Feature modules |
| `client/src/features/strategy/` | [README](client/src/features/strategy/README.md) | Strategy feature |
| `client/src/hooks/` | [README](client/src/hooks/README.md) | Custom hooks |
| `client/src/lib/` | [README](client/src/lib/README.md) | Core utilities |
| `client/src/pages/` | [README](client/src/pages/README.md) | Route pages |
| `client/src/types/` | [README](client/src/types/README.md) | TypeScript types |
| `client/src/utils/` | [README](client/src/utils/README.md) | Feature helpers |
| `client/src/_future/` | [README](client/src/_future/README.md) | Staged features |
| `client/src/_future/engine/` | [README](client/src/_future/engine/README.md) | Reflection engine |

### Test Folders (6 READMEs)

| Folder | README | Purpose |
|--------|--------|---------|
| `tests/` | [README](tests/README.md) | Test overview |
| `tests/e2e/` | [README](tests/e2e/README.md) | E2E tests |
| `tests/eidolon/` | [README](tests/eidolon/README.md) | Eidolon tests |
| `tests/gateway/` | [README](tests/gateway/README.md) | Gateway tests |
| `tests/scripts/` | [README](tests/scripts/README.md) | Test scripts |
| `tests/triad/` | [README](tests/triad/README.md) | TRIAD tests |

## Key Entry Points

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry |
| `strategy-generator.js` | Background strategy worker |
| `sdk-embed.js` | SDK router factory |
| `shared/schema.js` | Drizzle ORM schema |

## Related Files

- [CLAUDE.md](CLAUDE.md) - AI assistant quick reference
- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) - Historical issues and fixes
- [docs/AI_PARTNERSHIP_PLAN.md](docs/AI_PARTNERSHIP_PLAN.md) - Documentation improvement roadmap

---

**Note:** This file was restructured on 2025-12-15 as part of the AI Partnership Plan Phase 1. Detailed content was split into focused documents in `docs/architecture/` for better readability. This version includes the complete folder README index (68 files).
