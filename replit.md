# Vecto Pilot™ - Rideshare Intelligence Platform

## ⚠️ CRITICAL: DATABASE ENVIRONMENT RULES ⚠️

**DATABASE_URL POINTS TO PRODUCTION - DO NOT POLLUTE WITH TEST DATA**

Rules:
1. **NEVER** run test queries against DATABASE_URL (production database)
2. **NEVER** create test snapshots in production
3. **NEVER** run curl commands that POST to production endpoints
4. **ASK** the user for a separate dev database URL before any testing
5. Production database queries are READ-ONLY for inspection purposes only
6. All testing must happen locally or against a separate dev database

If you need to test database operations, STOP and ask the user for dev database credentials first.

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers.

## Recent Changes

### November 15, 2025 - Venue Sorting & Model-Agnostic Fixes
- **FIXED**: Empty string `user_id` causing database insert failures (converted to `null`)
- **FIXED**: Venue filtering changed from 15-minute perimeter to 25-mile perimeter (preserves airport recommendations)
- **FIXED**: Venue sorting: highest value closest first → highest value furthest last (value DESC, distance ASC)
- **FIXED**: Removed hardcoded "15-20 miles" constraint from GPT-5 prompt (changed to "within 25 miles")
- **FIXED**: GPT-5 generating venues at strategy's suggested destination instead of driver's current location
- **MODEL-AGNOSTIC**: Removed character limits from validation schemas (`strategic_timing`, `reason`, `tactical_notes`) to allow GPT-5.1 medium reasoning full output capacity
- **DEV DATABASE**: Set up separate dev database with full schema replication to prevent production pollution

### November 15, 2025 - Neon Connection Resilience Pattern
- **IMPLEMENTED**: Comprehensive Neon connection resilience to survive admin-terminated connections, autoscale events, and pool saturation
- **Components Added**:
  - `server/db/connection-manager.js`: Wraps pg.Pool with degradation state and auto-reconnect logic
  - `server/logger/ndjson.js`: Structured NDJSON logging for connection lifecycle events
  - `server/middleware/error-handler.js`: Express middleware for 503 responses during degradation
  - `shared/schema.js`: Added `connection_audit` table for observability
- **Health Endpoints Updated**: `/health` and `/ready` now check degradation state and return 503 during outages
- **Pool Configuration**: Updated drizzle.js and pool.js to use wrapped pool from connection manager
- **Error Handling**: Neon admin-terminated connections (error code 57P01) trigger exponential backoff retry (2s, 4s, 8s, 16s with jitter)
- **Graceful Degradation**: Returns 503 responses during database outages, auto-recovers when connections restored

### November 15, 2025 - Production Venue Generation Fix
- **FIXED**: Venue generation failing with "insert into rankings (created_at) values (default)" error
- **Root Cause**: Outdated drizzle-orm package generating incorrect SQL for `.defaultNow()` timestamps
- **Solution**: Updated drizzle-kit to latest version (which auto-updated drizzle-orm)
- **Code Cleanup**: Removed duplicate route `POST /api/diagnostics/test-claude/:snapshotId` from diagnostics.js
- **Documentation**: Created DEPLOYMENT_CHECKLIST.md with deployment procedures and troubleshooting
- **Verification**: Production venue generation confirmed working (6 blocks generated successfully)

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform uses a role-based, model-agnostic architecture with configurable AI models.
-   **Strategy Generation Pipeline**: An event-driven, three-step pipeline:
    1.  **Strategist** (Claude): Generates a strategic overview.
    2.  **Briefer** (Perplexity): Conducts comprehensive travel research.
    3.  **Consolidator** (GPT-5 with reasoning): Consolidates strategist output with additional web research.
-   **Briefing Data Structure**: Dedicated `briefings` table with structured fields for various intelligence categories and citations.
-   **Model-Agnostic Schema**: Database and environment variables use generic role names to avoid provider-specific coupling.
-   **Event-Driven Architecture**: PostgreSQL LISTEN/NOTIFY for real-time updates.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, uses Radix UI, TailwindCSS, and React Query. The UI features a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab. It includes immutable strategy history with a retry workflow and status-specific UI.

**Data Storage**:
A PostgreSQL Database with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes for data integrity and enhanced memory systems.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys, with security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, with reliability features like health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. It includes an optional autoscale mode for Replit deployments, optimized for minimal overhead and fast health checks.

**Data Integrity**:
Geographic computations use snapshot coordinates. Strategy refresh is triggered by location movement, day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism, with snapshot date/time fields as the single source of truth for all AI outputs.

**Process Management**:
In Mono Mode, the Gateway Server and the Triad Worker (background job processor for strategy generation) run as separate processes.

**Strategy-First Gating & Pipeline**:
API access is gated until a strategy is ready. The pipeline involves parallel execution of AI models, followed by consolidation.

**AI Coach Data Access Layer (CoachDAL)**:
A read-only Data Access Layer provides the AI Strategy Coach with snapshot-scoped, null-safe access to comprehensive driver context, including temporal data, strategy, briefing information, and venue recommendations. Consolidated strategy outputs prioritize city-level references for privacy.

