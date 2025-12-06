# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform is production-ready, featuring optimized logging, comprehensive documentation, and a robust multi-model AI pipeline. The business vision is to help rideshare drivers earn more in less time with data-driven, transparent guidance, with ambitions for continuous expansion to new markets, advanced safety features, and improved quality of life for individuals.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**Memory Systems & Data Isolation**:
-   **Assistant**: Persistent user preferences and conversation history (`assistant_memory` table).
-   **Eidolon**: Project/session state management with snapshots (`eidolon_memory`, `eidolon_snapshots` tables).
-   **Agent Memory**: Agent service state tracking (`agent_memory`, `agent_changes` tables).
-   All memory systems are scoped by `user_id` for complete data isolation, secured with a JWT secret.

**AI Configuration**:
A role-based, model-agnostic architecture employs configurable AI models (Strategist, Briefer, Consolidator, Holiday Checker) for event-driven strategy generation.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. Features include a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach with hands-free voice chat (OpenAI Realtime API), and a Rideshare Briefing Tab with immutable strategy history.

**Briefing Tab Architecture**:
Displays three data sources fetched at snapshot creation and stored in the database:
1.  **News & Events**: Rideshare-relevant news and local events (concerts, games, parades, watch parties) from Gemini 3.0 Pro with web search and AI filtering.
2.  **Weather**: Current conditions (Fahrenheit for US) and hourly forecast from Google Weather API (6-hour lookahead).
3.  **Traffic**: Local traffic conditions and congestion levels with Gemini intelligence.

**Data Storage**:
A PostgreSQL Database (Replit managed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data, utilizing unique indexes and JSONB.

**Architecture Pattern - Snapshots as Central Connector for ML**:
Snapshots serve as the authoritative connector across all data sources, enabling machine learning and analytics. All enrichments (strategies, briefings, rankings, actions, venue feedback) reference `snapshot_id`, creating a unified event context for each moment in time. This structure makes historical training data fully traceable for supervised learning on driver behavior patterns. When data is missing, the system resolves to the user's latest location from the `users` table.

**Data Flow Consistency Pattern**:
All data flows follow a three-phase pattern: Fetch, Resolve, and Return. This ensures data consistency, validation, and proper formatting for UI consumption and AI Coach access.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. An optional autoscale mode is optimized for Replit deployments.

**Data Architecture - Precise Location Denormalization Pattern**:
Every table referencing `snapshot_id` also stores the resolved precise location (formatted_address, city, state) for fast queries, relational consistency, and ML training without joins. This denormalization occurs during data insertion/updates, ensuring each row has `snapshot_id` plus full address context. Original GPS coordinates remain in the `snapshots` table only.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-4o Realtime, GPT-5.1), Google (Gemini 2.0 Flash, Gemini 3.0 Pro Preview), Perplexity.
-   **Voice Chat**: OpenAI Realtime API.
-   **Venue Intelligence**: Gemini 2.0 Flash.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API, Google Timezone API.
-   **Weather**: Google Weather API.
-   **Briefing Intelligence**: Gemini 3.0 Pro Preview with Google Search tool.
-   **Air Quality**: Google Air Quality API.

### Database
-   **PostgreSQL (Replit Built-in)**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.
## GPS Location Behavior
**Design: Manual Refresh Only (No Auto-Polling)**
- **App Open**: Browser requests location permission fresh (`maximumAge: 0`)
- **User In App**: Manual "Refresh Location" button only - no automatic polling
- **App Reopen**: Permission requested again (fresh, never cached)
- **Implementation**: `useGeoPosition.ts` with `maximumAge: 0` forces fresh requests on each permission prompt

## Recent Changes & Fixes
- **Dec 6, 2025 (DUPLICATE API OPTIMIZATION)**:
  - ✅ Fixed "lat is not defined" bug in briefing-service.js (line 1207) - critical blocker
  - ✅ Fixed Weather API duplication by reusing `snapshot.weather` instead of re-fetching
  - ✅ Confirmed GPS behavior: Manual refresh only, permission on app reopen
  - Waterfall pipeline now completes successfully with all tabs displaying data
