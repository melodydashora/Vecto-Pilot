
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

### Model Dictionary
**What it is:** Centralized model configuration registry.

**Codebase Files:**
- `server/lib/ai/models-dictionary.js` - JavaScript implementation
- `models-dictionary.json` - JSON configuration
- `agent-ai-config.js` - Gateway AI configuration

**Model Roles:**
- `replit_agent` - Claude Sonnet 4.5 (workspace intelligence)
- `strategist` - Claude Sonnet 4.5 (strategic overview)
- `tactical_planner` - GPT-5 (venue recommendations)
- `validator` - Gemini 2.5 Pro (validation/enrichment)
- `research_engine` - Perplexity Sonar Pro (event research)

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

### Smart Blocks (Tactical Recommendations)
**What it is:** AI-generated venue recommendations with event context.

**Codebase Files:**
- `server/lib/strategy/enhanced-smart-blocks.js` - Generation engine
- `server/api/strategy/blocks-fast.js` - HTTP endpoint
- `client/src/components/SmartBlocksStatus.tsx` - UI component

**Database Tables:**
- `rankings` - Recommendation sets
- `venue_candidates` - Individual venue recommendations

**API Endpoints:**
- `POST /api/blocks-fast` - Trigger generation
- `GET /api/blocks-fast?snapshot_id=<id>` - Fetch results

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

**Version:** 1.1.0
**Last Updated:** December 10, 2025
**Maintainer:** Vecto Pilot Development Team
