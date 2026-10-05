# Architecture documentation

This is a navigation index. Current code establishes behavior; specifications record
intent; tests and dated receipts establish what was verified. Historical audits explain
earlier findings. Read these together instead of treating a filename as proof of accuracy.

Use the root [lexicon](../../LEXICON.md) for canonical terminology and the
[October 4 readiness map](audits/PIPELINE_READINESS_2026-10-04.md) for the current
review candidate, verified checks and remaining live acceptance work.

## Pipeline entry points

These are source locations to trace, not a claim that every pipeline has been audited.
Follow imports and consumers for the full path.

| Area | Source entry points | Supporting reference |
|---|---|---|
| Preferences and session | [Auth routes](../../server/api/auth/auth.js), [admission](../../server/lib/main-run-admission.js), [setup context](../../client/src/contexts/run-setup-context.tsx) | [Preferences](USER_PREFERENCES.md), [auth](AUTH.md) |
| Location and snapshot | [Location routes](../../server/api/location/location.js), [snapshot routes](../../server/api/location/snapshot.js), [admitted snapshot](../../server/lib/location/main-run-snapshot.js) | [Snapshot](SNAPSHOT.md), [location](LOCATION.md) |
| Briefing | [Briefing routes](../../server/api/briefing/briefing.js), [aggregator](../../server/lib/briefing/briefing-aggregator.js) | [Briefing transformation](briefing-transformation-path.md) |
| Events | [Collector](../../server/lib/briefing/pipelines/events.js), [market reader](../../server/lib/events/market-event-reader.js), [shared writer](../../server/lib/briefing/cleanup-events.js) | [Discovery, storage and freshness](../EVENTS.md) |
| Strategist | [Strategy routes](../../server/api/strategy/strategy.js), [worker](../../server/jobs/triad-worker.js), [strategy provider](../../server/lib/ai/providers/consolidator.js) | [Strategy framework](strategy-framework.md), [source-generation record](2026-09-12-STRATEGY-SOURCE-GENERATION.md) |
| Venue planner | [Tactical planner](../../server/lib/strategy/tactical-planner.js), [venue enrichment](../../server/lib/venue/enhanced-smart-blocks.js) | [Venues](VENUES.md), [lounges and bars](LOUNGES_AND_BARS.md) |
| Coach | [Chat route](../../server/api/chat/chat.js), [owner data access](../../server/lib/ai/rideshare-coach-dal.js), [saved source context](../../server/lib/ai/coach-source-context.js) | [Coach guide](RIDESHARE_COACH.md) |
| Offer Analyzer | [Hook](../../server/api/hooks/analyze-offer.js), [adjudication](../../server/lib/offers/phase1-decision.js), [rules](../../server/lib/offers/rules-engine.js) | [Full source trace](OFFER_ANALYZER.md), [remaining gates](OFFER_ANALYZER_ROADMAP.md) |

The Offer Analyzer reference was reconciled with source on September 29. The other guides
need their own source review when those pipelines are touched. A source review is not
a production deployment or physical-device verification.

## Implementation references

| Topic | Reference |
|---|---|
| API mounting and routes | [Route mounting](../../server/bootstrap/routes.js), [API routes registry](../api-routes-registry.md) |
| Schema and environments | [DB schema reference](DB_SCHEMA.md), [actual schema](../../shared/schema.js), [database environments](DATABASE_ENVIRONMENTS.md), [migrations](../../migrations/README.md) |
| Models and adapters | [AI role map](../AI_ROLE_MAP.md), [model registry](../../server/lib/ai/model-registry.js), [adapter guide](AI_MODEL_ADAPTERS.md), [LLM requests](LLM-REQUESTS.md) |
| Client and design | [Client source](../../client/src/README.md), [UX schema](UX_SCHEMA.md), [header](GLOBALHEADER.md), [map](MAP.md) |
| Infrastructure | [SSE](SSE.md), [MCP continuity](mcp-server.md), [testing](TESTING.md), [recovery](DISASTER_RECOVERY.md) |
| Security | [Security policy](../../SECURITY.md), [security architecture](SECURITY.md) |
| Phone capture | [iPhone](SIRI_SHORTCUT_ANALYZE.md), [Android](ANDROID_SHORTCUT_ANALYZE.md) |
| Other features | [Concierge](CONCIERGE.md), [district tagging](DISTRICT_TAGGING.md), [market intelligence](MARKET_INTELLIGENCE.md), [translation](TRANSLATION.md) |

Runtime commands, model assignments, database columns and timing numbers belong in
their actual configuration/source and focused references. This index does not copy
those changing values. Start with [package.json](../../package.json),
[gateway-server.js](../../gateway-server.js), and [startup code](../../server/bootstrap/)
when investigating startup; check startup effects before running a server.

## Intent, plans and historical evidence

- [Partnership agreement](../../AI_PARTNERSHIP_AGREEMENT.md), [CLAUDE.md](../../CLAUDE.md)
  and [AGENTS.md](../../AGENTS.md) define collaboration and continuity.
- [Melody's Offer Analyzer specification](../OFFER_ANALYZER_DRIVER_RULESET.md) retains her
  authored requirements. A requirement is not evidence of implementation.
- [Decisions](DECISIONS.md), [deprecations](DEPRECATED.md), [dated audits](audits/README.md)
  and [handoffs](../coordination/) preserve reasoning and reported observations; verify
  present applicability before acting on them.
- [Removals record](removals/README.md) preserves why material left and how to recover it.
- [Preflight cards](../preflight/README.md) and the [discrepancy record](../DOC_DISCREPANCIES.md)
  identify checks and known documentation conflicts.
- [Native apps](NATIVE_APPS.md), [conversion](CONVERSION.md), [future work](FUTURE.md)
  and [research](../research/README.md) contain planning inputs, not shipped-feature proof.

Open work, lessons and product invariants are available through the existing
[continuity tools](mcp-server.md). Use the actual returned records; old section numbers
and copied task lists are not a substitute for that read.
