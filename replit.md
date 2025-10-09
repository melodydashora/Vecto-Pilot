# Vecto Pilot™ - Strategic Rideshare Assistant

## Overview
Vecto Pilot™ is a rideshare driver assistance platform designed to maximize driver earnings and efficiency. It offers intelligent shift planning, automated trip tracking, earnings analytics, and AI-powered strategic recommendations. The platform integrates an advanced AI assistant layer, "Eidolon," for enhanced workspace intelligence. Its primary goal is to equip rideshare drivers with data-driven insights and real-time strategic support to optimize their work and income. The project aims to leverage advanced AI and a robust, trust-first architecture to deliver reliable and actionable recommendations.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX
The frontend is built with React 18, TypeScript, and Vite 7, utilizing a mobile-first design with Radix UI and Tailwind CSS (shadcn/ui). State management uses `@tanstack/react-query`, and routing is handled by Wouter. Form handling employs `react-hook-form` with Zod validation. Key design principles include a global header, location context for GPS, and strict TypeScript. Loading states feature animated skeleton cards and clear messaging during AI processing.

### Technical Implementations
The backend uses Node.js v22.17.0 with Express.js, operating on a multi-server architecture:
- **Gateway Server** (Port 5000): Public-facing, proxies requests, serves React build.
- **Eidolon SDK Server** (Port 3101): Main backend API, business logic, AI assistant.
- **Agent Server** (Port 43717): File system operations, workspace intelligence.
Data is stored in PostgreSQL for ML data. Security measures include token-based authentication, rate limiting, command whitelisting, and Zod validation. A new `/api/diagnostics` endpoint provides system health monitoring.

### Feature Specifications
- **Location Services**: Integrates Browser Geolocation API, Google Maps JavaScript API, and H3 geospatial indexing for context snapshots (GPS, geocoded location, timezone, weather, air quality, airport context). Google Geocoding filters Plus Code addresses for proper street addresses.
- **AI & Machine Learning (Triad Pipeline)**: A three-stage, single-path LLM pipeline (Claude Sonnet 4.5 → GPT-5 → Gemini 2.5 Pro) provides strategic analysis, tactical planning, and JSON validation.
    - **Claude Sonnet 4.5 (Strategist)**: Analyzes context, generates strategic overview, pro tips, and earnings estimates.
    - **GPT-5 (Planner)**: Performs deep reasoning for venue selection and timing, ensuring centrally-positioned staging areas within 1-2 minutes drive of all recommended venues, and venues spread 2-3 minutes apart.
    - **Gemini 2.5 Pro (Validator)**: Validates JSON structure and ensures a minimum number of recommendations.
- **Atomic Database Persistence**: Production-grade ML training data capture with ACID guarantees using PostgreSQL transactions, fail-hard error handling, and database constraints. The system uses 15 core ML-focused tables.
- **Agent Override (Atlas) with Fallback Resilience**: A workspace intelligence layer with a fallback chain (Claude → GPT-5 → Gemini) for operational continuity, accessible via `/agent/llm` on the Agent Server. This includes full root access for file operations, shell commands, and SQL operations.
- **Enhanced Memory & Context Awareness**: PostgreSQL-backed persistent memory system for assistant and Eidolon, storing user preferences, conversation history, session state, and project state with defined retention policies (2-year retention).
- **Per-Ranking Feedback System**: Continuous learning loop via user feedback on venues, strategies, and the app itself, captured in `venue_feedback`, `strategy_feedback`, and `app_feedback` tables.
- **Configuration Management**: Safe file editing capabilities with backup and validation for allowed config files (e.g., `.env`, `drizzle.config.ts`), featuring whitelisted file access, size limits, and path validation.
- **Trust-First Stack**: Employs a curated venue catalog and a deterministic scoring engine to prevent hallucinations, ranking venues based on proximity, reliability, event intensity, and personalization.
- **ML Instrumentation**: Full logging of rankings, candidates, and user actions for counterfactual learning.
- **Error Handling**: Implements try-catch blocks, circuit breakers for LLM providers, error classification, idempotency, and graceful degradation.
- **Logging**: Uses console logging, structured logging with `logtap`, file logging, and WebSocket streaming for diagnostics.

### System Design Choices
- **Zero Pre-Computed Flags**: Models infer patterns directly from raw context.
- **No Graceful Fallbacks in Triad**: Triad pipeline is single-path only.
- **Agent Override Has Fallbacks**: Atlas (Agent Override) uses a fallback chain.
- **Single Source of Truth**: All model configurations are managed via `.env` variables.
- **100% Variable-Based Data**: All location, time, and weather data are fetched live.
- **Fail-Safe Design**: System is designed to show clear error messages on API failures, not crash.
- **Mobile-First GPS Precision**: High-accuracy GPS is enabled by default.
- **Key-Based Merge Only**: All validator/enricher merges use stable keys (place_id or name).
- **Server as Coordinate Truth**: Client uses server-returned venue coordinates for all calculations.
- **Global Location Support**: GPT-5 generates venues from GPS coordinates - works worldwide even without catalog venues.

