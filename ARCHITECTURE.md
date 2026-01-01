# Vecto Pilot - Architecture Reference

**Last Updated:** 2025-12-27 UTC

This file provides navigation to focused architecture documentation. Each linked document is designed to be readable in a single pass.

## Recent Changes (2026-01-01)

- **Server Reorganization**: Moved from flat lib structure to domain-based organization
  - `server/lib/ai/` - AI adapters and providers
  - `server/lib/auth/` - Authentication services
  - `server/lib/briefing/` - Briefing generation
  - `server/lib/strategy/` - Strategy pipeline
  - `server/lib/venue/` - Venue intelligence
  - `server/lib/location/` - Location services
  - `server/lib/external/` - Third-party API integrations
  - `server/lib/infrastructure/` - Job queue
  - `server/lib/notifications/` - Email alerts
  - `server/lib/change-analyzer/` - File change tracking
  - `server/lib/subagents/` - AI sub-tasks
- **API Route Organization**: Routes organized by domain in `server/api/`
  - `auth/`, `briefing/`, `chat/`, `feedback/`, `health/`, `intelligence/`, `location/`, `platform/`, `research/`, `strategy/`, `utils/`, `vehicle/`, `venue/`
- **Bootstrap System**: Separated server startup concerns into `server/bootstrap/`
- **React Router Refactor**: Monolithic co-pilot.tsx split into 7 route-based pages
- **Auth System**: New authentication pages and protected routes
- **Documentation**: 95+ README files across all folders

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
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │           React Client (Vite + React Router v6)             │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │ routes.tsx → CoPilotLayout → 7 Route Pages           │  │ │
│  │  │   /co-pilot/strategy   → StrategyPage                │  │ │
│  │  │   /co-pilot/bars       → BarsPage                    │  │ │
│  │  │   /co-pilot/briefing   → BriefingPage                │  │ │
│  │  │   /co-pilot/map        → MapPage                     │  │ │
│  │  │   /co-pilot/intel      → IntelPage                   │  │ │
│  │  │   /co-pilot/about      → AboutPage                   │  │ │
│  │  │   /privacy-policy      → PolicyPage                  │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                   │
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

Every folder has a README.md. Total: **95 README files**.

### Root Level

| Folder | README |
|--------|--------|
| `/` | [README.md](README.md) |
| `attached_assets/` | [README.md](attached_assets/README.md) |
| `config/` | [README.md](config/README.md) |
| `data/` | [README.md](data/README.md) |
| `data/context-snapshots/` | [README.md](data/context-snapshots/README.md) |
| `docs/` | [README.md](docs/README.md) |
| `docs/architecture/` | [README.md](docs/architecture/README.md) |
| `docs/melswork/` | [README.md](docs/melswork/README.md) |
| `docs/melswork/needs-updating/` | [README.md](docs/melswork/needs-updating/README.md) |
| `docs/melswork/needs-updating/architecture/` | [README.md](docs/melswork/needs-updating/architecture/README.md) |
| `docs/melswork/needs-updating/architecture/urgent/` | [README.md](docs/melswork/needs-updating/architecture/urgent/README.md) |
| `drizzle/` | [README.md](drizzle/README.md) |
| `drizzle/meta/` | [README.md](drizzle/meta/README.md) |
| `keys/` | [README.md](keys/README.md) |
| `mcp-server/` | [README.md](mcp-server/README.md) |
| `migrations/` | [README.md](migrations/README.md) |
| `migrations/manual/` | [README.md](migrations/manual/README.md) |
| `platform-data/` | [README.md](platform-data/README.md) |
| `platform-data/uber/` | [README.md](platform-data/uber/README.md) |
| `public/` | [README.md](public/README.md) |
| `public/.well-known/` | [README.md](public/.well-known/README.md) |
| `schema/` | [README.md](schema/README.md) |
| `scripts/` | [README.md](scripts/README.md) |
| `shared/` | [README.md](shared/README.md) |
| `tools/` | [README.md](tools/README.md) |
| `tools/research/` | [README.md](tools/research/README.md) |

### Server Folders (40 READMEs)

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
| `server/lib/change-analyzer/` | [README](server/lib/change-analyzer/README.md) | Diff detection |
| `server/lib/external/` | [README](server/lib/external/README.md) | Third-party APIs |
| `server/lib/infrastructure/` | [README](server/lib/infrastructure/README.md) | Job queue |
| `server/lib/location/` | [README](server/lib/location/README.md) | Location services |
| `server/lib/notifications/` | [README](server/lib/notifications/README.md) | Push notifications |
| `server/lib/strategy/` | [README](server/lib/strategy/README.md) | Strategy pipeline |
| `server/lib/subagents/` | [README](server/lib/subagents/README.md) | AI sub-tasks |
| `server/lib/venue/` | [README](server/lib/venue/README.md) | Venue intelligence |
| `server/logger/` | [README](server/logger/README.md) | Workflow logging |
| `server/middleware/` | [README](server/middleware/README.md) | Express middleware |
| `server/scripts/` | [README](server/scripts/README.md) | Server scripts |
| `server/types/` | [README](server/types/README.md) | TypeScript types |
| `server/util/` | [README](server/util/README.md) | Utilities |
| `server/validation/` | [README](server/validation/README.md) | Schema validation |

### Client Folders (21 READMEs)

