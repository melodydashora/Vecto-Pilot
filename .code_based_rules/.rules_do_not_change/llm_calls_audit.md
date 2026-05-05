# Vecto-Pilot LLM Call Audit

This document catalogues all Large Language Model (LLM) calls routed through the centralized `server/lib/ai/adapters/index.js` adapter.

## API Routes (`server/api/`)

| Role Name | File Name | Line Number | Call Type |
| :--- | :--- | :--- | :--- |
| `UTIL_RESEARCH` | `server/api/research/research.js` | 25, 62 | `callModel` |
| `UTIL_TRANSLATION` | `server/api/translate/index.js` | 50 | `callModel` |
| `UTIL_TRANSLATION` | `server/api/hooks/translate.js` | 61 | `callModel` |
| `STRATEGY_CONTEXT` | `server/api/strategy/tactical-plan.js` | 172 | `callModel` |
| `AI_COACH` | `server/api/chat/chat.js` | 1239 | `callModelStream` |
| `OFFER_ANALYZER` | `server/api/hooks/analyze-offer.js` | 240 | `callModel` |
| `OFFER_ANALYZER_DEEP` | `server/api/hooks/analyze-offer.js` | 435 | `callModel` |
| `CONCIERGE_CHAT` | `server/api/concierge/concierge.js` | 366 | `callModelStream` |

## Core Library (`server/lib/`)

### Briefing & Location
| Role Name | File Name | Line Number | Call Type |
| :--- | :--- | :--- | :--- |
| `BRIEFING_FALLBACK` | `server/lib/briefing/briefing-service.js` | 339, 583 | `callModel` |
| `BRIEFING_TRAFFIC` | `server/lib/briefing/briefing-service.js` | 495, 1985 | `callModel` |
| `BRIEFING_EVENTS_DISCOVERY` | `server/lib/briefing/briefing-service.js` | 995, 1166 | `callModel` |
| `BRIEFING_WEATHER` | `server/lib/briefing/briefing-service.js` | 1485 | `callModel` |
| `BRIEFING_SCHOOLS` | `server/lib/briefing/briefing-service.js` | 1753 | `callModel` |
| `BRIEFING_AIRPORT` | `server/lib/briefing/briefing-service.js` | 2126 | `callModel` |
| `BRIEFING_NEWS` | `server/lib/briefing/briefing-service.js` | 2256 | `callModel` |
| `BRIEFING_HOLIDAY` | `server/lib/location/holiday-detector.js` | 427 | `callModel` |
| `UTIL_WEATHER_VALIDATOR` | `server/lib/location/weather-traffic-validator.js` | 35 | `callModel` |
| `UTIL_TRAFFIC_VALIDATOR` | `server/lib/location/weather-traffic-validator.js` | 101 | `callModel` |

### Concierge
| Role Name | File Name | Line Number | Call Type |
| :--- | :--- | :--- | :--- |
| `CONCIERGE_SEARCH` | `server/lib/concierge/concierge-service.js` | 548 | `callModel` |
| `CONCIERGE_CHAT` | `server/lib/concierge/concierge-service.js` | 842 | `callModel` |

### Strategy & AI Consolidator
| Role Name | File Name | Line Number | Call Type |
| :--- | :--- | :--- | :--- |
| `STRATEGY_TACTICAL` | `server/lib/strategy/planner-gpt5.js` | 54 | `callModel` |
| `STRATEGY_TACTICAL` | `server/lib/ai/providers/consolidator.js` | 217 | `callModel` |
| `STRATEGY_DAILY` | `server/lib/ai/providers/consolidator.js` | 263 | `callModel` |
| `BRIEFING_FALLBACK` | `server/lib/ai/providers/consolidator.js` | 924 | `callModel` |
| `VENUE_SCORER` | `server/lib/strategy/tactical-planner.js` | 236 | `callModel` |

### Venue Intelligence
| Role Name | File Name | Line Number | Call Type |
| :--- | :--- | :--- | :--- |
| `VENUE_EVENT_VERIFIER` | `server/lib/venue/venue-event-verifier.js` | 43 | `callModel` |
| `VENUE_FILTER` | `server/lib/venue/venue-intelligence.js` | 276 | `callModel` |
| `VENUE_TRAFFIC` | `server/lib/venue/venue-intelligence.js` | 764 | `callModel` |

### Utilities
| Role Name | File Name | Line Number | Call Type |
| :--- | :--- | :--- | :--- |
| *(Dynamic Role)* | `server/lib/docs-agent/generator.js` | 51 | `callModel(this.role, ...)` |

## Scripts (`server/scripts/`)

| Role Name | File Name | Line Number | Call Type |
| :--- | :--- | :--- | :--- |
| `UTIL_MARKET_PARSER` | `server/scripts/parse-market-research.js` | 188 | `callModel` |
