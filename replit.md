# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform aims to help rideshare drivers earn more in less time with transparent guidance, with ambitions for continuous expansion to new markets and improved quality of life for individuals.

## User Preferences
Preferred communication style: Simple, everyday language. Do not say "done" until features are actually verified working.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture (Gateway, SDK, Agent servers), supporting both monolithic and split deployments.

**UI/UX Decisions**:
The frontend is a React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. Key features include a Strategy Section, Smart Blocks for venue recommendations, an Rideshare Coach with hands-free voice chat, and a Rideshare Briefing Tab with immutable strategy history. A new ML-focused bars and premium venues table has been added to the Venues tab for structured data capture.

**Technical Implementations**:
- **Briefing Generation**: Briefing roles resolve via the model registry (`server/lib/ai/model-registry.js`; currently `gemini-3.5-flash` with Google Search grounding) — models are never named at call sites. Briefing data sources populate with real Gemini API data using **split cache strategy**:
  - **School Closures**: 24-hour city-level cache; **Events**: cached in the `discovered_events` DB table with staleness checks
  - **Traffic, News, Weather, Airport**: always refreshed on app open or manual refresh (never cached)
  - This allows comprehensive daily research for news/events while keeping traffic conditions live throughout the day
- **Strategy Engine**: Single strategy — Immediate 1-hour tactical guidance via the STRATEGY_TACTICAL role at `server/lib/ai/providers/consolidator.js:157`, triggered synchronously by `POST /api/blocks-fast`. Stored in `strategies.strategy_for_now`.
- **SmartBlocks**: SmartBlocks race condition (limbo state) fixed with Just-In-Time generation in GET endpoint Gate 2. System now detects "strategy complete but rankings missing" and auto-triggers block generation during polling.
- **Strategy Loader**: Dynamic progress bar with real-time strategy steps. Shows Phase 1 (Strategy Analysis: 0-30%) and Phase 2 (Venue Discovery: 30-100%) with granular sub-steps during block generation (fetching, calculating distance/drive time, finalizing).
- **Rideshare Coach**: The Rideshare Coach uses the AI_COACH role (registry default `gemini-3.5-flash`, streaming-only) for conversational assistance with rideshare strategy, venue interpretation, and file analysis. Note: Web search tool was attempted but causes API timeouts - coach uses Vecto Pilot's data sources (briefing, events, traffic) for instant responses instead. Coach timeout increased to 90 seconds for any future web search attempts.
- **Data Flow Consistency**: All data flows follow a three-phase pattern: Fetch, Resolve, and Return, ensuring data consistency, validation, and proper formatting.
- **GPS Location Behavior**: Location refresh is manual only, requesting fresh permissions (`maximumAge: 0`) upon opening or manual trigger.
- **localStorage Behavior**: Strategy data clears on app mount to show fresh loading states for both consolidated and immediate strategies. Both states reset on new snapshot detection.
- **Coords Cache (NEW)**: Global lookup table (`coords_cache`) caches geocode/timezone data by coordinate hash to eliminate duplicate API calls:
  - Cache key: 4 decimal places (~11m precision) for matching similar locations
  - Storage: 6 decimal places (~11cm precision) for accurate data
  - On cache hit: Skip Google Geocode/Timezone APIs, use cached city/state/timezone/formatted_address
  - On cache miss: Call APIs, store complete result for future lookups
  - Tracks hit_count for cache utilization analytics

**Feature Specifications**:
- **Briefing Data**: Includes real-time traffic analysis, AI-curated local rideshare news, local events with venues/times, concerts, and school closures.
- **Smart Blocks**: Provide 6 venue recommendations per strategy (TARGET_VENUE_COUNT = 6), displaying venue name, address, distance, drive time, value per minute, grade, and pro tips.
- **Bars & Premium Venues Table**: Displays filtered SmartBlocks for bars, including business hours for ML training.

**System Design Choices**:
- **Core Services**: Gateway Server, SDK Server, Agent Server.
- **Memory Systems & Data Isolation**: Assistant (user preferences), Eidolon (project/session state with snapshots), Agent Memory (agent service state). All are scoped by `user_id` and secured with JWT.
- **AI Configuration**: Role-based architecture using configurable AI models for event-driven strategy generation:
  - **Strategist (STRATEGY_CORE)**: Claude Opus 4.8 for core strategic plan generation (the former minstrategy step was removed — no such column exists)
  - **Briefer**: Gemini 3 Pro Preview for Type A briefing data (news, events, traffic, weather, closures)
  - **Consolidator/Immediate Strategy (STRATEGY_TACTICAL)**: Claude Opus 4.8 generates the immediate 1-hour tactical strategy directly from the full snapshot + raw briefing JSON (traffic_conditions, events, news, weather_current, school_closures) — no minstrategy input and no separate GPT model in the strategy path.
  - **Holiday Checker (BRIEFING_HOLIDAY)**: Gemini 3.5 Flash with Google Search, run inside the briefing pipeline
- **Data Storage**: PostgreSQL Database (Replit managed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data using unique indexes and JSONB.
- **Architecture Pattern - Snapshots as Central Connector for ML**: Snapshots act as the authoritative connector across all data sources, enabling machine learning and analytics by linking all enrichments (strategies, briefings, rankings, actions, venue feedback) to a `snapshot_id`.
- **Authentication & Security**: JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.
- **Deployment & Reliability**: Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.
- **Data Architecture - Precise Location Denormalization Pattern**: Every table referencing `snapshot_id` also stores resolved precise location data (formatted_address, city, state) for fast queries, relational consistency, and ML training without joins.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude Opus 4.8 for strategy roles), OpenAI (GPT-5.5 for venue scoring and market parsing, Realtime API for voice), Google (Gemini 3.5 Flash with Google Search for briefing roles and AI Coach), Perplexity (Sonar web search for briefing research).
-   **DEPRECATED**: GPT-5.2 removed from the strategy pipeline entirely (2026-02-26) — STRATEGY_TACTICAL now runs on Claude Opus 4.8.
-   **Voice Chat**: OpenAI Realtime API.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API, Google Timezone API.
-   **Weather**: Google Weather API.
-   **Air Quality**: Google Air Quality API.

### Database
-   **PostgreSQL**: Primary data store, managed by Drizzle ORM — Replit Helium (local) in dev, Neon serverless (SSL) in prod; `DATABASE_URL` is the only selector.

### Infrastructure
-   **Replit Platform**: Deployment and Nix environment.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.