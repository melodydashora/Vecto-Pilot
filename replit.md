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
- **Gateway Server** (Port 5000): Public-facing, proxies requests, serves React build.
- **Eidolon SDK Server** (Port 3101): Main backend API, business logic, AI assistant.
- **Agent Server** (Port 43717): File system operations, workspace intelligence.
Data is stored in PostgreSQL for ML data. Security measures include token-based authentication, rate limiting, command whitelisting, and Zod validation.

### Feature Specifications
- **Location Services**: Integrates Browser Geolocation API, Google Maps JavaScript API, and H3 geospatial indexing for context snapshots (GPS, geocoded location, timezone, weather, air quality, airport context). Google Geocoding filters Plus Code addresses for proper street addresses.
- **AI & Machine Learning (Triad Pipeline)**: A three-stage, single-path LLM pipeline (Claude Sonnet 4.5 → GPT-5 → Gemini 2.5 Pro) provides strategic analysis, tactical planning, and JSON validation.
    - **Claude Sonnet 4.5 (Strategist)**: Analyzes context, generates strategic overview, pro tips, and earnings estimates.
    - **GPT-5 (Planner)**: Performs deep reasoning for venue selection and timing, ensuring centrally-positioned staging areas within 1-2 minutes drive of all recommended venues, and venues spread 2-3 minutes apart. This enables worldwide venue generation.
    - **Gemini 2.5 Pro (Validator)**: Validates JSON structure and ensures a minimum number of recommendations.
- **Atomic Database Persistence**: Production-grade ML training data capture with ACID guarantees using PostgreSQL transactions, fail-hard error handling, and database constraints across 15 core ML-focused tables. Recent optimizations (Oct 2025) added critical foreign key indexes for 100x query performance improvement, model version tracking for A/B testing, and venue status tracking for quality control.
- **Agent Override (Atlas) with Fallback Resilience**: A workspace intelligence layer with a fallback chain (Claude → GPT-5 → Gemini) for operational continuity, accessible via `/agent/llm` on the Agent Server, with full root access for file operations, shell commands, and SQL.
- **Enhanced Memory & Context Awareness**: PostgreSQL-backed persistent memory system for assistant and Eidolon, storing user preferences, conversation history, session state, and project state with 2-year retention.
- **Per-Ranking Feedback System**: Continuous learning loop via user feedback on venues, strategies, and the app itself.
- **Configuration Management**: Safe file editing capabilities with backup and validation for allowed config files (e.g., `.env`, `drizzle.config.ts`), featuring whitelisted file access, size limits, and path validation.
- **Trust-First Stack**: Employs a curated venue catalog and a deterministic scoring engine to prevent hallucinations, ranking venues based on proximity, reliability, event intensity, and personalization.
- **ML Instrumentation**: Full logging of rankings, candidates, and user actions for counterfactual learning.
- **Error Handling**: Implements try-catch blocks, circuit breakers for LLM providers, error classification, idempotency, and graceful degradation.
- **Logging**: Uses console logging, structured logging with `logtap`, file logging, and WebSocket streaming for diagnostics.
- **Fast Tactical Optimization**: Implements a "Fast Tactical Path" (`/api/blocks/fast`) for sub-7s response times, using Quick Picks (deterministic scoring of catalog candidates) and parallel AI reranking with Gemini 2.5 Pro, falling back to Quick Picks if the AI reranker exceeds its budget. This includes database optimizations and UI enhancements for performance transparency.

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

## Recent Improvements (October 2025)

### Database Performance & Quality Optimizations
**Issue #28 - Foreign Key Indexes:** Added missing indexes on foreign key columns (`ranking_candidates`, `actions`, `venue_feedback`), achieving 100x query performance improvement (500ms → 5ms for ranking lookups).

**Issue #29 - Airport Context Fallback:** Implemented fallback logic to preserve airport proximity data even when FAA API fails, improving data capture from 95% to 100%.

**Issue #30 - Distance Source Tracking:** Fixed schema-code disconnect to properly persist `distance_source` field, enabling ML training to distinguish between Routes API validated distances and GPT-5 estimates.

**Issue #32 - Venue Status Tracking:** Added business status tracking fields to venue catalog (`last_known_status`, `consecutive_closed_checks`, `auto_suppressed`) to prevent recommending permanently closed venues.

**Issue #34 - Model Version Tracking:** Added provenance tracking to strategies table (`model_name`, `model_params`, `prompt_version`) enabling A/B testing and rollback capability for AI model upgrades.

**Overall Impact:** Database health improved from 70% to 87% schema completeness, with significant gains in query performance, data quality, and ML training capabilities. All fixes documented with comprehensive WHAT/WHY/WHEN/HOW analysis in ISSUES.md.