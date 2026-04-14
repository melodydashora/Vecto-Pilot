[SYSTEM TAG: STRUCTURAL_INDEX | NON_EXECUTABLE]
AGENT DIRECTIVE: This is a read-only map of the system. Do not modify this file unless explicitly instructed to document a new architectural paradigm.

# LEXICON.md

**Vecto Pilot Terminology & Codebase Reference**

> **Scope:** This file is a TERMINOLOGY GLOSSARY. For endpoint inventories see [API_REFERENCE.md](docs/architecture/API_REFERENCE.md). For architecture see [docs/architecture/README.md](docs/architecture/README.md). For AI roles see [docs/AI_ROLE_MAP.md](docs/AI_ROLE_MAP.md).

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

### AI Coach (Multi-Model System)
**What it is:** Real-time strategic analysis system using multiple AI models in a waterfall pipeline.

**Key Characteristics:**
- Multi-provider pipeline (models swappable via env vars)
- Real-time event analysis
- Venue recommendations
- Tactical planning

**Codebase Files:**
- `server/api/chat/chat.js` - Chat interface endpoint
- `server/lib/ai/providers/coach-dal.js` - Data access layer
- `client/src/components/AICoach.tsx` - UI component
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

### Architecture Overview
**What it is:** A model-agnostic, multi-provider AI system. Code references **ROLES** (e.g., `VENUE_SCORER`), never model names. Models are swappable via environment variables without code changes.

**⚠️ CRITICAL (Rule 14):** Do NOT hardcode model names in business logic. The adapter layer owns model routing. Default models listed below are current defaults in `model-registry.js` — they can be changed at any time via env vars.

---

### LLM Router
**What it is:** Multi-provider routing with hedging, circuit breakers, and cross-provider fallback chains.

**Codebase Files:**
- `server/lib/ai/llm-router-v2.js` - Enhanced router with strict budget control
- `server/lib/ai/llm-router.js` - Original router implementation
- `server/lib/ai/model-retry.js` - Retry logic
- `server/lib/ai/transient-retry.js` - Transient failure handling

**Configuration:**
- `LLM_TOTAL_BUDGET_MS` (default: 8000ms) - Total request timeout
- `LLM_PRIMARY_TIMEOUT_MS` (default: 1200ms) - Hedging delay
- `PREFERRED_MODEL` - Primary model selection
- `FALLBACK_MODELS` - Fallback model chain
- `CIRCUIT_ERROR_THRESHOLD` (default: 5) - Circuit breaker threshold
- `CIRCUIT_COOLDOWN_MS` (default: 60000ms) - Breaker reset time

**Fallback Behavior:**
- Primary is Google provider → fallback to OpenAI (cross-provider)
- Primary is Anthropic/OpenAI → fallback to Google Flash model
- BRIEFING and OFFER_ANALYZER roles have **no fallback** (require web search grounding)

---

### Providers & Adapters
**What it is:** Provider-specific API clients with a unified interface. Each adapter normalizes a provider's SDK into a common response format.

**Unified Response Interface:**
```javascript
{ ok: boolean, output: string, error?: string }
```

**Dispatcher:**
- `server/lib/ai/adapters/index.js` - `callModel(role, params)` entry point + HedgedRouter
- `callModelStream(role, params)` - Streaming variant (provider must support it)

#### Provider: Anthropic (Claude family)
**Adapter:** `server/lib/ai/adapters/anthropic-adapter.js`
**API Key Env Var:** `ANTHROPIC_API_KEY`
**Functions:** `callAnthropic()`, `callAnthropicWithWebSearch()`

| Parameter | Format | Notes |
|-----------|--------|-------|
| Max tokens | `max_tokens` | Standard parameter name |
| Temperature | `temperature` | Supported on all Claude models |
| Web search | `web_search_20250305` tool | Max 5 search uses per call |

**Raw HTTP variant:** `server/lib/ai/adapters/anthropic-sonnet45.js` — Direct Messages API (no SDK)

#### Provider: OpenAI (GPT / o-series family)
**Adapter:** `server/lib/ai/adapters/openai-adapter.js`
**API Key Env Var:** `OPENAI_API_KEY`
**Functions:** `callOpenAI()`, `callOpenAIWithWebSearch()`

| Parameter | Format | Notes |
|-----------|--------|-------|
| Max tokens | `max_completion_tokens` | NOT `max_tokens` (deprecated for reasoning models) |
| Temperature | **NOT supported** | Use `reasoning_effort` instead for reasoning models |
| Reasoning | `reasoning_effort: 'low'\|'medium'\|'high'` | Controls depth of chain-of-thought |
| Web search | Separate search model | Uses dedicated search-capable model variant |

