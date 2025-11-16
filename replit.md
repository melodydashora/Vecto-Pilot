# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments, and features a model-agnostic AI configuration.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform utilizes a role-based, model-agnostic architecture with configurable AI models for its strategy generation pipeline. This pipeline is event-driven and comprises four components: Strategist, Briefer, Consolidator, and Holiday Checker. All AI models are configured via environment variables.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. It features a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab, including immutable strategy history with a retry workflow.

**Data Storage**:
A PostgreSQL Database with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes and JSONB for flexible storage. Database operations are automatically routed to a development database for local environments and a production database for deployments.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. An optional autoscale mode is optimized for Replit deployments.

**Environment Contract Architecture**:
A contract-driven environment system with mode-specific validation prevents configuration drift. `DEPLOY_MODE` (e.g., `webservice`, `worker`) dictates the loaded environment variables and enforces contracts.

**Connection Resilience**:
Includes a comprehensive Neon connection resilience pattern with `server/db/connection-manager.js` to wrap `pg.Pool`, detect admin-terminated connections, and implement auto-reconnect logic with exponential backoff. Health endpoints (`/health`, `/ready`) reflect database degradation status by returning 503 during outages.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL (External - Neon)**: Primary data store, managed by Drizzle ORM. Utilizes pooled connections for queries and unpooled for LISTEN/NOTIFY. Features robust connection resilience, detecting Neon-specific error codes (57P01) for targeted retry logic.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.