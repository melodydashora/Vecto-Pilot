# Server Structure

Backend organization for Vecto Pilot. All server code lives in `/server/`.

## Directory Overview

```
server/
├── api/                    # API routes (domain-organized)
│   ├── auth/               # JWT authentication
│   ├── briefing/           # Events, traffic, news, weather
│   ├── chat/               # AI Coach, voice, TTS
│   ├── feedback/           # User feedback, action logging
│   ├── health/             # Health checks, diagnostics
│   ├── location/           # GPS resolution, snapshots
│   ├── mcp/                # MCP protocol for Claude Desktop
│   ├── research/           # Vector search
│   ├── strategy/           # Strategy generation, SSE
│   ├── utils/              # HTTP helpers, timing
│   └── venue/              # Venue intelligence
├── lib/                    # Business logic
│   ├── ai/                 # AI layer
│   │   ├── adapters/       # Model adapters (anthropic, openai, gemini)
│   │   └── providers/      # AI providers (minstrategy, briefing, etc.)
│   ├── briefing/           # Briefing service
│   ├── external/           # Third-party APIs (Perplexity, FAA)
│   ├── infrastructure/     # Job queue
│   ├── location/           # Geo, holiday detection, snapshot context
│   ├── strategy/           # Strategy pipeline, providers
│   └── venue/              # Venue intelligence, enrichment, places
├── agent/                  # Workspace agent (file ops, shell, SQL)
├── assistant/              # Assistant proxy layer
├── bootstrap/              # Server startup, route mounting
├── config/                 # Configuration files
├── db/                     # Database connection, pool
├── eidolon/                # Enhanced SDK
│   ├── memory/             # Memory management
│   └── tools/              # Tool definitions
├── gateway/                # Gateway proxy
├── jobs/                   # Background workers (triad-worker)
├── logger/                 # Logging utilities (ndjson, workflow)
├── middleware/             # Express middleware (auth, validation)
├── scripts/                # Server-side scripts
├── types/                  # TypeScript types
├── util/                   # Utilities (circuit breaker, UUID, ETA)
└── validation/             # Schema validation
```

## Folder READMEs

Every folder has a README.md explaining its purpose.

### Top-Level Server Folders

| Folder | README | Purpose |
|--------|--------|---------|
| `server/` | [README](../../server/README.md) | Server overview |
| `server/api/` | [README](../../server/api/README.md) | API routes index |
| `server/lib/` | [README](../../server/lib/README.md) | Business logic index |
| `server/agent/` | [README](../../server/agent/README.md) | Workspace agent |
| `server/assistant/` | [README](../../server/assistant/README.md) | Assistant proxy |
| `server/bootstrap/` | [README](../../server/bootstrap/README.md) | Server startup |
| `server/config/` | [README](../../server/config/README.md) | Configuration |
| `server/db/` | [README](../../server/db/README.md) | Database connection |
| `server/eidolon/` | [README](../../server/eidolon/README.md) | Enhanced SDK |
| `server/gateway/` | [README](../../server/gateway/README.md) | Gateway proxy |
| `server/jobs/` | [README](../../server/jobs/README.md) | Background workers |
| `server/logger/` | [README](../../server/logger/README.md) | Workflow logging |
| `server/middleware/` | [README](../../server/middleware/README.md) | Express middleware |
| `server/scripts/` | [README](../../server/scripts/README.md) | Server scripts |
| `server/types/` | [README](../../server/types/README.md) | TypeScript types |
| `server/util/` | [README](../../server/util/README.md) | Utilities |
| `server/validation/` | [README](../../server/validation/README.md) | Schema validation |

### API Route Folders

| Folder | README | Routes | Purpose |
|--------|--------|--------|---------|
| `api/auth/` | [README](../../server/api/auth/README.md) | `/api/auth/*` | JWT token generation |
| `api/briefing/` | [README](../../server/api/briefing/README.md) | `/api/briefing/*` | Events, traffic, news, weather |
| `api/chat/` | [README](../../server/api/chat/README.md) | `/api/chat`, `/api/tts`, `/api/realtime` | AI Coach, voice, TTS |
| `api/feedback/` | [README](../../server/api/feedback/README.md) | `/api/feedback/*`, `/api/actions` | User feedback, action logging |
| `api/health/` | [README](../../server/api/health/README.md) | `/api/health`, `/api/diagnostics` | Health checks, monitoring |
| `api/location/` | [README](../../server/api/location/README.md) | `/api/location/*`, `/api/snapshot` | GPS resolution, snapshots |
| `api/mcp/` | [README](../../server/api/mcp/README.md) | `/mcp/*` | MCP protocol for Claude Desktop |
| `api/research/` | [README](../../server/api/research/README.md) | `/api/research`, `/api/vector-search` | Vector search, research |
| `api/strategy/` | [README](../../server/api/strategy/README.md) | `/api/blocks-fast`, `/api/strategy` | Strategy generation, venues |
| `api/utils/` | [README](../../server/api/utils/README.md) | (internal) | HTTP helpers, timing |
| `api/venue/` | [README](../../server/api/venue/README.md) | `/api/venues/*` | Venue intelligence |