#### Provider: Google (Gemini family)
**Adapter:** `server/lib/ai/adapters/gemini-adapter.js`
**SDK:** `@google/genai` (`GoogleGenAI` class)
**API Key Env Var:** `GEMINI_API_KEY`
**Functions:** `callGemini()`, `callGeminiStream()`

| Parameter | Format | Notes |
|-----------|--------|-------|
| Max tokens | `maxOutputTokens` | NOT `max_tokens` |
| Temperature | `temperature` | Supported |
| Thinking | `thinkingConfig: { thinkingLevel }` | Extended reasoning |
| Web search | `googleSearch: {}` tool | Native grounding with citation suppression |
| Vision | `images: [{mimeType, data}]` | Multimodal input |
| JSON mode | `responseMimeType: 'application/json'` | Structured output |
| Safety | All HARM categories set to OFF | Required for news/traffic/civic content |

**Thinking Level Constraints:**
| Model tier | Allowed levels |
|------------|----------------|
| Pro models | `LOW`, `HIGH` only (NO `MEDIUM` — runtime validated) |
| Flash models | `LOW`, `MEDIUM`, `HIGH` |

#### Provider: Google Vertex AI
**Adapter:** `server/lib/ai/adapters/vertex-adapter.js`
**Auth:** Google Cloud Application Default Credentials (ADC) or service account
**Functions:** `callVertexAI()`, `callVertexAIStream()`, `isVertexAIAvailable()`

| Env Var | Purpose | Required |
|---------|---------|----------|
| `VERTEX_AI_ENABLED` | Set to `'true'` to enable | Yes |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID | Yes |
| `GOOGLE_CLOUD_LOCATION` | Region (default: `us-central1`) | No |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account JSON path | No (uses ADC) |

**Notes:** Same parameter format as Gemini adapter. Enables access to Vertex-only models (e.g., native audio).

#### Provider: Perplexity
**Adapter:** `server/lib/ai/adapters/perplexity-adapter.js`
**API Key Env Var:** `PERPLEXITY_API_KEY`
**Default Model:** `sonar-pro`
**Purpose:** AI-powered web research for event discovery and holiday detection

---

### Provider Auto-Detection
The adapter layer detects provider from model ID prefix:

| Model ID prefix | Provider |
|----------------|----------|
| `gpt-*`, `o1-*` | OpenAI |
| `claude-*` | Anthropic |
| `gemini-*` | Google |

**⚠️ This is the ONLY place model names matter.** All other code uses role names.

---

### AI Pipeline Roles
**What it is:** Canonical role names following `{TABLE}_{FUNCTION}` convention. The model-registry maps each role to a default model + parameters, all overridable via env vars.

**Naming Convention:** `{TABLE}_{FUNCTION}`
- `BRIEFING_*` - Roles that populate the `briefings` table
- `STRATEGY_*` - Roles that populate the `strategies` table
- `VENUE_*` - Roles that populate `ranking_candidates` (SmartBlocks)
- `AI_COACH` / `COACH_*` - Roles that populate `coach_conversations`
- `OFFER_*` - Roles for real-time offer analysis (Siri Shortcuts)
- `CONCIERGE_*` - Roles for public event/venue discovery
- `UTIL_*` - Utility roles for validation/parsing (no direct DB write)
- `DOCS_*` - Internal documentation generation

**Complete Role Registry:**

