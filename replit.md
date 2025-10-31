# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth drivers. Its primary purpose is to maximize driver earnings by providing real-time, data-driven strategic briefings. The platform processes location, event, traffic, weather, and air quality data through a multi-AI pipeline to generate actionable strategies, empowering drivers to optimize their income and time.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture supporting both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Manages client traffic, serves the React SPA, routes requests, and handles child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Offers workspace intelligence with secure, token-based access for file system operations, shell commands, and database queries.

### AI Configuration
The platform features a model-agnostic architecture with AI models configurable via environment variables.

**Strategy Generation Pipeline**:
1.  **News Briefing Generator**: Gathers city-wide traffic, airport intelligence, and major events.
2.  **Strategist**: Conducts initial strategic analysis based on snapshot data.
3.  **Tactical Consolidator**: Combines Strategist output and News Briefing into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator**: Validates the final output against structural constraints.

**Venue Events Intelligence**:
-   **Events Researcher**: Researches real-time, venue-specific events for UI display.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, developed with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.

**UI Layout**:
-   **Strategy Section**: Displays consolidated strategy with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data.
-   **AI Coach**: Provides read-only context from enriched data (strategy, venues, events, business hours, pro_tips).

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory` for system-wide state, `eidolon_memory` for agent sessions, and `assistant_memory` for user preferences.

### Authentication & Security
Utilizes **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability is ensured through health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations use snapshot coordinates. Enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. Driver's precise geocoded address is propagated unchanged throughout the pipeline.

### Strategy Freshness
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

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