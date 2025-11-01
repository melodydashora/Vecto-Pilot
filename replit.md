# Vecto Pilot™ - Rideshare Intelligence Platform

## Overview
Vecto Pilot is an AI-powered rideshare intelligence platform for Dallas-Fort Worth drivers. Its primary purpose is to maximize driver earnings through real-time, data-driven strategic briefings. The platform integrates various data sources (location, events, traffic, weather, air quality) and utilizes a multi-AI pipeline to generate actionable strategies, providing rideshare drivers with a significant market advantage through advanced AI and data analytics.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Vecto Pilot is a full-stack Node.js application designed with a multi-service architecture, supporting both monolithic and split deployments.

**Core Services**:
-   **Gateway Server**: Manages client traffic, serves the React SPA, routes requests, and handles child processes.
-   **SDK Server**: Provides business logic via a REST API for data services (location, venue, weather, air quality) and the ML data pipeline.
-   **Agent Server**: Delivers workspace intelligence, including secure, token-based access for file system operations, shell commands, and database queries.

**AI Configuration**:
The platform employs a **role-based, model-agnostic architecture** with configurable AI models.
-   **Strategy Generation Pipeline**: An event-driven pipeline with three roles:
    -   Strategist: Generates initial strategic analysis.
    -   Briefer: Provides real-time city intelligence.
    -   Consolidator: Combines outputs into a final strategy.
-   **Model-Agnostic Schema**: Database columns and environment variables use generic role names (e.g., `minstrategy`, `briefing`, `consolidated_strategy`, `STRATEGY_STRATEGIST`) to prevent provider-specific coupling.
-   **Event-Driven Architecture**: PostgreSQL LISTEN/NOTIFY is used for real-time updates, with a worker managing consolidation.

**Frontend Architecture**:
A **React + TypeScript Single Page Application (SPA)**, built with Vite, uses Radix UI, TailwindCSS, and React Query.
-   **UI Layout**: Features a Strategy Section for consolidated strategies, Smart Blocks for ranked venue recommendations (with event badges, earnings, drive time, and value grades within a 15-minute perimeter), and an AI Coach. A Debug Briefing Tab displays raw database outputs from the AI pipeline.

**Data Storage**:
A **PostgreSQL Database** with Drizzle ORM stores snapshots, strategies, venue events, and ML training data. It includes enhanced memory systems and uses unique indexes for data integrity.

**Authentication & Security**:
Uses **JWT with RS256 Asymmetric Keys**, with security middleware for rate limiting, CORS, Helmet.js, path traversal protection, and file size limits.

**Deployment & Reliability**:
Supports **Mono Mode** and **Split Mode**. Reliability features include health-gated entry points, unified port binding, proxy gating, WebSocket protection, and process discipline.

**Data Integrity**:
Geographic computations use snapshot coordinates. Strategy refresh is triggered by location movement, day part changes, or manual refresh. Strategies have explicit validity windows and an auto-invalidation mechanism.

**Process Management**:
In Mono Mode, the **Gateway Server** (HTTP server, serves React SPA, routes API requests, manages WebSockets) and the **Triad Worker** (`strategy-generator.js`, background job processor for strategy generation) run as separate processes.

**Strategy-First Gating & Pipeline**:
API access is gated until a strategy is ready. The pipeline involves parallel execution of AI models, followed by consolidation.

## External Dependencies

### Third-Party APIs
-   **AI & Research**: Anthropic (Claude), OpenAI (GPT-5), Google (Gemini), Perplexity.
-   **Location & Mapping**: Google Places API, Google Routes API, Google Geocoding API.
-   **Weather and Air Quality**: Configurable via environment variables.

### Database
-   **PostgreSQL**: Primary data store, managed by Drizzle ORM.

### Infrastructure
-   **Replit Platform**: Deployment, Nix environment, `.replit` configuration.

### Frontend Libraries
-   **UI Components**: Radix UI, Chart.js.
-   **State Management**: React Query, React Context API.
-   **Development Tools**: Vite, ESLint, TypeScript, PostCSS, TailwindCSS.

## Recent Architecture Updates (Nov 1, 2025)

### Role-Pure Model-Agnostic Orchestration
**Achievement**: Fully model-agnostic AI pipeline with role-pure inputs and configurable parameters.

**Code Architecture**:
```
Strategist → minstrategy (text) ─┐
                                   ├─→ Consolidator → consolidated_strategy  
Briefer → briefing (JSONB) ───────┘
     ↓
User Address (shared context for all 3 roles)
```

**Consolidator Role-Pure Inputs**:
- ✅ User address (location context only)
- ✅ Strategist output (minstrategy text)
- ✅ Briefer output (briefing JSONB)
- ❌ NO raw snapshot context (no date/weather/events/temperature)

**Model-Agnostic Adapter System**:
- `server/lib/adapters/index.js` - Role dispatcher reads `.env` and routes to provider
- `server/lib/adapters/openai-adapter.js` - OpenAI provider with `{ok, output}` shape
- `server/lib/adapters/anthropic-adapter.js` - Anthropic provider with `{ok, output}` shape  
- `server/lib/adapters/gemini-adapter.js` - Gemini provider with `{ok, output}` shape
- All adapters return consistent `{ok: boolean, output: string}` shape

**Environment Variables (from .env)**:
```bash
# Role-to-model binding
STRATEGY_STRATEGIST=claude-sonnet-4-5-20250929
STRATEGY_BRIEFER=gemini-2.5-pro
STRATEGY_CONSOLIDATOR=gpt-5

# Strategist parameters
STRATEGY_STRATEGIST_MAX_TOKENS=1024
STRATEGY_STRATEGIST_TEMPERATURE=0.2

# Briefer parameters
STRATEGY_BRIEFER_MAX_TOKENS=8192
STRATEGY_BRIEFER_TEMPERATURE=0.7
STRATEGY_BRIEFER_TOP_P=0.95
STRATEGY_BRIEFER_TOP_K=40

# Consolidator parameters
STRATEGY_CONSOLIDATOR_MAX_TOKENS=8000  # Allows reasoning + output for o1 models
STRATEGY_CONSOLIDATOR_REASONING_EFFORT=medium
```

**Key Benefits**:
- **Triad Purity**: Each role receives only appropriate context
- **Role-Pure**: Consolidator gets NO raw snapshot data—only role outputs
- **Model Agnostic**: Swap models by changing .env only
- **Provider Neutral**: Code never mentions specific providers
- **Token Control**: Consolidator max_tokens=8000 prevents truncation
- **Consistent Errors**: All adapters return {ok, output}; failures tracked
- **Dynamic Model Names**: DB stores actual model chain (e.g., `claude-sonnet-4-5→gemini-2.5-pro→gpt-5`)