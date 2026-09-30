# Pipeline source and documentation consolidation — September 29, 2026

Authorized by Melody's request to trace every pipeline from code, correct root causes,
and remove obsolete duplicate documentation. Base: `main` at
`6e98390697dfd3d677702bc64fe206b2383f5279`; earlier P1/Analyzer work was preserved.
This is a recovery map, not an application deployment receipt. Git at that base
retains historical source. Root also preserved pre-edit working copies outside Git
in `/tmp/astra-pipeline-originals/`; those temporary copies are not durable backups.

| Removed or consolidated material | Why | Current source/reference |
|---|---|---|
| `server/lib/venue/venue-event-verifier.js` and its sole call | Its expected event fields were never populated, so it produced no verification evidence. | Verified saved event matching in [venue pipeline](../VENUES.md). |
| Legacy implementation inside `server/api/strategy/tactical-plan.js` | Only UI consumer was removed in April; mounted endpoint still trusted model coordinates and fabricated geometric zones after parsing failures. | Endpoint remains an explicit authenticated 410; [MAIN planner](../ai-pipeline.md#5-strategy--preferences--venue-recommendations) is separate. |
| Global latest-row diagnostic implementation | Could select another run and interleave file writes; claimed to be the exact provider prompt. | Snapshot-scoped private atomic [diagnostic](../../../server/lib/briefing/dump-last-briefing.js), preserving quiet artifact intent from memory 218. |
| Duplicate market reader blocks and state-only event queries in Briefing API | Lost country, metro boundaries, multi-day and venue-timezone correctness. | [market-event-reader.js](../../../server/lib/events/market-event-reader.js). |
| Separate worker supervisors and transparent pool retry wrapper | Duplicate error/exit timers could create competing workers; lost database acknowledgement did not prove write rollback. | [workers.js](../../../server/bootstrap/workers.js), [DB runtime](../../../server/db/README.md). |
| `docs/architecture/ai-pipeline.md` old model/prompt/timing/fallback tables | Parallel Strategy/Briefing, dead verifier, copied pins and unsupported timing were presented as current. | Source-linked [full pipeline trace](../ai-pipeline.md). |
| `server/lib/briefing/README.md`, `server/api/briefing/README.md` old facade, route and cache examples | Referenced removed service and refresh routes, six sections, old models, stale schools caching and partial refresh. | [Generation guide](../../../server/lib/briefing/README.md), [API guide](../../../server/api/briefing/README.md). Workstream 6 reasoning/memory294–300 preserved. |
| `docs/architecture/LOCATION.md`, `SNAPSHOT.md` April copies of schemas/flows | Contradicted explicit Continue, fresh saved observations, scoped identity and retired legacy capture behavior. | Rewritten [location](../LOCATION.md) and [snapshot](../SNAPSHOT.md) guides retain safety and session-history rationale. |
| `docs/architecture/SSE.md` April topology/TODOs | Claimed no auth/filter/reconnect and documented request-close cleanup and stale emitters. | Current [SSE trace](../SSE.md), including Analyzer saved-state boundary. |
| `docs/preflight/location.md`, `ai-change-protocol.md` stale instructions | Confused decimal precision with sensor accuracy; claimed Places cannot return coordinates; old registry env schema and ineffective pseudo-CI. | [Location card](../../preflight/location.md), [AI change card](../../preflight/ai-change-protocol.md). |
| Four duplicate Coach architecture/audit files | Obsolete providers/components, redundant history and retired Analyzer mutation paths in active search results. | Exact paths, replacements and preservation in [Coach removal receipt](2026-09-29-coach-doc-consolidation.md). |

Additional reconciliation:

- Removed `docs/architecture/audits/llm_calls_audit.md`: a duplicated list of removed callers, obsolete pins and dead line numbers, not unique findings. Git at the stated base retains it. [Role ownership](../../AI_ROLE_MAP.md) now links current callers.
- Replaced stale role, `SYSTEM_MAP.md` waterfall and venue-module tables with source-linked contracts; removed false parallel-Strategist, Gemini-only-Coach, never-refresh-Places and no-op verifier claims.
- [Independent pipeline consolidation](2026-09-29-independent-pipelines.md) records the retired event-sync entrypoints and consolidated auth/preferences/translation guidance.

Earlier September 29 cleanup is separately recorded in
[documentation cleanup](2026-09-29-documentation-cleanup.md),
[Analyzer reconciliation](2026-09-29-offer-analyzer-doc-reconciliation.md),
[admitted snapshots](2026-09-29-admitted-snapshots.md), and
[held header](2026-09-29-held-header.md). This ledger does not erase those receipts
or authorize deleting migration history, private coordination, uploaded evidence,
current source documents or another collaborator's work.

## Event documentation consolidation

The event review read all four guides in full, traced their claims to current source,
and consolidated the active contract into [EVENTS.md](../../EVENTS.md). The original
four files matched Git at the base above before editing. No unique unresolved issue
was treated as closed merely because its old document was removed.

| Removed or replaced material | Reason and preservation |
|---|---|
| `docs/EVENT_FRESHNESS_AND_TTL.md` (241 lines, removed) | Its earlier phantom TTL design and later per-driver-timezone cleanup description competed with current venue-local cleanup, validation v7 and explicit read failures. Current freshness and lifecycle contracts live in EVENTS. The absence of `events_facts`, event `expires_at`, the proposed trigger and an active cleanup timer remains explicit; no new scheduler was implied. |
| `docs/VENUELOGIC.md` (313 lines, removed) | The copied field/line inventory, old sample rows and unresolved venue-creation/role-field assertions were obsolete. [VENUES.md](../VENUES.md) owns provider identity, field provenance, independent Bars and catalog migration rollout. Historical sample values are recoverable, not current database evidence. |
| `docs/BRIEFING_AND_EVENTS_ISSUES.md` (565 lines, removed) | The duplicated February issue list mixed implemented fixes, removed entry points and unimplemented TTL/verifier proposals. EVENTS preserves each substantive finding's present status and does not certify old records or run operator repairs. |
| `docs/EVENTS.md` (former 928-line guide, rewritten) | Replaced copied schemas, stale model/validator references and supersession claims with source-linked entry points, input/output boundaries, shared writer locking, schedule variants, venue-local freshness, presentation and verification limits. |
| Ignored `rankings.extras` property in `enhanced-smart-blocks.js` | It was not in the rankings schema and had never been persisted. Canonical evidence remains in `ranking_candidates.venue_events`; [actual SQL coverage](../../../tests/events/main-collector-market.test.js) verifies saved event IDs, venue timezone and absolute timestamps. [Orchestrator tests](../../../tests/venue/smart-blocks-evidence.test.js) assert the obsolete property is absent. This removed no stored column or historical data. |

Preserved reasoning includes the April 15-mile destination / 60-mile context distinction
and links to its original plans; the July cross-venue span-dedup investigation (historical
todo #5) remains explicitly unclosed. Unique/null provider identities cannot be assumed
to prove physical-venue equivalence, and real colocated businesses must remain separate.
Text-clock DST ambiguity, heuristic semantic matching, language/address coverage and the
current discovery prompt's missing explicit country field remain documented limits.
Unicode normalization and venue creation are source fixes, not proof of a historical
backfill. June development cleanup / pending-production claims remain historical Git
evidence rather than a claim about today's database. Operator repair scripts were not run.

The current guide includes bounded provider cancellation and the root review's disposable
PostgreSQL shared-writer result (5/5 with real pooled connections and advisory locks),
while distinguishing that result from single-connection PGlite coverage. The required
colocated-catalog migration remains **not applied to the application database**. No live
provider, application deployment or physical-device verification was implied.

Current documentation indexes now link the canonical guide. References in dated audits,
review queues and merge history are intentionally retained as historical provenance;
there were no active source imports or Markdown links depending on the removed guides.
Recover any original without adding another duplicate public archive:

```sh
git show 6e98390697dfd3d677702bc64fe206b2383f5279:docs/EVENTS.md
git show 6e98390697dfd3d677702bc64fe206b2383f5279:docs/EVENT_FRESHNESS_AND_TTL.md
git show 6e98390697dfd3d677702bc64fe206b2383f5279:docs/VENUELOGIC.md
git show 6e98390697dfd3d677702bc64fe206b2383f5279:docs/BRIEFING_AND_EVENTS_ISSUES.md
```
