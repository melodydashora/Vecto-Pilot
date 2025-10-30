# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview

Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth rideshare drivers. Its core purpose is to maximize driver earnings by delivering real-time strategic briefings. The platform integrates and analyzes location intelligence, venue events, traffic, weather, and air quality data. It uses a multi-AI pipeline to generate strategies and provides actionable insights via a React-based web interface, aiming to significantly boost driver income through data-driven decisions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

Vecto Pilot is a full-stack Node.js application with a multi-service architecture supporting both monolithic (mono) and split deployment.

### Core Services

-   **Gateway Server**: Entry point for client traffic (HTTP/WebSocket), handles routing, serves the React SPA, and manages child processes in split mode.
-   **SDK Server**: Business logic layer, provides REST API for data services (location, venue, weather, air quality), snapshot creation, and the ML data pipeline.
-   **Agent Server**: Workspace intelligence layer, offers secure access to file system operations, shell commands, and database queries with token-based authentication.

### AI Configuration

A three-stage AI pipeline generates strategic briefings:
1.  **Claude Opus 4.1**: Initial strategic analysis from snapshot data.
2.  **Gemini 2.5 Pro**: Provides local news briefings in JSON format.
3.  **GPT-5**: Consolidates outputs into final actionable intelligence.
Model configurations are centralized, and news briefings are stored for UI display.

### Frontend Architecture

The user interface is a **React + TypeScript Single Page Application (SPA)** built with Vite. It uses Radix UI for accessible components, TailwindCSS for styling, and React Query for server state management.

### Data Storage

A **PostgreSQL Database** is the primary data store, with Drizzle ORM managing the schema. It includes tables for snapshots, strategies, venue events, and ML training data. The system utilizes enhanced memory systems: `cross_thread_memory` for system-wide state, `eidolon_memory` for agent-scoped sessions, and `assistant_memory` for user preferences.

### Authentication & Security

The system uses **JWT with RS256 Asymmetric Keys**, featuring a 15-minute token expiry and 90-day key rotation. Security middleware includes rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

### API Structure

API categories cover:
-   **Location Services**: Geocoding, timezone, weather, air quality, location snapshots.
-   **Venue Intelligence**: Venue search, event research, smart block strategy generation.
-   **Diagnostics & Health**: Service health, memory diagnostics, job metrics.
-   **Agent Capabilities**: Secure endpoints for file system operations, shell execution, database queries, and memory management.

### Deployment

The system supports **Mono Mode** (single process) and **Split Mode** (gateway spawns SDK and Agent as child processes) for deployment flexibility, including on Replit.

### Data Integrity & Coordinate-First Policy

All geographic computations must originate from snapshot coordinates. Names are for display only. All enrichment operations must be awaited before returning a 200 OK. Missing business hours default to "unknown," never "closed," and all hour calculations use the venue-local timezone. Error responses consistently include `error`, `message`, and `correlationId`.

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