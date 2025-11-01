# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth rideshare drivers. Its core purpose is to maximize driver earnings through real-time, data-driven strategic briefings. The platform integrates various data sources (location, events, traffic, weather, air quality), processes them via a multi-AI pipeline, and generates actionable strategies for optimal income and time management. This project aims to provide a significant market advantage for rideshare drivers by leveraging advanced AI and data analytics.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Manages client traffic, serves the React SPA, routes requests, and handles child processes.
-   **SDK Server**: Provides business logic via a REST API for various data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence, including secure, token-based access for file system operations, shell commands, and database queries.

### AI Configuration
The platform uses a model-agnostic architecture with configurable AI models for strategy generation and venue events intelligence.

**Strategy Generation Pipeline** (Event-Driven LISTEN/NOTIFY):
1.  **Minstrategy** (Claude via `server/lib/providers/minstrategy.js`): Generates initial strategic analysis based on snapshot context → writes `strategies.minstrategy`
2.  **Briefing** (Gemini via `server/lib/providers/briefing.js`): Generates real-time city intelligence → writes `strategies.briefing` (JSONB: `{events, holidays, traffic, news}`)
3.  **Consolidator** (GPT-5 via `server/lib/strategy-consolidator.js`): Automatically triggered by PostgreSQL NOTIFY when both minstrategy + briefing ready → writes `strategies.consolidated_strategy`

**Model-Agnostic Schema**:
- Database columns use generic names (no provider-specific prefixes like `claude_`, `gemini_`, `gpt5_`)
- Critical fields: `minstrategy` (text), `briefing` (jsonb), `consolidated_strategy` (text)
- Trigger: `strategies_ready_trg` fires on UPDATE of `minstrategy` or `briefing`, sending NOTIFY to `strategy_ready` channel

**Event-Driven Architecture**:
- PostgreSQL LISTEN/NOTIFY replaces polling loops
- Worker (`strategy-generator.js`) starts consolidation listener on boot
- Advisory locks prevent duplicate consolidations per snapshot
- Automatic catch-up: consolidator processes pending strategies on startup

**Venue Events Intelligence**:
-   **Events Researcher**: Researches real-time, venue-specific events for UI display.