| Role | Purpose | Override Env Var | Features |
|------|---------|------------------|----------|
| **BRIEFINGS TABLE** ||||
| `BRIEFING_WEATHER` | Weather intelligence | `BRIEFING_WEATHER_MODEL` | web search |
| `BRIEFING_TRAFFIC` | Traffic conditions analysis | `BRIEFING_TRAFFIC_MODEL` | web search, extended thinking |
| `BRIEFING_NEWS` | Local news research | `BRIEFING_NEWS_MODEL` | web search, extended thinking |
| `BRIEFING_EVENTS_DISCOVERY` | Event discovery (parallel category search) | `BRIEFING_EVENTS_MODEL` | web search, extended thinking |
| `BRIEFING_FALLBACK` | General fallback for failed briefing calls | `BRIEFING_FALLBACK_MODEL` | web search, extended thinking |
| `BRIEFING_SCHOOLS` | School closure detection | `BRIEFING_SCHOOLS_MODEL` | web search, extended thinking |
| `BRIEFING_AIRPORT` | Airport delay/disruption data | `BRIEFING_AIRPORT_MODEL` | web search |
| `BRIEFING_HOLIDAY` | Holiday detection | `BRIEFING_HOLIDAY_MODEL` | web search, extended thinking |
| **STRATEGIES TABLE** ||||
| `STRATEGY_CORE` | Core strategic plan generation | `STRATEGY_CORE_MODEL` | |
| `STRATEGY_CONTEXT` | Real-time context gathering | `STRATEGY_CONTEXT_MODEL` | extended thinking |
| `STRATEGY_TACTICAL` | Immediate 1-hour tactical strategy | `STRATEGY_TACTICAL_MODEL` | fallback enabled |
| `STRATEGY_DAILY` | Long-term 8-12hr daily strategy | `STRATEGY_DAILY_MODEL` | fallback enabled |
| **RANKING_CANDIDATES TABLE (SmartBlocks)** ||||
| `VENUE_SCORER` | Tactical venue recommendations (4-6 venues with coords) | `VENUE_SCORER_MODEL` | reasoning |
| `VENUE_FILTER` | Fast low-cost venue classification | `VENUE_FILTER_MODEL` | minimal tokens |
| `VENUE_TRAFFIC` | Venue-specific traffic intelligence | `VENUE_TRAFFIC_MODEL` | web search |
| `VENUE_EVENT_VERIFIER` | Verify events at specific venues | `VENUE_EVENT_VERIFIER_MODEL` | minimal tokens |
| **COACH_CONVERSATIONS TABLE** ||||
| `AI_COACH` | AI Coach conversation (streaming) | `AI_COACH_MODEL` | web search, vision, OCR, **streaming required** |
| **OFFER ANALYSIS** ||||
| `OFFER_ANALYZER` | Phase 1: Quick offer screenshot analysis | `OFFER_ANALYZER_MODEL` | vision |
| `OFFER_ANALYZER_DEEP` | Phase 2: Deep offer analysis | `OFFER_ANALYZER_DEEP_MODEL` | vision, thinking |
| **CONCIERGE (Public)** ||||
| `CONCIERGE_SEARCH` | Public event/venue search | `CONCIERGE_SEARCH_MODEL` | web search, thinking |
| `CONCIERGE_CHAT` | Public conversational interface | `CONCIERGE_CHAT_MODEL` | web search, thinking |
| **UTILITIES** ||||
| `UTIL_RESEARCH` | General research queries | `UTIL_RESEARCH_MODEL` | web search |
| `UTIL_WEATHER_VALIDATOR` | Validate weather data structure | `UTIL_WEATHER_VALIDATOR_MODEL` | |
| `UTIL_TRAFFIC_VALIDATOR` | Validate traffic data structure | `UTIL_TRAFFIC_VALIDATOR_MODEL` | |
| `UTIL_MARKET_PARSER` | Parse unstructured market research | `UTIL_PARSER_MODEL` | reasoning |
| `UTIL_TRANSLATION` | Text translation | `UTIL_TRANSLATION_MODEL` | minimal tokens |
| **INTERNAL** ||||
| `DOCS_GENERATOR` | Documentation generation | `DOCS_GENERATOR_MODEL` | extended thinking, skip JSON extraction |

**Usage Pattern:**
```javascript
import { callModel } from './lib/ai/adapters/index.js';

// Use {TABLE}_{FUNCTION} role names — NEVER model names
const result = await callModel('STRATEGY_CORE', { system, user });
const filtered = await callModel('VENUE_FILTER', { system, user });
const events = await callModel('BRIEFING_EVENTS_DISCOVERY', { system, user });

// Streaming (AI Coach only — provider must support it)
const stream = await callModelStream('AI_COACH', { system, messageHistory });
```

**Legacy Role Mapping (deprecated, still functional):**
| Legacy Name | Maps To |
|-------------|---------|
| `strategist` | `STRATEGY_CORE` |
| `briefer` | `STRATEGY_CONTEXT` |
| `consolidator` | `STRATEGY_TACTICAL` |
| `venue_planner` | `VENUE_SCORER` |
| `venue_filter` | `VENUE_FILTER` |
| `haiku` | `VENUE_FILTER` |
| `coach` | `AI_COACH` |
| `COACH_CHAT` | `AI_COACH` |

