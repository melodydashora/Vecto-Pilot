# Server-Sent Events

Source-reconciled September 29, 2026. SSE delivers wake-ups to saved-data readers. It does not establish that a Briefing, Strategy, ranking or spoken Analyzer decision succeeded. See the [MAIN trace](ai-pipeline.md), [Analyzer boundary](OFFER_ANALYZER.md) and [review register](audits/PIPELINE_REVIEW_2026-09-29.md).

## Sources and consumers

| Endpoint | Upstream | Wire event and scope |
|---|---|---|
| `/events/strategy?snapshot_id=…` | `strategy_ready` notification; tracked strategy trigger migration | `strategy_ready`, owned snapshot |
| `/events/briefing?snapshot_id=…` | Final `briefing_ready` plus seven [section channels](../../server/lib/briefing/briefing-channels.js) | `briefing_ready`, owned snapshot; progressive completion is not final readiness |
| `/events/blocks?snapshot_id=…` | [strategy-utils.js](../../server/lib/strategy/strategy-utils.js) atomic ranking/admission completion | `blocks_ready`, owned snapshot and saved ranking ID |
| `/events/phase?snapshot_id=…` | In-process [phase emitter](../../server/events/phase-emitter.js) | Default `message`, owned snapshot only |
| `/events/offers` | `offer_analyzed` notification | `offer_analyzed`, authenticated owner only |

[bootstrap/routes.js](../../server/bootstrap/routes.js) mounts the [stream router](../../server/api/strategy/strategy-events.js) at the root. Phase delivery is process-local; it is not a cross-instance event bus. Polling and the saved phase state remain necessary. The tracked migration for `strategy_ready` is source evidence, not confirmation of the selected database's installed triggers.

## Server lifetime

The router authenticates and verifies snapshot ownership before sending headers. Every stream uses the same lifecycle:

1. Register close/error/abort cleanup and send SSE headers.
2. Acquire the required database subscriptions before reading initial saved state. Register each acquired release immediately, including partial setup. If close wins while LISTEN is pending, release the late acquisition instead of adding more channels.
3. Send a `state` event after registration, including when no saved row exists. The client refetches canonical data; this closes the lost-notification registration window.
4. Filter every notification by snapshot and, where supplied, owner; offer notifications always require exact owner. Phase uses the same ownership filter.
5. Recheck current authentication/session before state or notification delivery and on the 30-second heartbeat. Remote logout, reset, expiry, credential rotation or a failed authorization read closes the stream. These checks do not update session activity.
6. Response `close`/`error` or request `aborted` releases listeners and stops the heartbeat. Request `close` alone is not used: a consumed GET can still have a live streaming response.

The shared non-mutating guard is in [auth middleware](../../server/middleware/auth.js). Client logout also closes streams immediately; server authorization is still required for clients that remain connected elsewhere.

## Database LISTEN connection

[db-client.js](../../server/db/db-client.js) owns one LISTEN connection and dispatches notifications to per-channel registrations. Each subscription has its own identity, even when consumers reuse a callback. Channel changes serialize on the current connection. Failed initial LISTEN cannot leave a falsely healthy registration; failed restoration cannot mark reconnect complete.

Reconnect restores the desired channel set before resolving readiness, then calls each still-current subscription's recovery callback. This wakes HTTP streams that stayed connected while only the database connection failed. The stream coalesces concurrent state reads; if an older read fails during reconnect, it still sends an authenticated refetch wake-up rather than consuming the recovery signal silently. Shutdown fences pending connects, retries and delayed callbacks; unsubscribe cannot reopen a closed connection. [connection-config.js](../../server/db/connection-config.js) provides the same parsed, verified TLS configuration as the query pool and migration runner. See the [DB guide](../../server/db/README.md) for details and test limits.

## Browser lifetime

[co-pilot-helpers.ts](../../client/src/utils/co-pilot-helpers.ts) shares one EventSource per endpoint/event key within the current token. No token means no new connection. A changed token closes the prior instance before creating its replacement. Delivery checks the current instance and token; each callback is isolated so an exception does not block other readers. Each subscribe call has its own release, including callers that reuse a callback. An old release cannot close a newer login's connection.

Named notifications and `state` both wake subscribers. Native EventSource retry is retained: the error callback records disconnection without closing the stream or clearing auth merely because transport failed. Reconnect opens a new server request and repeats ownership, subscriptions and saved-state recovery. There is no exactly-once delivery or durable event queue.

[auth-context.tsx](../../client/src/contexts/auth-context.tsx) clears streams and queries during logout, forced auth loss and cross-tab identity replacement. [co-pilot-context.tsx](../../client/src/contexts/co-pilot-context.tsx) scopes Strategy, blocks and phase subscriptions to the current snapshot. [useBriefingQueries.ts](../../client/src/hooks/useBriefingQueries.ts) gates subscriptions on auth, polls all seven sections and discards late responses for a replaced snapshot/session. Analyzer recovery is documented in its own trace; notification delivery does not replace phone shortcut speech.

## Verification and limits

[Server lifecycle tests](../../tests/strategy/sse-lifecycle.test.js) cover registration order, partial/late cleanup, foreign snapshots, revoked sessions and an actual local HTTP response that stays open after its GET is consumed. [Client tests](../../tests/client/sse-lifecycle.test.ts) cover token replacement, old releases, callback isolation and shared callback lifetime. [DB tests](../../tests/db/) cover LISTEN/UNLISTEN/reconnect/shutdown and TLS option construction with controlled connection doubles; they do not prove a remote TLS handshake or production reconnect.

This consolidates the April lifecycle guide and obsolete unauthenticated/unfiltered/no-reconnect TODOs. Its historical Analyzer correction is preserved in the current boundary above; previous text is recoverable through the [removal ledger](removals/2026-09-29-pipeline-review.md).


Final subscription release also tears down the idle physical LISTEN connection,
cancels keepalive/reconnect timers and invalidates any pending connection attempt.
A new subscription can open its own connection while the detached old client ends;
late cleanup cannot close that replacement. Explicit `getListenClient()` consumers
retain ownership until `closeListenClient()`; current production callers use
`subscribeToChannel`, while direct acquisition is exercised by the lifecycle tests.
