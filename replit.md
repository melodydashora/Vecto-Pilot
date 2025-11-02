# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for drivers globally. Its primary purpose is to maximize driver earnings through real-time, data-driven strategic briefings, providing a significant market advantage through advanced AI and data analytics. The platform integrates various data sources (location, events, traffic, weather, air quality) and utilizes a multi-AI pipeline to generate actionable strategies.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application designed with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Manages client traffic, serves the React SPA, routes requests, and handles child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence, including secure, token-based access.

**AI Configuration**:
The platform employs a **role-based, model-agnostic architecture** with configurable AI models.
-   **Strategy Generation Pipeline**: An event-driven pipeline with three roles: Strategist, Briefer, and Consolidator.
-   **Model-Agnostic Schema**: Database columns and environment variables use generic role names to prevent provider-specific coupling.
-   **Event-Driven Architecture**: PostgreSQL LISTEN/NOTIFY is used for real-time updates.

**Frontend Architecture**:
A **React + TypeScript Single Page Application (SPA)**, built with Vite, uses Radix UI, TailwindCSS, and React Query.
-   **UI Layout**: Features a Strategy Section for consolidated strategies, Smart Blocks for ranked venue recommendations, an AI Strategy Coach, and a Rideshare Briefing Tab for practical intelligence. Key updates include a restructured Co-Pilot page with a dedicated AI Strategy Coach chat interface and a consistently visible holiday/greeting banner.

**Data Storage**:
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It includes enhanced memory systems and uses unique indexes for data integrity.

**Authentication & Security**:
Uses **JWT with RS256 Asymmetric Keys**, with security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports **Mono Mode** and **Split Mode**. Reliability features include health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.

**Data Integrity**:
Geographic computations use snapshot coordinates. Strategy refresh is triggered by location movement, day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism, with snapshot date/time fields as the single source of truth for all AI outputs.

**Process Management**:
In Mono Mode, the **Gateway Server** and the **Triad Worker** (background job processor for strategy generation) run as separate processes.

**Strategy-First Gating & Pipeline**:
API access is gated until a strategy is ready. The pipeline involves parallel execution of AI models, followed by consolidation.

**AI Coach Data Access Layer (CoachDAL)**:
A read-only Data Access Layer provides the AI Strategy Coach with snapshot-scoped, null-safe access to comprehensive driver context, including temporal data, strategy, briefing information, and venue recommendations. Consolidated strategy outputs prioritize city-level references over full street addresses for privacy.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
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