**Key Principles:**
1. Role names indicate **output destination** (table) + **function**
2. Code references **ROLES**, never model names
3. Model assignments are **configuration** (env vars in `model-registry.js`)
4. Adapters folder is the only place provider-specific model IDs appear
5. Any role can be pointed at any compatible provider via its env var override
6. Legacy role names are supported but deprecated

**API Key Requirements:**

| Env Var | Provider | Required |
|---------|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic | Yes (strategy roles) |
| `OPENAI_API_KEY` | OpenAI | Yes (venue/tactical roles) |
| `GEMINI_API_KEY` | Google | Yes (briefing/coach roles) |
| `PERPLEXITY_API_KEY` | Perplexity | Optional (event research) |

**Codebase Files:**
- `server/lib/ai/model-registry.js` - Canonical role definitions, defaults, parameter quirks
- `server/lib/ai/adapters/index.js` - Role dispatcher with HedgedRouter fallback
- `server/config/env-registry.js` - Centralized env var definitions

---

### Model Registry
**What it is:** Centralized configuration for all AI model interactions — the single source of truth.

**Codebase Files:**
- `server/lib/ai/model-registry.js` — Role definitions, model defaults, env overrides, quirks

**Documentation:**
- `docs/preflight/ai-models.md` — Human-readable model landscape and parameter constraints

**Removed (2026-02-26):** `models-dictionary.js` (dead code, zero imports), `MODEL.md` (sync burden), `tools/research/` (orphaned pipeline).

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

## 🏢 Venue Identity System

### Core Identity Fields

| Field | Format | Example | Description |
|-------|--------|---------|-------------|
| `place_id` | Google Place ID | `ChIJfTlLXrk8TIYRi7jESAUBky8` | Authoritative Google identifier |
| `coord_key` | 6-decimal lat_lng | `33.090780_-96.821596` | Precise coordinate key for cache |
| `normalized_name` | Lowercase, stripped | `ifly indoor skydiving frisco` | Deduplication key |
| `venue_id` | UUID | `5a51a3c4-a97c-49de-9b62...` | Internal primary key |

### Place ID Types

| Prefix | Type | Trust Level | Use for API? |
|--------|------|-------------|--------------|
| `ChIJ...` | Valid Google Place ID | HIGH | ✅ YES |
| `Ei...` | Synthetic Address ID | NONE | ❌ NEVER |
| `null` | Missing | UNKNOWN | Needs resolution |

**CRITICAL:** Ei* IDs are Base64-encoded addresses, NOT database references. They often point to wrong locations (e.g., highway segments instead of businesses).

### Canonical Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `server/lib/venue/venue-address-resolver.js` | Authoritative place resolution | ✅ CORRECT |
| `server/lib/venue/venue-cache.js` | Venue CRUD operations | ⚠️ Uses fuzzy matching |
| `server/lib/venue/venue-enrichment.js` | Places API caching | ⚠️ Wrong key (coords in place_id) |
| `server/scripts/sync-events.mjs` | Event ETL pipeline | ⚠️ Drops place_id |

### Resolution Priority

1. **place_id exact match** (most reliable)
2. **coord_key exact match** (6-decimal precision = ~11cm)
3. **normalized_name + city + state** (last resort)

**Standard:** "venue identification should be place_id-first (not name similarity)"

### Related Documentation

- `docs/AUDIT_LEDGER.md` - Current pipeline issues
- `docs/DOC_DISCREPANCIES.md` - D-013 places_cache mismatch

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
- `/api/blocks-fast` - Smart blocks generation
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

### SmartBlocks (Strategy Venue Recommendations)
**What it is:** The venue cards displayed on the Strategy page — specific tactical venue recommendations generated by the VENUE_SCORER role during the strategy pipeline. These are the primary "where to go RIGHT NOW" outputs that drivers see.

**⚠️ Common confusion:** The codebase file `enhanced-smart-blocks.js` generates these. Despite the name overlap, SmartBlocks are **venue recommendations**, not raw intelligence data.

**Pipeline (how SmartBlocks are generated):**
1. VENUE_SCORER role generates 4-6 venue names + coordinates from strategy context
2. Google Routes API calculates distances and drive times
3. Google Places API enriches with addresses, business hours, open/closed status
4. Events from `discovered_events` DB are matched to venues
5. Results stored in `ranking_candidates` table, displayed as venue cards in UI

**⚠️ SmartBlocks are AI-generated, NOT pulled from `venue_catalog`.** The AI model behind the VENUE_SCORER role uses its training knowledge to recommend venues for the driver's current location. The `venue_catalog` is only used by the separate Bar Tab/nightlife feature.

