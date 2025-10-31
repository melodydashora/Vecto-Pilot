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