
# LEXICON.md

**Vecto Pilot Terminology & Codebase Reference**

This document defines the core terminology used throughout Vecto Pilot and maps each concept to its implementation in the codebase.

---

## 🤖 AI & Intelligence Systems

### Agent (Atlas Agent)
**What it is:** Workspace intelligence layer providing secure file system operations, shell commands, and database access.

**Key Characteristics:**
- Token-based authentication
- Unrestricted shell command execution
- Direct database access (DDL/DML)
- File system operations (read/write/delete)

**Codebase Files:**
- `agent-server.js` - Main HTTP server (port 43717)
- `server/agent/index.ts` - TypeScript implementation
- `server/agent/embed.js` - Gateway integration
- `server/agent/routes.js` - API route definitions
- `server/agent/agent-override-llm.js` - AI model integration (Claude/GPT-5/Gemini fallback chain)
- `server/agent/context-awareness.js` - Memory and project context
- `server/agent/enhanced-context.js` - Deep workspace analysis
- `server/agent/thread-context.js` - Conversation threading
- `server/agent/config-manager.js` - Configuration file management

**Environment Variables:**
- `AGENT_PORT` (default: 43717)
- `AGENT_TOKEN` - Bearer auth token
- `AGENT_SHELL_WHITELIST` - Allowed shell commands
- `AGENT_OVERRIDE_API_KEY_C` - Claude API key
- `AGENT_OVERRIDE_API_KEY_5` - GPT-5 API key
- `AGENT_OVERRIDE_API_KEY_G` - Gemini API key

**API Endpoints:**
- `/agent/healthz` - Health check
- `/agent/fs/read` - Read file contents
- `/agent/fs/write` - Write file contents
- `/agent/shell` - Execute shell commands
- `/agent/sql/query` - Read-only SQL queries
- `/agent/sql/execute` - DML/DDL operations
- `/agent/context` - Project context
- `/agent/memory/*` - Memory operations

**Memory Tables:**
- `agent_memory` - Session state tracking
- `agent_changes` - File modification audit log

---

### Eidolon (Enhanced SDK)
**What it is:** Project and session state management system with snapshot capabilities.

**Key Characteristics:**
- Cross-chat awareness
- Workspace intelligence
- Predictive intelligence
- MCP diagnostics
- Code map generation

**Codebase Files:**
- `server/eidolon/index.ts` - Main export point
- `server/eidolon/core/code-map.ts` - Workspace code analysis
- `server/eidolon/core/context-awareness.ts` - Project context
- `server/eidolon/core/memory-enhanced.ts` - Enhanced memory system
- `server/eidolon/core/memory-store.ts` - JSON-based persistence
- `server/eidolon/core/deep-thinking-engine.ts` - Advanced reasoning
- `server/eidolon/core/deployment-tracker.ts` - Deployment monitoring
- `server/eidolon/policy-loader.js` - Policy enforcement
- `server/eidolon/policy-middleware.js` - Request validation
- `server/eidolon/memory/pg.js` - PostgreSQL adapter
- `server/eidolon/memory/compactor.js` - Memory optimization

**Environment Variables:**
- `EIDOLON_PORT` or `SDK_PORT` (default: 3102)
- `DISABLE_SPAWN_SDK` - Prevent auto-spawning SDK server

**Memory Tables:**
- `eidolon_memory` - Project state storage
- `eidolon_snapshots` - State snapshots

**Configuration:**
- `config/eidolon-policy.json` - Access control policy

---

### Assistant (Replit Assistant Override)
**What it is:** Persistent conversation history and user preference system.

**Key Characteristics:**
- User-scoped memory
- Conversation threading
- Preference tracking
- Policy-based access control

**Codebase Files:**
- `server/gateway/assistant-proxy.ts` - Request proxy layer
- `server/assistant-events.ts` - Event streaming
- `server/eidolon/policy-middleware.js` - Policy enforcement (shared with Eidolon)

**Memory Tables:**
- `assistant_memory` - Conversation history and user preferences

**Configuration:**
- `config/assistant-policy.json` - Access control policy

