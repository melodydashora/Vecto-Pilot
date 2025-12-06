# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform aims to help rideshare drivers earn more in less time with transparent guidance, with ambitions for continuous expansion to new markets and improved quality of life for individuals.

## User Preferences
Preferred communication style: Simple, everyday language. Do not say "done" until features are actually verified working.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture (Gateway, SDK, Agent servers), supporting both monolithic and split deployments.

**UI/UX Decisions**:
The frontend is a React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. Key features include a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach with hands-free voice chat, and a Rideshare Briefing Tab with immutable strategy history. A new ML-focused bars and premium venues table has been added to the Venues tab for structured data capture.

**Technical Implementations**:
- **Briefing Generation**: All AI calls now use `gemini-3-pro-preview` with Google tools for consistent web search reliability. Briefing data sources (Traffic Conditions, Rideshare News, Events, Concerts & Live Music, School Closures) populate with real Gemini API data. Auto-regeneration of briefings occurs when data is stale or missing.
- **SmartBlocks**: SmartBlocks loading issues due to race conditions have been resolved, ensuring correct generation and display of venue recommendations.
- **AI Coach**: The AI Strategy Coach now has real-time web search capabilities via `gemini-3-pro-preview` with the `googleSearch` tool enabled, allowing it to provide current information on local events, traffic, weather, and rideshare trends.
- **Data Flow Consistency**: All data flows follow a three-phase pattern: Fetch, Resolve, and Return, ensuring data consistency, validation, and proper formatting.
- **GPS Location Behavior**: Location refresh is manual only, requesting fresh permissions (`maximumAge: 0`) upon opening or manual trigger.

**Feature Specifications**:
- **Briefing Data**: Includes real-time traffic analysis, AI-curated local rideshare news, local events with venues/times, concerts, and school closures.
- **Smart Blocks**: Provide 5 venue recommendations per strategy, displaying venue name, address, distance, drive time, value per minute, grade, and pro tips.
- **Bars & Premium Venues Table**: Displays filtered SmartBlocks for bars, including business hours for ML training.

**System Design Choices**:
- **Core Services**: Gateway Server, SDK Server, Agent Server.
- **Memory Systems & Data Isolation**: Assistant (user preferences), Eidolon (project/session state with snapshots), Agent Memory (agent service state). All are scoped by `user_id` and secured with JWT.
- **AI Configuration**: Role-based, model-agnostic architecture using configurable AI models (Strategist, Briefer, Consolidator, Holiday Checker) for event-driven strategy generation.
- **Data Storage**: PostgreSQL Database (Replit managed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data using unique indexes and JSONB.
- **Architecture Pattern - Snapshots as Central Connector for ML**: Snapshots act as the authoritative connector across all data sources, enabling machine learning and analytics by linking all enrichments (strategies, briefings, rankings, actions, venue feedback) to a `snapshot_id`.
- **Authentication & Security**: JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.
- **Deployment & Reliability**: Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.
- **Data Architecture - Precise Location Denormalization Pattern**: Every table referencing `snapshot_id` also stores resolved precise location data (formatted_address, city, state) for fast queries, relational consistency, and ML training without joins.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-4o Realtime, GPT-5.1), Google (Gemini 3.0 Pro with Web Search, Gemini 2.0 Flash), Perplexity.
-   **Voice Chat**: OpenAI Realtime API.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API, Google Timezone API.
-   **Weather**: Google Weather API.
-   **Air Quality**: Google Air Quality API.

### Database
-   **PostgreSQL (Replit Built-in)**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.