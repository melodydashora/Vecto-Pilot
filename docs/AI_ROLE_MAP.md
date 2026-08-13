# AI Role Ownership Map

> **Source of truth for model assignments:** `server/lib/ai/model-registry.js` (`MODEL_ROLES` map).
> This document describes role purpose, owning files, entrypoints, and data flow.
> Specific model versions are intentionally NOT enumerated here — per Rule 14 (model-agnostic adapter architecture), model identity belongs in the registry alone. The "Default Model" column below names the **provider/class**, not a specific version.
>
> Last reviewed: 2026-04-25

## Role Registry

All roles follow the `{TABLE}_{FUNCTION}` naming convention defined in `model-registry.js`.

### 1. BRIEFING Roles (write to `briefings` table)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `BRIEFING_TRAFFIC` | Google (Gemini Flash) | `server/lib/briefing/pipelines/traffic.js:131, 470` | `fetchTrafficConditions()` | Snapshot coords, TomTom JSON | `briefings.traffic_conditions` (JSONB) |
| `BRIEFING_NEWS` | Google (Gemini Flash) | `server/lib/briefing/pipelines/news.js:195` | `fetchRideshareNews()` | Market name, region | `briefings.news` (JSONB) |
| `BRIEFING_EVENTS_DISCOVERY` | Google (Gemini Flash) | `server/lib/briefing/pipelines/events.js:372` | `fetchEventsForBriefing()`, `discoverEvents()` | Market, coords, date, categories | `discovered_events` table |
| `BRIEFING_SCHOOLS` | Google (Gemini Flash) | `server/lib/briefing/pipelines/schools.js:104` (`fetchSchoolClosures()` at :52) | `fetchSchoolClosures()` | Market, date | `briefings.school_closures` (JSONB) |
| `BRIEFING_AIRPORT` | Google (Gemini Flash) | `server/lib/briefing/pipelines/airport.js:257` (`fetchAirportConditions()` at :146) | `fetchAirportConditions()` | Market airports | `briefings.airport_conditions` (JSONB) |
| `BRIEFING_HOLIDAY` | Google (Gemini Flash) | `server/lib/location/holiday-detector.js:474` (called from `server/lib/briefing/pipelines/holiday.js:47`) | `detectHoliday()` | Date, country, state | Returns holiday object (in-memory) |
| `BRIEFING_FALLBACK` | Google (Gemini Flash) | registered in `model-registry.js` only — no live call sites as of 2026-08-11 | (uncalled — candidate for removal or re-wiring) | Failed briefing call payload | Replaces failed field in `briefings` |

> BRIEFING_WEATHER removed 2026-05-02 — weather is fetched deterministically from the Google Weather API (`server/lib/briefing/pipelines/weather.js` `fetchWeatherConditions()`), no model role involved.

### 2. STRATEGY Roles (write to `strategies` table)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `STRATEGY_CORE` | Anthropic (Claude flagship) | `server/gateway/assistant-proxy.ts:33` | TRIAD pipeline step 1 | Full snapshot + briefing | `strategies.core_analysis` |
| `STRATEGY_CONTEXT` | Google (Gemini Flash) | `server/api/strategy/tactical-plan.js:172` | `generateTacticalPlan()` | Snapshot, briefing summary | Real-time context for strategy enrichment |
| `STRATEGY_TACTICAL` | Anthropic (Claude flagship) | `server/lib/ai/providers/consolidator.js:270` | `generateImmediateStrategy()` | Snapshot + briefing + events + preferences | `strategies.strategy_for_now` |

### 3. VENUE Roles (write to `ranking_candidates` / Smart Blocks)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `VENUE_SCORER` | OpenAI (GPT-5 reasoning) | `server/lib/strategy/tactical-planner.js:499` | `generateTacticalPlan()` | Venues + events (NEAR/FAR buckets) + driver context | `ranking_candidates` table |
| `VENUE_FILTER` | Anthropic (Claude Haiku) | `server/lib/venue/venue-intelligence.js:285` | `classifyAndFilterVenues()` | Venue list, driver context | P/S/X classification (premium/standard/remove) |
| `VENUE_TRAFFIC` | Google (Gemini Flash) | `server/lib/venue/venue-intelligence.js:809` | `getTrafficIntelligence()` | Venue coords | Venue-specific traffic (in-memory) |
| `VENUE_EVENT_VERIFIER` | Google (Gemini Flash) | `server/lib/venue/venue-event-verifier.js:43` | `verifyVenueEvent()` | Venue + event pair | Boolean verified (in-memory) |

