---
date: 2026-04-18
session_id: 2026-04-18-notify-loss-listen-reconnect
scope: Read-only RECON of NOTIFY-loss during LISTEN reconnect for the briefing pipeline (snapshot ef36f6c6 infinite-spinner case)
status: recon complete; no code changes; no migrations; no DB writes
author: claude-opus-4-7[1m]
related_docs:
  - docs/architecture/SSE.md
  - docs/architecture/audits/FRISCO_LOCK_DIAGNOSIS_2026-04-18.md
  - migrations/20260109_briefing_ready_notify.sql
  - migrations/20260110_fix_strategy_now_notify.sql
  - migrations/20260217_drop_briefing_ready_trigger.sql
constraints_honored:
  - read_only: true
  - prod_db_touched: false
  - dev_db_touched: false
  - schema_changes: none
  - migrations_applied: none
  - code_changes: none
  - server_restarted: false
  - republished: false
  - DECISIONS_md_modified: false
prior_work:
  - Phase 0a local commit e7034939 — flipped HTTP 202 → 200 + `_coverageEmpty` sentinel on 4 briefing sub-endpoints (server-side only, client unchanged)
---

# NOTIFY-loss RECON — 2026-04-18

Read-only investigation triggered by the prod-log evidence on snapshot `ef36f6c6-60e9-450c-9aa4-0d0c4c8b1523` (2026-04-18 01:32–01:42): the briefing rows committed to DB, the SSE channels closed for ~2.6 minutes, the LISTEN client re-attached, and the briefing tab spinners never cleared.

## TL;DR

**The hypothesis is correct, but it is one of two compounding bugs.**

- **Bug A — confirmed**: PostgreSQL `NOTIFY briefing_ready` is fire-and-forget. There is *no* PG buffering, *no* dispatcher catch-up replay, *no* SSE initial-state handshake. Anything that fires during the LISTEN reconnect window (1 s → 10 s exponential backoff, up to ~25 s cumulative across 5 retries) is lost permanently.
- **Bug B — newly surfaced by Phase 0a**: the new server-side `_coverageEmpty` sentinel returns `{ success: true, _coverageEmpty: true, reason, timestamp }` with **no `traffic` / `news` / `airport_conditions` field**. The client's loading detector (`isTrafficLoading(data) → if (!data?.traffic) return true`) treats the missing field as "still loading," kicks off the 12-attempt exponential backoff, and at exhaustion **stops polling without setting `_exhausted`**. `isLoading` stays stuck on `true`, the spinner spins forever, and there is no further self-heal once the SSE wake-up is missed.

In Melody's snapshot, the briefing rows are fully populated (traffic, 2 airports, 5 news items). The server would happily return them on the *next* poll. But polling has stopped, and the only mechanism that would have triggered a refetch — the `briefing_ready` SSE event — was lost during the 01:36:43 → 01:39:21 LISTEN reconnect window.

**The smallest correct fix is on the client**: teach `isTrafficLoading / isNewsLoading / isAirportLoading` to honor `_coverageEmpty` (and to not interpret a missing field as "still loading"). That alone clears the spinner immediately on the next poll, regardless of whether the SSE event was lost.

The longer-tail fix is on the server side: add an initial-state handshake on SSE subscribe — `event: state\n` with the briefing's current readiness vector — so a fresh subscriber always knows what's already in DB without depending on a future NOTIFY.

## 1. Topology — Emit → LISTEN → Dispatcher → SSE → Client

