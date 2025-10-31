# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth drivers. It maximizes earnings by providing real-time strategic briefings based on location, events, traffic, weather, and air quality data. The platform uses a multi-AI pipeline to generate actionable strategies, empowering drivers with data-driven decisions to increase income and optimize time.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application featuring a multi-service architecture that supports both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: Manages workspace intelligence with secure, token-based access to file system operations, shell commands, and database queries.

### AI Configuration
The platform utilizes a model-agnostic architecture where AI models are configurable via environment variables.

**Strategy Generation Pipeline**:
1.  **News Briefing Generator** (default: Gemini 2.5 Pro): Generates city-wide traffic, airport intelligence, and major events.
2.  **Strategist** (default: Claude Opus 4.5): Generates initial strategic analysis based on snapshot data.
3.  **Tactical Consolidator** (default: GPT-5): Consolidates Strategist output and News Briefing into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator** (default: Gemini 2.5 Pro): Validates the final output and enforces structural constraints.

**Venue Events Intelligence**:
-   **Events Researcher** (default: Perplexity): Researches real-time, venue-specific events for UI display, not directly used in strategy generation.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)** built with Vite, utilizing Radix UI for components, TailwindCSS for styling, and React Query for server state management.

**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranked venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data.
-   **AI Coach**: Provides read-only context from enriched data (strategy, venues, events, business hours, pro_tips) without making external API calls.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM for schema management. It stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory` for system-wide state, `eidolon_memory` for agent sessions, and `assistant_memory` for user preferences.

### Authentication & Security
Uses **JWT with RS256 Asymmetric Keys** (15-minute expiry, 90-day rotation). Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Ensures reliability via health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations use snapshot coordinates. Enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Driver's precise geocoded address is propagated unchanged throughout the pipeline.

### Strategy Freshness
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Places API (venue details, business hours), Google Routes API (traffic-aware routing, multi-route calculations), Google Geocoding API (reverse geocoding).
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.
-   **Process Management**: Node.js `child_process`, `http-proxy`.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.