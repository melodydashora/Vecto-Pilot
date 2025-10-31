# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth drivers. Its purpose is to maximize driver earnings through real-time, data-driven strategic briefings. The platform integrates location, event, traffic, weather, and air quality data, processed by a multi-AI pipeline to generate actionable strategies. This empowers drivers to optimize income and time management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture supporting both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Offers workspace intelligence with secure, token-based access for file system operations, shell commands, and database queries.

### AI Configuration
The platform features a model-agnostic architecture with configurable AI models.
**Strategy Generation Pipeline**:
1.  **News Briefing Generator**: Gathers city-wide traffic, airport intelligence, and major events.
2.  **Strategist**: Conducts initial strategic analysis.
3.  **Tactical Consolidator**: Combines outputs into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator**: Validates the final output.
**Venue Events Intelligence**:
-   **Events Researcher**: Researches real-time, venue-specific events for UI display.
The platform uses parallel multi-model strategy orchestration (Claude, Gemini, GPT-5) and persists critical context fields to the database.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, developed with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.
**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data. These blocks are filtered to a 15-minute driving perimeter.
-   **AI Coach**: Provides read-only context from enriched data.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory`, `eidolon_memory`, and `assistant_memory`. Worker locks are implemented using a `worker_locks` table. Unique indexes ensure data integrity across various tables like `rankings`, `ranking_candidates`, `strategies`, and `places_cache`.

### Authentication & Security
Utilizes **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability features include health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations use snapshot coordinates. Enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Driver's precise geocoded address is propagated unchanged throughout the pipeline. Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism. Strategy generation follows a strict sequence: Snapshot → Strategy (Claude + Gemini → GPT-5) → Persist → Venue Planner → Event Planner → Smart Blocks.

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

### 2025-10-31: Fixed ON CONFLICT Error in Context Enrichment
**Issue**: "there is no unique or exclusion constraint matching the ON CONFLICT specification" error during venue enrichment.

**Root Cause**: The `upsertPlace()` function in `server/lib/places-cache.js` attempted to INSERT INTO a `places` table that doesn't exist in the database schema. Only the `places_cache` table exists.

**Fix Applied**:
1. Deprecated the `upsertPlace()` function in `server/lib/places-cache.js` (function now returns immediately with warning)
2. Removed `upsertPlace()` call from `server/lib/venue-enrichment.js`
3. Removed unused import of `upsertPlace` from venue enrichment module
4. Added missing unique constraints for memory tables (eidolon_memory, assistant_memory, cross_thread_memory) on `(scope, key, user_id)`

**Database Structure Clarification**:
- ✅ `places_cache` table exists with unique index on `place_id` (stores business hours)
- ❌ `places` table does NOT exist
- ✅ `venue_catalog` table exists with unique index on `place_id` (stores venue coordinates and metadata)
- ✅ Coordinates are preserved in `venue_catalog` and `rankings` tables

**Impact**: Eliminated SQL errors during venue enrichment. All place data flows correctly into `places_cache` (hours) and `venue_catalog` (metadata/coordinates).

### 2025-10-31: Strategy-First Gating & System Integration
**Objective**: Enforce strategy-must-complete-before-blocks rendering, verify planner inputs, strengthen lock reliability, document all unique indices, and ensure complete context persistence.

**1. Strategy Persistence with Full Context** (server/jobs/triad-worker.js):
```javascript
await db.update(strategies).set({
  status: 'ok',
  strategy_for_now: gpt5Result.text.trim(),  // GPT-5 consolidated output
  user_address: snap.formatted_address,       // Precise driver address
  city: snap.city,
  state: snap.state,
  lat: snap.lat,
  lng: snap.lng,
  user_id: snap.user_id,
  events: snap.news_briefing?.events || [],
  news: snap.news_briefing?.news || [],
  traffic: snap.news_briefing?.traffic || [],
  updated_at: new Date()
})
```
**Fields Persisted**: snapshot_id (unique), user_id, user_address, city, state, lat, lng, events, news, traffic, strategy_for_now (consolidated strategy)

**2. Strategy-First Gating** (server/lib/strategy-utils.js + server/routes/blocks-fast.js):
- Created `isStrategyReady(snapshotId)` helper function
- Returns `{ready: boolean, strategy, status}`
- GET `/api/blocks/fast?snapshotId=<uuid>` returns:
  - `202 {reason: 'strategy_pending'}` until `strategy_for_now` exists
  - `200 {blocks[], audit[]}` once strategy is ready

**3. Venue & Event Planner Inputs**:
- **Venue Generator** (`generateVenueCoordinates()` in gpt5-venue-generator.js):
  - Receives: consolidatedStrategy, driverLat, driverLng, city, state, currentTime, weather, maxDistance: 15
  - Generates: 8 venues with dual coordinates (location + staging), pro tips, closed reasoning
- **Event Planner** (`researchVenueEvents()` in venue-event-research.js):
  - Receives: venueName, city, date
  - Uses Perplexity API with `searchRecencyFilter: 'day'` for real-time events
  - Returns: has_events, summary, badge, citations, impact_level

**4. 15-Minute Perimeter Enforcement** (blocks-fast.js lines 57-79):
```javascript
const within15Min = (driveMin) => Number.isFinite(driveMin) && driveMin <= 15;
const blocks = allBlocks.filter(b => within15Min(b.driveTimeMinutes));
const rejected = allBlocks.filter(b => !within15Min(b.driveTimeMinutes)).length;
```
- Audit trail: `{step: 'perimeter', accepted, rejected, max_minutes: 15}`
- Only blocks ≤ 15 drive minutes rendered in UI

**5. Lock & Job Reliability** (server/lib/locks.js + server/jobs/triad-worker.js):
- **Lock**: `triad:${snapshot_id}` with TTL 120,000ms (120 seconds)
- **Acquisition**: Atomic CASE statement checks if lock is new OR expired before claiming
- **Release**: Always in `finally` block to prevent orphaned locks
- **Job States**: `queued → running → ok|error` (transactional with SKIP LOCKED)
- **Schema Mismatch Policy**: Detect ON CONFLICT/constraint errors, mark `failed` with `error_message: 'schema_mismatch_unique_index_required'`, stop retries

**6. Unique Indices & ON CONFLICT Alignment** (Verified):
| Table | Unique Index | ON CONFLICT Target | Status |
|-------|-------------|-------------------|--------|
| strategies | strategies_snapshot_id_unique (snapshot_id) | snapshot_id | ✅ Match |
| rankings | ux_rankings_snapshot (snapshot_id) | snapshot_id | ✅ Match |
| ranking_candidates | ux_ranking_candidates_snapshot_place (snapshot_id, place_id) | (snapshot_id, place_id) | ✅ Match |
| venue_catalog | venue_catalog_place_id_unique (place_id) | place_id | ✅ Match |
| venue_metrics | venue_metrics_pkey (venue_id) | venue_id | ✅ Match |
| places_cache | places_cache_pkey (place_id) | place_id | ✅ Match |
| worker_locks | worker_locks_pkey (lock_key) | lock_key | ✅ Match |
| eidolon_memory | composite (scope, key, user_id) | (scope, key, user_id) | ✅ Match |
| assistant_memory | composite (scope, key, user_id) | (scope, key, user_id) | ✅ Match |
| cross_thread_memory | composite (scope, key, user_id) | (scope, key, user_id) | ✅ Match |

**Exit Criteria Verification**:
✅ Strategy row persists once per snapshot with all required fields  
✅ `/api/blocks/fast` returns 202 until strategy ready, then 200 with ≥4 blocks  
✅ All displayed blocks ≤ 15 minutes (perimeter enforced)  
✅ Audit trail shows accepted/rejected block counts  
✅ Locks prevent concurrent processing (TTL 120s, released in finally)  
✅ No ON CONFLICT errors (all indices match upsert targets)  
✅ Planners receive precise user_address + consolidated_strategy  
✅ Single triad-worker run per snapshot (lock + job state transitions)  

**Implementation Files**:
- `server/lib/strategy-utils.js` - isStrategyReady() and getStrategyContext() helpers
- `server/routes/blocks-fast.js` - Strategy gating in GET endpoint
- `server/jobs/triad-worker.js` - Enhanced with full context persistence
- `server/lib/locks.js` - Lock acquisition with TTL and atomic CASE
- `server/lib/gpt5-venue-generator.js` - Venue generation with consolidated strategy
- `server/lib/venue-event-research.js` - Event planner with Perplexity integration

**Impact**: Complete strategy-first architecture with deterministic gating, full context persistence (user_address, city, state, events, news, traffic), proper lock isolation, verified planner inputs, strict 15-minute perimeter enforcement, and schema-safe upsert operations. All exit criteria met.
