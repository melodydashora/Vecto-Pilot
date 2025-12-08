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
- **Briefing Generation**: All AI calls now use `gemini-3-pro-preview` with Google tools for consistent web search reliability. Briefing data sources (Traffic Conditions, Rideshare News, Events, Concerts & Live Music, School Closures) populate with real Gemini API data. TTL-based cache invalidation (30 min) ensures fresh data in BOTH development and production - briefings older than TTL are automatically regenerated.
- **SmartBlocks**: SmartBlocks race condition (limbo state) fixed with Just-In-Time generation in GET endpoint Gate 2. System now detects "strategy complete but rankings missing" and auto-triggers block generation during polling.
- **Strategy Loader**: Dynamic progress bar with real-time strategy steps. Shows Phase 1 (Strategy Analysis: 0-30%) and Phase 2 (Venue Discovery: 30-100%) with granular sub-steps during block generation (fetching, calculating distance/drive time, finalizing).
- **AI Coach**: The AI Strategy Coach uses `gemini-3-pro-preview` for conversational assistance with rideshare strategy, venue interpretation, and file analysis. Note: Web search tool was attempted but causes API timeouts - coach uses Vecto Pilot's data sources (briefing, events, traffic) for instant responses instead. Coach timeout increased to 90 seconds for any future web search attempts.
- **Data Flow Consistency**: All data flows follow a three-phase pattern: Fetch, Resolve, and Return, ensuring data consistency, validation, and proper formatting.
- **GPS Location Behavior**: Location refresh is manual only, requesting fresh permissions (`maximumAge: 0`) upon opening or manual trigger.

**Feature Specifications**:
- **Briefing Data**: Includes real-time traffic analysis, AI-curated local rideshare news, local events with venues/times, concerts, and school closures.
- **Smart Blocks**: Provide 5 venue recommendations per strategy, displaying venue name, address, distance, drive time, value per minute, grade, and pro tips.
- **Bars & Premium Venues Table**: Displays filtered SmartBlocks for bars, including business hours for ML training.

**System Design Choices**:
- **Core Services**: Gateway Server, SDK Server, Agent Server.
- **Memory Systems & Data Isolation**: Assistant (user preferences), Eidolon (project/session state with snapshots), Agent Memory (agent service state). All are scoped by `user_id` and secured with JWT.
- **AI Configuration**: Role-based architecture using configurable AI models for event-driven strategy generation:
  - **Strategist**: Claude Sonnet 4.5 for strategic overview (minstrategy)
  - **Briefer**: Gemini 3 Pro Preview for Type A briefing data (news, events, traffic, weather, closures)
  - **Consolidator**: Gemini 3 Pro Preview as "Tactical Dispatcher" - receives RAW JSON from briefings table (traffic_conditions, events, news, weather_current, school_closures) + full snapshot + minstrategy. Passes labeled JSON sections directly to Gemini (CURRENT_TRAFFIC_DATA, CURRENT_EVENTS_DATA, etc.) so strategy can reference specific details like "Eastbound Main St closed"
  - **Holiday Checker**: Perplexity for holiday detection
- **Data Storage**: PostgreSQL Database (Replit managed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data using unique indexes and JSONB.
- **Architecture Pattern - Snapshots as Central Connector for ML**: Snapshots act as the authoritative connector across all data sources, enabling machine learning and analytics by linking all enrichments (strategies, briefings, rankings, actions, venue feedback) to a `snapshot_id`.
- **Authentication & Security**: JWT with RS256 Asymmetric Keys and security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.
- **Deployment & Reliability**: Supports Mono Mode and Split Mode, featuring health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.
- **Data Architecture - Precise Location Denormalization Pattern**: Every table referencing `snapshot_id` also stores resolved precise location data (formatted_address, city, state) for fast queries, relational consistency, and ML training without joins.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude Sonnet 4.5), OpenAI (GPT-4o Realtime), Google (Gemini 3.0 Pro Preview with Web Search for briefing + consolidation), Perplexity (holiday detection).
-   **DEPRECATED**: GPT-5.1 consolidation removed - replaced by Gemini 3 Pro Preview Tactical Dispatcher.
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