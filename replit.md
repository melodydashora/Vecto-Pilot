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
-   **UI Layout**: Features a Strategy Section for consolidated strategies, Smart Blocks for ranked venue recommendations (with event badges, earnings, drive time, and value grades within a 15-minute perimeter), and an AI Strategy Coach with full data access. A Rideshare Briefing Tab displays practical intelligence organized by topic.

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

## Recent Changes (Nov 2, 2025)

### Co-Pilot Page Restructure
**Problem**: AI Strategy Coach was duplicating consolidated strategy; Events/Traffic/Holidays showing as "Unknown" counts instead of detailed data.

**Changes Made**:
1. **Removed StrategyCoach component** - was just displaying consolidated strategy text again
2. **Moved AI Strategy Coach** - Now uses CoachChat (GPT-5 chat interface) positioned after Consolidated Strategy
3. **Removed SmartBlocks component from Co-Pilot** - Events/Traffic/Holidays/News cards moved to Briefing tab
4. **New Co-Pilot Layout**:
   - Header
   - Holiday Banner (if holiday exists)
   - Consolidated Strategy (with loading bar)
   - **AI Strategy Coach** (GPT-5 chat for deeper questions and guidance)
   - **Smart Blocks** (location cards with navigation buttons)

**Result**: 
- AI Strategy Coach is now a separate chat interface, not a duplicate of consolidated strategy
- Detailed briefing data (Events/Traffic/Holidays/News) properly displayed on Briefing tab
- Clean separation of concerns: Co-Pilot for strategy & navigation, Briefing for raw AI outputs

## Recent Fixes (Nov 2, 2025)

### Timezone/DST Bug Fixed
**Problem**: Strategy output was showing wrong day of week (Saturday instead of Sunday) due to timezone/DST conversion issues.

**Root Cause**: Using `toLocaleString()` + `new Date()` doesn't preserve timezone properly, causing DST offset errors.

**Solution**: Use `Intl.DateTimeFormat` with proper timezone option to extract day of week in user's local timezone.

**Result**: Strategies now show correct day of week and temporal context.

### AI Coach Temporal Context
**Problem**: AI Coach was missing temporal context, providing generic advice without knowing current day/time.

**Solution**: Enhanced coach chat endpoint to receive complete temporal data:
- Day of week (Sunday, Monday, etc.)
- Weekend flag
- Full timestamp
- Day part (morning, afternoon, etc.)

**Result**: AI Coach now provides time-aware guidance based on actual day and time.

### Holiday Banner Immediate Display
**Problem**: Holiday banner waited for full strategy generation (30-60s) instead of appearing immediately.

**Root Cause**: `getStrategyFast` only returned holiday data when status was 'ok', not during 'pending' status.

**Solution**: Modified `server/routes/blocks-fast.js` to include holiday data in 'pending' responses, allowing UI to display banner as soon as Perplexity check completes (1-2s).

**Result**: 
- Holiday banners now appear within 1-2 seconds
- Beautiful early feedback during strategy generation
- Users see immediate activity while AI processes

### Briefing Page Restructure
**Problem**: Page showed "raw AI outputs" with technical language, not user-friendly.

**Solution**: Restructured BriefingPage.tsx from technical debug view to practical "Rideshare Briefing":
- **Rideshare News** - Industry news and alerts
- **Local Traffic** - Traffic conditions and delays
- **Local Events** - Events and holidays (combined)
- **Airport Conditions** - FAA data (moved to bottom)
- Removed: Strategist Output (already shown on Co-Pilot as consolidated strategy)

**Result**: 
- Clean, user-friendly layout focused on practical rideshare intelligence
- Better organization by topic instead of AI pipeline stage
- Removed all technical AI/model references from UI

### AI Coach Data Access Layer (CoachDAL)
**Implementation**: Created read-only Data Access Layer for AI Strategy Coach with snapshot-scoped access.

**Access Contract**:
- **Read-Only**: Coach consumes data only, never mutates
- **Snapshot-Scoped**: All reads scoped by user_id and snapshot_id
- **Null-Safe**: Missing data returns null/"pending" states, not errors
- **Temporal Alignment**: Trusts snapshot day/time as ground truth

**Data Sources** (via `server/lib/coach-dal.js`):
- `getHeaderSnapshot()` - Timezone, DST, day-of-week, day-part, location display
- `getLatestStrategy()` - Consolidated strategy, timestamps, context day
- `getBriefing()` - Events, traffic, news, holidays from strategy.briefing JSONB
- `getSmartBlocks()` - Location cards with navigation metadata from ranking_candidates
- `getCompleteContext()` - Combined snapshot + strategy + briefing + blocks
- `formatContextForPrompt()` - Null-safe formatting with clear "pending" states

**Tables with Read Access**:
- `snapshots` - Location context, weather, air quality, airports
- `strategies` - Consolidated strategy, holiday, briefing JSONB
- `ranking_candidates` - Smart blocks (venue recommendations)
- `rankings` - Ranking metadata

**Result**:
- AI Coach has complete visibility into driver context
- Temporal awareness (day of week, exact time, weekend flag)
- Rich context includes strategy, briefing data, and venue recommendations
- Graceful handling of pending/missing data states