### 4. COACH Role (writes to `coach_conversations`)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `AI_COACH` | Google (Gemini Flash) | `server/api/chat/chat.js:1467` | `callModelStream('AI_COACH', ...)` | Message history, system prompt, user message | `coach_conversations` table (streaming) |

> **Note:** AI_COACH uses `callModelStream()` — Gemini-only. Non-Gemini overrides are rejected at runtime by the streaming guard in `getRoleConfig()`.

### 5. CONCIERGE Roles (public-facing, writes to `concierge_feedback`)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `CONCIERGE_SEARCH` | Google (Gemini Flash) | `server/lib/concierge/concierge-service.js:548` | `searchNearby()` → `geminiDiscoverAndPersist()` (call at :549) | Query, location | Returns event results (in-memory → client) |
| `CONCIERGE_CHAT` | Google (Gemini Flash) | `server/lib/concierge/concierge-service.js:844` + `server/api/concierge/concierge.js:366` | `askConcierge()` / streaming variant | User question, location context | Returns answer (in-memory → client, streaming) |

### 6. UTILITY Roles (no direct DB write)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `UTIL_TRANSLATION` | Google (Gemini Flash) | `server/api/translate/index.js:50` + `server/api/hooks/translate.js:61` | POST `/api/translate`, Siri hook | Source text, target language | Returns translated text (in-memory → client) |
| `UTIL_RESEARCH` | Google (Gemini Flash) | `server/api/research/research.js:25, 62` | GET/POST `/api/research` | Research query | Returns research results (in-memory → client) |
| `UTIL_MARKET_PARSER` | OpenAI (GPT-5 reasoning) | `server/scripts/parse-market-research.js:188` | `extractIntelligence()` | Raw market research text | Returns structured data (script output) |

> UTIL_WEATHER_VALIDATOR / UTIL_TRAFFIC_VALIDATOR removed 2026-07-06 — their only caller (`weather-traffic-validator.js`) was deleted in consolidation Phase 1.

### 7. SIRI HOOKS (write to `offer_intelligence`)

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `OFFER_ANALYZER` | Google (Gemini Flash) | `server/api/hooks/analyze-offer.js:307` | Phase 1: real-time offer analysis | Screenshot image (vision) | ACCEPT/REJECT JSON → client (< 2s) |
| `OFFER_ANALYZER_DEEP` | Google (Gemini Pro) | `server/api/hooks/analyze-offer.js:505` | Phase 2: async deep analysis | Screenshot image (vision) | `offer_intelligence` table (async) |

### 8. INTERNAL AGENTS

| Role Name | Default Model | Owning File | Entrypoint Function | Data Input | Output Field/Table |
|-----------|--------------|-------------|--------------------|-----------|--------------------|
| `DOCS_GENERATOR` | Google (Gemini Flash) | `server/lib/docs-agent/generator.js:51` | `DocsAgent.generate()` | Codebase context | Documentation files (filesystem) |

## Provider Distribution

This section previously enumerated specific model versions per provider, which duplicated registry data. To get the current per-provider distribution, run:

```
bash scripts/verify-models.sh
```

Or read `server/lib/ai/model-registry.js` directly — `MODEL_ROLES` lists every role and its current default.

**Active providers:** Anthropic (Claude flagship + Haiku), Google (Gemini Flash + Pro), OpenAI (GPT-5 chat/reasoning + Realtime voice class).

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

| Role | Primary Provider | Fallback Provider |
|------|-----------------|------------------|
| `STRATEGY_TACTICAL` | Anthropic (Claude flagship) | Google (Gemini Flash) |
| `STRATEGY_CONTEXT` | Google (Gemini Flash) | OpenAI (GPT-5 family) |
| `STRATEGY_CORE` | Anthropic (Claude flagship) | Google (Gemini Flash) |
| `VENUE_FILTER` | Anthropic (Haiku) | Google (Gemini Flash) |

> 2026-04-30: BRIEFING_* roles removed from `FALLBACK_ENABLED_ROLES` — a Gemini outage now degrades those briefing fields rather than crossing to OpenAI (cost trade-off; see registry comment).

**Cross-provider fallback policy** (implemented in `getFallbackConfig()` in `server/lib/ai/model-registry.js`):
- Google primary → OpenAI fallback (different provider, different infrastructure).
- Anthropic / OpenAI primary → Google Gemini Flash fallback.

Specific fallback model versions live in the registry — do not duplicate them here.

## Source of Truth

- **Role definitions:** `server/lib/ai/model-registry.js` (lines 34–359)
- **Dispatcher:** `server/lib/ai/adapters/index.js` → `callModel()` / `callModelStream()`
- **Adapters:** `server/lib/ai/adapters/gemini-adapter.js`, `openai-adapter.js`, `anthropic-adapter.js`