### Business Logic Folders

| Folder | README | Purpose |
|--------|--------|---------|
| `lib/ai/` | [README](../../server/lib/ai/README.md) | AI layer index |
| `lib/ai/adapters/` | [README](../../server/lib/ai/adapters/README.md) | Model adapters |
| `lib/ai/providers/` | [README](../../server/lib/ai/providers/README.md) | AI providers |
| `lib/briefing/` | [README](../../server/lib/briefing/README.md) | Briefing service |
| `lib/external/` | [README](../../server/lib/external/README.md) | Third-party APIs |
| `lib/infrastructure/` | [README](../../server/lib/infrastructure/README.md) | Job queue |
| `lib/location/` | [README](../../server/lib/location/README.md) | Location services |
| `lib/strategy/` | [README](../../server/lib/strategy/README.md) | Strategy pipeline |
| `lib/venue/` | [README](../../server/lib/venue/README.md) | Venue intelligence |

### Eidolon Subfolders

| Folder | README | Purpose |
|--------|--------|---------|
| `eidolon/memory/` | [README](../../server/eidolon/memory/README.md) | Memory management |
| `eidolon/tools/` | [README](../../server/eidolon/tools/README.md) | Tool definitions |

## Key Files

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry |
| `strategy-generator.js` | Background strategy worker |
| `sdk-embed.js` | SDK router factory |
| `server/bootstrap/routes.js` | Route mounting order |
| `server/bootstrap/middleware.js` | Middleware configuration |
| `server/bootstrap/workers.js` | Background job startup |

## AI Layer (`server/lib/ai/`)

| File/Folder | Purpose |
|-------------|---------|
| `adapters/index.js` | Main dispatcher - `callModel(role, params)` |
| `adapters/anthropic-adapter.js` | Claude integration |
| `adapters/openai-adapter.js` | GPT-5.2 integration |
| `adapters/gemini-adapter.js` | Gemini integration |
| `providers/minstrategy.js` | Strategic overview (Claude Opus 4.6) |
| `providers/briefing.js` | Events, traffic, news (Gemini 3.0 Pro) |
| `providers/consolidator.js` | Final strategy (GPT-5.2) |
| `models-dictionary.js` | Model configuration and roles |
| `coach-dal.js` | AI Coach data access layer |

**Critical Rule:** Always use the adapter pattern:
```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('strategist', { system, user });
```

## Data Flow Examples

### Strategy Generation (TRIAD)
```
POST /api/blocks-fast
    → Create snapshot (GPS, weather, AQI, holiday)
    → Phase 1: Strategist (Claude) + Briefer (Gemini) [parallel]
    → Phase 2: Consolidator (GPT-5.2)
    → Phase 3: Tactical Planner + Venue Enrichment
    → Phase 4: Event Validator
    → SSE notification → Client polls result
```

### Venue Enrichment
```
GPT-5.2 venue suggestions
    → Google Places API (business hours, place_id)
    → Google Routes API (distance, drive time)
    → Gemini 2.5 Pro (event verification)
    → Google Geocoding (addresses)
    → Store in ranking_candidates table
```

## Import Patterns

```javascript
// AI adapters (always use this)
import { callModel } from '../../lib/ai/adapters/index.js';

// Database
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';

// Logging
import { triadLog, venuesLog } from '../../logger/workflow.js';

// Snapshot context
import { getSnapshotContext } from '../../lib/location/get-snapshot-context.js';
```

## See Also

- [Client Structure](client-structure.md) - Frontend organization
- [API Reference](api-reference.md) - Endpoint documentation
- [AI Pipeline](ai-pipeline.md) - Model configuration
- [Database Schema](database-schema.md) - Table structures
- [Logging](logging.md) - Workflow logging conventions