**Related Files:**
- `tools/research/THREAD_AWARENESS_README.md` - Thread system documentation

---

### AI Strategy Coach (Multi-Model System)
**What it is:** Real-time strategic analysis system using multiple AI models in a waterfall pipeline.

**Key Characteristics:**
- Three-stage pipeline (Claude → GPT-5 → Gemini)
- Real-time event analysis
- Venue recommendations
- Tactical planning

**Codebase Files:**
- `server/api/chat/chat.js` - Chat interface endpoint
- `server/lib/ai/providers/coach-dal.js` - Data access layer
- `client/src/components/CoachChat.tsx` - UI component
- `server/api/chat/chat-context.js` - Context builder
- `server/lib/strategy-generator.js` - Pipeline orchestrator
- `server/lib/triad-orchestrator.js` - Three-stage coordinator
- `strategy-generator.js` - Background worker process

**API Endpoints:**
- `/api/chat` - Chat interface
- `/api/chat/context` - Context snapshot
- `/api/chat/history` - Conversation history

**Related Documentation:**
- `COACH_DATA_ACCESS.md` - Data access patterns

---

## 🧠 LLM (Large Language Models)

### LLM Router
**What it is:** Multi-provider AI model routing system with hedging, circuit breakers, and fallback chains.

**Codebase Files:**
- `server/lib/ai/llm-router-v2.js` - Enhanced router with strict budget control
- `server/lib/ai/llm-router.js` - Original router implementation
- `server/lib/ai/model-retry.js` - Retry logic
- `server/lib/ai/transient-retry.js` - Transient failure handling

**Supported Providers:**
- Anthropic (Claude)
- OpenAI (GPT-5)
- Google (Gemini)

**Configuration:**
- `LLM_TOTAL_BUDGET_MS` (default: 8000ms) - Total request timeout
- `LLM_PRIMARY_TIMEOUT_MS` (default: 1200ms) - Hedging delay
- `PREFERRED_MODEL` - Primary model selection
- `FALLBACK_MODELS` - Fallback model chain
- `CIRCUIT_ERROR_THRESHOLD` (default: 5) - Circuit breaker threshold
- `CIRCUIT_COOLDOWN_MS` (default: 60000ms) - Breaker reset time

---

### Model Adapters
**What it is:** Provider-specific API clients with unified interface.

**Codebase Files:**
- `server/lib/ai/adapters/anthropic-adapter.js` - Claude adapter
- `server/lib/ai/adapters/openai-adapter.js` - GPT-5 adapter
- `server/lib/ai/adapters/gemini-adapter.js` - Gemini adapter
- `server/lib/ai/adapters/perplexity-adapter.js` - Perplexity research adapter

**Specialized Adapters:**
- `server/lib/ai/adapters/anthropic-sonnet45.js` - Claude Sonnet 4.5
- `server/lib/ai/adapters/openai-gpt5.js` - GPT-5 specific
- `server/lib/ai/adapters/gemini-2.5-pro.js` - Gemini 2.5 Pro

**Adapter Interface:**
```javascript
{ ok: boolean, output: string, error?: string }
```

---

### AI Pipeline Roles
**What it is:** Canonical role names for AI capabilities following `{TABLE}_{FUNCTION}` convention. Code references ROLES, not model names - models are swappable via environment variables.

**Naming Convention:** `{TABLE}_{FUNCTION}`
- `BRIEFING_*` - Roles that populate the `briefings` table
- `STRATEGY_*` - Roles that populate the `strategies` table
- `VENUE_*` - Roles that populate `ranking_candidates` (Venue Candidates)
- `COACH_*` - Roles that populate `coach_conversations`
- `UTIL_*` - Utility roles for validation/parsing (no direct DB write)

**Role Registry:**