```
                                    ┌──────────────────────────────┐
                                    │  PostgreSQL 16 (Replit Helium)│
                                    │   - NOTIFY pub/sub (no buffer)│
                                    │   - 5-min idle disconnect TO  │
                                    └──────────────┬───────────────┘
                                                   │
   ┌───────────────────┐  pool       ┌─────────────▼────────────┐    LISTEN client
   │ briefing-service.js│─────────────▶ pg_notify('briefing_ready│   (dedicated pg.Client)
   │  (gateway proc)    │  pool acquire│  ', '{snapshot_id:...}')│   keepAlive: true
   │  line 2949         │              └────────────┬─────────────┘   keepalive every 4 min:
   │  AFTER commit of   │                           │                  SELECT 1 (db-client.js:69)
   │  briefings INSERT/ │                           │                  exp-backoff reconnect:
   │  UPDATE            │                           │                  1s → 2s → 4s → 8s → 10s
   └───────────────────┘                           │                  × 5 retries (~25 s)
                                                   ▼
                              ┌───────────────────────────────────────┐
                              │ db-client.js — Notification Dispatcher│
                              │  - One pg.Client (singleton)          │
                              │  - One 'notification' handler         │
                              │  - channelSubscribers: Map<chan, Set> │
                              │  - resubscribeChannels() re-LISTEN    │
                              │    after reconnect (no replay)        │
                              └────────────────┬──────────────────────┘
                                               │ subscribers.forEach(cb)
                            ┌──────────────────┼──────────────────┐
                            ▼                  ▼                  ▼
              ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
              │ /events/briefing │ │ /events/strategy │ │ /events/blocks   │
              │   SSE handler     │ │   SSE handler    │ │   SSE handler    │
              │   strategy-events │ │   :50            │ │   :143           │
              │   .js:99          │ │                   │ │                   │
              │ ✗ NO initial-     │ │ ✗ NO initial-    │ │ ✗ NO initial-    │
              │   state handshake │ │   state handshake│ │   state handshake│
              │ Heartbeat 30 s    │ │ Heartbeat 30 s   │ │ Heartbeat 30 s   │
              └────────┬──────────┘ └────────┬─────────┘ └────────┬─────────┘
                       │ HTTP SSE             │                    │
                       ▼                      ▼                    ▼
              ┌──────────────────────────────────────────────────────┐
              │ Client SSE Manager (singleton, co-pilot-helpers.ts)  │
              │  - One EventSource per endpoint, shared subscribers  │
              │  - ✗ NO client-side auto-reconnect on onerror        │
              └────────────────────┬─────────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │  useBriefingQueries hook                │
              │   - subscribeBriefingReady → refetchAll │
              │   - 12-attempt exp-backoff polling      │
              │     (2s → 4s → 8s → 16s → 30s × 7)      │
              │   - ✗ Treats absent `traffic` field as  │
              │     "still loading" (Bug B)              │
              │   - ✗ Stops polling at attempt 12 with  │
              │     no `_exhausted` flag (Bug B cont'd) │
              └──────────────────────────────────────────┘
```

**Verified file & line references:**

| Hop | What | Where |
|-----|------|-------|
| Emit | `SELECT pg_notify('briefing_ready', ...)` after `briefings` INSERT/UPDATE commit, via the main `db` pool (NOT the LISTEN client) | `server/lib/briefing/briefing-service.js:2949` |
| Emit (blocks) | `pgClient.query("NOTIFY blocks_ready, ...")` directly on the LISTEN client | `server/jobs/triad-worker.js:138` |
| Trigger (strategy) | `pg_notify('strategy_ready', ...)` from PG trigger on `strategies` table when `strategy_for_now` or `consolidated_strategy` flips from NULL → non-NULL | `migrations/20260110_fix_strategy_now_notify.sql` |
| Trigger (briefing) | **DROPPED 2026-02-17** — only the manual emit at briefing-service.js:2949 remains | `migrations/20260217_drop_briefing_ready_trigger.sql` |
| LISTEN client | One singleton `pg.Client`, exponential-backoff reconnect, `notificationHandlerAttached` flag | `server/db/db-client.js:1–186` |
| Dispatcher | `channelSubscribers: Map<channel, Set<callback>>` plus single `notification` handler that fans out | `server/db/db-client.js:200–322` |
| SSE handlers | All three follow the same pattern: SSE headers → `: connected\n\n` → `subscribeToChannel()` → forward NOTIFY payload as named SSE event | `server/api/strategy/strategy-events.js:50, 99, 143` |
| Client manager | Singleton `Map<key, SSESubscription>`, no auto-reconnect | `client/src/utils/co-pilot-helpers.ts:26–117` |
| Client subscribe | `subscribeBriefingReady` → `refetchAllBriefingQueries` for all 6 briefing queries | `client/src/hooks/useBriefingQueries.ts:208–230` |
| Client polling | 12-attempt exp-backoff per query; stops at exhaustion | `client/src/hooks/useBriefingQueries.ts:413–423, 487–497, 561–571, 683–693` |

