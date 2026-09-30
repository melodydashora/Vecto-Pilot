# Coach API

Source review: 2026-09-29. This describes repository behavior, not current deployment.

| Entry | Boundary |
|---|---|
| `POST /api/chat` (`chat.js`) | Authenticated Coach brain; snapshot ownership checked before context/provider use. |
| `GET /api/chat/context/:snapshotId` | Authenticated and snapshot-owned; `summary=1` returns source progress. |
| `coach-live.js` | Active live-voice session setup; bounded bootstrap and delegated questions use the same brain. |
| `realtime.js`, `gemini-live.js`, `tts.js` | Retained voice/transport routes; do not assume their smaller bootstrap is full brain context. |

`server/lib/ai/rideshare-coach-dal.js` loads saved snapshot/briefing/strategy, driver
profile and active primary vehicle, owner notes, full recent offer records and
longitudinal patterns. The current profile includes `selected_services`, separately
from eligibility. Offer history is bounded (20 nonremoved rows); pattern reads use
an owner-scoped 180-day window. `coach-source-context.js` serializes complete saved
source records as data in addition to the readable summary.

Current owner rules are read through `getOfferRules()` on a brain turn. `source_state`
distinguishes `saved`, `profile_defaults`, `unavailable`, `read_failed` and `invalid`.
The source context carries effective config, saved version/hash/update time,
`stored_schema_version` and `effective_hash`; raw stored hash verification and migrated
effective config are different receipts. Invalid/failed reads do not become defaults.
The existing snapshot/timezone entry requirements remain; this is not before-GPS access.
Architecture documents and model-registry source are no longer runtime rules input.

`model-registry.js` selects the brain/voice roles. The Responses adapter checks complete
versus incomplete output before success. `parse-actions.js` detects tags and the route
validates supported actions. Legacy `LOG_OFFER_DECISION`, `UPDATE_OFFER_DECISION` and
`BACKFILL_OFFER_INTEL` model-emitted mutations are retired: recognized attempts receive
an explicit not-saved error. Historical offer records remain readable. Driver outcomes
and immediate overrides remain available through the Offer Analyzer controls/API.
Coach explains saved evidence; it must not OCR a live offer, issue a new live verdict,
rewrite Analyzer capture evidence or automatically tune the driver's rules.

Relevant tests: `tests/coach/chat-completion.test.js`, `incremental-context.test.js`,
`restoration.test.js`, `gpt-live-session.test.js` and action validation tests.
See [the Analyzer reference](../../../docs/architecture/OFFER_ANALYZER.md#15-coach-integration)
for the downstream boundary, and the current task receipt for executed checks.


The full source-backed trace and September regression evidence live in
[the canonical Coach guide](../../../docs/architecture/RIDESHARE_COACH.md).
Saved snapshot timezone overrides browser hints. Disconnect cancellation spans
provider streaming, each later action, automatic learning and assistant completion;
an already-started DB write may still commit. Voice transcript queues keep their
original session credential/snapshot through teardown, and late microphone/audio
callbacks cannot restart a stopped or replaced session. TTS and retained token
routes propagate cancellation to their provider transports. The legacy token routes
return credentials with `Cache-Control: no-store` and validate their response shape.
