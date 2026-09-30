# Independent pipelines and manual entry points

Source traced September 29, 2026 alongside the [MAIN waterfall](ai-pipeline.md).
These entry points have separate admission/lifetimes. No provider was called,
legacy provider script executed, application gateway started, or application database
written during this review.

| Pipeline | Entry and source | Boundary / result |
|---|---|---|
| Siri translation | [hooks/translate.js](../../server/api/hooks/translate.js) | Public legacy Shortcut, required device metadata; strict output and cancellation. [Full trace](TRANSLATION.md). |
| Welcome AI | [slides.tsx](../../client/src/pages/welcome/slides.tsx) → [welcome-ai.js](../../server/api/welcome-ai/welcome-ai.js) | Public kiosk `/icebreaker` and `/ask`, shared 20/IP/10-minute limiter, server-held provider credentials. Calls the existing Gemini adapter directly. No driver profile, MAIN admission or Coach memory. |
| Address validation | Registration in [auth.js](../../server/api/auth/auth.js) → [address-validation.js](../../server/lib/location/address-validation.js) | Google Address Validation then optional geocoding; supports profile setup, not current GPS. Registration remains possible if validation is unavailable. |
| Coach text/voice/TTS | [RIDESHARE_COACH.md](RIDESHARE_COACH.md) | Authenticated owner/snapshot context, scoped action receipts and voice lifetime. Saved-only Analyzer boundary retained. |
| Memo export | [pull-coach-memos.mjs](../../scripts/pull-coach-memos.mjs) | Manual export under the sole supplied `DATABASE_URL`, serialized DB/file append with retry receipt; [runbook](../COACH_RUNBOOK.md). Never commit private inbox content. |

Welcome request ownership lives in the slide: each action has one synchronous
request slot; unmount aborts active work and retry delay, and late replies cannot
publish. Existing bounded retry behavior remains for live 5xx/network failures.
The server forwards disconnect/deadline cancellation and rejects blank/non-string
provider output. The generated “Driver says” presentation remains the existing
public kiosk behavior; it is not a message from the signed-in Coach.

Address validation distinguishes provider availability from successful validation.
Missing key, provider error, malformed response or exception returns
`valid:false, skipped:true`; a complete address with unconfirmed components is
not confirmed. Precision comes from `verdict.geocodeGranularity`. Registration
only adopts corrected fields/coordinates from a confirmed valid result; otherwise
it retains submitted fields and may geocode them. Coordinates pass the shared
finite/range validator, including valid zero values; an explicit chosen market
is preserved. A profile address change clears stale derived home coordinates and
timezone before optional resolution. The
[Google response contract](https://developers.google.com/maps/documentation/address-validation/reference/rest/v1/TopLevel/validateAddress)
is the provider reference; mocked tests do not establish live deliverability.

## Background/manual inventory

| Source | Actual startup relationship | Review boundary |
|---|---|---|
| [gateway-server.js](../../gateway-server.js), [bootstrap/workers.js](../../server/bootstrap/workers.js) | Gateway conditionally owns the Strategy child process. | Root audit covers process start/restart/shutdown ownership. The gateway also runs migrations at startup, so it was not started merely to test an entry. |
| [strategy-generator.js](../../strategy-generator.js) → [triad-worker.js](../../server/jobs/triad-worker.js) | Child entry establishes DB connectivity then the LISTEN worker. | Worker startup coalesces in-process starts; DB admission/source claims guard model work and publication. A heartbeat is not proof of pipeline completion. |
| [event-cleanup.js](../../server/jobs/event-cleanup.js) | Gateway starts its default hourly cleanup loop. | In-process loop and running guard; calls `fn_deactivate_ended_events()`, whose tracked migration uses each venue timezone and preserves unknown zones. Live function/schema not checked here. |
| [event-sync-job.js](../../server/jobs/event-sync-job.js) | No runtime starter reference found; gateway explicitly removed daily sync in February. Direct CLI and exported starter still exist. | Retired with explicit failure and no DB/provider/timer imports; see receipt below. |
| [change-analyzer-job.js](../../server/jobs/change-analyzer-job.js) | No runtime import/start call found despite its old “startup” header. | Exported optional job inspects repository changes and writes documentation queue/logs. It is not a MAIN event/provider worker; not executed in this review. |

The old event-sync job and its sole discovery module, `server/scripts/sync-events.mjs`,
are now retired after a full source/caller trace. Their unsafe UTC start-date
cleanup, two-decimal location snapshots, missing country/timezone, duplicate timer
ownership, independent direct-provider/writer path and false successful CLI exit
have been removed. Compatibility imports and both direct CLI paths fail explicitly
with the current admitted discovery reference. No database or provider initializes.
[Retirement receipt](removals/2026-09-29-independent-pipelines.md) records recovery
and preserved airport/market seed capabilities. Tests invoke only the new inert
failure shims, not the former provider implementation. This bounded inventory does
not certify every repository maintenance script or its live data effects.

Verification sources: `tests/independent/translation-welcome.test.js`,
`tests/client/welcome-ai-lifecycle.test.tsx`, `tests/location/address-validation.test.js`,
`tests/auth/account-transactions.test.js`, `tests/auth/profile-address-change.test.js`,
`tests/coach/memo-export.test.js`, `tests/independent/retired-event-sync.test.js`. Provider/DB/file boundaries are mocked; no private
messages or live driver fixtures are embedded in the tests.
