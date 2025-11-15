# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform uses a role-based, model-agnostic architecture with configurable AI models.
-   **Strategy Generation Pipeline**: An event-driven, three-step pipeline:
    1.  **Strategist** (Claude): Generates a strategic overview.
    2.  **Briefer** (Perplexity): Conducts comprehensive travel research.
    3.  **Consolidator** (GPT-5 with reasoning): Consolidates strategist output with additional web research.
-   **Briefing Data Structure**: Dedicated `briefings` table with structured fields for various intelligence categories and citations.
-   **Model-Agnostic Schema**: Database and environment variables use generic role names to avoid provider-specific coupling.
-   **Event-Driven Architecture**: PostgreSQL LISTEN/NOTIFY for real-time updates.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, uses Radix UI, TailwindCSS, and React Query. The UI features a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab. It includes immutable strategy history with a retry workflow and status-specific UI.

**Data Storage**:
A PostgreSQL Database with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes for data integrity and enhanced memory systems.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys, with security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, with reliability features like health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. It includes an optional autoscale mode for Replit deployments, optimized for minimal overhead and fast health checks.

**Data Integrity**:
Geographic computations use snapshot coordinates. Strategy refresh is triggered by location movement, day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism, with snapshot date/time fields as the single source of truth for all AI outputs.

**Process Management**:
In Mono Mode, the Gateway Server and the Triad Worker (background job processor for strategy generation) run as separate processes.

**Strategy-First Gating & Pipeline**:
API access is gated until a strategy is ready. The pipeline involves parallel execution of AI models, followed by consolidation.

**AI Coach Data Access Layer (CoachDAL)**:
A read-only Data Access Layer provides the AI Strategy Coach with snapshot-scoped, null-safe access to comprehensive driver context, including temporal data, strategy, briefing information, and venue recommendations. Consolidated strategy outputs prioritize city-level references for privacy.

**Environment Files Structure**:
Uses a hierarchical environment configuration system: `.env` (base config), `mono-mode.env` (deployment overrides), and Replit Secrets (API keys, highest priority).

**Database Schema Highlights**:
Core tables include `snapshots`, `strategies`, `briefings`, `rankings`, `ranking_candidates`, and `venue_events`, linked by relationships. JSONB is used for flexible storage of features, business hours, and venue events.

**API Routes Architecture**:
-   **Strategy Pipeline**: `POST /api/strategy/request` to trigger AI pipeline; `GET /api/strategy/:snapshotId` to fetch.
-   **Smart Blocks**: `GET /api/blocks-fast` to fetch; `POST /api/blocks-fast` to generate. Strategy-first gating returns HTTP 202 until strategy is ready.
-   **AI Coach**: `POST /api/coach/chat` for context-aware chat via CoachDAL.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL (External - Non-Replit Hosted)**: Primary data store hosted externally (Neon), managed by Drizzle ORM.
-   **Connection Modes**: Pooled (`DATABASE_URL`) for queries, Unpooled (`DATABASE_URL_UNPOOLED`) for LISTEN/NOTIFY.

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.
-   **Port Configuration**: Single port (5000) for autoscale health checks.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.