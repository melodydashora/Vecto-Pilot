# Vecto Pilot™ - Strategic Rideshare Assistant

## Overview
Vecto Pilot™ is a comprehensive rideshare driver assistance platform designed to maximize driver earnings and efficiency. It provides intelligent shift planning, automated trip tracking, earnings analytics, and AI-powered strategic recommendations. The platform integrates an advanced AI assistant layer, "Eidolon," for enhanced workspace intelligence. Its primary goal is to equip rideshare drivers with data-driven insights and real-time strategic support to optimize their work and income. The project aims to provide data-driven insights and real-time strategic support to optimize rideshare drivers' work and income, leveraging advanced AI and a robust, trust-first architecture to deliver reliable and actionable recommendations.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX
The frontend is built with React 18, TypeScript, and Vite 7, featuring a mobile-first design using Radix UI and Tailwind CSS (shadcn/ui). State management is handled by `@tanstack/react-query`, and routing by Wouter. Form handling uses `react-hook-form` with Zod validation. Key design principles include a global header, location context for GPS, and strict TypeScript.

### Technical Implementations
The backend uses Node.js v22.17.0 with Express.js, operating on a multi-server architecture:
- **Gateway Server** (Port 5000): Public-facing, proxies requests, serves React build.
- **Eidolon SDK Server** (Port 3101): Main backend API, business logic, AI assistant.
- **Agent Server** (Port 43717): File system operations, workspace intelligence.

Data is stored in PostgreSQL for ML data and file-based storage for JSON backups. Security measures include token-based authentication, rate limiting, command whitelisting, and Zod validation.

### Feature Specifications
- **Location Services**: Integrates Browser Geolocation API, Google Maps JavaScript API, and H3 geospatial indexing for context snapshots (GPS, geocoded location, timezone, weather, air quality, airport context).
- **AI & Machine Learning (Triad Pipeline)**: A three-stage LLM pipeline (Claude Sonnet 4.5 → GPT-5 → Gemini 2.5 Pro) provides strategic analysis, tactical planning, and JSON validation.
    - **Claude Sonnet 4.5 (Strategist)**: Model `claude-sonnet-4-5-20250929` - Analyzes context, generates strategic overview, pro tips, and earnings estimates.
    - **GPT-5 (Planner)**: Performs deep reasoning for venue selection and timing.
    - **Gemini 2.5 Pro (Validator)**: Validates JSON structure and ensures a minimum number of recommendations.
    - **Triad is single-path ONLY** - No fallbacks in the triad pipeline to ensure consistent quality.
- **Agent Override (Atlas) with Fallback Resilience**: Workspace intelligence layer with fallback chain for operational continuity.
    - **Primary: Atlas (Claude Sonnet 4.5)**: Model `claude-sonnet-4-5-20250929` - Main workspace assistant for file ops, SQL, and diagnostics.
    - **Fallback Chain**: Claude → GPT-5 → Gemini if Anthropic servers fail.
    - **Separate Keys**: Uses AGENT_OVERRIDE_API_KEYC/5/G (different from triad keys).
    - **Endpoint**: `/agent/llm` on Agent Server (Port 43717).
- **Enhanced Memory & Context Awareness**: PostgreSQL-backed persistent memory system for assistant and Eidolon.
    - **Assistant Memory**: Stores user preferences, conversation history, and session state.
    - **Eidolon Memory**: Tracks project state, recent activity, and system context.
    - **Context APIs**: Real-time project summaries, recent snapshots, strategies, and actions.
    - **Automatic Retention**: 365-day retention for preferences, 30-day for conversations, 7-day for sessions.
- **Configuration Management**: Safe file editing capabilities with backup and validation.
    - **Allowed Files**: `.env`, `.env.local`, `.env.example`, config files (Vite, Tailwind, TypeScript, etc.).
    - **Env Updates**: Atomic updates to environment variables with automatic backup.
    - **Config Backup**: Timestamped backups before any modifications.
    - **Safety**: Whitelist-based file access, size limits, and path validation.
