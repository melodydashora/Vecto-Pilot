# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It achieves this by providing real-time, data-driven strategic briefings, leveraging advanced AI and data analytics. The platform integrates diverse data sources such as location, events, traffic, weather, and air quality to generate actionable strategies for drivers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform uses a role-based, model-agnostic architecture with configurable AI models.
-   **Strategy Generation Pipeline**: An event-driven, three-step pipeline:
    1.  **Strategist** (Claude): Generates a strategic overview.
    2.  **Briefer** (Perplexity): Conducts comprehensive travel research (global, domestic, local, holidays, nearby events).
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
Supports Mono Mode and Split Mode, with reliability features like health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.

**Replit Autoscale Deployment**:
The platform supports optional autoscale mode via opt-in environment variable.

-   **Environment Detection**: Uses `process.env.REPLIT_DEPLOYMENT === "1"` to detect Replit deployments.
-   **Autoscale Mode (Opt-In)**: Only enabled when `CLOUD_RUN_AUTOSCALE=1` is explicitly set. When active:
    -   Uses raw HTTP server (no Express) for minimal overhead
    -   Responds to `/`, `/health`, `/ready` with 200 OK instantly
    -   Cloud Run compatible timeouts (keepAlive: 65s, headers: 66s)
    -   Skips all route loading (SDK, Agent, SSE events)
    -   Skips database connection initialization
-   **Regular Deployment Mode (Default)**: When `CLOUD_RUN_AUTOSCALE` is unset:
    -   Runs full Express application with all features
    -   Health endpoints (`/health`, `/ready`, `/healthz`) registered FIRST
    -   Server listens IMMEDIATELY before loading heavy modules
    -   Middleware/routes loaded in `setImmediate()` after server binds
    -   Static assets served from `client/dist`
-   **Worker Behavior**: Background worker automatically disabled in autoscale (stateless requirement), enabled in local development via `ENABLE_BACKGROUND_WORKER=true` in `mono-mode.env`.
-   **Implementation Files**:
    -   `gateway-server.js`: Autoscale detection (opt-in) and dual-mode support
    -   `scripts/start-replit.js`: Worker skip logic
    -   `mono-mode.env`: Port configuration (EIDOLON_PORT commented out)
    -   `.replit`: Single-port configuration (5000→80 only)
-   **Port Configuration**: **CRITICAL for autoscale** - Replit autoscale requires exactly ONE external port. Port 3101 was removed from all configuration files to prevent auto-detection. Never reference ports in env files that aren't actually used in deployment.
-   **Deployment Philosophy**: Run full Express app by default. Health endpoints respond in <10ms by registering first and listening immediately.

**Data Integrity**:
Geographic computations use snapshot coordinates. Strategy refresh is triggered by location movement, day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism, with snapshot date/time fields as the single source of truth for all AI outputs.

**Process Management**:
In Mono Mode, the Gateway Server and the Triad Worker (background job processor for strategy generation) run as separate processes.

**Strategy-First Gating & Pipeline**:
API access is gated until a strategy is ready. The pipeline involves parallel execution of AI models, followed by consolidation.

**AI Coach Data Access Layer (CoachDAL)**:
A read-only Data Access Layer provides the AI Strategy Coach with snapshot-scoped, null-safe access to comprehensive driver context, including temporal data, strategy, briefing information, and venue recommendations. Consolidated strategy outputs prioritize city-level references for privacy.

**Environment Files Structure**:
Uses a hierarchical environment configuration system: `.env` (base config), `mono-mode.env` (deployment overrides), and Replit Secrets (API keys, highest priority).

**Database Schema Highlights**:
Core tables include `snapshots`, `strategies`, `briefings`, `rankings`, `ranking_candidates`, and `venue_events`, linked by relationships. JSONB is used for flexible storage of features, business hours, and venue events.

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
-   **Important**: Database is NOT hosted on Replit infrastructure - it's an external Neon PostgreSQL instance. Schema changes must be applied via `npm run db:push` from development environment.

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.
-   **Port Configuration**: Single port (5000) for autoscale health checks.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## Recent Changes - November 14, 2025

### Smart Blocks Drizzle ORM INSERT Fix (Production Ready) ✅

**Problem**: Smart Blocks waterfall was failing with database INSERT error: `Failed query: insert into "rankings" (..., "created_at", ...) values ($1, default, $2, ...)`

**Root Cause**:
Drizzle ORM was trying to explicitly insert the SQL keyword `DEFAULT` as a bound parameter when `.defaultNow()` was present in the schema. This generated invalid SQL because PostgreSQL expects `DEFAULT` as a keyword, not a parameter value.

**Solution**:
1. **Removed `.defaultNow()` from rankings.created_at** in `shared/schema.js` (line 111)
   - Changed from: `created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()`
   - Changed to: `created_at: timestamp("created_at", { withTimezone: true }).notNull()`
2. Database already has `DEFAULT NOW()` constraint, so omitting the column from INSERT lets PostgreSQL handle it automatically
3. Required server restart to clear Drizzle's cached schema

**Technical Details**:
- Database constraint: `ALTER TABLE rankings ALTER COLUMN created_at SET DEFAULT NOW();` (already applied)
- Drizzle behavior: When column has `.defaultNow()`, it tries to INSERT `default` as a value instead of omitting the column
- Fix: Remove `.defaultNow()` so Drizzle omits the column entirely, letting database default apply

**Verified Working**:
✅ Smart Blocks waterfall completes successfully  
✅ Rankings INSERT without errors
✅ created_at automatically populated by database DEFAULT NOW()
✅ Production tested with multiple successful waterfalls

### Smart Blocks Waterfall Architecture (Production Ready) ✅

**Problem**: Smart Blocks were not appearing because the synchronous waterfall was never triggered.

**Root Causes**:
1. Frontend never called POST /api/blocks-fast to trigger the waterfall
2. Code attempting to manually set created_at conflicted with schema

**Solutions**:
1. Frontend Fix (client/src/pages/co-pilot.tsx): Modified vecto-snapshot-saved event handler to trigger POST /api/blocks-fast
2. Code Cleanup (server/lib/enhanced-smart-blocks.js): Removed duplicate created_at assignment

**Verified Working**:
✅ Snapshot creation → POST trigger → waterfall executes → blocks appear in UI
✅ No background worker required (autoscale compatible)
✅ Health endpoints remain fast (<10ms)
✅ Performance: Strategy 8-22s, Total waterfall 35-50s

See WATERFALL_FIX_SUMMARY.md for complete technical documentation.