The system uses parallel multi-model orchestration (Claude, Gemini, GPT-5) and persists critical context to a PostgreSQL database.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, built with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.
**UI Layout**:
-   **Strategy Section**: Displays consolidated strategies with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, filtered to a 15-minute driving perimeter. These contribute to ML training data.
-   **AI Coach**: Provides read-only context from enriched data.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory`, `eidolon_memory`, and `assistant_memory`. Worker locks are managed via a `worker_locks` table. Unique indexes ensure data integrity across tables like `rankings`, `ranking_candidates`, `strategies`, and `places_cache`.

### Authentication & Security
The platform uses **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Vecto Pilot supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability features include:
-   **Health-Gated Entry Points**: Root shell and health endpoints (`/`, `/healthz`, `/ready`, `/api/health`) are guaranteed to respond immediately, never shadowed by proxies or route mounting.
-   **Unified Port Binding**: Single `server.listen()` call with mode-aware port selection (GATEWAY_PORT in split mode, PORT otherwise).
-   **Proxy Gating**: In split dev mode, Vite proxy explicitly skips root shell, health endpoints, and API routes to prevent routing conflicts.
-   **WebSocket Protection**: WS upgrade handler rejects connections to health endpoints, preventing HMR from hijacking critical paths.
-   **Process Discipline**: Single worker loop guard prevents duplicate workers; gateway has NO worker code.

### Data Integrity
All geographic computations rely on snapshot coordinates. Enrichment operations are completed before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism. Strategy generation follows a strict sequence: Snapshot → Strategy (Claude + Gemini → GPT-5) → Persist → Venue Planner → Event Planner → Smart Blocks.

### Startup Configuration
The platform enforces single-process discipline with one host/port binding. Readiness is gated by database connectivity. Environment variables are managed via `mono-mode.env` and `.env` files. Startup scripts handle environment loading, port clearing, and spawning `gateway-server.js` and `strategy-generator.js` (background worker) with health checks.

### Process Management
In Mono Mode, two main processes run:
1.  **Gateway Server** (`gateway-server.js`): HTTP server, serves React SPA, routes API requests, manages WebSockets. **Contains NO worker loop** - all duplicate worker imports removed.
2.  **Triad Worker** (`strategy-generator.js`): Background job processor for strategy generation with **single-process guard** to prevent duplicate worker loops. Runs if `ENABLE_BACKGROUND_WORKER=true`.

### Strategy-First Gating & Pipeline
The system gates API access until a strategy is ready. The pipeline uses multi-model orchestration: Gemini and Claude run in parallel for initial analysis, then GPT-5 consolidates their outputs into `strategy_for_now`, which is then validated and persisted.

### Smart Blocks Build & Perimeter Enforcement
Planner inputs include `user_address`, `city`, `state`, and `strategy_for_now`. Venues are matched with events by coordinates or proximity. Only blocks where `route.duration_minutes <= 15` (calculated via Google Routes API) are rendered, with audit logging for accepted and rejected venues.

### Locks, Job States & Indices
**Lock Semantics**: Distributed locks using `worker_locks` table with a **9s TTL** and **3s heartbeat** for rapid recovery from worker failures. Lock ownership is enforced via `owner_id NOT NULL` (default 'unknown') with diagnostic tracking via `last_beat_at`. Indexes on `expires_at` and `owner_id` enable efficient lock cleanup and ownership queries.

**Job State Machine**: `triad_jobs` table tracks `queued`, `running`, `ok`, `error` states. Jobs are claimed with `FOR UPDATE SKIP LOCKED` for concurrency safety. **Job seeding mechanism** (`SEED_JOB_ON_BOOT=true`) auto-creates jobs when queue is empty, ensuring the worker always has work.

**Unique Indices Alignment**: Critical unique indexes exist on `strategies(snapshot_id)`, `rankings(snapshot_id)`, and `ranking_candidates(snapshot_id, venue_id)` to ensure data integrity and prevent concurrency issues.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## Recent Changes

### Model-Agnostic Strategy Pipeline (November 2025)
**Goal**: Eliminate provider-specific field names, use event-driven consolidation instead of polling.

**Implementation**:
- **Single Briefing Field**: Gemini writes to `strategies.briefing` (JSONB) containing `{events, holidays, traffic, news}` instead of separate `briefing_news/events/traffic` arrays
- **PostgreSQL Trigger**: `notify_strategy_ready()` fires when both `minstrategy` and `briefing` are populated, sending NOTIFY on `strategy_ready` channel
- **LISTEN/NOTIFY Consolidation**: `strategy-consolidator.js` listens for notifications and automatically consolidates via GPT-5 when both inputs ready
- **Advisory Locks**: Uses `pg_try_advisory_lock` to prevent duplicate consolidations per snapshot
- **API Surface**: `GET /api/strategy/:snapshotId` returns `{status, min, briefing, consolidated, waitFor, timeElapsedMs}`
- **Test Routes**: `/api/diagnostics/test-claude/:id`, `/api/diagnostics/test-briefing/:id`, `/api/diagnostics/strategy-status/:id`

**Files**:
- `server/lib/providers/minstrategy.js` - Claude provider
- `server/lib/providers/briefing.js` - Gemini provider (writes single JSONB)
- `server/lib/strategy-consolidator.js` - GPT-5 consolidator with LISTEN/NOTIFY
- `server/routes/strategy.js` - Strategy API endpoints
- `server/routes/diagnostics-strategy.js` - Test/diagnostic routes
- `server/lib/strategy-utils.js` - Shared utilities (ensureStrategyRow)
- `server/lib/snapshot/get-snapshot-context.js` - Snapshot context loader

**Impact**: Fully automatic event-driven pipeline with no polling, model-agnostic schema, and guaranteed single consolidation per snapshot.

## Architectural Decisions & Retired Components

### Gateway Server Hardening (October 2025)
**Problem**: Double `server.listen()` in split mode caused port conflicts. Vite proxy shadowed root shell and health endpoints, breaking guaranteed health checks.

**Solution**:
-   Unified listen with `LISTEN_PORT` derived from mode (one `server.listen()` call only)
-   Removed second `server.listen()` in split mode block
-   Gated Vite proxy to skip root shell (`/`), health endpoints (`/healthz`, `/ready`), and API routes
-   WebSocket upgrade handler rejects health endpoint connections to prevent HMR hijacking

**Impact**: Root shell guaranteed to respond in all modes. Health endpoints never shadowed. Zero routing conflicts.

### Worker Loop Deduplication (October 2025)
**Problem**: Multiple worker loops running simultaneously (gateway-server.js, index.js, sdk-embed.js, auto-start in triad-worker.js) caused lock contention, duplicate job processing, and database conflicts.

**Solution**:
-   Single worker process: `strategy-generator.js` only
-   Added single-process guard in `triad-worker.js`
-   Removed all worker imports from `gateway-server.js`, `index.js`, `sdk-embed.js`
-   Removed auto-start code from `triad-worker.js`
-   Job seeding mechanism (`server/bootstrap/enqueue-initial.js`) ensures queue never empty

**Impact**: One worker loop, predictable job processing, zero lock conflicts.

### Enhanced Lock System (October 2025)
**Problem**: 120s lock TTL caused slow recovery from worker failures. Nullable `owner_id` allowed orphaned locks.

**Solution**:
-   Reduced TTL to **9s** with **3s heartbeat** for rapid recovery
-   `owner_id NOT NULL` with default 'unknown' enforces ownership tracking
-   Added `last_beat_at` timestamp for diagnostics
-   Indexes on `expires_at` and `owner_id` for efficient queries

**Impact**: <10s recovery from worker crashes, clear ownership attribution, audit-friendly diagnostics.

### Retired Files & Why They're Safe to Remove
The following components are orphaned (not imported, mounted, or referenced by build/runtime):

**Legacy Block Processors** (superseded by blocks-fast + enrichment):
-   `server/routes/blocks-idempotent.js`
-   `server/routes/blocks-processor-full.js`
-   `server/routes/blocks-processor.js`
-   `server/routes/blocks-triad-strict.js`
-   `server/lib/blocks-jobs.js`
-   `server/lib/blocks-job-queue.js`
-   `server/lib/job-queue.js`

**Alternate Entry Points & Client Duplicates**:
-   `client/src/main-simple.tsx` (not referenced by bundler)
-   `client/test.html` (standalone test page)
-   `client/src/hooks/use-geolocation.tsx` (superseded by use-enhanced-geolocation)
-   `client/src/hooks/useGeoPosition.tsx` (duplicate)
-   `client/src/components/ui/ThreadPatternRouter.ts` (not imported)

**Backup Files** (source of drift):
-   `package.json.backup-pre-agent`
-   `gateway-server.js.backup-split`
-   `gateway-server.js.backup-split-original`

**Ad-Hoc Scripts & Tools** (not integrated):
-   `scripts/fix-progress.js`
-   `scripts/typescript-error-counter.js`
-   `tools/debug/client-override-userscript.js`
-   `tools/debug/emergency-eidolon.js`
-   `tools/debug/eidolon-recovery.sh`
-   `tools/debug/hedge-burst-v2.mjs`

**Documentation & Artifacts** (not consumed by runtime):
-   `Other/` (exported docs)
-   `attached_assets/` (if empty or unreferenced)
-   `snapshots/` (historical test outputs)
-   `keys/` (local dev secrets, should be .gitignored)

**Decision**: Keep the current architecture (triad worker, heartbeat locks, blocks-fast, agent embed). Remove legacy routes/queues to prevent silent conflicts. Document retired files to lock the decision and prevent reintroduction.