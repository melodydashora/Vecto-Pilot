> **Last Verified:** 2026-01-10

# Server Architecture (`server/`)

## Overview

The server is organized into domain-specific folders. Each folder has its own README with detailed documentation.

## Folder Structure

| Folder | Purpose | Key Files |
|--------|---------|-----------|
| [`api/`](api/README.md) | HTTP route handlers organized by domain | Routes mounted on Express |
| [`lib/`](lib/README.md) | Core business logic and AI pipeline | Adapters, providers, strategies |
| [`lib/events/`](lib/events/pipeline/README.md) | Event ETL pipeline | Normalize, validate, hash events |
| [`db/`](db/README.md) | Database connection and Drizzle ORM | `drizzle.js`, `pool.js` |
| [`middleware/`](middleware/README.md) | Express middleware | Auth, validation, rate limiting |
| [`config/`](config/README.md) | Configuration and env loading | `load-env.js`, `validate-env.js` |
| [`validation/`](validation/README.md) | Zod schemas for request validation | `schemas.js` |
| [`util/`](util/README.md) | Utility functions | UUID, circuit breaker, validation |
| [`logger/`](logger/README.md) | Structured logging (NDJSON) | `ndjson.js` |
| [`jobs/`](jobs/README.md) | Background workers | `triad-worker.js` |
| [`bootstrap/`](bootstrap/README.md) | Server startup and route mounting | `routes.js`, `middleware.js` |
| [`gateway/`](gateway/README.md) | Gateway server configuration | Main Express app setup |
| [`agent/`](agent/README.md) | WebSocket agent for real-time | Agent embed routes |
| [`scripts/`](scripts/README.md) | Operational scripts | Holiday override, maintenance |

## Import Path Reference

When importing between folders, use these patterns:

### From `server/api/*/` (nested API routes)

| Target | Import Path |
|--------|-------------|
| `server/lib/` | `../../lib/` |
| `server/db/` | `../../db/` |
| `server/middleware/` | `../../middleware/` |
| `server/util/` | `../../util/` |
| `server/validation/` | `../../validation/` |
| `server/logger/` | `../../logger/` |
| `server/jobs/` | `../../jobs/` |
| `shared/` (project root) | `../../../shared/` |
| `server/api/utils/` | `../utils/` |

### From `server/lib/*/` (nested lib modules)

| Target | Import Path |
|--------|-------------|
| `server/db/` | `../../db/` |
| `server/lib/` (sibling) | `../other-folder/` |
| `shared/` (project root) | `../../../shared/` |

### Common Mistakes

1. **`../../shared/`** from `server/api/*/` resolves to `server/shared/` (wrong) - use `../../../shared/`
2. **`./utils/`** from `server/api/subfolder/` resolves to `server/api/subfolder/utils/` - use `../utils/`
3. **Dynamic imports** (`await import('...')`) need the same path corrections as static imports

## Data Flow

```
Client Request
    ↓
gateway-server.js (Express)
    ↓
bootstrap/routes.js (mounts API routes)
    ↓
api/*/route.js (validates request)
    ↓
lib/*/ (business logic)
    ↓
db/drizzle.js (database)
    ↓
Response
```

## TRIAD Pipeline (AI Strategy Generation)

```
POST /api/blocks-fast → TRIAD Pipeline (~35-50s)
│
├── Phase 1 (Parallel): Strategist + Briefer + Holiday
│   ├── minstrategy (Claude Opus 4.5) → strategies.minstrategy
│   ├── briefing.js (Gemini 3.0 Pro) → briefings table
│   └── holiday-checker → holiday context
│
├── Phase 2 (Parallel): Consolidators
│   ├── runConsolidator (Gemini) → strategies.consolidated_strategy
│   └── runImmediateStrategy (GPT-5.2) → strategies.strategy_for_now
│
├── Phase 3: Venue Generation
│   └── enhanced-smart-blocks.js → rankings + ranking_candidates
│
└── Response with strategy + blocks

Phase timing tracked via strategies.phase_started_at for real-time progress.
See lib/ai/README.md for model details.
```

## Key Conventions

1. **All data links to `snapshot_id`** - Snapshots are the central connector
2. **Use adapters for AI calls** - Never call AI APIs directly
3. **Drizzle ORM for database** - Schema in `shared/schema.js`
4. **Zod for validation** - Schemas in `validation/schemas.js`
5. **NDJSON for logging** - Structured JSON logs via `logger/ndjson.js`

## See Also

- [ARCHITECTURE.md](../ARCHITECTURE.md) - Full system architecture
- [CLAUDE.md](../CLAUDE.md) - Quick reference for AI agents
- [LESSONS_LEARNED.md](../LESSONS_LEARNED.md) - Historical issues and fixes
