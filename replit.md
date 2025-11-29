# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform is production-ready, featuring optimized logging, comprehensive documentation, and a robust multi-model AI pipeline.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform utilizes a role-based, model-agnostic architecture with configurable AI models (Strategist, Briefer, Consolidator, Holiday Checker) for its event-driven strategy generation pipeline. AI models are configured via environment variables.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. Key features include a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach with hands-free voice chat (OpenAI Realtime API), and a Rideshare Briefing Tab with immutable strategy history and retry workflow.

**Briefing Tab Architecture**:
The Briefing tab displays three data sources fetched at snapshot creation and stored in the database for consistency:
1. **News**: Rideshare-relevant news from SerpAPI (Google News, 24-48 hour filter) + Gemini 2.0 Flash AI filtering for driver-relevant content
2. **Weather**: Current conditions + hourly forecast from Google Weather API (6-hour lookahead)
3. **Traffic**: Local traffic conditions and congestion levels

Key files:
- `server/lib/briefing-service.js` - Data fetching and AI filtering service
- `server/routes/briefing.js` - API endpoints (GET /current, /snapshot/:id, POST /refresh, /generate)
- `client/src/components/BriefingTab.tsx` - Frontend display component
- Database table: `briefings` (linked to snapshots via snapshot_id)

**Data Storage**:
A PostgreSQL Database (Replit managed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes and JSONB for flexible storage. The architecture employs a two-table location model where the `users` table is the authoritative source for driver location, and the `snapshots` table references `users` for API-enriched contextual data without duplicating location information. Connection resilience includes automatic reconnection logic with exponential backoff.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. An optional autoscale mode is optimized for Replit deployments. The system uses a contract-driven environment system with mode-specific validation to prevent configuration drift.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-4o Realtime for voice, GPT-5.1 for strategy), Google (Gemini 2.0 Flash for venue intelligence + news filtering), Perplexity.
-   **Voice Chat**: OpenAI Realtime API (GPT-4o Realtime with 232-320ms latency, configurable via VOICE_MODEL env var)
-   **Venue Intelligence**: Gemini 2.0 Flash with real-time bar/restaurant discovery, expense-level sorting ($$$$→$), hours filtering, and last-call alerts
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API, Google Timezone API.
-   **Weather**: Google Weather API (current conditions + 240-hour forecast), configurable via GOOGLE_MAPS_API_KEY
-   **News**: SerpAPI (Google News search with 24-48 hour time filtering), configurable via SERP_API_KEY
-   **Air Quality**: Google Air Quality API, configurable via environment variables.

### Database
-   **PostgreSQL (Replit Built-in)**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.