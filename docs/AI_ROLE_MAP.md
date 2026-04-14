# AI Role Ownership Map

> Single source of truth for every AI role in the system.
> Generated from `server/lib/ai/model-registry.js` and verified against actual `callModel()` / `callModelStream()` call sites.
>
> Last verified: 2026-04-14

## Role Registry

All roles follow the `{TABLE}_{FUNCTION}` naming convention defined in `model-registry.js`.

### 1. BRIEFING Roles (write to `briefings` table)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `BRIEFING_WEATHER` | `gemini-3.1-pro-preview` | `server/lib/briefing/briefing-service.js:1593` | `fetchWeatherConditions()` | Snapshot coords + market | `briefings.weather_conditions` (JSONB) |
| `BRIEFING_TRAFFIC` | `gemini-3.1-pro-preview` | `server/lib/briefing/briefing-service.js:509, 2093` | `fetchTrafficConditions()` | Snapshot coords, TomTom JSON | `briefings.traffic_conditions` (JSONB) |
| `BRIEFING_NEWS` | `gemini-3.1-pro-preview` | `server/lib/briefing/briefing-service.js:2364` | `fetchRideshareNews()` | Market name, region | `briefings.news` (JSONB) |
| `BRIEFING_EVENTS_DISCOVERY` | `gemini-3.1-pro-preview` | `server/lib/briefing/briefing-service.js:1030, 1216` | `discoverEventsForCategory()`, `discoverEventsForMarket()` | Market, coords, date, categories | `discovered_events` table |
| `BRIEFING_SCHOOLS` | `gemini-3.1-pro-preview` | `server/lib/briefing/briefing-service.js:1861` | `fetchSchoolClosures()` | Market, date | `briefings.school_closures` (JSONB) |
| `BRIEFING_AIRPORT` | `gemini-3.1-pro-preview` | `server/lib/briefing/briefing-service.js:2234` | `fetchAirportConditions()` | Market airports | `briefings.airport_conditions` (JSONB) |
| `BRIEFING_HOLIDAY` | `gemini-3.1-pro-preview` | `server/lib/location/holiday-detector.js:427` | `detectHolidaysWithAI()` | Date, country, state | Returns holiday object (in-memory) |
| `BRIEFING_FALLBACK` | `gemini-3.1-pro-preview` | `server/lib/briefing/briefing-service.js:353, 618` + `consolidator.js:1524` | Various fallback paths | Failed briefing call payload | Replaces failed field in `briefings` |

### 2. STRATEGY Roles (write to `strategies` table)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `STRATEGY_CORE` | `claude-opus-4-6` | `server/gateway/assistant-proxy.ts:33` | TRIAD pipeline step 1 | Full snapshot + briefing | `strategies.core_analysis` |
| `STRATEGY_CONTEXT` | `gemini-3.1-pro-preview` | `server/api/strategy/tactical-plan.js:172` | `generateTacticalPlan()` | Snapshot, briefing summary | Real-time context for strategy enrichment |
| `STRATEGY_TACTICAL` | `claude-opus-4-6` | `server/lib/ai/providers/consolidator.js:268` + `planner-gpt5.js:54` | `generateImmediateStrategy()` | Snapshot + briefing + events + preferences | `strategies.immediate_strategy` |
| `STRATEGY_DAILY` | `claude-opus-4-6` | `server/lib/ai/providers/consolidator.js:323` | `generateDailyStrategy()` | Snapshot + briefing + events + preferences | `strategies.daily_strategy` |

### 3. VENUE Roles (write to `ranking_candidates` / Smart Blocks)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `VENUE_SCORER` | `gpt-5.4` | `server/lib/strategy/tactical-planner.js:346` | `scoreCandidateVenues()` | Venues + events (NEAR/FAR buckets) + driver context | `ranking_candidates` table |
| `VENUE_FILTER` | `claude-haiku-4-5-20251001` | `server/lib/venue/venue-intelligence.js:276` | `classifyVenues()` | Venue list, driver context | P/S/X classification (premium/standard/remove) |
| `VENUE_TRAFFIC` | `gemini-3.1-pro-preview` | `server/lib/venue/venue-intelligence.js:764` | `getVenueTraffic()` | Venue coords | Venue-specific traffic (in-memory) |
| `VENUE_EVENT_VERIFIER` | `gemini-3.1-pro-preview` | `server/lib/venue/venue-event-verifier.js:43` | `verifyVenueEvent()` | Venue + event pair | Boolean verified (in-memory) |

### 4. COACH Role (writes to `coach_conversations`)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `AI_COACH` | `gemini-3.1-pro-preview` | `server/api/chat/chat.js:1239` | `callModelStream('AI_COACH', ...)` | Message history, system prompt, user message | `coach_conversations` table (streaming) |

> **Note:** AI_COACH uses `callModelStream()` — Gemini-only. Non-Gemini overrides are rejected at runtime by the streaming guard in `getRoleConfig()`.

### 5. CONCIERGE Roles (public-facing, writes to `concierge_feedback`)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `CONCIERGE_SEARCH` | `gemini-3.1-pro-preview` | `server/lib/concierge/concierge-service.js:548` | `searchConciergeEvents()` | Query, location | Returns event results (in-memory → client) |
| `CONCIERGE_CHAT` | `gemini-3.1-pro-preview` | `server/lib/concierge/concierge-service.js:842` + `server/api/concierge/concierge.js:366` | `conciergeChatCompletion()` / streaming variant | User question, location context | Returns answer (in-memory → client, streaming) |

