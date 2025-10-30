# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview

Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth rideshare drivers. It provides real-time strategic briefings by integrating location intelligence, venue events, traffic, weather, and air quality data to optimize driver earnings. The platform uses a multi-AI pipeline (Claude for strategy, GPT-5 for planning, Gemini for validation) and delivers insights through a React-based web interface. The system aims to significantly enhance driver income through data-driven decision-making.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

Vecto Pilot operates as a full-stack Node.js application with a multi-service architecture supporting both monolithic ("mono") and split deployment modes.

### Core Services

-   **Gateway Server (`gateway-server.js`)**: The primary entry point for all client traffic (HTTP/WebSocket) on port 80/5000. It routes API requests to the SDK server, agent requests to the Agent server, serves the React SPA, and manages child processes in split mode.
-   **SDK Server (`index.js`)**: The business logic layer on port 3101, offering REST API endpoints for location services, venue intelligence, weather, and air quality. It handles snapshot creation and the ML data pipeline.
-   **Agent Server (`agent-server.js`)**: The workspace intelligence layer on port 43717, providing secure access to file system operations, shell commands, and database queries with token-based authentication and capability-based access control.

### AI Configuration

A three-stage AI pipeline generates strategic briefings:
1.  **Claude Opus 4.1**: Generates initial strategic analysis from snapshot data.
2.  **Gemini 2.5 Pro**: Provides local news briefings in structured JSON.
3.  **GPT-5**: Consolidates Claude's strategy and Gemini's briefing into final actionable intelligence.

Model configurations are centralized, and news briefings are stored in `snapshots.news_briefing` for UI display.

### Frontend Architecture

The platform features a **React + TypeScript Single Page Application (SPA)** built with Vite. It uses Radix UI for accessible components, TailwindCSS for styling, and React Query for server state management.

### Data Storage

A **PostgreSQL Database** manages all data, utilizing Drizzle ORM for schema management. It includes tables for snapshots, strategies, venue events, and ML training data. The system implements enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences and conversation history.

### Authentication & Security

The system uses **JWT with RS256 Asymmetric Keys** for authentication, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js for security headers, path traversal protection, and file size limits.

### API Structure

Key API categories include:
-   **Location Services**: Geocoding, timezone, weather, air quality, and location snapshot creation.
-   **Venue Intelligence**: Venue search, event research (Perplexity API), and smart block strategy generation.
-   **Diagnostics & Health**: Endpoints for service health, memory diagnostics, and job metrics.
-   **Agent Capabilities**: Secure endpoints for file system operations, shell execution, database queries, and memory management.

### Deployment

Supports both **Mono Mode** (single process, gateway embeds SDK and Agent) and **Split Mode** (gateway spawns SDK and Agent as child processes) for flexible deployment on platforms like Replit.

## External Dependencies

### Third-Party APIs

-   **AI & Research**: Anthropic API (Claude), OpenAI API (GPT-5), Google Gemini API, Perplexity API (for real-time internet research).
-   **Location & Mapping**: Google Maps API for geocoding, timezone, and places.
-   **Weather and Air Quality**: Various services via environment variables.

### Database

-   **PostgreSQL**: Used for primary data storage, schema managed by Drizzle ORM. Supports vector database capabilities and Row-Level Security (RLS).

### Infrastructure

-   **Replit Platform**: Utilized for deployment, Nix environment, and `.replit` workflow configuration, including Extension API support.
-   **Process Management**: Node.js `child_process` for multi-process environments, `http-proxy` for routing, and graceful shutdown handling.

### Frontend Libraries

-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.
## Strategy Provider Registry & Error Handling (October 30, 2025)

### Centralized Provider Registry

**Location:** `server/lib/strategies/index.js`

All AI strategy providers are registered in a single centralized map to prevent ReferenceError issues:
- **Startup Assertion:** Server validates all providers at boot (`gateway-server.js`)
- **Health Check:** `/api/health/strategies` endpoint for monitoring
- **Extensible:** New providers can be added without code changes elsewhere

### 529 Overload Error Handling

**Anthropic 529 Response:**
- Server detects 529 status codes from Anthropic API  
- Marks strategy as `failed` with `error_code: 'provider_overloaded'`
- Returns **202 Accepted** to client with retry signal

**Structured Errors:**
All error responses include `error`, `message`, and `correlationId` for traceability.

**Client Handling:**
- 200: Success - display blocks
- 202: Retrying - show "Provider overloaded, retrying..."  
- 500: Hard error - display message with correlationId

## Recent Changes (October 30, 2025)

- ✅ Fixed `claudeStrategy` ReferenceError - now uses `consolidatedStrategy` at blocks.js:611
- ✅ Added 529 overload handling with graceful 202 retry responses
- ✅ Created centralized strategy provider registry (`server/lib/strategies/index.js`)
- ✅ Added startup assertion to validate providers at boot
- ✅ Added `/api/health/strategies` endpoint for monitoring
- ✅ Added `correlationId` to all error responses for traceability
- ✅ Enhanced Claude adapter to attach status codes to error objects
- ✅ Documented port configuration policy and coordinate fallback rules
- ✅ Added inline comments in co-pilot.tsx explaining fetch vs apiRequest usage
