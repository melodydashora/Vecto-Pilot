# SSE.md — Server-Sent Events Architecture

> **Canonical reference** for the SSE Manager, connection lifecycle, event types, and how auth-drop affects SSE.
> Last updated: 2026-04-10

## Supersedes
- `docs/architecture/realtime.md` — Real-time architecture overview (SSE + WebSocket, absorbed here and in SCALABILITY.md)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Server-Side: Event Emission](#2-server-side-event-emission)
3. [Server-Side: SSE Endpoints](#3-server-side-sse-endpoints)
4. [Client-Side: SSE Manager (Singleton Pattern)](#4-client-side-sse-manager-singleton-pattern)
5. [Connection Lifecycle](#5-connection-lifecycle)
6. [Subscribe Functions](#6-subscribe-functions)
7. [closeAllSSE — Emergency Shutdown](#7-closeallsse--emergency-shutdown)
8. [Auth-Drop Effects on SSE](#8-auth-drop-effects-on-sse)
9. [Current State](#9-current-state)
10. [Known Gaps](#10-known-gaps)
11. [TODO — Hardening Work](#11-todo--hardening-work)

---

## 1. Architecture Overview

```
┌──────────────────┐         ┌──────────────────────┐         ┌──────────────────┐
│  Briefing Service │         │  PostgreSQL           │         │  Client Browser  │
│  Strategy Gen     │───pg_notify──▶│  LISTEN/NOTIFY      │         │                  │
│  Triad Worker     │         │  Channels             │         │                  │
└──────────────────┘         └──────────┬───────────┘         └────────┬─────────┘
                                        │                              │
                              subscribeToChannel()              EventSource
                                        │                              │
                              ┌─────────▼───────────┐         ┌───────▼──────────┐
                              │  SSE Endpoints       │────────▶│  SSE Manager     │
                              │  /events/strategy    │  HTTP   │  (Singleton Map) │
                              │  /events/blocks      │  SSE    │                  │
                              │  /events/phase       │         │  Subscribers:    │
                              │  /events/briefing    │         │  - CoPilotCtx    │
                              └──────────────────────┘         │  - BriefingHook  │
                                                               └──────────────────┘
```

**Key design:** Server uses PostgreSQL LISTEN/NOTIFY to propagate events from background workers to SSE endpoints. Client uses a singleton manager to share one EventSource connection per endpoint across multiple React components.

---

## 2. Server-Side: Event Emission

### PostgreSQL LISTEN/NOTIFY

Events are emitted via PostgreSQL's built-in pub/sub:

```sql
SELECT pg_notify('briefing_ready', '{"snapshot_id":"034292d5-..."}');
SELECT pg_notify('strategy_ready', '{"snapshot_id":"034292d5-..."}');
NOTIFY blocks_ready, '{"snapshot_id":"034292d5-...","ranking_id":"..."}';
```

### Who Emits What

| Channel | Emitted By | File | Trigger |
|---------|-----------|------|---------|
| `briefing_ready` | `generateAndStoreBriefing()` | `briefing-service.js:2794` | All parallel data fetches complete |
| `strategy_ready` | PostgreSQL trigger on `strategies` table | `migrations/20260110_fix_strategy_now_notify.sql` | `strategy_for_now` column updated |
| `blocks_ready` | `startConsolidationListener()` | `jobs/triad-worker.js:138` | SmartBlocks generation complete |
| (phase changes) | Phase updates during pipeline | `blocks-fast.js` via `updatePhase()` | Each pipeline phase transition |

### Dispatcher Architecture

**File:** `server/db/db-client.js` (lines 200–300)

**Problem solved:** Without centralization, 23 SSE connections × 1 NOTIFY = 23 duplicate handler invocations.

**Solution:** Single LISTEN client → shared dispatcher → per-channel subscriber routing.

```javascript
// Data structure
const channelSubscribers = new Map<channel, Set<callbacks>>();

// Key functions:
subscribeToChannel(channel, callback)  // Register for NOTIFY events
resubscribeChannels()                  // Re-LISTEN after DB reconnect
getListenClient()                      // Get/create dedicated LISTEN-only connection
```

---

## 3. Server-Side: SSE Endpoints

**File:** `server/api/strategy/strategy-events.js` (277 lines)

All endpoints follow the same pattern:
1. Set SSE headers (`text/event-stream`, `no-cache`, `Connection: keep-alive`)
2. Subscribe to PostgreSQL channel via `subscribeToChannel()`
3. On notification → filter by snapshot_id → write SSE event
4. 30-second heartbeat (comment: `: heartbeat\n\n`) to detect dead connections
5. On `req.close` → unsubscribe and clear heartbeat interval

### Endpoints

| Endpoint | Channel | SSE Event Name | Payload |
|----------|---------|---------------|---------|
| `GET /events/strategy` | `strategy_ready` | `strategy_ready` | `{ snapshot_id }` |
| `GET /events/briefing` | `briefing_ready` | `briefing_ready` | `{ snapshot_id }` |
| `GET /events/blocks` | `blocks_ready` | `blocks_ready` | `{ snapshot_id, ranking_id }` |
| `GET /events/phase` | EventEmitter | `message` (default) | `{ snapshot_id, phase, phase_started_at, expected_duration_ms }` |
| `GET /events/offers` | `offer_analyzed` | `offer_analyzed` | `{ device_id, decision, reason }` |

### Heartbeat

**Interval:** 30 seconds (line 33)
**Purpose:** Detect dead connections (mobile sleep, network switch)
**Format:** `: heartbeat\n\n` (SSE comment, ignored by EventSource)
**On write failure:** Connection is dead → `req.end()` closes it

---

## 4. Client-Side: SSE Manager (Singleton Pattern)

**File:** `client/src/utils/co-pilot-helpers.ts` (lines 26–117)

### Data Structure

```typescript
const sseConnections: Map<string, SSESubscription> = new Map();

interface SSESubscription {
  eventSource: EventSource;
  subscribers: Set<(data: any) => void>;
  isConnected: boolean;
}
```

**Map key format:** `${endpoint}:${eventName}` (e.g., `/events/strategy:strategy_ready`)

### How It Works

```
Component A calls subscribeStrategyReady(callback1)
  └─ subscribeSSE('/events/strategy', 'strategy_ready', callback1)
      └─ Key: '/events/strategy:strategy_ready'
      └─ Not in Map → create new EventSource, add to Map
      └─ subscribers: Set { callback1 }

Component B calls subscribeStrategyReady(callback2)
  └─ subscribeSSE('/events/strategy', 'strategy_ready', callback2)
      └─ Key: '/events/strategy:strategy_ready'
      └─ Already in Map → reuse existing EventSource
      └─ subscribers: Set { callback1, callback2 }

Event arrives:
  └─ EventSource.addEventListener('strategy_ready', handler)
      └─ Parse JSON data
      └─ Broadcast to ALL subscribers: callback1(data), callback2(data)

Component A unmounts:
  └─ unsubscribe() returned from subscribeSSE
      └─ Remove callback1 from subscribers Set
      └─ subscribers.size = 1 → keep connection alive

Component B unmounts:
  └─ unsubscribe()
      └─ Remove callback2 from subscribers Set
      └─ subscribers.size = 0 → close EventSource, delete from Map
```

### Core Function: `subscribeSSE()`

**Signature:** `(endpoint: string, eventName: string, callback: (data) => void) => () => void`

**Returns:** Unsubscribe function

**Behavior on error:** Logs warning, sets `isConnected = false`. **No auto-reconnect** — the connection stays dead until a new subscriber triggers recreation.

---

## 5. Connection Lifecycle

### Creation

1. First subscriber calls `subscribeSSE(endpoint, eventName, callback)`
2. Manager checks Map for existing `${endpoint}:${eventName}` key
3. **Not found:** Creates new `EventSource(endpoint)`, adds `addEventListener(eventName, ...)`, stores in Map
4. **Found:** Adds callback to existing subscribers Set

### Active

- `onopen`: `isConnected = true`, logs `✅ Connected: ${endpoint}`
- `addEventListener(eventName)`: Parses JSON, iterates subscribers, calls each
- Server sends heartbeat every 30s (keeps connection alive)

### Teardown (Normal)

- Last subscriber unsubscribes → `subscribers.size === 0`
- `eventSource.close()` called
- Entry deleted from Map
- Log: `🔌 Closed: ${key}`

### Teardown (Emergency — Logout)

- `closeAllSSE()` called from auth-context during logout
- Iterates ALL entries in Map
- Calls `eventSource.close()` and `subscribers.clear()` on each
- Clears entire Map
- Log: `🔌 Closing ALL connections (N active)`

### Error / Disconnect

- `onerror`: `isConnected = false`, logs `⚠️ Connection error: ${endpoint}`
- **No auto-reconnect logic**
- Browser's EventSource built-in reconnect may or may not fire (browser-dependent)
- If browser reconnects, the `onopen` handler fires again and sets `isConnected = true`

---

## 6. Subscribe Functions

All defined in `co-pilot-helpers.ts`, all use `subscribeSSE()` internally.

### subscribeStrategyReady()

**Lines:** 187–193
**Endpoint:** `/events/strategy`
**Event:** `strategy_ready`
**Callback:** `(snapshotId: string) => void`
**Used by:** CoPilotContext (line 363) — triggers `refetchQueries` for strategy data

### subscribeBlocksReady()

**Lines:** 201–207
**Endpoint:** `/events/blocks`
**Event:** `blocks_ready`
**Callback:** `(data: { snapshot_id: string; ranking_id?: string }) => void`
**Used by:** CoPilotContext (line 376) — triggers `refetchQueries` for blocks data

### subscribeBriefingReady()

**Lines:** 216–222
**Endpoint:** `/events/briefing`
**Event:** `briefing_ready`
**Callback:** `(snapshotId: string) => void`
**Used by:** useBriefingQueries (line 208) — refetches all 6 briefing queries

### subscribePhaseChange()

**Lines:** 234–246
**Endpoint:** `/events/phase`
**Event:** `message` (default onmessage, not named event)
**Callback:** `(data: { snapshot_id, phase, phase_started_at, expected_duration_ms }) => void`
**Used by:** CoPilotContext (line 391) — triggers strategy refetch for phase-accurate progress bar

---

## 7. closeAllSSE — Emergency Shutdown

**File:** `co-pilot-helpers.ts` (lines 109–117)

```typescript
export function closeAllSSE(): void {
  console.log(`[SSE Manager] 🔌 Closing ALL connections (${sseConnections.size} active)`);
  for (const [key, sub] of sseConnections) {
    sub.eventSource.close();     // Kill the HTTP connection
    sub.subscribers.clear();      // Clear all callbacks
    console.log(`[SSE Manager] 🔌 Closed: ${key}`);
  }
  sseConnections.clear();          // Wipe the Map
}
```

**Called from:**
1. `auth-context.tsx` line 88 — Forced logout (auth error event)
2. `auth-context.tsx` line 216 — Manual logout

**Called synchronously BEFORE** `setState({ isAuthenticated: false })` — this ensures SSE connections are killed before the React re-render cascade begins.

---

## 8. Auth-Drop Effects on SSE

### Complete Sequence

```
LOGOUT CLICKED
  │
  ├─ 1. queryClient.cancelQueries()     ← Cancel React Query first
  ├─ 2. queryClient.clear()
  ├─ 3. closeAllSSE()                   ← Kill all 4 SSE connections NOW
  │     ├─ Closed: /events/strategy:strategy_ready
  │     ├─ Closed: /events/blocks:blocks_ready
  │     ├─ Closed: /events/phase:message
  │     └─ Closed: /events/briefing:briefing_ready
  │
  ├─ 4. POST /api/auth/logout           ← Server-side session teardown
  ├─ 5. Clear localStorage/sessionStorage
  └─ 6. setState({ isAuthenticated: false })
       │
       ├─ LocationContext re-renders
       │   └─ Auth-drop effect: clears lastSnapshotId + all state
       │
       └─ CoPilotContext re-renders
            ├─ Auth-drop effect: clears lastSnapshotId
            ├─ Sync effect: isAuthenticated=false → RETURNS EARLY (zombie guard)
            ├─ SSE subscription effects: lastSnapshotId=null → cleanup runs
            │   └─ Each effect returns early (guard: !lastSnapshotId) → no new subscriptions
            └─ NO NEW SSE CONNECTIONS CREATED
```

### The Zombie Prevention (2026-04-10)

Before the fix, steps 3→6 created a gap:
- Step 3 closed all SSE connections
- Step 6 triggered CoPilotContext re-render
- CoPilot's sync effect saw LocationContext still had old snapshotId → restored it
- SSE subscription effects saw snapshotId restored → **reopened all 4 connections**

After the fix:
- LocationContext clears its snapshotId in auth-drop effect
- CoPilotContext's sync effect checks `isAuthenticated` → blocks restoration
- No snapshotId = no SSE subscription effects fire = no reconnection

---

## 9. Current State

| Area | Status |
|------|--------|
| Singleton SSE Manager | Working — one EventSource per endpoint, shared across components |
| PostgreSQL LISTEN/NOTIFY | Working — events propagate from workers to SSE endpoints |
| Server heartbeat (30s) | Working — detects dead client connections |
| Client subscribe/unsubscribe | Working — proper cleanup on last subscriber |
| closeAllSSE on logout | Working — kills all connections synchronously |
| Zombie SSE prevention | **Fixed 2026-04-10** — no reconnection after auth drop |
| 4 SSE channels active | strategy_ready, blocks_ready, briefing_ready, phase |

---

## 10. Known Gaps

1. **No client-side auto-reconnect** — If an SSE connection drops (network error, server restart), the manager logs the error but does NOT reconnect. Connection stays dead until component remounts. Browser's built-in EventSource reconnect is browser-dependent and unreliable.

2. **No connection health monitoring** — No way to detect that a connection is silently dead (server closed it but client hasn't noticed). The 30s heartbeat only works server→client.

3. **No snapshot filtering on server** — SSE endpoints relay ALL events on a channel. Every connected client receives events for ALL snapshots, then filters client-side. With many concurrent users, this could be noisy.

4. **No auth on SSE endpoints** — The `/events/*` endpoints don't use `requireAuth`. Any client can connect and receive events. Events only contain snapshot IDs (no sensitive data), but it's still an information leak.

5. **Phase events use default `message` type** — `subscribePhaseChange()` listens for `message` (onmessage) instead of a named event. This makes it impossible to distinguish from other default messages on the same endpoint.

6. **No backpressure** — If the client is slow to process events, they queue up in the browser's EventSource buffer with no limit.

7. **LISTEN client is shared** — One PostgreSQL connection handles all LISTEN channels. If this connection drops, all SSE channels go dead simultaneously until reconnect.

---

## 11. TODO — Hardening Work

- [ ] **Implement client-side auto-reconnect** — On `onerror`, wait 2s then recreate EventSource. Use exponential backoff: 2s → 4s → 8s → 30s max
- [ ] **Add SSE auth** — Pass JWT as query param on EventSource URL (`/events/strategy?token=...`). Validate in SSE endpoint middleware
- [ ] **Add server-side snapshot filtering** — Accept `snapshotId` query param on SSE endpoints. Only relay matching events
- [ ] **Add client health ping** — Periodically send an empty message; if no response after 3 heartbeat cycles, force reconnect
- [ ] **Name the phase event** — Change from default `message` to `phase_change` event type for clarity
- [ ] **Add connection state indicator** — Show in UI when SSE is disconnected (orange dot in header)
- [ ] **PostgreSQL LISTEN failover** — Detect LISTEN connection drop and resubscribe all channels automatically
- [ ] **Add per-user SSE channels** — `strategy_ready:${userId}` instead of broadcasting to all clients
- [ ] **Rate-limit SSE events** — Debounce rapid phase transitions (e.g., max 1 event per second per channel)

---

## Key Files

| File | Purpose |
|------|---------|
| `client/src/utils/co-pilot-helpers.ts` | SSE Manager, subscribe functions, closeAllSSE |
| `server/api/strategy/strategy-events.js` | SSE endpoint definitions (277 lines) |
| `server/db/db-client.js` | PostgreSQL LISTEN/NOTIFY dispatcher |
| `server/lib/briefing/briefing-service.js:2794` | `pg_notify('briefing_ready')` emission |
| `server/jobs/triad-worker.js:138` | `NOTIFY blocks_ready` emission |
| `migrations/20260110_fix_strategy_now_notify.sql` | DB trigger for `strategy_ready` |
| `client/src/contexts/co-pilot-context.tsx:356-393` | SSE subscription effects |
| `client/src/hooks/useBriefingQueries.ts:195-215` | `briefing_ready` subscription |
| `client/src/contexts/auth-context.tsx:88,216` | `closeAllSSE()` call sites |
