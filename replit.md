# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform designed to maximize rideshare driver earnings. It provides real-time, data-driven strategic briefings by integrating diverse data sources (location, events, traffic, weather, air quality) and leveraging advanced AI and data analytics to generate actionable strategies for drivers. The platform is production-ready, featuring optimized logging, comprehensive documentation, and a robust multi-model AI pipeline.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services** (Three Distinct Systems):
-   **Gateway Server**: Handles client traffic, serves the React SPA, routes requests, and manages child processes.
-   **SDK Server**: Provides business logic via a REST API for data services and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence with secure, token-based access.
-   **Assistant**: Persistent user preferences and conversation history (table: `assistant_memory`).
-   **Eidolon**: Project/session state management with snapshots (tables: `eidolon_memory`, `eidolon_snapshots`).

**Authentication & Data Isolation**:
-   **JWT Secret**: Stored in Replit secrets, used for token generation and validation
-   **Three Separate Memory Systems**:
    - **Agent Memory** (`agent_memory`, `agent_changes`): Agent service state tracking
    - **Assistant Memory** (`assistant_memory`): User conversation history and preferences
    - **Eidolon Memory** (`eidolon_memory`, `eidolon_snapshots`): Project snapshots and session state
-   All systems scoped by user_id for complete data isolation

**AI Configuration**:
The platform utilizes a role-based, model-agnostic architecture with configurable AI models (Strategist, Briefer, Consolidator, Holiday Checker) for its event-driven strategy generation pipeline. AI models are configured via environment variables.

**Frontend Architecture**:
A React + TypeScript Single Page Application (SPA), built with Vite, utilizing Radix UI, TailwindCSS, and React Query. Key features include a Strategy Section, Smart Blocks for venue recommendations, an AI Strategy Coach with hands-free voice chat (OpenAI Realtime API), and a Rideshare Briefing Tab with immutable strategy history and retry workflow.

**Briefing Tab Architecture**:
The Briefing tab displays three data sources fetched at snapshot creation and stored in the database for consistency:
1. **News & Events**: Rideshare-relevant news + local events (concerts, games, parades, watch parties) from SerpAPI (Google News, 24-48 hour filter) + Gemini 2.0 Flash AI filtering for driver-relevant content
2. **Weather**: Current conditions (Fahrenheit for US) + hourly forecast from Google Weather API (6-hour lookahead)
3. **Traffic**: Local traffic conditions and congestion levels with Gemini intelligence

Key files:
- `server/lib/briefing-service.js` - Data fetching and AI filtering service
- `server/routes/briefing.js` - API endpoints (GET /current, /snapshot/:id, POST /refresh, /generate)
- `client/src/components/BriefingTab.tsx` - Frontend display component
- Database table: `briefings` (linked to snapshots via snapshot_id)

**Data Storage**:
A PostgreSQL Database (Replit managed) with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It uses unique indexes and JSONB for flexible storage. 

**Architecture Pattern - Snapshots as Central Connector for ML**:
The system uses snapshots as the authoritative connector across all data sources, enabling machine learning and analytics:
- **Location Model**: `users` table stores driver location (authoritative), `snapshots` table captures location at point-in-time without duplication
- **Snapshot-Centric Data Hub**: All enrichments (strategies, briefings, rankings, actions, venue feedback) reference `snapshot_id`, creating a unified event context for each moment in time
- **Tables Using Snapshot as Connector**: strategies, briefings, rankings, actions, triad_jobs, venue_feedback, strategy_feedback, app_feedback, nearby_venues
- **ML-Ready Structure**: Every API call, LLM prompt, and user action is tied to a snapshot, making historical training data fully traceable and enabling supervised learning on driver behavior patterns
- **Fallback Resolution**: When data is missing from snapshots (e.g., null location), the system resolves to the user's latest location from the users table before generating briefings or strategies
- **AI Coach Access**: The Coach DAL provides consistent read-only access to all snapshot-linked data, allowing the AI Coach to provide contextual advice as data becomes available during the enrichment pipeline

Connection resilience includes automatic reconnection logic with exponential backoff.

