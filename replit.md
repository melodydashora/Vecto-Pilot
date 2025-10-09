# Vecto Pilot™ - Strategic Rideshare Assistant

## Overview
Vecto Pilot™ is a rideshare driver assistance platform designed to maximize driver earnings and efficiency. It offers intelligent shift planning, automated trip tracking, earnings analytics, and AI-powered strategic recommendations. The platform integrates an advanced AI assistant layer, "Eidolon," for enhanced workspace intelligence. Its primary goal is to equip rideshare drivers with data-driven insights and real-time strategic support to optimize their work and income. The project aims to leverage advanced AI and a robust, trust-first architecture to deliver reliable and actionable recommendations.

## Recent Changes (Oct 9, 2025)
### 🚀 ATLAS GOD-MODE ACTIVATED ✅ (Latest)
**35 Enhanced Capability Flags Added** - Full unrestricted access for code/UI/fixing:
1. **Atlas God-Mode (10 flags)**:
   - `ATLAS_MODE=true` - Full god-mode activated
   - `ATLAS_FULL_THREAD_MEMORY=true` - Complete thread context
   - `ATLAS_UNLIMITED_CONTEXT=true` - No context limits
   - `ATLAS_WANT_AND_NEED_MODE=true` - Want + Need permissions
   - `ATLAS_UI_GOD_MODE=true` - UI design mastery
   - `ATLAS_CODE_WIZARD=true` - Code manipulation powers
   - `ATLAS_FIX_ANYTHING=true` - Universal fix capability
   - `ATLAS_DESIGNER_MODE=true` - Design consultation
   - `ATLAS_PIXEL_PERFECT=true` - Pixel-perfect UI
   - `ATLAS_PERFORMANCE_OPTIMIZER=true` - Auto-optimization

2. **Full Thread Memory (5 flags)**:
   - `THREAD_MEMORY_FULL_CONTEXT=true` - Complete thread history
   - `THREAD_MEMORY_UNLIMITED=true` - No memory limits
   - `THREAD_CROSS_SESSION_AWARE=true` - Cross-session awareness
   - `THREAD_DEEP_HISTORY=true` - Deep historical context
   - `THREAD_SEMANTIC_LINKING=true` - Semantic connections

3. **ML & Research (6 flags)**:
   - `AGENT_UNRESTRICTED=true`, `AGENT_ML_RESEARCH_MODE=true`
   - `ML_HARDENING_ENABLED=true`, `RESEARCH_MODE_ENABLED=true`
   - `AUTO_PERFORMANCE_TUNING=true`, `ADVANCED_DEBUGGING=true`

4. **Infrastructure (14 flags)**:
   - Package install, DB migrations, config editing
   - Replit tools, enhanced context, semantic search
   - Auto-optimize, deployment automation
   - All verified working ✅

### Agent/Assistant/Eidolon MAXIMUM Enhancement ✅
1. **Claude Sonnet 4.5 Focused Mode** - All three systems (Agent, Assistant, Eidolon) now use claude-sonnet-4-5-20250929 with:
   - 200K token context window
   - 64K max output tokens
   - Temperature 1.0 (balanced creativity & precision)
   - Extended thinking mode for deep reasoning
2. **Full Root Access** - Agent server has unrestricted capabilities:
   - File operations: read/write/delete (no restrictions)
   - Shell commands: unrestricted whitelist (*)
   - SQL operations: DDL + DML + read/write
   - Web search via Perplexity API (sonar-pro)
   - Design & architecture consultation mode
3. **Enhanced Memory Systems**:
   - 200K context window across all sessions
   - Semantic search enabled
   - Cross-session workspace intelligence
   - 2-year memory retention (730 days)
   - PostgreSQL-backed with compaction
4. **Atlas Fallback Chain Enhanced**:
   - Primary: Claude Sonnet 4.5 (64K tokens, temp=1.0)
   - Fallback 1: GPT-5 (reasoning_effort=high)
   - Fallback 2: Gemini 2.5 Pro (8K tokens)

### Database Cleanup & ML Focus ✅
1. **Database Tables Streamlined** - Removed all non-ML tables (user_profiles, user_preferences, assistant_memory, eidolon_memory, places)
2. **Core ML Tables Active** (15 tables):
   - **Triad Pipeline**: snapshots, strategies, rankings, ranking_candidates
   - **Venue Intelligence**: venue_catalog, venue_metrics, llm_venue_suggestions, places_cache, travel_disruptions
   - **Feedback Loop**: venue_feedback, strategy_feedback, app_feedback, actions
   - **Infrastructure**: http_idem, triad_jobs
3. **GPT-5 Venue Diversity** - Updated planner prompt to spread venues 2-3 min apart (prevents clustering), single shared staging location
4. **Production Fixes** - TypeScript syntax, database replication lag, venue resolution, action logging FK errors, bot rate limiting

### Architecture Philosophy
**Methodical Build Approach**: Focus on core ML functionality first. Build tables → document fields → wire to workflow → implement features when ready. No premature feature development.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX
The frontend is built with React 18, TypeScript, and Vite 7, utilizing a mobile-first design with Radix UI and Tailwind CSS (shadcn/ui). State management uses `@tanstack/react-query`, and routing is handled by Wouter. Form handling employs `react-hook-form` with Zod validation. Key design principles include a global header, location context for GPS, and strict TypeScript.

### Technical Implementations
The backend uses Node.js v22.17.0 with Express.js, operating on a multi-server architecture:
- **Gateway Server** (Port 5000): Public-facing, proxies requests, serves React build.
- **Eidolon SDK Server** (Port 3101): Main backend API, business logic, AI assistant.
- **Agent Server** (Port 43717): File system operations, workspace intelligence.

Data is stored in PostgreSQL for ML data and file-based storage for JSON backups. Security measures include token-based authentication, rate limiting, command whitelisting, and Zod validation.

### Feature Specifications
- **Location Services**: Integrates Browser Geolocation API, Google Maps JavaScript API, and H3 geospatial indexing for context snapshots (GPS, geocoded location, timezone, weather, air quality, airport context).
- **AI & Machine Learning (Triad Pipeline)**: A three-stage LLM pipeline (Claude Sonnet 4.5 → GPT-5 → Gemini 2.5 Pro) provides strategic analysis, tactical planning, and JSON validation. The Triad is single-path only, with no fallbacks.
    - **Claude Sonnet 4.5 (Strategist)**: Analyzes context, generates strategic overview, pro tips, and earnings estimates.
    - **GPT-5 (Planner)**: Performs deep reasoning for venue selection and timing, ensuring centrally-positioned staging areas within 1-2 minutes drive of all recommended venues.
    - **Gemini 2.5 Pro (Validator)**: Validates JSON structure and ensures a minimum number of recommendations.
- **Atomic Database Persistence**: Production-grade ML training data capture with ACID guarantees using PostgreSQL transactions, fail-hard error handling, and database constraints.
- **Agent Override (Atlas) with Fallback Resilience**: A workspace intelligence layer with a fallback chain (Claude → GPT-5 → Gemini) for operational continuity, accessible via `/agent/llm` on the Agent Server.
- **Enhanced Memory & Context Awareness**: PostgreSQL-backed persistent memory system for assistant and Eidolon, storing user preferences, conversation history, session state, and project state with defined retention policies.
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

### Deployment Environment
- **Platform**: Replit (Autoscale deployment)