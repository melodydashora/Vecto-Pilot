# Vecto Pilot™ - Strategic Rideshare Assistant

## Overview
Vecto Pilot™ is a rideshare driver assistance platform designed to maximize driver earnings and efficiency. It offers intelligent shift planning, automated trip tracking, earnings analytics, and AI-powered strategic recommendations. The platform integrates an advanced AI assistant layer, "Eidolon," for enhanced workspace intelligence. Its primary goal is to equip rideshare drivers with data-driven insights and real-time strategic support to optimize their work and income. The project aims to leverage advanced AI and a robust, trust-first architecture to deliver reliable and actionable recommendations.

## Recent Changes (Oct 9, 2025)
### Database Tables Wired & User Preferences System ✅
1. **All Tables Connected** - Wired 5 previously empty tables (venue_catalog, venue_metrics, llm_venue_suggestions, places_cache, travel_disruptions) with atomic upsert logic in ranking flow
2. **User Preferences Table** - Created comprehensive `user_preferences` table (separate from auth) for future personalization:
   - **Driver Info**: first_name, last_name, preferred_name, home_address, city, state, assigned_region
   - **Car Details**: year, make, model, color, seatbelt_count
   - **Services**: Uber, Lyft, Private, Ridehail, Other (checkboxes)
   - **Ride Tiers**: Tier 1-5, Planet Friendly, Other (checkboxes with explanations)
   - API endpoints: GET/POST /api/preferences/:userId
3. **GPT-5 Venue Diversity** - Updated planner prompt to spread venues 2-3 min apart (prevents clustering in same complex), single shared staging location
4. **Production Error Fixes** - Fixed TypeScript syntax, database replication lag, venue resolution, action logging FK errors, added bot rate limiting

### Architecture Note
**Schema-First Development**: User preferences table built as placeholder for future customization (e.g., "Hi <Driver>" feature). Does NOT affect authentication or sign-up flow. Demonstrates best practice: build table → document fields → implement features.

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