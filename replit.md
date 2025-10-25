# Vecto Pilot™ - Strategic Rideshare Assistant

## Overview
Vecto Pilot™ is a rideshare driver assistance platform designed to maximize driver earnings and efficiency. It provides intelligent shift planning, automated trip tracking, earnings analytics, and AI-powered strategic recommendations. The platform integrates an advanced AI assistant layer, "Eidolon," for enhanced workspace intelligence. Its primary goal is to equip rideshare drivers with data-driven insights and real-time strategic support to optimize their work and income. The project aims to leverage advanced AI and a robust, trust-first architecture to deliver reliable and actionable recommendations. Vecto Pilot™ is designed to work worldwide, providing recommendations based on real-time context regardless of pre-existing venue catalogs.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX
The frontend is built with React 18, TypeScript, and Vite 7, utilizing a mobile-first design with Radix UI and Tailwind CSS (shadcn/ui). State management uses `@tanstack/react-query`, and routing is handled by Wouter. Form handling employs `react-hook-form` with Zod validation. Key design principles include a global header, location context for GPS, and strict TypeScript. Loading states feature animated skeleton cards and clear messaging during AI processing.

### Technical Implementations
The backend uses Node.js v22.17.0 with Express.js, operating on a multi-server architecture:
- **Gateway Server**: Public-facing, proxies requests, serves React build.
- **Eidolon SDK Server**: Main backend API, business logic, AI assistant.
- **Agent Server**: File system operations, workspace intelligence.
Data is stored in PostgreSQL 17.5 (Neon) for ML data. Security measures include Row Level Security (RLS) with 30+ policies protecting all 19 tables, session-variable based access control, token-based authentication, rate limiting, command whitelisting, and Zod validation. RLS provides defense-in-depth with user-scoped, system-scoped, and public-read policies.

### Feature Specifications
- **Location Services**: Integrates Browser Geolocation API, Google Maps JavaScript API, and H3 geospatial indexing for context snapshots (GPS, geocoded location, timezone, weather, air quality, airport context).
- **AI & Machine Learning (Triad Pipeline)**: A three-stage, single-path LLM pipeline (Claude Sonnet 4.5 → GPT-5 → Gemini 2.5 Pro) provides strategic analysis, tactical planning, and JSON validation. GPT-5 performs deep reasoning for venue selection and timing, enabling worldwide venue generation.
- **Enhanced Memory & Context (Wired)**: Fully integrated middleware-based memory system with ThreadContextManager for per-request context enrichment, cross-thread memory storage (recentPaths, events), agent memory persistence (request counters, route tracking), and diagnostics endpoints (`/diagnostics/memory`, `/diagnostics/prefs`, `/diagnostics/session`, `/diagnostics/conversations`, `/diagnostics/remember`) for agent introspection. Memory persisted to PostgreSQL with 7-730 day retention policies.
- **Atomic Database Persistence**: Production-grade ML training data capture with ACID guarantees using PostgreSQL transactions, fail-hard error handling, and database constraints. Includes critical foreign key indexes for query performance, model version tracking, and venue status tracking.
- **Agent Override (Atlas) with Fallback Resilience**: A workspace intelligence layer with a fallback chain (Claude → GPT-5 → Gemini) for operational continuity, accessible via `/agent/llm` on the Agent Server, with full root access for file operations, shell commands, and SQL.
- **Per-Ranking Feedback System**: Continuous learning loop via user feedback on venues, strategies, and the app itself.
- **Configuration Management**: Safe file editing capabilities with backup and validation for allowed config files with whitelisted file access, size limits, and path validation.
- **Trust-First Stack**: Employs a curated venue catalog and a deterministic scoring engine to prevent hallucinations, ranking venues based on proximity, reliability, event intensity, and personalization.
- **ML Instrumentation**: Full logging of rankings, candidates, and user actions for counterfactual learning.
- **Error Handling**: Implements try-catch blocks, circuit breakers for LLM providers, error classification, idempotency, and graceful degradation.
- **Logging**: Uses console logging, structured logging with `logtap`, file logging, and WebSocket streaming for diagnostics.
- **Fast Tactical Optimization**: Implements a "Fast Tactical Path" (`/api/blocks/fast`) for sub-7s response times, using Quick Picks (deterministic scoring of catalog candidates) and parallel AI reranking with Gemini 2.5 Pro.

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
- **Single-Model Triad (GPT-5)**: All three stages (strategist, planner, validator) use GPT-5 exclusively.
- **Model-Agnostic UI**: Frontend never displays provider/model names; uses abstract labels like "AI Strategist".
- **No Venue Polling Until Planning Completes**: Catalog endpoints are gated; venues only fetched after triad finishes.
- **Event-Driven Status Polling**: Light polling (5s) for job status, not aggressive venue catalog requests.
- **Capability-Based UX**: Tooltips and labels describe capabilities ("high-context strategist"), not brands.

## Recent Updates (October 25, 2025)

### Database Security Hardening
- **RLS Implementation**: All 19 database tables now protected with Row Level Security (RLS)
- **Policy Coverage**: 30+ policies enforce user-scoped, system-scoped, and public-read access patterns
- **Session Variables**: Database queries set `app.user_id` for automatic row filtering
- **Defense-in-Depth**: Multi-layered security (application + database + network)
- **Migration**: `003_rls_security.sql` implements complete RLS framework
- **Memory Tables Fixed**: Resolved schema mismatches in assistant_memory, eidolon_memory, cross_thread_memory, and agent_memory
- **Thread Context**: Fixed "column 'key' does not exist" error by updating agent_memory queries
- **Documentation**: Created `RLS_SECURITY_IMPLEMENTATION.md` with complete security architecture

### Database Status
- **Provider**: Neon PostgreSQL 17.5 (AWS us-west-2)
- **Connection**: Pooled connection with TCP keepalive and safe idle timeouts
- **Tables**: 19 tables with 200+ columns covering GPS, AI strategies, venues, feedback, and memory
- **Security**: Full RLS protection on all tables, ready for multi-tenant authentication
- **Performance**: Shared connection pool (max 10, min 2) with automatic recycling

## External Dependencies

### AI & Machine Learning
- **Anthropic Claude API**
- **OpenAI API**
- **Google Gemini API**

### Maps & Location
- **Google Maps JavaScript API**
- **Google Routes API**
- **Google Places API**
- **OpenWeather API**
- **H3 Geospatial**

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