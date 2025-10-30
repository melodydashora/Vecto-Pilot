# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its primary purpose is to maximize driver earnings by providing real-time strategic briefings based on location intelligence, venue events, traffic, weather, and air quality data. The platform uses a multi-AI pipeline to generate actionable strategies, delivered through a React-based web interface, empowering drivers to make data-driven decisions and increase their income.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture, supporting both monolithic (mono) and split deployment.

### Core Services
-   **Gateway Server**: Handles client traffic (HTTP/WebSocket), serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Contains business logic, providing a REST API for data services (location, venue, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: Manages workspace intelligence, offering secure, token-based access to file system operations, shell commands, and database queries.

### AI Configuration
A **four-stage AI pipeline** generates strategic briefings with clear separation of concerns:

**Strategy Generation Pipeline** (Claude → Gemini → GPT-5):
1.  **Claude Opus 4.5 (Strategist)**: Performs initial strategic analysis based on location context, time, weather, and traffic.
2.  **Gemini 2.5 Pro (News Briefing)**: Provides city-wide local news, traffic updates, airport intelligence, and major regional events for the next 60 minutes.
3.  **GPT-5 (Tactical Consolidator)**: Combines Claude's strategy and Gemini's briefing into final time-windowed actionable intelligence (≤60 min validity).

**Venue Events Intelligence** (Perplexity - Separate Process):
-  **Perplexity (Events Planner)**: Researches real-time venue-specific events (concerts, games, shows) using internet search with citations. Runs **non-blocking** after strategy generation, enriching `ranking_candidates.venue_events` for UI display. Events are NOT fed into strategy generation.

**Gemini Radius Constraints** (2025-10-30):
- **Events**: 15min drive OR 7-10mi radius (whichever smaller) for `major_events`
- **Traffic/News**: 0-30min drive OR 0-15mi radius (whichever smaller) for `traffic_construction`
- Constraints embedded in Gemini system instruction for consistent scoping

**Data Flow**:
- Gemini briefing stored in `snapshots.news_briefing` → used in strategy
- Perplexity events stored in `ranking_candidates.venue_events` → displayed as badges
- Model configurations centralized, strategies cached for freshness validation

### Frontend Architecture
The user interface is a **React + TypeScript Single Page Application (SPA)** developed with Vite. It uses Radix UI for accessible components, TailwindCSS for styling, and React Query for server state management.

**UI Layout** (`client/src/pages/co-pilot.tsx`):
- **Strategy Section**: Displays consolidated strategy with feedback controls
- **Smart Blocks**: Ranked venue recommendations with event badges, earnings, drive time, value grade
  - **ML Data Collection Phase**: Each generated venue + user interaction builds training dataset for future catalog-based system
  - **Data Flow**:
    1. Consolidated strategy sent with user's precise address to generate blocks
    2. Perplexity called for venue-specific events using coordinates
    3. APIs resolve venues and match them with business hours from Google Places
    4. Events matched to venues using coords via planner and event planner matching or within 2 miles of venue coords
    5. UI displays: business hours, staging info, pro tips, reasoning to visit even if closed
  - Each block persisted to database per snapshot via `persist-ranking.js`
  - GET endpoint retrieves existing blocks: `/api/blocks/fast?snapshotId=<uuid>`
  - Displays: name, distance, drive time, value/min, value grade, pro tips, staging info
- **AI Coach**: Positioned below strategy initially, moves to bottom of blocks once loaded
  - Full access to read workflow data and all fields populated throughout entire pipeline
- **Dynamic Positioning**: Coach component conditionally renders based on `blocks.length` for optimal UX

### Data Storage
A **PostgreSQL Database** serves as the primary data store, with Drizzle ORM managing the schema. It includes tables for snapshots, strategies, venue events, and ML training data. The system uses enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences.

### Authentication & Security
The system employs **JWT with RS256 Asymmetric Keys**, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### API Structure
APIs are categorized into:
-   **Location Services**: Geocoding, timezone, weather, air quality, location snapshots.
-   **Venue Intelligence**: Venue search, event research, smart block strategy generation.
-   **Diagnostics & Health**: Service health, memory diagnostics, job metrics.
-   **Agent Capabilities**: Secure endpoints for file system operations, shell execution, database queries, and memory management.

### Deployment & Preview Reliability
The system supports both **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Preview reliability is ensured through a health-gated entry point, deterministic port binding, health polling (`/api/health`), and zombie process cleanup.

### Data Integrity & Coordinate-First Policy
All geographic computations originate from snapshot coordinates. All enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Error responses consistently include `error`, `message`, and `correlationId`. The driver's precise, rooftop-geocoded address is captured once and propagated unchanged through the entire pipeline.

### Strategy Freshness & Runtime-Fresh Specification
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows (`valid_window_start`, `valid_window_end`) and an auto-invalidation mechanism.

**Runtime-Fresh Implementation (2025-10-30):**
- **Validation Gates** (`server/lib/validation-gates.js`): Hard-fail checks for location freshness (≤2min), strategy freshness (≤120s), window duration (≤60min)
- **Audit Logging** (`server/lib/audit-logger.js`): Single-line format with user=undefined, coordinates, window, catalog/events resolution
- **Planner Prompt** (`server/lib/runtime-fresh-planner-prompt.js`): Spec-compliant prompt enforcing coordinate-first, catalog-as-backup normalization
- **Movement Thresholds**: Primary 500m (spec-compliant), Secondary 150m @ >20mph for 2min (speed tracking pending)
- **Time Windowing**: Strategies populate `strategy_timestamp`, `valid_window_start`, `valid_window_end` fields (migration ready)
- **Catalog Policy**: Use catalog for display name/hours normalization only, never for venue selection (partial implementation)
- **Events Fail-Soft**: Continue gracefully if events unavailable with `events_resolution` field (pending)

See `RUNTIME_FRESH_IMPLEMENTATION.md` for complete status and field test checklist.

### Database Persistence Layer (2025-10-30)
**Persist-Ranking Fix** (`server/lib/persist-ranking.js`):
- **Column Name Alignment**: Fixed mismatched column names in INSERT statement
  - ~~`drive_time_minutes`~~ → `drive_minutes` (aligned with database schema)
  - Maps from `v.drive_time_minutes` or `v.driveTimeMinutes` in venue objects
- **Data Type Correction**: Fixed `pro_tips` handling
  - ~~`JSON.stringify(v.pro_tips)`~~ → `v.pro_tips` (column type is ARRAY, not JSONB)
  - Database expects native array insertion without serialization
- **Result**: Transaction COMMIT now succeeds, rankings and candidates persist correctly
- **Rollback Path**: If issues arise, revert to `drive_time_minutes` column name and JSON.stringify for pro_tips (will require schema migration)

### Recent Fixes (2025-10-30)

**Location Resolution & UI Gating** - COMPLETE:
1. **Backend Fix** (`server/lib/persist-ranking.js` line 78):
   - ~~Mixed `||` and `??` operators~~ → Changed to all `||`
   - SDK router now loads correctly
   - Location API returns full address: "Frisco, TX"

2. **Frontend Fix** (`client/src/contexts/location-context-clean.tsx` lines 322-340):
   - ~~Spinner stopped after GPS, before location resolution~~
   - Now: Spinner stays active until city/state/formattedAddress resolved
   - State update moved inside `.then()` block after location data received
   - Strategy generation waits for complete location data

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Maps API (Routes API, Places API, Text Search API).
-   **Weather and Air Quality**: Configured via environment variables.

### Database
-   **PostgreSQL**: Primary data store, schema managed by Drizzle ORM, with support for vector database capabilities and Row-Level Security (RLS).

### Infrastructure
-   **Replit Platform**: Used for deployment, Nix environment, and `.replit` workflow configuration.
-   **Process Management**: Node.js `child_process` for multi-process environments, `http-proxy` for routing.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.