| Role | Purpose | Env Variable | Default Model |
|------|---------|--------------|---------------|
| **BRIEFINGS TABLE** ||||
| `BRIEFING_WEATHER` | Weather intelligence with web search | `BRIEFING_WEATHER_MODEL` | gemini-3-pro |
| `BRIEFING_TRAFFIC` | Traffic conditions analysis | `BRIEFING_TRAFFIC_MODEL` | gemini-3-flash |
| `BRIEFING_NEWS` | Local news research | `BRIEFING_NEWS_MODEL` | gemini-3-pro |
| `BRIEFING_EVENTS_DISCOVERY` | Event discovery (parallel category search) | `BRIEFING_EVENTS_MODEL` | gemini-3-pro |
| `BRIEFING_EVENTS_VALIDATOR` | Event schedule verification | `BRIEFING_VALIDATOR_MODEL` | claude-opus-4.5 |
| `BRIEFING_FALLBACK` | General fallback for failed briefing calls | `BRIEFING_FALLBACK_MODEL` | claude-opus-4.5 |
| **STRATEGIES TABLE** ||||
| `STRATEGY_CORE` | Core strategic plan generation | `STRATEGY_CORE_MODEL` | claude-opus-4.5 |
| `STRATEGY_CONTEXT` | Real-time context gathering | `STRATEGY_CONTEXT_MODEL` | gemini-3-pro |
| `STRATEGY_TACTICAL` | Immediate 1-hour tactical strategy | `STRATEGY_TACTICAL_MODEL` | gpt-5.2 |
| `STRATEGY_DAILY` | Long-term 8-12hr daily strategy | `STRATEGY_DAILY_MODEL` | gemini-3-pro |
| **RANKING_CANDIDATES TABLE** ||||
| `VENUE_SCORER` | Venue Candidate scoring | `VENUE_SCORER_MODEL` | gpt-5.2 |
| `VENUE_FILTER` | Fast low-cost venue filtering | `VENUE_FILTER_MODEL` | claude-haiku |
| `VENUE_TRAFFIC` | Venue-specific traffic intelligence | `VENUE_TRAFFIC_MODEL` | gemini-3-pro |
| **COACH_CONVERSATIONS TABLE** ||||
| `COACH_CHAT` | AI Strategy Coach conversation | `COACH_CHAT_MODEL` | gemini-3-pro |
| **UTILITIES** ||||
| `UTIL_WEATHER_VALIDATOR` | Validate weather data structure | `UTIL_WEATHER_VALIDATOR_MODEL` | gemini-3-pro |
| `UTIL_TRAFFIC_VALIDATOR` | Validate traffic data structure | `UTIL_TRAFFIC_VALIDATOR_MODEL` | gemini-3-pro |
| `UTIL_MARKET_PARSER` | Parsing unstructured market research | `UTIL_PARSER_MODEL` | gpt-5.2 |

**Usage Pattern:**
```javascript
import { callModel } from './lib/ai/adapters/index.js';

// NEW: Use {TABLE}_{FUNCTION} role names
const result = await callModel('STRATEGY_CORE', { system, user });
const filtered = await callModel('VENUE_FILTER', { system, user });
const events = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user });

// LEGACY (still works via automatic mapping):
const result = await callModel('strategist', { system, user });  // → STRATEGY_CORE
const filtered = await callModel('consolidator', { system, user });  // → STRATEGY_TACTICAL
```

**Legacy Role Mapping:**
| Legacy Name | Maps To |
|-------------|---------|
| `strategist` | `STRATEGY_CORE` |
| `briefer` | `STRATEGY_CONTEXT` |
| `consolidator` | `STRATEGY_TACTICAL` |
| `event_validator` | `BRIEFING_EVENTS_VALIDATOR` |
| `venue_planner` | `VENUE_SCORER` |
| `venue_filter` | `VENUE_FILTER` |
| `coach` | `COACH_CHAT` |

**Key Principles:**
1. Role names indicate **output destination** (table) + **function**
2. Code references **ROLES**, never model names
3. Model assignments are **configuration** (env vars)
4. Adapters folder is the only place model names appear in code
5. Legacy role names are supported but deprecated

**Codebase Files:**
- `server/lib/ai/model-registry.js` - Canonical role definitions with `{TABLE}_{FUNCTION}` convention
- `server/lib/ai/adapters/index.js` - Role dispatcher with legacy support