**Codebase Files:**
- `server/lib/venue/enhanced-smart-blocks.js` - Venue generation engine (orchestrates pipeline)
- `server/lib/strategy/tactical-planner.js` - VENUE_SCORER AI prompt + response parsing
- `server/lib/venue/venue-enrichment.js` - Google Places/Routes API enrichment
- `server/api/strategy/blocks-fast.js` - HTTP endpoint (pipeline trigger)
- `client/src/components/SmartBlocksStatus.tsx` - Pipeline status UI
- `client/src/pages/co-pilot/StrategyPage.tsx` - Strategy page venue card display

**Database Tables:**
- `ranking_candidates` - Scored venue recommendations linked to a strategy/snapshot
- `rankings` - Parent record for a set of venue candidates

**API Endpoints:**
- `POST /api/blocks-fast` - Trigger venue recommendation generation
- `GET /api/blocks-fast?snapshot_id=<id>` - Fetch generated venue results

---

### Briefing Blocks (Intelligence Inputs)
**What it is:** Modular units of contextual market data (Traffic, Events, Weather, News) gathered during the briefing pipeline. These are **inputs** to the strategy generation process, NOT displayed as venue cards.

**Codebase Files:**
- `server/lib/strategy/content-blocks.js` - Block generation
- `client/src/components/_future/SmartBlocks.tsx` - Renders briefing blocks (Events, Traffic, News)

**What Briefing Blocks ARE:**
- Traffic intelligence blocks
- Event discovery blocks
- Weather condition blocks
- News/disruption blocks

---

### Venue Candidates (Bar Tab / Nightlife)
**What it is:** Upscale bars and nightlife venues discovered via Google Places API for the "Lounges & Bars" tab. These are a **separate system** from SmartBlocks — they use a cache-first pattern backed by the `venue_catalog` table.

**⚠️ NOT the same as SmartBlocks.** SmartBlocks = strategy venue recommendations (AI-generated). Venue Candidates = nightlife discovery (Google Places API + venue_catalog cache).

**Codebase Files:**
- `server/lib/venue/venue-intelligence.js` - Discovery engine (Google Places API + cache)
- `server/lib/venue/venue-cache.js` - venue_catalog CRUD and cache lookup
- `client/src/components/BarsMainTab.tsx` - "Lounges & Bars" driver UI
- `client/src/hooks/useBarsQuery.ts` - Client-side data fetching

**Database Tables:**
- `venue_catalog` - Persistent library of all known nightlife venues (cache-first pattern)

**Key Distinction:**
| Term | Source | UI Location | Example |
|------|--------|-------------|---------|
| SmartBlock | VENUE_SCORER role (AI-generated) | Strategy page venue cards | "Legacy West - position at north entrance for pickup surge" |
| Briefing Block | Briefing pipeline | Intelligence feed | "Traffic is heavy on I-35" |
| Venue Candidate | Google Places API + venue_catalog | Lounges & Bars tab | "Concrete Cowboy bar, $$$, 4.7★, Open" |

**API Endpoints:**
- `GET /api/venues/nearby` - Discover nearby nightlife venues

---

### Strategy Pipeline (Multi-Stage)
**What it is:** Multi-provider AI pipeline for strategic analysis. Models are role-based and swappable — do NOT assume a specific provider for any stage.

**Stages (by role, not by model):**
1. **STRATEGY_CORE** - Strategic overview and plan generation
2. **VENUE_SCORER** - Tactical venue recommendations (JSON schema with coords)
3. **STRATEGY_CONTEXT** - Real-time context enrichment and validation
4. **STRATEGY_TACTICAL** - Immediate 1-hour actionable strategy
5. **STRATEGY_DAILY** - Long-term 8-12hr daily strategy

**Codebase Files:**
- `server/lib/ai/providers/minstrategy.js` - STRATEGY_CORE role implementation
- `server/lib/strategy/tactical-planner.js` - VENUE_SCORER role implementation
- `server/lib/venue/enhanced-smart-blocks.js` - SmartBlocks orchestrator (calls VENUE_SCORER + Google APIs)
- `server/lib/strategy/strategy-generator.js` - Pipeline orchestrator

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
- `docs/preflight/ai-models.md` - AI model reference and parameter constraints
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

**Version:** 1.4.0
**Last Updated:** March 28, 2026
**Maintainer:** Vecto Pilot Development Team (Melody Dashora, architect)

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