- **Trust-First Stack**: Employs a curated venue catalog and a deterministic scoring engine to prevent hallucinations, ranking venues based on proximity, reliability, event intensity, and personalization.
- **ML Instrumentation**: Full logging of rankings, candidates, and user actions for counterfactual learning.
- **Error Handling**: Implements try-catch blocks, circuit breakers for LLM providers, error classification, idempotency, and graceful degradation.
- **Logging**: Uses console logging, structured logging with `logtap`, file logging, and WebSocket streaming for diagnostics.

### System Design Choices
- **Zero Pre-Computed Flags**: Models infer patterns directly from raw context.
- **No Graceful Fallbacks in Triad**: Triad pipeline is single-path only; issues are fixed properly, and complete snapshots are sent.
- **Agent Override Has Fallbacks**: Atlas (Agent Override) uses fallback chain (Claude → GPT-5 → Gemini) for operational resilience.
- **Single Source of Truth**: All model configurations are managed via `.env` variables.
- **100% Variable-Based Data**: All location, time, and weather data are fetched live.
- **Fail-Safe Design**: The system is designed to never crash on API failures, showing clear error messages instead.
- **Mobile-First GPS Precision**: High-accuracy GPS is enabled by default.

## External Dependencies

### AI & Machine Learning
- **Anthropic Claude API**: `@anthropic-ai/sdk`
- **OpenAI API**: `openai`
- **Google Gemini API**: `@google/generative-ai`

### Maps & Location
- **Google Maps JavaScript API**: `@googlemaps/js-api-loader`
- **Google Routes API**: For traffic-aware distance/ETA.
- **Google Places API**: For business hours.
- **OpenWeather API**: For current weather data.
- **H3 Geospatial**: `h3-js`

### UI Component Libraries
- **Radix UI**: Headless primitives.
- **Tailwind CSS**: Utility-first styling.
- **shadcn/ui**: Pre-built components.
- **Lucide React**: Icon library.
- **Recharts**: Data visualization.

### Form & Data Management
- **React Hook Form**: Form state management.
- **Zod**: Runtime validation.
- **@tanstack/react-query**: Server state management.

### Backend Infrastructure
- **Express**: HTTP server.
- **http-proxy-middleware**: Reverse proxy.
- **cors**: Cross-origin resource sharing.
- **express-rate-limit**: API rate limiting.
- **dotenv**: Environment configuration.
- **PostgreSQL**: Database with Drizzle ORM.
- **pg**: PostgreSQL client.

### Deployment Environment
- **Platform**: Replit

## Agent Server Capabilities

### Enhanced Memory System
The agent server now includes comprehensive memory and context awareness:

**Endpoints:**
- `GET /agent/context` - Full project context with recent activity
- `GET /agent/context/summary` - High-level project summary
- `POST /agent/memory/preference` - Save user preferences
- `POST /agent/memory/session` - Save session state
- `POST /agent/memory/project` - Save project state
- `POST /agent/memory/conversation` - Remember conversation topics
- `GET /agent/memory/conversations` - Retrieve recent conversations

**Database Tables:**
- `assistant_memory` - User preferences and conversation history
- `eidolon_memory` - Project state and session tracking

### Configuration Management
Safe file editing with validation and backups:

**Endpoints:**
- `GET /agent/config/list` - List all allowed config files
- `GET /agent/config/read/:filename` - Read config file contents
- `POST /agent/config/env/update` - Update .env variables
- `POST /agent/config/backup/:filename` - Create timestamped backup

**Allowed Configuration Files:**
- `.env`, `.env.local`, `.env.example`
- `drizzle.config.ts`, `vite.config.ts`, `tailwind.config.ts`
- `tsconfig.json`, `package.json`

**Safety Features:**
- Whitelist-based file access
- Automatic backups before modifications
- 10MB file size limit
- Path traversal protection
- Token-based authentication