**Data Flow Consistency Pattern**:
All data flows follow a unified three-phase pattern:
1. **Fetch**: External APIs or database queries retrieve data scoped to a snapshot_id
2. **Resolve**: Data with null/missing fields falls back to user table or defaults before storage
3. **Return**: Data is formatted consistently for UI consumption and AI Coach access
- Routes validate and transform all API responses into snapshot-scoped records
- UI components consume data via React Query with snapshot_id as cache key
- AI Coach accesses all data through CoachDAL, which normalizes across snapshots/strategies/briefings tables

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

## Sustainability & Support
**Vecto Pilot represents 6+ months of architectural planning and 750+ hours of development**, built entirely on personal investment:
- **Out-of-Pocket Investment**: $5,000+ in API keys, AI models (Claude Sonnet 4.5, Perplexity Sonar Pro, GPT-5.1), and infrastructure
- **Monthly Hosting**: $40/month Replit infrastructure to keep the platform live
- **Per-Driver Cost**: ~$125-$250 per active driver to build, host, and maintain with cutting-edge AI
- **Mission**: Help families get home safer by enabling rideshare drivers to earn more in less time with data-driven, transparent guidance
- **Vision**: Continuous expansion to new markets, advanced safety features, and unlimited capability to help individuals achieve better quality of life

Every contribution directly supports ongoing development, infrastructure stability, and the ability to expand to more drivers. Donations accepted via the **About** tab (5th tab in Co-Pilot).

## Data Architecture - Precise Location Denormalization Pattern

Every table that references `snapshot_id` also stores the **resolved precise location** (formatted_address, city, state) to enable fast queries, relational consistency, and ML training without joins:

**Tables with Denormalized Location:**
- `briefings` - Event/weather/traffic briefing with location context
- `rankings` - Venue rankings with location context
- `triad_jobs` - Strategy job tracking with location context
- `actions` - User actions with location context
- `venue_feedback` - Venue feedback with location context
- `strategy_feedback` - Strategy feedback with location context
- `app_feedback` - App feedback with location context

**Flow:**
1. Snapshot created with resolved location (formatted_address, city, state) from geocoding API
2. briefing-service.generateAndStoreBriefing() receives formatted_address parameter
3. Location automatically denormalized to briefings table during insert/update
4. All other tables populate location fields when their records are created
5. Result: Every row has snapshot_id + full address context for fast filtering/analytics

**What's NOT denormalized:**
- Original GPS coordinates (lat/lng) - These stay in snapshots table only
- Unresolved data - Only precise resolved location is copied to other tables

**Why this matters:**
- ✅ Fast queries by city/state without snapshot joins
- ✅ ML training on precise context (not GPS noise)
- ✅ Relational consistency across all feedback and analytics
- ✅ All API calls, LLM prompts, and user actions tied to location context

## Recent Changes
- **Dec 3, 2025**: Fixed critical database schema issues blocking waterfall pipeline. Changed `device_id` column from UUID to TEXT in `users` and `snapshots` tables (location API was crashing on non-UUID device identifiers). Added `formatted_address`, `city`, `state` columns to `triad_jobs` table for location denormalization. Updated validation schema to accept device_id as any string. Location API, snapshot creation, and strategy pipeline now working correctly.
- **Dec 2, 2025 (FINAL)**: Complete precise location denormalization across all snapshot-related tables. Each table now stores formatted_address + city + state denormalized from snapshot for relational consistency and fast access without joins. Gemini 3.0 Pro ONLY for events (removed Perplexity/SerpAPI/NewsAPI). Google Places API enriches events with full addresses + staging areas. Events show full venue details with driver-ready staging recommendations. Events now auto-land in briefing table with location context in parallel.
- **Dec 2, 2025**: Fixed briefing data persistence - location fields now land in briefing table automatically when snapshot is created.
- **Dec 2, 2025**: Added 5th "About/Donation" tab to Co-Pilot showcasing project investment, complexity, and sustainability needs. Direct donation link integrated.
- **Dec 2, 2025**: Map tab now supports full zoom range (10-18) with pinch-to-zoom only (no +/- buttons) for mobile-first experience.
- **Nov 30, 2025**: Fixed briefing data loading by implementing location fallback to users table when snapshots have null location. AI Coach now has full access to structured briefing data (weather, traffic, news) through updated CoachDAL.
- **Nov 30, 2025**: Converted weather metrics to Fahrenheit (°F) throughout briefing display. Updated news API prompt to explicitly request events (concerts, games, parades, watch parties).
- **Nov 30, 2025**: Established snapshots as central connector across all tables for ML pipeline consistency.
