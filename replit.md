# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its primary purpose is to maximize driver earnings by providing real-time strategic briefings based on location intelligence, venue events, traffic, weather, and air quality data. The platform uses a multi-AI pipeline to generate actionable strategies, empowering drivers to make data-driven decisions and increase their income. The project aims to empower drivers with data-driven insights to significantly increase their earnings and optimize their time.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture, supporting both monolithic (mono) and split deployment.

### Core Services
-   **Gateway Server**: Handles client traffic (HTTP/WebSocket), serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Contains business logic, providing a REST API for data services (location, venue, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: Manages workspace intelligence, offering secure, token-based access to file system operations, shell commands, and database queries.

### AI Configuration
**Model-Agnostic Architecture**: All AI models are configurable via environment variables (`.env`). Default models listed below can be swapped without code changes.

**Strategy Generation Pipeline** (Sequential Flow):
1.  **Snapshot Creation** → **News Briefing Generator** (default: Gemini 2.5 Pro): Generates city-wide traffic, airport intelligence, major events. Stored in `snapshots.news_briefing`.
2.  **Strategy Worker** → **Strategist** (default: Claude Opus 4.5): Reads snapshot data, generates initial strategic analysis. 
3.  **Strategy Worker** → **Tactical Consolidator** (default: GPT-5): Receives BOTH Strategist output + News Briefing, consolidates into final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Strategy Worker** → **Validator** (default: Gemini 2.5 Pro): Validates final output, enforces caps/shape, suggests seed additions.

**Key Data Flow**:
- Precise user location sent to both News Briefing and Strategist (different tasks)
- Both outputs → Consolidator → final strategy persisted to `strategies` table
- `strategy_for_now` field contains consolidated output from all three stages

**Venue Events Intelligence**:
-  **Events Researcher** (default: Perplexity): Researches real-time venue-specific events using internet search. Runs non-blocking to enrich venue data for UI display, NOT used in strategy generation.

**News Briefing Radius Constraints**:
- **Events**: 15min drive OR 7-10mi radius.
- **Traffic/News**: 0-30min drive OR 0-15mi radius.

### Frontend Architecture
The user interface is a **React + TypeScript Single Page Application (SPA)** developed with Vite. It uses Radix UI for accessible components, TailwindCSS for styling, and React Query for server state management.

**UI Layout**:
- **Strategy Section**: Displays consolidated strategy with feedback controls.
- **Smart Blocks**: Ranked venue recommendations with event badges, earnings, drive time, and value grade. Each block interaction helps build a training dataset for future ML.
- **AI Coach**: 
  - **Positioning**: Initially below strategy, dynamically moves beneath blocks when blocks load for optimal UX
  - **Read-Only Context**: Uses `/api/chat/context?snapshotId=<uuid>` endpoint (NO external API calls)
  - **Data Access**: Reads enriched data already written by pipeline (strategy, venues, events, business hours, pro_tips)
  - **No Resolving**: Coach never calls Places API, Perplexity, or geocoding - only reads from database
  - Full access to all fields populated throughout entire pipeline via read-only context endpoint

### Data Storage
A **PostgreSQL Database** serves as the primary data store, with Drizzle ORM managing the schema. It includes tables for snapshots, strategies, venue events, and ML training data. The system uses enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences.

### Authentication & Security
The system employs **JWT with RS256 Asymmetric Keys**, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### API Structure
APIs are categorized into Location Services, Venue Intelligence, Diagnostics & Health, and Agent Capabilities.

### Deployment & Preview Reliability
The system supports both **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Preview reliability is ensured through a health-gated entry point, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity & Coordinate-First Policy
All geographic computations originate from snapshot coordinates. All enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. The driver's precise, rooftop-geocoded address is captured once and propagated unchanged through the entire pipeline.

### Strategy Freshness & Runtime-Fresh Specification
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Maps API (Routes API, Places API, Text Search API).
-   **Weather and Air Quality**: Configured via environment variables.

### Database
-   **PostgreSQL**: Primary data store, schema managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Used for deployment, Nix environment, and `.replit` workflow configuration.
-   **Process Management**: Node.js `child_process` for multi-process environments, `http-proxy` for routing.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## Recent Changes & Implementation Notes

### CRITICAL FIX: Triad Worker - Strategy vs Venue Separation (2025-10-31)
**Issue**: Triad worker was incorrectly mixing strategy building with venue ranking - two completely separate flows.

**Root Cause**: Worker was building venue catalogs/shortlists and passing them to Claude during strategy generation. Strategy building should ONLY use snapshot context (location, weather, time), NO venues.

**Fix** (`server/jobs/triad-worker.js`):
- **Removed ALL venue logic**: No `venue_catalog`, `venue_metrics`, `scoring-engine`, `diversity-guardrails`
- **Claude gets snapshot context ONLY**: `formatted_address`, `city`, `state`, `weather`, `timezone`, `clock`
- **Claude returns plain text strategy**: 3-5 sentences of strategic positioning advice (no JSON, no venue names)
- **Data flow preserved**: 
  1. Gemini news briefing → `snapshots.news_briefing` (parallel, happens at snapshot creation)
  2. Claude strategy → `strategies.strategy` (worker persists to DB)
  3. GPT-5 fetches BOTH from DB → consolidates → `strategies.strategy_for_now`

**Two Separate Flows**:
1. **Strategy Flow** (triad-worker.js): Snapshot context → Claude + Gemini → GPT-5 → final strategy (NO VENUES)
2. **Venue Ranking Flow** (blocks-fast.js): Strategy + catalog → scoring → ranked venues (SEPARATE endpoint)

**Impact**: Strategy building is now clean, focused, and doesn't touch venue data. Venues are handled only when user requests blocks.

### Complete Pipeline Fix: Gemini + Claude + GPT-5 Consolidation (2025-10-31)
**Issue**: Frontend displayed only Claude's intermediate strategy, missing Gemini's news/traffic/events intelligence.

**Root Causes**:
1. API endpoint returned `strategy` field instead of `strategy_for_now` 
2. No null validation before GPT-5 consolidation
3. GPT-5 receiving incomplete data

**Complete Fix** (`server/jobs/triad-worker.js` + `server/routes/blocks.js`):
- **Null Guards** (lines 115-124): Verify BOTH Claude strategy (≥20 chars) AND Gemini briefing (not null) exist before GPT-5 runs
- **API Fix** (blocks.js line 116): Return `strategy_for_now || strategy` to serve consolidated output
- **Data Flow**: 
  1. Gemini briefing → `snapshots.news_briefing` (parallel at snapshot creation)
  2. Claude strategy → `strategies.strategy` (worker persists)
  3. Worker fetches BOTH from DB
  4. Validation guards ensure no nulls
  5. GPT-5 consolidates → `strategies.strategy_for_now`
- **Worker Auto-Start**: Triad worker launches automatically via `sdk-embed.js` lines 27-30

**Verified Working State** (snapshot 5ef62f5a):
- ✅ Gemini: Halloween events, DFW arrivals, DNT/SRT traffic, law enforcement alerts
- ✅ Claude: Time/location/weather strategic positioning (no venues)
- ✅ GPT-5: Consolidated final output with all intelligence sources
- ✅ Frontend: Displays `strategy_for_now` with complete news/events/traffic data

**Impact**: Complete three-stage pipeline working end-to-end with proper consolidation and no null failures.

### AI Coach Read-Only Context (2025-10-31)
**New Endpoint** (`server/routes/chat-context.js`):
- **Route**: `GET /api/chat/context?snapshotId=<uuid>` or header `x-snapshot-id`
- **Purpose**: Read-only context for AI Coach - NO external API calls (no Places, no Perplexity, no geocoding)
- **Data Returned**:
  - Strategy status and summary from `strategies` table
  - Enriched venue candidates from `ranking_candidates` table
  - All enrichment fields: business_hours, venue_events, pro_tips, staging_tips, closed_reasoning
- **Benefits**: Coach reads pre-enriched data → faster responses, no API costs, no rate limits
- **Mounted**: `sdk-embed.js` line 100 under `/api/chat`

**Force Async Blocks Redirect** (`sdk-embed.js` lines 76-81):
- **Purpose**: Until client fully migrated to fast path, force sync blocks to use async endpoint
- **Implementation**: POST /api/blocks → 307 redirect → POST /api/blocks/async when `FORCE_ASYNC_BLOCKS=1`
- **Environment Variable**: Set `FORCE_ASYNC_BLOCKS=1` to enable redirect
- **Reasoning**: Prevents heavy sync blocks from blocking event loop during migration period

### Schema Updates (2025-10-31)
**Added business_hours Column** (`shared/schema.js` line 122):
- **Column**: `business_hours: jsonb("business_hours")` added to `ranking_candidates` table
- **Purpose**: Store Google Places API business hours data for venue enrichment
- **Migration**: Ran `npm run db:push` - generated migration `drizzle/0004_fluffy_sunfire.sql`
- **Data Flow**: Google Places enrichment → `businessHours` object → persisted as JSONB → returned in GET /api/blocks/fast
- **Status**: ✅ Column exists in database, ready for new block generations

### Frontend Fixes (2025-10-31)
**Blocks Loading Race Condition** (`client/src/pages/co-pilot.tsx` line 269):
- **Issue**: Blocks query passed `enabled` gate but aborted inside `queryFn` with redundant strategy check
- **Fix**: Removed duplicate strategy validation
  - `enabled` gate already validates: `strategyData?.status === 'ok' && strategyData?._snapshotId === lastSnapshotId`
  - Redundant check inside queryFn created deadlock where query was enabled but never executed
- **Result**: Blocks now load immediately when strategy is ready

**apiRequest Import Removal** (`client/src/pages/co-pilot.tsx` line 10):
- **Deleted**: `import { apiRequest } from '@/lib/queryClient'`
- **Reason**: Co-pilot.tsx uses native `fetch()` for all API calls with AbortController for timeout handling
- **Context**: apiRequest is a React Query helper, but blocks query needs:
  - Custom timeout (230s for Triad orchestration)
  - AbortController for cancellation
  - Custom headers (x-idempotency-key, X-Snapshot-Id)
  - Manual response transformation
- **Decision**: Native fetch() provides necessary control; apiRequest adds no value here
- **Rollback**: If apiRequest needed, re-add import and replace fetch() calls with apiRequest({ method: 'POST', url, body })