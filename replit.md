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

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, developed with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.
**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data. These blocks are strictly filtered to a 15-minute driving perimeter.
-   **AI Coach**: Provides read-only context from enriched data.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory` for system-wide state, `eidolon_memory` for agent sessions, and `assistant_memory` for user preferences. Worker locks are implemented using a `worker_locks` table to prevent duplicate snapshot processing.

### Authentication & Security
Utilizes **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability is ensured through health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations use snapshot coordinates. Enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Driver's precise geocoded address is propagated unchanged throughout the pipeline. Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

### Critical Stability Features
-   **GPT-5 Venue Generator Token Limits**: Reduced to 1200 tokens with content validation to prevent empty responses.
-   **ON CONFLICT Error Handling**: Schema mismatch detection prevents infinite retry loops for constraint violations.
-   **Unique Indexes**: Implemented on `rankings(snapshot_id)` and `ranking_candidates(snapshot_id, place_id)` to prevent duplicate data and ensure data integrity.
-   **Parallel Multi-Model Strategy Orchestration**: Executes Claude (core plan) and Gemini (events/news/traffic) in parallel, then consolidates with GPT-5. Critical context fields are persisted to the database. Claude and GPT-5 failures are hard failures, while Gemini failures are soft.

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
---

### 2025-10-31T03:25:46Z — Comprehensive Exit Criteria Verification

**[CRITERION 1] Port Reliability & Readiness** ✅:
```
✓ /ready status: 200
✓ Response: OK
✓ Port 5000 accessible: YES
✓ Server ready: YES
```

**[CRITERION 2] Worker Locks: No 202 Loops** ✅:
```
Parallel requests to same snapshot: 3
Status 200 (immediate): 3
Status 202 (loop): 0
✓ No loops detected: YES
```

**[CRITERION 3] Smart Blocks: 15-Minute Perimeter** ✅:
```
Snapshot 4d1db587: 5 blocks, max 13.0min, within15=✓
Snapshot 8be557fb: 5 blocks, max 13.0min, within15=✓
Snapshot d260968d: 5 blocks, max 12.0min, within15=✓
✓ All blocks within 15-min perimeter: YES
✓ All snapshots returned ≥4 blocks: YES
```

**[CRITERION 4] Unique Indexes Match ON CONFLICT** ✅:
```
✓ strategies: strategies_snapshot_id_unique ON (snapshot_id)
✓ rankings: ux_rankings_snapshot ON (snapshot_id)
✓ ranking_candidates: ux_ranking_candidates_snapshot_place ON (snapshot_id, place_id)
✓ worker_locks: worker_locks_pkey ON (lock_key)
✓ places_cache: places_cache_pkey ON (place_id)
✓ venue_catalog: venue_catalog_place_id_unique ON (place_id)
✓ All ON CONFLICT targets verified: YES
```

**FINAL VERIFICATION** ✅:
```
✅ Ports: /ready returns 200, no manual refresh needed
✅ Worker: No 202 loops (3/3 = 200 OK)
✅ Indices: All unique indexes match ON CONFLICT targets
✅ Smart Blocks: ≥4 blocks, all ≤15 minutes, snapshot-first pattern
✅ Documentation: 73 → 361 → 461 lines (append-only, no deletions)
```

**ALL EXIT CRITERIA MET** ✅

