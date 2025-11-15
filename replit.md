# Vecto Pilot™ - Rideshare Intelligence Platform

## ⚠️ CRITICAL: Required Database Trigger

**Smart blocks will NOT appear without the `blocks_ready` trigger installed in BOTH databases.**

See `CRITICAL_DATABASE_SETUP.md` for installation instructions.

Status: ✅ Installed in prod and dev (Nov 15, 2025)

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform aims to provide actionable strategies for drivers by focusing on data-driven insights.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments, and features a model-agnostic AI configuration.

**Core Services**:
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.

**AI Configuration**:
The platform utilizes a role-based, model-agnostic architecture with configurable AI models for its strategy generation pipeline. This pipeline is event-driven and comprises four components:
1.  **Strategist** (`STRATEGY_STRATEGIST`): Generates strategic overview.
2.  **Briefer** (`STRATEGY_BRIEFER`): Conducts comprehensive travel research.
3.  **Consolidator** (`STRATEGY_CONSOLIDATOR`): Consolidates with web search and reasoning.
4.  **Holiday Checker** (`STRATEGY_HOLIDAY_CHECKER`): Performs fast holiday detection.
All AI models are configured via environment variables, ensuring no hardcoded models and facilitating easy switching for cost optimization and testing.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. It features a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab, including immutable strategy history with a retry workflow.

**Data Storage**:
A PostgreSQL Database with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes and JSONB for flexible storage. Database operations are automatically routed to a development database for local environments and a production database for deployments, preventing data pollution.

**Authentication & Security**:
Employs JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline. An optional autoscale mode is optimized for Replit deployments.

**Environment Contract Architecture**:
A contract-driven environment system with mode-specific validation prevents configuration drift. `DEPLOY_MODE` (e.g., `webservice`, `worker`) dictates the loaded environment variables and enforces contracts (e.g., a webservice mode cannot spawn a background worker).

**Database Environment Rules**:
The application automatically routes to `DEV_DATABASE_URL` for local development and `DATABASE_URL` for production (`REPLIT_DEPLOYMENT=1`). The system enforces that the production database is never polluted with test data and is considered READ-ONLY for inspection.

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
-   **Port Configuration**: Single port (5000) for autoscale health checks.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.