| Folder | README | Purpose |
|--------|--------|---------|
| `client/` | [README](client/README.md) | Client overview |
| `client/public/` | [README](client/public/README.md) | Static assets |
| `client/src/` | [README](client/src/README.md) | Source overview |
| `client/src/components/` | [README](client/src/components/README.md) | Components index |
| `client/src/components/_future/` | [README](client/src/components/_future/README.md) | Staged components |
| `client/src/components/co-pilot/` | [README](client/src/components/co-pilot/README.md) | Co-pilot specific |
| `client/src/components/strategy/` | [README](client/src/components/strategy/README.md) | Strategy display |
| `client/src/components/strategy/_future/` | [README](client/src/components/strategy/_future/README.md) | Staged strategy UI |
| `client/src/components/ui/` | [README](client/src/components/ui/README.md) | shadcn/ui primitives |
| `client/src/contexts/` | [README](client/src/contexts/README.md) | React contexts |
| `client/src/features/` | [README](client/src/features/README.md) | Feature modules |
| `client/src/features/strategy/` | [README](client/src/features/strategy/README.md) | Strategy feature |
| `client/src/hooks/` | [README](client/src/hooks/README.md) | Custom hooks |
| `client/src/layouts/` | [README](client/src/layouts/README.md) | Route layouts |
| `client/src/lib/` | [README](client/src/lib/README.md) | Core utilities |
| `client/src/pages/` | [README](client/src/pages/README.md) | Route pages |
| `client/src/pages/co-pilot/` | [README](client/src/pages/co-pilot/README.md) | Co-pilot route pages |
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

### Server Entry Points

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry |
| `strategy-generator.js` | Background strategy worker |
| `sdk-embed.js` | SDK router factory |
| `shared/schema.js` | Drizzle ORM schema |

### Client Entry Points (React Router v6)

| File | Purpose |
|------|---------|
| `client/src/main.tsx` | React app bootstrap |
| `client/src/App.tsx` | RouterProvider wrapper |
| `client/src/routes.tsx` | Route definitions (createBrowserRouter) |
| `client/src/layouts/CoPilotLayout.tsx` | Shared layout with bottom nav |
| `client/src/contexts/co-pilot-context.tsx` | Shared state across pages |

### Route Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/co-pilot/strategy` | StrategyPage.tsx | AI strategy + Smart Blocks + Coach |
| `/co-pilot/bars` | BarsPage.tsx | Premium venue listings |
| `/co-pilot/briefing` | BriefingPage.tsx | Weather, traffic, news, events |
| `/co-pilot/map` | MapPage.tsx | Venue + event map |
| `/co-pilot/intel` | IntelPage.tsx | Rideshare intelligence |
| `/co-pilot/about` | AboutPage.tsx | About + donation |
| `/privacy-policy` | PolicyPage.tsx | Privacy policy |

## Application Workflow

### User Flow

```
User opens app → LocationContext resolves GPS
                         ↓
              POST /api/blocks-fast (triggers TRIAD)
                         ↓
              SSE /api/strategy/subscribe (real-time updates)
                         ↓
              StrategyPage displays results
```

### Data Flow

```
LocationContext (GPS) ─────────────────────────────────────────────┐
                                                                    ↓
CoPilotContext ─── strategyQuery ─── POST /api/blocks-fast ─── TRIAD Pipeline
      │                                                             ↓
      ├── blocksQuery ──────────────────────────────── Smart Blocks
      │                                                             ↓
      └── SSE subscription ────────── /api/strategy/subscribe ── Live Updates
```

### Key Contexts

| Context | Scope | Purpose |
|---------|-------|---------|
| `LocationContext` | App-wide | GPS, city, timezone, overrides |
| `CoPilotContext` | Co-pilot pages | Strategy, blocks, SSE, progress |
| `QueryClient` | App-wide | React Query cache |

## Pending Items / Roadmap

Tracked in [docs/DOC_DISCREPANCIES.md](docs/DOC_DISCREPANCIES.md).

### Critical (Must Fix)

*None currently - all critical issues resolved on 2025-12-27*

### Medium Priority

| Issue | Status |
|-------|--------|
| MCP memory tools verification | Unknown if configured |
| Legacy Replit docs review | In `docs/melswork/needs-updating/` |

### Documentation Backlog

| Folder | Status | Action Needed |
|--------|--------|---------------|
| `docs/melswork/needs-updating/architecture/ai-ml/` | Unknown | Review & merge |
| `docs/melswork/needs-updating/architecture/auth/` | Unknown | Review & merge |
| `docs/melswork/needs-updating/architecture/guides/` | Unknown | Review & merge |
| `docs/melswork/needs-updating/architecture/integration/` | Unknown | Review & merge |
| `docs/melswork/needs-updating/assistant/` | Unknown | Review & merge |
| `docs/melswork/needs-updating/eidolon/` | Unknown | Review & merge |
| `docs/melswork/needs-updating/agent/` | Unknown | Review & merge |

## Related Files

- [CLAUDE.md](CLAUDE.md) - AI assistant quick reference
- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) - Historical issues and fixes
- [docs/AI_PARTNERSHIP_PLAN.md](docs/AI_PARTNERSHIP_PLAN.md) - Documentation improvement roadmap
- [docs/DOC_DISCREPANCIES.md](docs/DOC_DISCREPANCIES.md) - Known documentation issues

---

**Note:** This file was restructured on 2025-12-15 and updated on 2025-12-27 with React Router architecture. Detailed content is in `docs/architecture/` for better readability. Complete folder README index now includes 95 files.
