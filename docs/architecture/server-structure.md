# Server Structure

Backend organization for Vecto Pilot. All server code lives in `/server/`.

## Directory Overview

```
server/
├── api/                    # API routes (domain-organized)
├── lib/                    # Business logic
├── config/                 # Configuration files
├── middleware/             # Express middleware
├── bootstrap/              # Server startup
├── jobs/                   # Background workers
├── db/                     # Database connection
├── logger/                 # Workflow-aware logging
├── agent/                  # AI agent infrastructure
├── eidolon/                # Enhanced SDK
├── assistant/              # Assistant proxy layer
└── scripts/                # Server-side scripts
```

## API Routes (`server/api/`)

Routes are organized by domain. Each folder has a README.md.

| Folder | Routes | Purpose |
|--------|--------|---------|
| `auth/` | `/api/auth/*` | JWT token generation |
| `briefing/` | `/api/briefing/*` | Events, traffic, news, weather |
| `chat/` | `/api/chat`, `/api/tts`, `/api/realtime` | AI Coach, voice, TTS |
| `feedback/` | `/api/feedback/*`, `/api/actions` | User feedback, action logging |
| `health/` | `/api/health`, `/api/diagnostics` | Health checks, monitoring |
| `location/` | `/api/location/*`, `/api/snapshot` | GPS resolution, snapshots |
| `research/` | `/api/research`, `/api/vector-search` | Vector search, research |
| `strategy/` | `/api/blocks-fast`, `/api/strategy` | Strategy generation, venues |
| `venue/` | `/api/venues/*` | Venue intelligence |
| `mcp/` | `/mcp/*` | MCP protocol for Claude Desktop |

## Business Logic (`server/lib/`)

Core business logic, organized by domain.

### AI Layer (`server/lib/ai/`)

| File/Folder | Purpose |
|-------------|---------|
| `adapters/index.js` | Main dispatcher - `callModel(role, params)` |
| `adapters/anthropic-adapter.js` | Claude integration |
| `adapters/openai-adapter.js` | GPT-5.2 integration |
| `adapters/gemini-adapter.js` | Gemini integration |
| `providers/minstrategy.js` | Strategic overview (Claude Opus 4.5) |
| `providers/briefing.js` | Events, traffic, news (Gemini 3.0 Pro) |
| `providers/consolidator.js` | Final strategy (GPT-5.2) |
| `models-dictionary.js` | Model configuration and roles |
| `coach-dal.js` | AI Coach data access layer |

**Critical Rule:** Always use the adapter pattern:
```javascript
import { callModel } from './lib/ai/adapters/index.js';
const result = await callModel('strategist', { system, user });
```

### Strategy Layer (`server/lib/strategy/`)

| File | Purpose |
|------|---------|
| `strategy-generator-parallel.js` | Main TRIAD pipeline orchestrator |
| `tactical-planner.js` | GPT-5.2 venue generation |
| `providers.js` | Strategy provider registry |

### Venue Layer (`server/lib/venue/`)

| File | Purpose |
|------|---------|
| `enhanced-smart-blocks.js` | Venue enrichment orchestrator |
| `venue-enrichment.js` | Google Places/Routes integration |
| `venue-event-verifier.js` | Event verification (Gemini 2.5 Pro) |
| `venue-address-resolver.js` | Batch address resolution |

### Location Layer (`server/lib/location/`)

| File | Purpose |
|------|---------|
| `geo.js` | Geospatial utilities (haversine, etc.) |
| `get-snapshot-context.js` | Snapshot context builder |
| `holiday-detector.js` | Holiday detection (Gemini + override) |

### External APIs (`server/lib/external/`)

| File | Purpose |
|------|---------|
| `routes-api.js` | Google Routes API integration |
| `faa-api.js` | FAA airport delay data |

## Data Flow Examples

### Location Resolution
```
GPS coords → /api/location/resolve
    → Check users table (device_id match?)
    → Check coords_cache (4-decimal precision)
    → Google Geocoding API (if cache miss)
    → Update users table
    → Return user_id + resolved location
```

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

## Key Entry Points

| File | Purpose |
|------|---------|
| `gateway-server.js` | Main Express server entry |
| `strategy-generator.js` | Background strategy worker |
| `server/bootstrap/routes.js` | Route mounting order |
| `server/bootstrap/middleware.js` | Middleware configuration |
| `server/bootstrap/workers.js` | Background job startup |

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

- [API Reference](api-reference.md) - Endpoint documentation
- [AI Pipeline](ai-pipeline.md) - Model configuration
- [Database Schema](database-schema.md) - Table structures
- [Logging](logging.md) - Workflow logging conventions