### 6. UTILITY Roles (no direct DB write)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `UTIL_TRANSLATION` | `gemini-3.1-flash-lite-preview` | `server/api/translate/index.js:50` + `server/api/hooks/translate.js:61` | POST `/api/translate`, Siri hook | Source text, target language | Returns translated text (in-memory → client) |
| `UTIL_RESEARCH` | `gemini-3.1-pro-preview` | `server/api/research/research.js:25, 62` | GET/POST `/api/research` | Research query | Returns research results (in-memory → client) |
| `UTIL_WEATHER_VALIDATOR` | `gemini-3.1-pro-preview` | `server/lib/location/weather-traffic-validator.js:35` | `validateWeatherData()` | Raw weather JSON | Returns validated weather (in-memory) |
| `UTIL_TRAFFIC_VALIDATOR` | `gemini-3.1-pro-preview` | `server/lib/location/weather-traffic-validator.js:101` | `validateTrafficData()` | Raw traffic JSON | Returns validated traffic (in-memory) |
| `UTIL_MARKET_PARSER` | `gpt-5.4` | `server/scripts/parse-market-research.js:188` | `parseMarketResearch()` | Raw market research text | Returns structured data (script output) |

### 7. SIRI HOOKS (write to `offer_intelligence`)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `OFFER_ANALYZER` | `gemini-3-flash-preview` | `server/api/hooks/analyze-offer.js:240` | Phase 1: real-time offer analysis | Screenshot image (vision) | ACCEPT/REJECT JSON → client (< 2s) |
| `OFFER_ANALYZER_DEEP` | `gemini-3.1-pro-preview` | `server/api/hooks/analyze-offer.js:435` | Phase 2: async deep analysis | Screenshot image (vision) | `offer_intelligence` table (async) |

### 8. INTERNAL AGENTS

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `DOCS_GENERATOR` | `gemini-3.1-pro-preview` | `server/lib/docs-agent/generator.js:51` | `DocsAgent.generate()` | Codebase context | Documentation files (filesystem) |

## Model Distribution Summary

| Provider | Model | Roles Using It | Count |
|----------|-------|---------------|-------|
| **Google** | `gemini-3.1-pro-preview` | BRIEFING_* (7), STRATEGY_CONTEXT, VENUE_TRAFFIC, VENUE_EVENT_VERIFIER, AI_COACH, CONCIERGE_* (2), UTIL_RESEARCH, UTIL_WEATHER_VALIDATOR, UTIL_TRAFFIC_VALIDATOR, OFFER_ANALYZER_DEEP, DOCS_GENERATOR | 18 |
| **Google** | `gemini-3-flash-preview` | OFFER_ANALYZER | 1 |
| **Google** | `gemini-3.1-flash-lite-preview` | UTIL_TRANSLATION | 1 |
| **Anthropic** | `claude-opus-4-6` | STRATEGY_CORE, STRATEGY_TACTICAL, STRATEGY_DAILY | 3 |
| **Anthropic** | `claude-haiku-4-5-20251001` | VENUE_FILTER | 1 |
| **OpenAI** | `gpt-5.4` | VENUE_SCORER, UTIL_MARKET_PARSER | 2 |

**Total: 26 roles across 3 providers, 6 models**

## Legacy Role Aliases

These old role names still work via `LEGACY_ROLE_MAP` in `model-registry.js`:

| Legacy Name | Resolves To |
|-------------|------------|
| `strategist` | `STRATEGY_CORE` |
| `briefer` | `STRATEGY_CONTEXT` |
| `consolidator` | `STRATEGY_TACTICAL` |
| `venue_planner` | `VENUE_SCORER` |
| `venue_filter` | `VENUE_FILTER` |
| `haiku` | `VENUE_FILTER` |
| `coach` | `AI_COACH` |
| `COACH_CHAT` | `AI_COACH` |

## Fallback Configuration

Roles with cross-provider fallback (via `FALLBACK_ENABLED_ROLES`):

| Role | Primary Provider | Fallback |
|------|-----------------|----------|
| `STRATEGY_TACTICAL` | Anthropic (Claude) | Gemini Flash |
| `STRATEGY_CONTEXT` | Google (Gemini Pro) | GPT-5.4 |
| `STRATEGY_DAILY` | Anthropic (Claude) | Gemini Flash |
| `STRATEGY_CORE` | Anthropic (Claude) | Gemini Flash |
| `VENUE_FILTER` | Anthropic (Haiku) | Gemini Flash |
| `BRIEFING_WEATHER` | Google (Gemini Pro) | GPT-5.4 |
| `BRIEFING_TRAFFIC` | Google (Gemini Pro) | GPT-5.4 |
| `BRIEFING_SCHOOLS` | Google (Gemini Pro) | GPT-5.4 |
| `BRIEFING_AIRPORT` | Google (Gemini Pro) | GPT-5.4 |

Cross-provider fallback logic: Google primary → `gpt-5.4` fallback. Anthropic/OpenAI primary → `gemini-3-flash-preview` fallback.

## Source of Truth

- **Role definitions:** `server/lib/ai/model-registry.js` (lines 65–363)
- **Dispatcher:** `server/lib/ai/adapters/index.js` → `callModel()` / `callModelStream()`
- **Adapters:** `server/lib/ai/adapters/gemini-adapter.js`, `openai-adapter.js`, `anthropic-adapter.js`
