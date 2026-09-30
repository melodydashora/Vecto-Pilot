# Strategy library

Source traced September 29, 2026. The full admitted MAIN flow is maintained in
[ai-pipeline.md](../../../docs/architecture/ai-pipeline.md); this is the local
module map, not a second orchestration specification.

| Current file | Responsibility |
|---|---|
| [strategy-source.js](strategy-source.js) | Pure checks binding `strategy_for_now` to the exact saved Briefing generation. A populated text column alone cannot prove current Strategy. |
| [strategy-source-store.js](strategy-source-store.js) | Read, claim and conditional publication of that source receipt under the current MAIN admission; obsolete/duplicate writers cannot replace current results. |
| [strategy-utils.js](strategy-utils.js) | Strategy row creation, readiness, phase updates and shared event/news time helpers. Creation failures and missing rows throw. Terminal completion requires committed rankings, current source and admission; its transaction publishes the single `blocks_ready` notification. |
| [status-constants.js](status-constants.js) | Status vocabulary and compatibility predicates. These enums alone are not source/admission checks. |
| [tactical-planner.js](tactical-planner.js) | Venue planner via `VENUE_SCORER`, taking saved Strategy, snapshot, bounded Briefing context and admitted driver preferences; verified Places/Routes work follows. |
| [index.js](index.js) | Small barrel for row/phase helpers and `generateTacticalPlan`. The nonexistent `fallbackStrategy` export was removed; `tests/strategy/barrel.test.js` imports the actual barrel. |

MAIN enters through `server/api/strategy/main-runs.js`, persists/enriches a
snapshot, obtains a complete atomic Briefing, runs the Strategist in
`server/lib/ai/providers/consolidator.js`, then obtains venue rankings through
`server/api/strategy/blocks-fast.js`. The child entry `strategy-generator.js`
and `server/jobs/triad-worker.js` are outside this directory. Caller-provided
snapshot objects do not bypass authoritative snapshot/source rechecks.

Strategist event hours use saved `venue_id`, the exact venue's hours and venue
IANA timezone. Same-name venues do not share status. Missing identity/timezone
stays unknown; no extra paid lookup is made. Saved absolute event instants and
venue-local day boundaries outrank ambiguous display clocks. Prompt coordinates
retain supplied numeric precision; display-distance rounding is separate.

Shared time helpers require explicit offsets or a supplied IANA timezone for
local clocks; there is no host-timezone fallback. They preserve multi-day,
overnight and explicitly all-day events, reject malformed times, and retain the
existing three-hour missing-end estimate plus two-hour surge window. News uses
its publication time and the three-calendar-day freshness window in the supplied
zone; future publication times are rejected. See the actual helpers/tests for
field precedence rather than copying another parser.

Admitted preferences and vehicle reach Strategist and planner through
`mainDriverContext`. Analyzer rules are pinned for configuration change detection
but withheld from MAIN model prompts while integration is on hold. There is no
active daily-strategy generator/export in this directory and no requirement to
force saved-preference edits before Continue.

Validation: `tests/strategy/`, `tests/events/consolidator-date-gate.test.js` and
`tests/events/event-read-reconciliation.test.js` exercise the source/phase and
time boundaries with synthetic fixtures. PostgreSQL semantics were checked in
in-memory PGlite, not by inspecting or mutating a deployed application's schema.
The tracked migrations and an observed live schema are different evidence.