---

### Model Dictionary
**What it is:** Reference catalog of model configurations (for documentation purposes).

**Codebase Files:**
- `server/lib/ai/models-dictionary.js` - JavaScript implementation
- `agent-ai-config.js` - Gateway AI configuration

**Note:** The authoritative source for role→model mapping is `model-registry.js`, not this dictionary.

**Documentation:**
- `MODEL.md` - Model capabilities and parameters
- `tools/research/MODEL_UPDATE_TEMPLATE.md` - Update workflow

---

## 📡 APIs & Services

### Google Places API
**What it is:** Venue enrichment service providing business details, hours, and coordinates.

**Codebase Files:**
- `server/lib/venue/places-cache.js` - Caching layer
- `server/lib/venue/places-hours.js` - Business hours calculation
- `server/lib/venue/venue-enrichment.js` - Main enrichment logic

**Environment Variables:**
- `GOOGLE_PLACES_API_KEY` - API key
- `PLACES_API_CACHE_TTL` - Cache expiration (default: 86400s)

**Database Tables:**
- `places_cache` - Cached API responses

---

### Google Routes API
**What it is:** Real-time distance and drive time calculation service.

**Codebase Files:**
- `server/lib/location/routes-api.js` - API client
- `server/lib/location/driveTime.js` - Legacy implementation

**Features:**
- Traffic-aware routing
- Multiple route alternatives
- Polyline encoding

---

### Google Geocoding API
**What it is:** Address resolution and reverse geocoding service.

**Codebase Files:**
- `server/lib/location/geocoding.js` - Main implementation
- `server/api/location/geocode-proxy.js` - HTTP proxy endpoint

**API Endpoints:**
- `/api/geocode/reverse` - Coordinates → address
- `/api/geocode/forward` - Address → coordinates

---

### Weather & Air Quality APIs
**What it is:** Environmental data providers (OpenWeatherMap, Google Air Quality).

**Codebase Files:**
- `server/api/location/location.js` - Location/weather/air quality resolver
- `client/src/contexts/location-context-clean.tsx` - Client-side location context

**API Endpoints:**
- `/api/location/resolve` - Unified location/weather/air quality

---

### FAA ASWS (Aviation System Status)
**What it is:** Airport delay and disruption data service.

**Codebase Files:**
- `server/lib/external/faa-asws.js` - API client
- `server/api/venue/venue-events.js` - Event integration

**Database Tables:**
- `travel_disruptions` - Airport status cache

---

### Perplexity Research API
**What it is:** AI-powered research engine for event discovery.

**Codebase Files:**
- `server/lib/external/perplexity-research.js` - Research orchestrator
- `server/lib/external/perplexity-event-prompt.js` - Prompt templates
- `server/lib/ai/adapters/perplexity-adapter.js` - API adapter

**Environment Variables:**
- `PERPLEXITY_API_KEY` - API key
- `PERPLEXITY_MODEL` (default: 'sonar-pro')

---

### Venue Intelligence API
**What it is:** Event-aware venue recommendation system.

**Codebase Files:**
- `server/lib/venue/venue-intelligence.js` - Intelligence engine
- `server/lib/venue/venue-discovery.js` - Venue discovery
- `server/lib/venue/venue-event-research.js` - Event research
- `server/lib/venue/venue-event-verifier.js` - Event validation
- `server/api/venue/venue-intelligence.js` - HTTP endpoints

**API Endpoints:**
- `/api/venues/intelligence` - Smart recommendations
- `/api/venues/events` - Event-specific analysis

---

## 🏗️ Architecture Components

### Gateway Server
**What it is:** Main HTTP server routing requests to SDK/Agent services.

**Codebase Files:**
- `gateway-server.js` - Main entry point
- `server/middleware/*` - Request middleware
- `server/api/health/health.js` - Health endpoints

**Port:** 5000 (default)

**Modes:**
- `mono` - All services in one process
- `split` - Separate SDK/Agent processes

