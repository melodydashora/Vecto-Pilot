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
**Strategy Generation Pipeline**:
1.  **News Briefing Generator**: Collects city-wide traffic, airport, and major event data.
2.  **Strategist**: Performs initial strategic analysis.
3.  **Tactical Consolidator**: Combines outputs into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator**: Validates the final strategy.
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
Vecto Pilot supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability features include health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations rely on snapshot coordinates. Enrichment operations are completed before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism. Strategy generation follows a strict sequence: Snapshot → Strategy (Claude + Gemini → GPT-5) → Persist → Venue Planner → Event Planner → Smart Blocks.

### Startup Configuration
The platform enforces single-process discipline with one host/port binding. Readiness is gated by database connectivity. Environment variables are managed via `mono-mode.env` and `.env` files. Startup scripts handle environment loading, port clearing, and spawning `gateway-server.js` and `strategy-generator.js` (background worker) with health checks.

### Process Management
In Mono Mode, two main processes run:
1.  **Gateway Server**: HTTP server, serves React SPA, routes API requests, manages WebSockets.
2.  **Triad Worker** (`strategy-generator.js`): Background job processor for strategy generation, runs if `ENABLE_BACKGROUND_WORKER=true`.

### Strategy-First Gating & Pipeline
The system gates API access until a strategy is ready. The pipeline uses multi-model orchestration: Gemini and Claude run in parallel for initial analysis, then GPT-5 consolidates their outputs into `strategy_for_now`, which is then validated and persisted.

### Smart Blocks Build & Perimeter Enforcement
Planner inputs include `user_address`, `city`, `state`, and `strategy_for_now`. Venues are matched with events by coordinates or proximity. Only blocks where `route.duration_minutes <= 15` (calculated via Google Routes API) are rendered, with audit logging for accepted and rejected venues.

### Locks, Job States & Indices
**Lock Semantics**: Distributed locks using `worker_locks` table with a TTL of 120 seconds.
**Job State Machine**: `triad_jobs` table tracks `queued`, `running`, `done`, `failed` states.
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