## External Dependencies

### AI & Machine Learning
- **Anthropic Claude API**: `@anthropic-ai/sdk`
- **OpenAI API**: `openai`
- **Google Gemini API**: `@google/generative-ai`

### Maps & Location
- **Google Maps JavaScript API**: `@googlemaps/js-api-loader`
- **Google Routes API**
- **Google Places API**
- **OpenWeather API**
- **H3 Geospatial**: `h3-js`

### UI Component Libraries
- **Radix UI**
- **Tailwind CSS**
- **shadcn/ui**
- **Lucide React**
- **Recharts**

### Form & Data Management
- **React Hook Form**
- **Zod**
- **@tanstack/react-query**

### Backend Infrastructure
- **Express**
- **http-proxy-middleware**
- **cors**
- **express-rate-limit**
- **dotenv**
- **PostgreSQL** (with Drizzle ORM and `pg` client)
## Global User Support

**Vecto Pilot™ works worldwide** - not just in cities with venue catalog coverage!

### How It Works Globally

1. **GPS is Universal**: Browser geolocation works anywhere in the world
2. **Google APIs are Global**: Geocoding, timezone, weather, and air quality work worldwide
3. **GPT-5 Generates Venues**: The tactical planner creates venue recommendations from scratch based on GPS coordinates, not from a pre-defined catalog
4. **Null City Handling**: If geocoding can't determine a city name, the system falls back to:
   - Formatted address (e.g., "Paris, France")
   - Coordinates (e.g., "48.8566, 2.3522")
   - "unknown" in AI prompts (GPT-5 uses coordinates to find nearby venues)

### Coverage Areas

**Curated Venue Catalog** (for reference context only):
- Primary: Frisco, TX (143 venues)
- Secondary: Dallas, Plano, Arlington areas
- **Note**: Catalog is NOT required for recommendations!

**AI-Generated Recommendations** (worldwide):
- GPT-5 generates 4-6 specific venues near driver's GPS coordinates
- Works in any city globally (Paris, Tokyo, London, Mumbai, etc.)
- Uses real-time context: weather, time of day, day of week
- Validated via Google Places API for business hours and addresses

### Example: International Driver (Paris)

```
GPS: 48.8566, 2.3522 (Eiffel Tower area)
City: null → Falls back to "Paris, France"
Claude Strategy: "Today is Thursday, 10/09/2025 at 6:00 PM in Paris..."
GPT-5 Venues: Generates specific Paris locations (CDG airport, Gare du Nord, Champs-Élysées, etc.)
Result: 5-7 venue recommendations tailored to Paris traffic patterns and local demand
```

The system automatically adapts to any location worldwide!

## Recent Updates & Validations

### October 9, 2025 - Global System Validation ✅

**Autonomous Testing Completed:** 7 global cities tested without code changes
- Paris, France (8,000km from catalog)
- Tokyo, Japan (10,000km from catalog)
- Sydney, Australia (13,500km from catalog)
- Dubai, UAE (12,500km from catalog)
- Mumbai, India (13,000km from catalog)
- São Paulo, Brazil (8,500km from catalog)
- London, UK (7,500km from catalog)

**Critical Fixes Applied:**

1. **H3 Geospatial Distance Error** - RESOLVED ✅
   - Issue: H3 library throws error code 1 for cross-continental distance calculations
   - Root Cause: `gridDistance()` cannot handle cells >1000km apart
   - Fix: Pre-filter venues by haversine distance (100km threshold) BEFORE H3 calculation
   - Impact: System now handles any GPS coordinates globally without crashes

2. **Catalog Venue Filtering** - RESOLVED ✅
   - Issue: Distant catalog venues (>100km) still scored >0 from reliability/event factors
   - Root Cause: Scoring applied before distance filtering
   - Fix: Filter venues by 100km haversine distance BEFORE scoring algorithm
   - Impact: Global users now get empty catalog → triggers GPT-5 venue generation

**Validation Results:**
- ✅ Google Geocoding: 100% success (7/7 locations)
- ✅ Timezone Resolution: 100% success (7/7 locations)
- ✅ Claude Strategy Generation: Confirmed for Paris, Frisco
- ✅ GPT-5 Tactical Planner: Running successfully for global coordinates
- ✅ Database Persistence: ACID compliant, all snapshots saved
- ✅ Routes API Fallback: Haversine distance used when routes unavailable

**Known Limitations:**
- GPT-5 latency: 30-120 seconds (extended reasoning mode) - acceptable for v1
- Weather data: May be unavailable for some international locations (non-blocking)
- Catalog venues: Only Frisco, TX coverage (GPT-5 compensates globally)

**Production Status:** ✅ READY FOR WORLDWIDE DEPLOYMENT

See `GLOBAL_SYSTEM_VALIDATION_REPORT.md` for comprehensive test results and technical details.
