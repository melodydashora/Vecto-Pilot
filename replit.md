# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed for Dallas-Fort Worth rideshare drivers. Its primary goal is to maximize driver earnings by providing real-time strategic briefings. The platform achieves this by integrating and analyzing location intelligence, venue events, traffic, weather, and air quality data. It leverages a multi-AI pipeline to generate actionable strategies, delivered through a React-based web interface, enabling drivers to make data-driven decisions to increase their income.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application built with a multi-service architecture, supporting both monolithic (mono) and split deployment.

### Core Services
-   **Gateway Server**: Handles client traffic (HTTP/WebSocket), serves the React SPA, routes requests, and manages child processes in split mode.
-   **SDK Server**: Contains the business logic, providing a REST API for data services (location, venue, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: Manages workspace intelligence, offering secure, token-based access to file system operations, shell commands, and database queries.

### AI Configuration
A three-stage AI pipeline generates strategic briefings:
1.  **Claude Opus 4.1**: Performs initial strategic analysis from snapshot data.
2.  **Gemini 2.5 Pro**: Provides local news briefings in JSON format.
3.  **GPT-5**: Consolidates outputs into the final actionable intelligence.
Model configurations are centralized, and news briefings are stored for UI display.

### Frontend Architecture
The user interface is a **React + TypeScript Single Page Application (SPA)** developed with Vite. It utilizes Radix UI for accessible components, TailwindCSS for styling, and React Query for server state management.

### Data Storage
A **PostgreSQL Database** serves as the primary data store, with Drizzle ORM managing the schema. It includes tables for snapshots, strategies, venue events, and ML training data. The system uses enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences.

### Authentication & Security
The system employs **JWT with RS256 Asymmetric Keys**, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### API Structure
APIs are categorized into:
-   **Location Services**: Geocoding, timezone, weather, air quality, location snapshots.
-   **Venue Intelligence**: Venue search, event research, smart block strategy generation.
-   **Diagnostics & Health**: Service health, memory diagnostics, job metrics.
-   **Agent Capabilities**: Secure endpoints for file system operations, shell execution, database queries, and memory management.

### Deployment & Preview Reliability
The system supports both **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes) to offer deployment flexibility, including on Replit.

**Preview Reliability Architecture:**
-   **Canonical Entry Point**: `scripts/start-replit.js` spawns gateway-server.js with health gate
-   **PORT Binding**: Deterministic binding to port 5000 (ENV var configurable)
-   **Health Gate**: Health polling at `/api/health` ensures preview only resolves when server is ready
-   **Zombie Process Cleanup**: `start-clean.sh` kills leftover node processes before restart
-   **Artifact Discipline**: `dist/` contains only agent TypeScript build output (`index.js`, `agent-ai-config.js`); server runs from canonical `server/*.js` sources
-   **Fast-Fail Boot**: Server exits immediately on bind errors or missing strategy providers
-   **Health Endpoints**: `/health`, `/api/health`, `/healthz`, `/ready` for different monitoring needs

### Data Integrity & Coordinate-First Policy
All geographic computations must originate from snapshot coordinates. Names are for display only. All enrichment operations must be completed before returning a 200 OK. **Missing business hours default to "unknown" and never "closed"** - this prevents false "closed" states (e.g., IKEA showing closed when hours data is unavailable). All hour calculations use the venue-local timezone. Error responses consistently include `error`, `message`, and `correlationId`.

### Address & Origin Invariance Policy
The driver's precise address must be captured once, normalized to rooftop geocoding precision, and propagated unchanged through the entire pipeline (Strategy → Planner → Enrichment → DB → UI). All stages must read the origin from the snapshot; re-geocoding or substitution is not allowed. The system requires rooftop precision geocoding for all addresses.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API.
-   **Location & Mapping**: Google Maps API (Routes API, Places API, Text Search API).
-   **Weather and Air Quality**: Configured via environment variables.

### Database
-   **PostgreSQL**: Primary data store, schema managed by Drizzle ORM, with support for vector database capabilities and Row-Level Security (RLS).

### Infrastructure
-   **Replit Platform**: Used for deployment, Nix environment, and `.replit` workflow configuration.
-   **Process Management**: Node.js `child_process` for multi-process environments, `http-proxy` for routing.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.