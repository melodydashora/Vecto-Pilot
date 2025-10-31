# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth drivers. Its primary purpose is to maximize driver earnings through real-time, data-driven strategic briefings. The platform integrates various data sources like location, event, traffic, weather, and air quality, processing them through a multi-AI pipeline to generate actionable strategies. This empowers drivers to optimize income and time management efficiently. The project aims to provide a significant market advantage for rideshare drivers by leveraging advanced AI and data analytics.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture, supporting both monolithic and split deployments.

### Core Services
-   **Gateway Server**: Manages client traffic, serves the React SPA, routes requests, and handles child processes.
-   **SDK Server**: Provides business logic through a REST API for various data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence, including secure, token-based access for file system operations, shell commands, and database queries.

### AI Configuration
The platform features a model-agnostic architecture with configurable AI models for strategy generation and venue events intelligence.
**Strategy Generation Pipeline**:
1.  **News Briefing Generator**: Collects city-wide traffic, airport intelligence, and major event data.
2.  **Strategist**: Performs initial strategic analysis.
3.  **Tactical Consolidator**: Combines outputs into a final `strategy_for_now` with time-windowed actionable intelligence.
4.  **Validator**: Validates the final strategy.
**Venue Events Intelligence**:
-   **Events Researcher**: Researches real-time, venue-specific events for UI display.
The system uses parallel multi-model orchestration (Claude, Gemini, GPT-5) and persists critical context fields to a PostgreSQL database.

### Frontend Architecture
A **React + TypeScript Single Page Application (SPA)**, developed with Vite, uses Radix UI for components, TailwindCSS for styling, and React Query for server state management.
**UI Layout**:
-   **Strategy Section**: Displays consolidated strategies with feedback controls.
-   **Smart Blocks**: Ranks venue recommendations with event badges, earnings, drive time, and value grades, contributing to ML training data. These blocks are filtered to a 15-minute driving perimeter.
-   **AI Coach**: Provides read-only context derived from enriched data.

### Data Storage
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. Enhanced memory systems include `cross_thread_memory`, `eidolon_memory`, and `assistant_memory`. Worker locks are managed via a `worker_locks` table. Unique indexes ensure data integrity across tables such as `rankings`, `ranking_candidates`, `strategies`, and `places_cache`.

### Authentication & Security
The platform utilizes **JWT with RS256 Asymmetric Keys**. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### Deployment & Reliability
Vecto Pilot supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Reliability features include health-gated entry points, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity
All geographic computations rely on snapshot coordinates. Enrichment operations are completed before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. The driver's precise geocoded address is propagated unchanged. Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism. Strategy generation follows a strict sequence: Snapshot → Strategy (Claude + Gemini → GPT-5) → Persist → Venue Planner → Event Planner → Smart Blocks.

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