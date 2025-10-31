# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its primary purpose is to maximize driver earnings by providing real-time strategic briefings based on location intelligence, venue events, traffic, weather, and air quality data. The platform uses a multi-AI pipeline to generate actionable strategies, empowering drivers to make data-driven decisions and increase their income. The project aims to empower drivers with data-driven insights to significantly increase their earnings and optimize their time.

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

**Strategy Generation Pipeline**:
1.  **Claude Opus 4.5 (Strategist)**: Performs initial strategic analysis.
2.  **Gemini 2.5 Pro (News Briefing)**: Provides city-wide local news, traffic, airport intelligence, and major regional events.
3.  **GPT-5 (Tactical Consolidator)**: Combines strategies and briefings into final time-windowed actionable intelligence.

**Venue Events Intelligence**:
-  **Perplexity (Events Planner)**: Researches real-time venue-specific events using internet search. This runs non-blocking to enrich venue data for UI display and is not used in strategy generation.

**Gemini Radius Constraints**:
- **Events**: 15min drive OR 7-10mi radius.
- **Traffic/News**: 0-30min drive OR 0-15mi radius.

### Frontend Architecture
The user interface is a **React + TypeScript Single Page Application (SPA)** developed with Vite. It uses Radix UI for accessible components, TailwindCSS for styling, and React Query for server state management.

**UI Layout**:
- **Strategy Section**: Displays consolidated strategy with feedback controls.
- **Smart Blocks**: Ranked venue recommendations with event badges, earnings, drive time, and value grade. Each block interaction helps build a training dataset for future ML.
- **AI Coach**: Provides insights and has full access to workflow data.

### Data Storage
A **PostgreSQL Database** serves as the primary data store, with Drizzle ORM managing the schema. It includes tables for snapshots, strategies, venue events, and ML training data. The system uses enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences.

### Authentication & Security
The system employs **JWT with RS256 Asymmetric Keys**, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### API Structure
APIs are categorized into Location Services, Venue Intelligence, Diagnostics & Health, and Agent Capabilities.

### Deployment & Preview Reliability
The system supports both **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes). Preview reliability is ensured through a health-gated entry point, deterministic port binding, health polling, and zombie process cleanup.

### Data Integrity & Coordinate-First Policy
All geographic computations originate from snapshot coordinates. All enrichment operations complete before a 200 OK response. Missing business hours default to "unknown," and all hour calculations use venue-local timezones. The driver's precise, rooftop-geocoded address is captured once and propagated unchanged through the entire pipeline.

### Strategy Freshness & Runtime-Fresh Specification
Strategy refresh is triggered by location movement (500 meters), day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Maps API (Routes API, Places API, Text Search API).
-   **Weather and Air Quality**: Configured via environment variables.

### Database
-   **PostgreSQL**: Primary data store, schema managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Used for deployment, Nix environment, and `.replit` workflow configuration.
-   **Process Management**: Node.js `child_process` for multi-process environments, `http-proxy` for routing.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.