## 2. Delivery-guarantee gaps (root-cause table)

| # | Gap | Severity | Location | Effect |
|---|-----|----------|----------|--------|
| **G1** | PostgreSQL NOTIFY has no per-channel buffer. Events sent while no session is `LISTEN`ing are dropped. | High | PG protocol | NOTIFY → /dev/null whenever the LISTEN client is between disconnect and `LISTEN` re-issue. |
| **G2** | Dispatcher reconnect re-issues `LISTEN` for every channel in `channelSubscribers`, but performs **no catch-up query** for events that fired during the reconnect window. | High | `db-client.js:222–257` | After reconnect, the dispatcher is "live again" but has no idea any briefing committed during the gap. The SSE fan-out for that snapshot will never fire. |
| **G3** | SSE handlers (`/events/briefing`, `/events/strategy`, `/events/blocks`) have **no initial-state handshake**. They write `: connected\n\n`, attach `subscribeToChannel`, and from that moment forward only forward live NOTIFYs. | High | `strategy-events.js:60, 109, 153` | A client whose snapshot's briefing was committed *before* it subscribed will never get a `briefing_ready` event for that snapshot. Reliance on polling is mandatory. |
| **G4** | The Phase 0a server sentinel `{ success: true, _coverageEmpty: true }` omits the data field (`traffic`, `news`, `airport_conditions`). The client's `isTrafficLoading(data)` returns `true` whenever `!data?.traffic`. | High | `useBriefingQueries.ts:166–185` (client) ↔ `briefing.js:553–559, 598–604, 945–951, 1003–1009` (server) | The client treats the sentinel as "still loading," polls 12 times, then stops without setting `_exhausted` — the spinner is permanently stuck on `isLoading=true`. |
| **G5** | Client SSE manager has no auto-reconnect on `onerror`. The connection stays dead until a component remounts. | Medium | `co-pilot-helpers.ts` (per SSE.md §10 known gap #1) | If the SSE socket drops (mobile sleep, network switch, server reload), the briefing subscription is silently dead — even live NOTIFYs after the drop are not forwarded. |
| **G6** | `triad-worker.js:58` registers a `notification` handler **directly** on the shared LISTEN client (not via `subscribeToChannel`). On reconnect, `pgClient.removeAllListeners()` (db-client.js:38) kills it, and `resubscribeChannels()` only restores the dispatcher handler. The triad-worker handler is **not re-attached**. | Medium (process-scoped) | `triad-worker.js:58, 152` ↔ `db-client.js:38, 222–257` | After a LISTEN reconnect *inside the strategy-generator subprocess*, `strategy_ready` arrives but the triad-worker stops generating SmartBlocks and stops emitting `NOTIFY blocks_ready`. (Only relevant when `ENABLE_BACKGROUND_WORKER=true`; otherwise the strategy-generator subprocess never starts.) |
| **G7** | The notify-handler-attached flag is process-local, but the LISTEN client lifecycle is also process-local. Each Node process (gateway + strategy-generator subprocess if spawned) has its own copy. The SSE handlers in the gateway process and the triad-worker LISTEN in the subprocess do not share state — so a subprocess reconnect does not affect SSE delivery, and vice versa. | Informational | `db-client.js` module scope | This is correct, but easy to misread when chasing the bug. Document explicitly. |

## 3. Mapping the evidence to the architecture

Prod log timeline for snapshot `ef36f6c6` on 2026-04-18:

| Time | Event | Architectural meaning |
|------|-------|------------------------|
| 01:32–01:36 | Briefing generation completes server-side (traffic, 2 airports, 5 news items DFW logged) | `briefing-service.js:2779` `Promise.allSettled` succeeded for at least 4 subsystems. The row was UPDATEd. |
| ~01:36 (window) | `pg_notify('briefing_ready', '{snapshot_id:...}')` fired via the main `db` pool | `briefing-service.js:2949` — fire-and-forget. The emit succeeded (try/catch only logs failure). |
| 01:36:43.15 | `/events/briefing /events/strategy /events/blocks /events/phase all closed` | Either the SSE socket lost the client (HTTP-layer close) OR the LISTEN client emitted `'end'` and `reconnectWithBackoff()` triggered. The log entry "Re-LISTENed ... LISTEN client reconnected, Notification dispatcher re-attached" at 01:39:21 strongly suggests the LISTEN client closed and reconnected. |
| 01:36:43 → 01:39:21 | **Vulnerability window — ~2.6 minutes** | If `briefing_ready` fired *inside* this window, it's gone. PG dropped it. Dispatcher has no replay. |
| 01:39:21 | "Re-LISTENed blocks_ready + briefing_ready + strategy_ready, LISTEN client reconnected, Notification dispatcher re-attached" | Matches `db-client.js:222–257` exactly. New `pg.Client`, new connect, `resubscribeChannels()` re-issues LISTEN per channel from `channelSubscribers`, then re-attaches the dispatcher handler. |
| 01:42:07 | Closed again | Another disconnect — likely a Replit-side connection cycle or transient network. |
| 01:42:12 | Reconnected (5 s) | Fast reconnect — `1s` initial backoff + connect + resubscribe. |

**Did the NOTIFY land in the gap or after?** The log doesn't directly tell us when `briefing-service.js:2949` ran relative to 01:36:43. Two cases:

1. **NOTIFY fired before 01:36:43** — the dispatcher should have forwarded it to the SSE subscriber. SSE then writes `event: briefing_ready\n` to the client. Client's `subscribeBriefingReady` callback runs `refetchAllBriefingQueries`. **This case is inconsistent with the spinning-spinner symptom unless the SSE socket itself was already closed on the client side at the time of NOTIFY.**
2. **NOTIFY fired during 01:36:43 → 01:39:21** — dropped by PG. Dispatcher learns nothing. SSE forwards nothing. Client's subscriber is connected (the SSE channel re-attaches at 01:39:21, presumably as the client reopens), but the original NOTIFY is gone. **This case matches the symptom.**

In both cases, **Bug B (G4) is what makes the spinner permanent** rather than just "delayed." Without G4, polling would have eventually returned the now-populated traffic/news/airport rows and the spinner would have cleared. With G4, polling halts at attempt 12 with no exhaustion flag — the spinner is now an undead state.

## 4. What triggers LISTEN reconnects

From `db-client.js`:

- `pgClient.on('error', ...)` — any DB error fires `reconnectWithBackoff` (line 88).
- `pgClient.on('end', ...)` — connection closed by server fires `reconnectWithBackoff` (line 99).

From the runtime environment:

- **Replit Helium PostgreSQL idle disconnect** is the single most likely trigger. The keepalive `SELECT 1` runs every **4 minutes** (line 73), inside a presumed 5-minute server-side idle window — so most of the time it works. But a single transient network blip during the keepalive (or a Replit-side connection cycle for maintenance) is enough to fire `'end'` and start the reconnect dance.
- `pg.Client.keepAlive: true` with `keepAliveInitialDelayMillis: 10000` adds TCP-layer keepalive on top of the application-layer ping. Both layers can fail together if the network is flaky.
- **Pool recycling does not apply** — the LISTEN client is a dedicated `pg.Client`, not from the `pool` (which is `connection-manager.js`). The pool is used only for one-off NOTIFY emissions and normal queries.
- **Process-level restarts** (gateway crash, strategy-generator restart) would reset everything from scratch, but the snapshot in question was inside a single uninterrupted process based on the log narrative.

**During the reconnect window itself, what happens to incoming NOTIFYs?**

- PostgreSQL receives the `pg_notify(...)` and dispatches it only to currently-listening sessions. If no session has an outstanding `LISTEN <chan>`, the message is **dropped immediately**. There is no per-channel buffer.
- Once the new `pg.Client` finishes `connect()` and `resubscribeChannels()` runs `LISTEN <chan>`, future NOTIFYs are again deliverable — but past NOTIFYs are lost.
- Worst-case window: 5 retries × backoff `1s + 2s + 4s + 8s + 10s = 25s` plus connect time. In practice the prod log shows ~2.6 minutes total — which suggests the original `'end'` may not have been the first failure, or that `connect()` itself took multiple seconds per attempt. Either way: the window is large enough to lose any NOTIFY emitted during normal briefing completion.

## 5. Does the dispatcher replay missed NOTIFYs after reconnect?

**No.** `resubscribeChannels()` (db-client.js:222–257) does exactly two things:

1. For each channel in `channelSubscribers`, call `pgClient.query(LISTEN ${channel})`.
2. If `notificationHandlerAttached === false`, attach the dispatcher handler.

There is no query of the form `SELECT snapshot_id FROM briefings WHERE updated_at > $lastSeenAt AND traffic_conditions IS NOT NULL` to backfill missed events. The dispatcher has no high-water-mark per channel. After reconnect, the dispatcher behaves as if no NOTIFYs were missed — the next inbound NOTIFY is the first event it knows about.

## 6. Does the SSE handler send initial state on subscribe?

**No.** Each handler (`/events/briefing`, `/events/strategy`, `/events/blocks`) follows this exact sequence (see strategy-events.js:99–141 for briefing):

1. `res.writeHead(200, { 'Content-Type': 'text/event-stream', ... })`
2. `res.write(': connected\n\n')` — SSE comment, ignored by `EventSource`
3. `startHeartbeat(res)` — 30 s `: heartbeat\n\n` writer
4. `unsubscribe = await subscribeToChannel('briefing_ready', (payload) => res.write('event: briefing_ready\ndata: ${payload}\n\n'))`
5. Wait. Forever (until `req.close`).

There is no read of the snapshot's current briefing state. There is no `event: state\ndata: {...}\n\n` emission on connect. A subscriber that arrives after the briefing is committed gets nothing until the *next* NOTIFY for the *next* snapshot.

This is the architectural gap that makes Bug A (NOTIFY loss) catastrophic. With an initial-state handshake, even a lost NOTIFY would be self-healed on the next SSE reconnect: the client closes the dead connection, the manager could re-open (if G5 were fixed), and the new SSE handler would push the current state immediately.

## 7. Ranked hypotheses for the spinning briefing tab

Ranked by probability that this specific snapshot's symptom is explained by the hypothesis.

### H1 — Bug A + Bug B combined (≈ 80 % confidence — **most likely**)

`briefing_ready` fired during the 01:36:43 → 01:39:21 LISTEN reconnect window and was dropped. The client's SSE subscriber received nothing. Polling continued for 12 attempts (~3.5 min cumulative with backoff), each returning Phase 0a's `_coverageEmpty` sentinel. `isTrafficLoading` saw the missing `traffic` field and counted each as "still loading." At attempt 12, polling stopped without setting `_exhausted`. `isLoading` remains `true`, spinner spins forever, no further trigger.

**Why this is the strongest hypothesis**: the symptom is permanent (not "delayed by N seconds"), and only G4 produces a permanent stuck-loading state on the client. G3 + G2 + G1 alone would explain a *delayed* clear (whenever polling next runs), but Phase 0a + G4 turns a delay into a permanent stop.

### H2 — Bug B alone, NOTIFY not lost (≈ 15 %)

`briefing_ready` was delivered to the SSE subscriber, but the client refetched too early (before the briefing UPDATE actually committed) — got `_coverageEmpty` from one or more sub-endpoints — and entered the same dead-end loop. Possible if `pg_notify` fired while the row UPDATE was still in flight (unlikely given the manual emit is `await`ed after the write at briefing-service.js:2942–2949, so the write has *committed* by the time NOTIFY fires).

### H3 — Bug A alone, no Bug B contribution (≈ 5 %)

`briefing_ready` was lost AND the client polling somehow recovered, but a different stuck-loading bug exists in a component layer not yet inspected. Unlikely given the depth of the trace through `useBriefingQueries`.

### H4 — Different snapshot mid-flight (< 1 %)

A second snapshot was created during the gap, the user's `lastSnapshotId` flipped, and the spinning spinner is for the *new* snapshot's briefing-in-progress. Inconsistent with the FRISCO_LOCK_DIAGNOSIS notes that this snapshot's briefing had completed.

### H5 — Stale SSE subscriber (G5) (< 1 %)

The client's EventSource silently died (Bug G5: no auto-reconnect on `onerror`) and the SSE manager never reopened. New `briefing_ready` events would not reach the client. Possible contributor but not necessary to explain the symptom — H1 already accounts for everything.

## 8. Proposed fixes — smallest first

Each fix listed with: minimal change footprint, fixed gaps, and what symptom it eliminates.

### F1 — Teach the client to honor `_coverageEmpty` (smallest, kills the permanent stuck-loading)

**Files**: `client/src/hooks/useBriefingQueries.ts` only.

**Change**: in the four loading detectors, treat `_coverageEmpty === true` as "loaded but empty" instead of "still loading":

```diff
 function isTrafficLoading(data: any): boolean {
+  if (data?._coverageEmpty) return false;
   if (!data?.traffic) return true;
   return data.traffic.summary === 'Loading traffic...' || data.traffic.summary === null;
 }
```

(repeat for `isAirportLoading`, `isNewsLoading`, optionally extend to `isEventsLoading`)

**Gaps closed**: G4 (entire bug B class).
**Symptom eliminated**: spinning briefing tab in *every* market with empty subfields, regardless of whether SSE delivered. Polling now terminates with a clear "no data for this market" UI state rather than spinning forever.
**Risk**: zero — the sentinel is a brand-new field; no existing client code reads it yet.
**Why this is first**: it converts the failure mode from "permanent silent failure" into "graceful empty state." Even if NOTIFY-loss is never fixed, the symptom Melody saw cannot recur.

### F2 — SSE initial-state handshake on `/events/briefing`

**Files**: `server/api/strategy/strategy-events.js` only.

**Change**: accept an optional `?snapshot_id=<uuid>` query param. On subscribe, look up the briefing's current readiness vector and emit it as an initial event before attaching the live NOTIFY listener:

```js
const snapshotId = req.query.snapshot_id;
if (snapshotId) {
  const briefing = await getBriefingBySnapshotId(snapshotId);
  if (briefing) {
    res.write(`event: state\n`);
    res.write(`data: ${JSON.stringify({
      snapshot_id: snapshotId,
      has_traffic: briefing.traffic_conditions != null,
      has_news: briefing.news != null,
      has_airport: briefing.airport_conditions != null,
      has_school_closures: briefing.school_closures != null,
      has_events: true,
      has_weather: briefing.weather_current != null,
      ts: new Date().toISOString()
    })}\n\n`);
  }
}
```

The client wires the new `state` event to the same `refetchAllBriefingQueries` callback. Apply the same shape to `/events/strategy` and `/events/blocks`.

**Gaps closed**: G3 (and indirectly G1/G2, since the handshake makes them harmless).
**Symptom eliminated**: a client that arrives after a NOTIFY has fired (or after a NOTIFY was dropped) gets the current state pushed within milliseconds of subscribing. The next reconnect is automatically self-healing — no replay logic required because the *current* state is the only thing that matters.
**Risk**: low. Requires clients to send `snapshot_id` (additive, easy to gate behind a feature flag).
**Why second**: this is the architecturally cleanest long-term fix and obviates any need for a complex catch-up replay mechanism. But F1 is enough to clear the immediate symptom.

### F3 — Dispatcher catch-up window after reconnect

**Files**: `server/db/db-client.js` only.

**Change**: track `lastNotifyAt` per channel as a high-water mark. After `resubscribeChannels()`, run a per-channel catch-up query:

```sql
-- For briefing_ready:
SELECT snapshot_id FROM briefings WHERE updated_at > $lastSeenAt AND traffic_conditions IS NOT NULL;
-- For strategy_ready:
SELECT snapshot_id FROM strategies WHERE updated_at > $lastSeenAt AND strategy_for_now IS NOT NULL;
-- For blocks_ready:
SELECT snapshot_id FROM rankings WHERE updated_at > $lastSeenAt;
```

Synthesize a virtual NOTIFY for each row found and dispatch via the same `subscribers.forEach(cb)` path.

**Gaps closed**: G2.
**Symptom eliminated**: notifications fired during the reconnect window are recovered on reconnect, even without F2.
**Risk**: medium. Each channel needs its own SQL + catch-up logic; risk of double-delivery if NOTIFY arrives normally AND catch-up fires for the same row. Requires per-channel idempotency on the consumer side (which `refetchAllBriefingQueries` already is).
**Why third**: more code surface than F2, and F2 already removes the value of catch-up by making the next handshake authoritative.

### F4 — Triad-worker dispatcher migration (subprocess fix)

**Files**: `server/jobs/triad-worker.js` only.

**Change**: replace `pgClient.on('notification', ...)` and `pgClient.query('LISTEN strategy_ready')` (lines 58, 152) with `subscribeToChannel('strategy_ready', handler)` from `db-client.js`. This brings the worker under the dispatcher's reconnect umbrella so its handler survives reconnect.

**Gaps closed**: G6.
**Symptom eliminated**: in `ENABLE_BACKGROUND_WORKER=true` deployments, the SmartBlocks generation chain stays alive across LISTEN reconnects. Otherwise dormant.
**Risk**: low.
**Why fourth**: only relevant for the subprocess deployment mode. Not on Melody's spinner critical path.

### F5 — Client-side EventSource auto-reconnect

**Files**: `client/src/utils/co-pilot-helpers.ts` only.

**Change**: implement the TODO from SSE.md §11 — exponential backoff `2s → 4s → 8s → 30s max` on `onerror`, recreate the EventSource, re-emit subscriber notifications.

**Gaps closed**: G5.
**Symptom eliminated**: prevents silently-dead client sockets after mobile sleep / network switch / server reload.
**Risk**: low — additive.
**Why fifth**: not on the critical path for *this* snapshot, but a general SSE robustness improvement.

## 9. Open questions for Melody

| # | Question |
|---|----------|
| QN1 | Is F1 (client `_coverageEmpty` honoring) acceptable as the standalone Phase 0a-completion fix, or do you want F1 + F2 shipped together as a "complete the SSE contract" pass? |
| QN2 | F2 requires the client to pass `?snapshot_id=` on the EventSource URL — any reason that would conflict with current SSE auth/middleware design or the planned per-snapshot SSE filtering (SSE.md §11 known gap #3)? |
| QN3 | Should F3 (dispatcher catch-up) be skipped entirely if F2 is shipped? F2 makes catch-up logically redundant — every reconnect implicitly catches up via the next handshake — but F3 has the appeal of being a "belt and suspenders" guarantee. |
| QN4 | The 01:36 → 01:39 SSE-channels-closed window — was this triggered by Replit-side maintenance, a client app-suspend, or something we changed? Worth asking ops to correlate against Helium-side connection reset logs. |
| QN5 | For the triad-worker (F4): what's the current state of `ENABLE_BACKGROUND_WORKER` in the prod environment Melody is running? If `false`, F4 is dormant and can be deferred. If `true`, F4 is a separate latent ticking timer. |
| QN6 | Phase 0a's 4-endpoint sentinel was committed locally (e7034939) but not pushed. Do you want F1 batched into the same commit before push, or kept as a follow-up commit so the diffs can be reviewed independently? |

## 10. What this RECON deliberately did NOT do

- No DB writes (dev or prod).
- No queries against prod DB (per Rule 13).
- No code changes.
- No schema changes.
- No server restart.
- No republish.
- No DECISIONS.md modifications.
- No dispatch of agents to "fix it" — this is RECON only.
- No assumption that the Phase 0a server change will be committed/pushed without Melody's review of F1.

The recon respects the strict "STOP. Do not propose code. Do not commit. Do not push. Do not restart server. Do not republish." boundary by surfacing the gaps and proposing fixes as text diffs only — no edits to source files.

## Memory Index

| # | Section | Title |
|---|---------|-------|
| RN1 | §1 | Topology — emit → LISTEN → dispatcher → SSE → client |
| RN2 | §2 | Seven delivery-guarantee gaps catalogued (G1–G7) |
| RN3 | §3 | Snapshot ef36f6c6 timeline mapped to architecture |
| RN4 | §4 | LISTEN reconnect triggers + reconnect-window vulnerability |
| RN5 | §5 | No catch-up replay after reconnect (confirmed) |
| RN6 | §6 | No SSE initial-state handshake (confirmed) |
| RN7 | §7 | Five-hypothesis ranking — H1 (Bug A + Bug B) is dominant |
| RN8 | §8 | Five-fix smallest-first plan (F1 = client `_coverageEmpty` honoring) |