**Environment Variables:**
- `APP_MODE` (default: 'mono')
- `DISABLE_SPAWN_SDK` - Prevent SDK auto-spawn
- `DISABLE_SPAWN_AGENT` - Prevent Agent auto-spawn

---

### SDK Server (Embedded)
**What it is:** Business logic and data services layer.

**Codebase Files:**
- `sdk-embed.js` - Express router factory
- `server/api/*` - API route handlers (domain-organized)

**API Prefix:** `/api` (default)

**Key Routes (by domain):**
- `/api/strategy/blocks-fast` - Smart blocks generation
- `/api/briefing/*` - Events, traffic, news
- `/api/auth/*` - Authentication
- `/api/location/*` - Location resolution

---

### Strategy Generator (Background Worker)
**What it is:** Asynchronous AI pipeline processor.

**Codebase Files:**
- `strategy-generator.js` - Worker entry point
- `server/lib/strategy/strategy-generator.js` - Pipeline logic
- `server/lib/strategy/triad-orchestrator.js` - Three-stage coordinator

**Process Management:**
- Spawned by Gateway in mono mode
- Listens for `strategy_trigger` database notifications
- Auto-restarts on failure

---

### Database Connection Pool
**What it is:** Shared PostgreSQL connection manager.

**Codebase Files:**
- `server/db/pool.js` - Shared pool instance
- `server/db/connection-manager.js` - Health monitoring
- `server/db/pool-lazy.js` - Lazy initialization

**Environment Variables:**
- `DATABASE_URL` - Production database
- `DEV_DATABASE_URL` - Development database
- `DB_POOL_MIN` (default: 2)
- `DB_POOL_MAX` (default: 10)

**Tables:** See `scripts/create-all-tables.sql`

---

## 📊 Data Pipeline

### Smart Blocks (Intelligence Modules)
**What it is:** Modular units of contextual market data (Traffic, Events, Weather, News) used to inform strategy. These are the **inputs** to the decision process.

**⚠️ NOT to be confused with:** Venue Candidates (see below) - which are the **outputs**.

**Codebase Files:**
- `server/lib/strategy/content-blocks.js` - Block generation
- `server/api/strategy/blocks-fast.js` - HTTP endpoint (pipeline trigger)
- `client/src/components/SmartBlocksStatus.tsx` - Pipeline status UI
- `client/src/components/_future/SmartBlocks.tsx` - Renders briefing blocks (Events, Traffic, News)

**What Smart Blocks ARE:**
- Traffic intelligence blocks
- Event discovery blocks
- Weather condition blocks
- News/disruption blocks