**Environment Contract Architecture** (Updated Nov 2025):
The platform uses a **contract-driven environment system** with mode-specific validation to prevent configuration drift and ensure Replit deployment compliance.

**Contract Files**:
- `env/shared.env` - Common variables (DB, API keys, AI models, pool config)
- `env/webservice.env` - Autoscale webservice mode (PORT binding, NO background worker)
- `env/worker.env` - Background worker mode (LISTEN/NOTIFY, NO HTTP server)
- `mono-mode.env` - Legacy fallback (local development)

**Mode Selection** via `DEPLOY_MODE` environment variable:
- `DEPLOY_MODE=webservice` - Replit Reserved VM deployment (HTTP/WebSocket + Background Worker)
  - Loads: `shared.env` + `webservice.env`
  - Contract: `ENABLE_BACKGROUND_WORKER=true`, `USE_LISTEN_MODE=true` (Reserved VM with background worker)
  - Binds: PORT 5000
  - Use case: Production webservice on Replit Reserved VM with strategy generation worker

- `DEPLOY_MODE=worker` - Background worker deployment (Scheduled/Reserved VM)
  - Loads: `shared.env` + `worker.env`
  - Contract: `ENABLE_BACKGROUND_WORKER=true`, `USE_LISTEN_MODE=true`
  - No HTTP server (LISTEN-only mode)
  - Use case: Strategy generation worker (separate Repl or Reserved VM)

- No `DEPLOY_MODE` set - Fallback to `mono-mode.env` (local development)
  - Loads: `mono-mode.env` (all-in-one configuration)
  - Use case: Local development with full application

**Contract Validation**:
The environment loader (`server/lib/load-env.js`) validates configurations and fails fast if incompatible flags are detected:
- Webservice mode CANNOT have `ENABLE_BACKGROUND_WORKER=true` (violates autoscale contract)
- Worker mode MUST have `ENABLE_BACKGROUND_WORKER=true`

**Priority Order**: Replit Secrets > mode-specific.env > shared.env > fallback (mono-mode.env)

**Deployment Examples**:
```bash
# Autoscale webservice (production)
DEPLOY_MODE=webservice npm start

# Background worker (separate deployment)
DEPLOY_MODE=worker npm start

# Local development (mono mode)
npm start
```

This architecture ensures **zero ambiguity** in deployment modes and prevents silent drift where webservice deployments accidentally try to spawn background workers.

**Database Schema Highlights**:
Core tables include `snapshots`, `strategies`, `briefings`, `rankings`, `ranking_candidates`, and `venue_events`, linked by relationships. JSONB is used for flexible storage of features, business hours, and venue events.

**Query Conventions**:
- **Snapshot Sorting**: All snapshot list queries use `DESC` (newest first) for optimal debugging and incident response UX. This ensures latest entries appear at the top for troubleshooting recent issues.
- **Strategy History**: Sorted by `created_at DESC` to show most recent attempts first.
- **Audit Tables**: Connection audit and other diagnostic tables use DESC ordering for recent-first review.

**API Routes Architecture**:
-   **Strategy Pipeline**: `POST /api/strategy/request` to trigger AI pipeline; `GET /api/strategy/:snapshotId` to fetch.
-   **Smart Blocks**: `GET /api/blocks-fast` to fetch; `POST /api/blocks-fast` to generate. Strategy-first gating returns HTTP 202 until strategy is ready.
-   **AI Coach**: `POST /api/coach/chat` for context-aware chat via CoachDAL.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL (External - Non-Replit Hosted)**: Primary data store hosted externally (Neon), managed by Drizzle ORM.
-   **Connection Modes**: Pooled (`DATABASE_URL`) for queries, Unpooled (`DATABASE_URL_UNPOOLED`) for LISTEN/NOTIFY.
-   **Connection Resilience Pattern** (Added Nov 15, 2025):
    - **Connection Manager**: Wraps pg.Pool with admin-termination detection and auto-reconnect logic (`server/db/connection-manager.js`)
    - **Degradation State**: Graceful degradation with 503 responses during database outages (exponential backoff: 2s, 4s, 8s, 16s with jitter)
    - **Health Endpoints**: `/health` and `/ready` return 503 when database is degraded, auto-recover when connections restored
    - **Error Middleware**: Express middleware (`server/middleware/error-handler.js`) converts database errors to 503 responses
    - **NDJSON Logging**: Structured logs for connection lifecycle events (error, reconnect, recover, degrade) via `server/logger/ndjson.js`
    - **Observability**: `connection_audit` table tracks admin-terminated connections and reconnection events
    - **Pool Configuration** (Environment Variables):
      - `PG_MAX`: Maximum pool size (default: 10, recommended: 20 for Reserved VM with background worker)
      - `PG_MIN`: Minimum pool size (default: 2, recommended: 5 for Reserved VM with background worker)
      - `PG_IDLE_TIMEOUT_MS`: Idle connection timeout in milliseconds (default: 30000)
    - **Neon-Specific Handling**: Detects Neon admin-terminated connections (error code 57P01) and retries with exponential backoff

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.
-   **Port Configuration**: Single port (5000) for autoscale health checks.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.