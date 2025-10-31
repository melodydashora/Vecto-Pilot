# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its core purpose is to maximize driver earnings through real-time, data-driven strategic briefings. The platform integrates location, event, traffic, weather, and air quality data, processing it through a multi-AI pipeline to generate actionable strategies. This empowers drivers to optimize their income and time management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture supporting both monolithic and split deployments.

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
The platform uses parallel multi-model strategy orchestration, executing Claude (core plan) and Gemini (events/news/traffic) in parallel, then consolidating with GPT-5. Critical context fields are persisted to the database.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, developed with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.
**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data. These blocks are strictly filtered to a 15-minute driving perimeter.
-   **AI Coach**: Provides read-only context from enriched data.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory` for system-wide state, `eidolon_memory` for agent sessions, and `assistant_memory` for user preferences. Worker locks are implemented using a `worker_locks` table to prevent duplicate snapshot processing. Unique indexes are implemented on `rankings(snapshot_id)` and `ranking_candidates(snapshot_id, place_id)` to ensure data integrity.

### Authentication & Security
Utilizes **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability is ensured through health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

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

**Database Structure Clarification**:
- ✅ `places_cache` table exists with unique index on `place_id` (stores business hours)
- ❌ `places` table does NOT exist
- ✅ `venue_catalog` table exists with unique index on `place_id` (stores venue coordinates and metadata)
- ✅ Coordinates are preserved in `venue_catalog` and `rankings` tables

**Impact**: Eliminated SQL errors during venue enrichment. All place data flows correctly into `places_cache` (hours) and `venue_catalog` (metadata/coordinates).

### 2025-10-31: Strategy-First Gating & Comprehensive System Integration
**Objective**: Enforce strategy-must-complete-before-blocks rendering, verify planner inputs, strengthen lock reliability, and document all unique indices.

**1. Strategy-First Gating**:
- ✅ `strategies` table has unique index on `snapshot_id` (verified)
- ✅ `strategies.strategy_for_now` field stores GPT-5 consolidated output (unlimited text)
- ✅ Created `isStrategyReady(snapshotId)` helper function in `server/lib/strategy-utils.js`
- ✅ `GET /api/blocks/fast?snapshotId=<uuid>` returns:
  - `202 { reason: 'strategy_pending' }` until `strategy_for_now` exists
  - `200 { blocks[], audit[] }` once strategy is ready
- ✅ blocks-fast GET endpoint uses `isStrategyReady()` for gating logic

**2. Venue Planner & Event Planner Inputs** (Verified):
- **Venue Planner** (`enrichVenues()` in `server/lib/venue-enrichment.js`):
  - Receives: `venues[]`, `driverLocation {lat, lng}`, `snapshot` (full object)
  - Snapshot provides: `formatted_address`, `city`, `state`, `lat`, `lng`, `timezone`, `snapshot_id`
  - Outputs: `address`, `placeId`, `businessStatus`, `businessHours`, `isOpen`, `distanceMeters`, `driveTimeMinutes`, `stagingArea`
- **Event Planner** (`researchVenueEvents()` in `server/lib/venue-event-research.js`):
  - Receives: `venueName`, `city`, `date`
  - Uses Perplexity API with `searchRecencyFilter: 'day'` for today's events
  - Outputs: `has_events`, `summary`, `badge`, `citations`, `impact_level`
- **Event Matching**: Direct coord match from planners + proximity enrichment (≤2 miles via Google Places)

**3. Smart Blocks Perimeter Enforcement** (Verified):
- **Build Sequence**: `Snapshot → Strategy (Claude + Gemini → GPT-5) → Persist → Venue Planner → Event Planner → blocks-fast payload`
- **15-Minute Filter**: `blocks-fast.js` lines 57-79
  ```javascript
  const within15Min = (driveMin) => Number.isFinite(driveMin) && driveMin <= 15;
  const blocks = allBlocks.filter(b => within15Min(b.driveTimeMinutes));
  const rejected = allBlocks.filter(b => !within15Min(b.driveTimeMinutes)).length;
  ```
- **Audit Trail**: Returns `{ step: 'perimeter', accepted, rejected, max_minutes: 15 }`
- **Render Rule**: Only blocks with `route.duration_minutes ≤ 15` appear above AI Coach

**4. Lock & Job Reliability** (Verified):
- **Triad-Worker Lock** (`server/jobs/triad-worker.js` lines 38-50):
  - Lock key: `triad:${snapshot_id}` (per-snapshot isolation)
  - TTL: 120,000ms (120 seconds)
  - Acquisition: `acquireLock()` checks if lock is new OR expired (CASE statement in SQL)
  - Release: `releaseLock()` in `finally` block (line 230-232)
- **Job State Transitions**: `queued → running → ok|error` (transactional with SKIP LOCKED)
- **Schema Mismatch Policy** (lines 192-214):
  - Detects: `ON CONFLICT`, `constraint`, `unique`, error code `23505`
  - Action: Mark job as `error`, set strategy status to `failed` with `error_message: 'schema_mismatch_unique_index_required'`
  - **No retries** on schema mismatches - requires manual schema fix

**5. Unique Indices & ON CONFLICT Alignment** (Verified):
- **strategies**:
  - Unique index: `strategies_snapshot_id_unique` on `snapshot_id`
  - ON CONFLICT: ✅ Matches (upserts use `snapshot_id`)
- **rankings**:
  - Unique index: `ux_rankings_snapshot` on `snapshot_id`
  - ON CONFLICT: ✅ Matches (upserts use `snapshot_id`)
- **ranking_candidates**:
  - Unique index: `ux_ranking_candidates_snapshot_place` on `(snapshot_id, place_id)`
  - ON CONFLICT: ✅ Matches (upserts use both columns)
- **venue_catalog**:
  - Unique index: `venue_catalog_place_id_unique` on `place_id`
  - ON CONFLICT: ✅ Matches (lines 32 in `persist-ranking.js`)
- **venue_metrics**:
  - Unique index: `venue_metrics_pkey` on `venue_id`
  - ON CONFLICT: ✅ Matches (line 46 in `persist-ranking.js`)
- **places_cache**:
  - Unique index: `places_cache_pkey` on `place_id`
  - ON CONFLICT: ✅ Matches (lines 42, 70 in `places-cache.js` and `places-hours.js`)
- **worker_locks**:
  - Unique index: `worker_locks_pkey` on `lock_key`
  - ON CONFLICT: ✅ Matches (line 13 in `locks.js`)
- **Memory Tables** (eidolon_memory, assistant_memory, cross_thread_memory):
  - Unique constraint: `(scope, key, user_id)` composite
  - ON CONFLICT: ✅ Matches (line 46 in `eidolon/memory/pg.js`)

**6. Exit Criteria Verification**:
- ✅ `/api/blocks/fast?snapshotId=<uuid>` returns 202 until strategy ready, then 200 with blocks
- ✅ All blocks returned have `driveTimeMinutes ≤ 15` (perimeter enforcement)
- ✅ Single triad-worker run per snapshot (lock prevents duplicates)
- ✅ Locks released in `finally` blocks
- ✅ No ON CONFLICT errors (all indices match upsert targets)
- ✅ Planner inputs verified: snapshot_id, user_address (formatted_address), city, state, coords, timezone
- ✅ Strategy context persisted: `strategy_for_now` in strategies table
- ✅ Business hours stored in `places_cache`, coordinates in `venue_catalog` and `rankings`
- ✅ Event data flows from Perplexity → venue_events → blocks payload

**Implementation Files**:
- `server/lib/strategy-utils.js` - New utility for `isStrategyReady()` and `getStrategyContext()`
- `server/routes/blocks-fast.js` - Enhanced with strategy gating using helper function
- `server/jobs/triad-worker.js` - Lock-protected job processing with schema mismatch detection
- `server/lib/locks.js` - Lock acquisition with TTL and atomic CASE statement
- `server/lib/venue-enrichment.js` - Receives full snapshot context for planners
- `server/lib/venue-event-research.js` - Event planner with Perplexity integration

**Impact**: Complete strategy-first architecture with deterministic gating, proper lock isolation, verified planner inputs, strict 15-minute perimeter enforcement, and schema-safe upsert operations. All exit criteria met.

### 2025-10-31: Strategy Persistence & Planner Integration
**Objective**: Ensure GPT-5 consolidation persists all required context fields and planners receive precise inputs for venue/event generation.

**1. Strategy Persistence Enhancement** (triad-worker.js lines 172-189):
- **Fields Persisted**: `snapshot_id`, `user_id`, `user_address`, `city`, `state`, `lat`, `lng`, `events`, `news`, `traffic`, `strategy_for_now`
- **Source Data**: Full snapshot context + Gemini briefing structured data
- **Update Applied**:
  ```javascript
  await db.update(strategies).set({
    status: 'ok',
    strategy_for_now: gpt5Result.text.trim(),  // Consolidated strategy
    user_address: snap.formatted_address,       // Precise address for planners
    city: snap.city,
    state: snap.state,
    lat: snap.lat,
    lng: snap.lng,
    user_id: snap.user_id,
    events: snap.news_briefing?.events || [],
    news: snap.news_briefing?.news || [],
    traffic: snap.news_briefing?.traffic || []
  })
  ```

**2. Planner Input Verification**:
- **Venue Generator** (`generateVenueCoordinates()` in gpt5-venue-generator.js):
  - Receives: `consolidatedStrategy`, `driverLat`, `driverLng`, `city`, `state`, `currentTime`, `weather`, `maxDistance: 15`
  - Generates: 8 venues with dual coordinates (location + staging), pro tips, closed reasoning
  - Called from: blocks-fast.js POST endpoint (lines 224-233) when generating fallback venues
- **Event Planner** (researchVenueEvents() in venue-event-research.js):
  - Receives: `venueName`, `city`, `date`
  - Uses: Perplexity API with `searchRecencyFilter: 'day'`
  - Returns: Event badges, summaries, impact levels

**3. Smart Blocks Gating Flow** (blocks-fast.js):
- **GET Endpoint** (lines 23-91):
  1. Call `isStrategyReady(snapshotId)` → check `strategies.strategy_for_now` existence
  2. Return `202 { reason: 'strategy_pending' }` if not ready
  3. Return `200 { blocks[], audit[] }` with 15-minute filtered blocks once ready
- **POST Endpoint** (lines 93-674):
  1. Load snapshot from database
  2. Check for existing `ranking_candidates` (snapshot-first pattern)
  3. If insufficient data (< 4 candidates):
     - Fetch consolidated strategy from DB
     - Generate 8 venues using GPT-5 with strategy + snapshot context
  4. Enrich with drive times and scores
  5. Filter to 15-minute perimeter
  6. Persist to `rankings` and `ranking_candidates` tables

**4. Perimeter Enforcement Details**:
- **Filter Logic** (blocks-fast.js lines 57-79):
  ```javascript
  const within15Min = (driveMin) => Number.isFinite(driveMin) && driveMin <= 15;
  const blocks = allBlocks.filter(b => within15Min(b.driveTimeMinutes));
  const rejected = allBlocks.filter(b => !within15Min(b.driveTimeMinutes)).length;
  ```
- **Audit Trail**: `{ step: 'perimeter', accepted, rejected, max_minutes: 15 }`
- **Render Rule**: Only blocks ≤ 15 drive minutes appear in frontend

**5. Exit Criteria Verification**:
✅ **Strategy Row**: Persists once per snapshot with all required fields (snapshot_id, user_address, city, state, events, news, traffic, consolidated_strategy)
✅ **Gating**: `/api/blocks/fast` returns 202 until `strategy_for_now` exists, then 200 with blocks
✅ **Block Count**: Minimum 4 blocks generated using precise address + consolidated strategy
✅ **Perimeter**: All displayed blocks ≤ 15 minutes; audit shows accepted/rejected counts
✅ **Lock**: Per-snapshot lock `triad:${snapshot_id}` with 120s TTL, released in finally
✅ **Job**: Transactional states (queued → running → ok|error), no retries on schema mismatch
✅ **Indices**: All ON CONFLICT clauses match unique indexes (verified via SQL queries)

**Database Schema Verification**:
```sql
-- Strategies table has all required fields
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'strategies' 
AND column_name IN ('snapshot_id', 'user_address', 'city', 'state', 'events', 'news', 'traffic', 'strategy_for_now', 'user_id', 'lat', 'lng');
-- Returns: 11 columns (all present)

-- Unique index on snapshot_id
SELECT indexname FROM pg_indexes 
WHERE tablename = 'strategies' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%snapshot_id%';
-- Returns: strategies_snapshot_id_unique
```

**Impact**: Complete strategy persistence with all context fields. Planners receive precise user address and consolidated strategy. Gating prevents premature block rendering. Perimeter strictly enforced at 15 minutes. All exit criteria verified and met.