**What Smart Blocks are NOT:**
- Specific bar or restaurant locations (those are Venue Candidates)
- The "Upscale Bars" list in BarTab.tsx (that's Venue Intelligence output)

---

### Venue Candidates (Tactical Opportunities)
**What it is:** Specific high-value locations (Bars, Restaurants, Staging Areas) identified as tactical opportunities. These are the **outputs** of the Venue Intelligence system.

**Codebase Files:**
- `server/lib/venue/venue-intelligence.js` - Discovery engine (Google Places API)
- `server/lib/venue/enhanced-smart-blocks.js` - Venue scoring and ranking
- `client/src/components/BarsTable.tsx` - "Late Night Hotspots" UI display
- `client/src/components/BarTab.tsx` - "Upscale Bars" driver UI

**Database Tables:**
- `ranking_candidates` - Scored venue recommendations linked to a strategy
- `venue_catalog` - Persistent library of all known venues

**Key Distinction:**
| Term | Meaning | Example |
|------|---------|---------|
| Smart Block | Intelligence input | "Traffic is heavy on I-35" |
| Venue Candidate | Tactical output | "Concrete Cowboy bar, $$$, 2.3 mi away" |

**API Endpoints:**
- `GET /api/venues/nearby` - Discover nearby venues
- `POST /api/blocks-fast` - Generate venue recommendations
- `GET /api/blocks-fast?snapshot_id=<id>` - Fetch venue results

---

### Strategy Pipeline (Three-Stage Waterfall)
**What it is:** Claude → GPT-5 → Gemini AI pipeline for strategic analysis.

**Stages:**
1. **Claude Strategist** - Strategic overview (4000 tokens)
2. **GPT-5 Tactical Planner** - Venue recommendations (JSON schema)
3. **Gemini Validator** - Enrichment and validation

**Codebase Files:**
- `server/lib/ai/providers/minstrategy.js` - Claude strategist
- `server/lib/strategy/planner-gpt5.js` - GPT-5 planner
- `server/lib/strategy/validator-gemini.js` - Gemini validator

**Documentation:**
- `ARCHITECTURE.md` - Pipeline architecture (sections 1-9)

---

### Event Research Pipeline
**What it is:** Perplexity-powered event discovery and verification.

**Codebase Files:**
- `server/lib/external/perplexity-research.js` - Research orchestrator
- `server/lib/venue/venue-event-research.js` - Venue-specific research
- `server/lib/venue/venue-event-verifier.js` - Verification logic

**Database Tables:**
- `venue_events` - Discovered events
- `event_research_log` - Research audit trail

---

## 🔐 Security & Authentication

### JWT (JSON Web Tokens)
**What it is:** User authentication token system.

**Codebase Files:**
- `server/lib/jwt.ts` - Token generation/validation
- `server/middleware/auth.ts` - Auth middleware
- `scripts/make-jwks.mjs` - JWKS generation
- `scripts/sign-token.mjs` - Token signing utility

**Environment Variables:**
- `JWT_SECRET` - Token signing secret (required)

**Public Key:**
- `public/.well-known/jwks.json` - JSON Web Key Set

---

### RLS (Row Level Security)
**What it is:** Database-level user data isolation.

**Codebase Files:**
- `server/db/rls-middleware.js` - RLS enforcement
- `migrations/003_rls_security.sql` - RLS policies

**Helper Functions:**
- `current_user_id()` - Extract user ID from JWT
- `is_admin()` - Admin privilege check

---

## 📍 Location & GPS

### Location Context
**What it is:** Unified GPS, weather, and air quality state manager.

**Codebase Files:**
- `client/src/contexts/location-context-clean.tsx` - React context
- `client/src/hooks/useGeoPosition.ts` - GPS hook
- `client/src/hooks/use-geolocation.tsx` - Enhanced geolocation

**Features:**
- Browser Geolocation API
- Google Geolocation API fallback
- Debouncing and caching
- GPS refresh management

---

## 📚 Documentation Files

- `ARCHITECTURE.md` - System architecture and AI pipeline
- `MODEL.md` - AI model capabilities and parameters
- `LEXICON.md` - This file (terminology reference)
- `replit.md` - Replit-specific documentation
- `COACH_DATA_ACCESS.md` - AI Coach data access patterns
- `QUERY_CONVENTIONS.md` - Database query standards
- `SECURITY_AUDIT_REPORT.md` - Security audit findings

---

## 🛠️ Development Tools

### Scripts
- `scripts/seed-dev.js` - Database seeding
- `scripts/init-dev-db.js` - Database initialization
- `scripts/test-all.sh` - Full test suite
- `scripts/validate-all.sh` - Validation suite

### Debug Tools
- `tools/debug/test-llm-router.mjs` - Router testing
- `tools/debug/test-v2-router.mjs` - V2 router testing
- `tools/debug/hedge-burst-v2.mjs` - Hedge testing

### Research Tools
- `tools/research/model-discovery.mjs` - Model API discovery
- `tools/research/generate-model-md.mjs` - Documentation generator

---

**Version:** 1.2.0
**Last Updated:** January 5, 2026
**Maintainer:** Vecto Pilot Development Team

---

## 📝 Lexicon Update Protocol

When you notice terminology confusion, use this command:

```
Lexicon Update: [Term] should be [Correct Definition]
```

Example: `Lexicon Update: Bar venues should be called "Venue Candidates" not "Smart Blocks"`

The AI will:
1. Open LEXICON.md
2. Apply the correction
3. Re-read the file to update its understanding
