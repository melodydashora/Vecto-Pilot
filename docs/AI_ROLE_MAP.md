# AI role ownership map

Source-checked September 29, 2026. Role configuration, models, limits, aliases and
fallback eligibility live in [model-registry.js](../server/lib/ai/model-registry.js).
A registered role is not evidence of an active pipeline stage. This index links
actual callers; [the full pipeline trace](architecture/ai-pipeline.md) explains
admission, source validation, saved outputs and independent lifecycles.

| Role / capability | Active source | Ownership |
|---|---|---|
| `BRIEFING_TRAFFIC`, `BRIEFING_NEWS`, `BRIEFING_EVENTS_DISCOVERY`, `BRIEFING_SCHOOLS`, `BRIEFING_AIRPORT` | [Briefing pipelines](../server/lib/briefing/pipelines/) | Generation-scoped saved Briefing; event discovery also uses the verified shared venue/event writer. |
| `BRIEFING_HOLIDAY` | [holiday detector](../server/lib/location/holiday-detector.js), called by [Holiday pipeline](../server/lib/briefing/pipelines/holiday.js) | Seventh required Briefing section, including a verified none result. |
| Weather | [weather pipeline](../server/lib/briefing/pipelines/weather.js) | Deterministic Google Weather measurements; no weather model role. |
| `STRATEGY_TACTICAL` | [consolidator](../server/lib/ai/providers/consolidator.js) | Current admitted snapshot + complete Briefing + pinned MAIN driver context → `strategies.strategy_for_now`. |
| `VENUE_SCORER` | [venue planner](../server/lib/strategy/tactical-planner.js) | Saved Strategy + driver context → candidates, subsequently verified and routed. |
| `VENUE_FILTER`, `VENUE_TRAFFIC` | [venue intelligence](../server/lib/venue/venue-intelligence.js) | Independent Bars/Lounges classification and traffic analysis; shared catalog identity. |
| `AI_COACH` | [chat route](../server/api/chat/chat.js), [adapter dispatch](../server/lib/ai/adapters/index.js) | Owned saved context and conversation → streamed response and checked actions; see [Coach trace](architecture/RIDESHARE_COACH.md) for text, live voice, TTS and actions. |
| `CONCIERGE_SEARCH`, `CONCIERGE_CHAT` | [Concierge service](../server/lib/concierge/concierge-service.js), [public route](../server/api/concierge/concierge.js) | Public token/GPS-scoped discovery and conversation; canonical verified catalog writes. |
| `OFFER_ANALYZER`, `OFFER_ANALYZER_DEEP` | [offer hook](../server/api/hooks/analyze-offer.js) | Immediate evidence + deterministic decision/voice reconciliation; eligible deferred enrichment preserves the original decision. See [full Analyzer trace](architecture/OFFER_ANALYZER.md). |
| `UTIL_TRANSLATION` | [shortcut translation](../server/api/hooks/translate.js), [shared prompt](../server/api/translate/translation-prompt.js) | Validated independent translation, with cancellation. |
| `UTIL_RESEARCH` | [research API](../server/api/research/research.js) | Independent research request. |
| `UTIL_MARKET_PARSER` | [explicit market parser script](../server/scripts/parse-market-research.js) | Manual research import; not a MAIN stage. |
| `DOCS_GENERATOR` | [docs generator](../server/lib/docs-agent/generator.js) | Explicit documentation tooling; not a driver pipeline. |

`STRATEGY_CORE` is not a second live MAIN step. The legacy tactical endpoint that
used `STRATEGY_CONTEXT` now returns 410. The unused venue-event-verifier caller was
removed because its expected inputs were never populated; the retained registry
entry is not proof of event verification. `BRIEFING_FALLBACK` registration likewise
does not promise a successful retry or replacement section.

The adapter dispatch and provider implementations establish runtime behavior.
Do not infer that Coach is Gemini-only, copy model pins into a role table, or run
live model-verification scripts as an ordinary offline documentation check.
