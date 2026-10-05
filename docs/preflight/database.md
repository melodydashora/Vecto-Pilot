# Pre-flight: Database

Quick reference for database operations. Read before modifying any DB code.

## snapshot_id Linking Rule

**All data links to `snapshot_id`.** This is the moment-in-time anchor.

```javascript
// CORRECT - Always include snapshot_id
await db.insert(rankings).values({
  snapshot_id: snapshotId,  // Required
  ranking_id: rankingId,
  // ...
});

// WRONG - Missing snapshot_id
await db.insert(rankings).values({
  ranking_id: rankingId,  // Where's snapshot_id?
});
```

## Identity & Session Architecture (2026-01-05)

**Three Tables, Three Purposes:**

1.  **`driver_profiles`**: Permanent driver profile.
2.  **`users`**: Permanent identity key and current session pointer; only the session expires.
3.  **`snapshots`**: Activity (what you did when) - **FOREVER**.

**Session Rules:**
- **Ephemeral**: on logout or inactivity (60 min TTL) the `users` row is KEPT and its `session_id` is set NULL (2026-01-06: DELETE was blocked by RESTRICT FKs from driver_profiles/auth_credentials). Do not store permanent settings here.
- **No Location Data**: All location data goes to the `snapshots` table.
- **Sliding Window**: `last_active_at` updates on every request.
- **One live session per user**: Login from another browser/device returns `session_already_active`; the driver must log out of the prior session first. Same-session app switching retains the 60-minute inactivity window and two-hour hard limit. See [authentication](../architecture/AUTH.md).
- **Lazy Cleanup**: expired sessions are cleared (session_id → NULL) on the next `requireAuth` check; see server/middleware/auth.js.

Interrupted-login receipts live in `auth_login_attempts`, created by
`20261005_login_recovery.sql`. Only proof digests are stored. Finalization,
recovery and cancellation lock the attempt before credentials/the user. A
completed receipt can recover only its original live session; it never changes
session clocks or MAIN pointers. Cancellation tombstones must not be deleted
without a reviewed retention protocol: a delayed original request could otherwise
claim that proof again. The ten-minute `expires_at` bounds unfinished work, not a
completed session's lifetime or an automatic row-deletion schedule.

**Key Fields:**
- `current_snapshot_id`: Links to the user's ONE active snapshot.

## Snapshots Architecture (2026-02-01)

The `snapshots` table is the authoritative source for location and time context.

- **Ownership**: Includes `user_id` for ownership verification (required for `requireSnapshotOwnership` middleware).
- **Market Data**: `market` is resolved from the current snapshot location; a driver's home-profile market is not current location.
- **Holiday Data**: Holiday enrichment lives in `briefings.holiday`, not the snapshot (July 6 migration).
- **Density Analysis**: Includes `h3_r8` (H3 geohash) for density analysis.
- **Location**: Uses `coord_key` to link to `coords_cache`. Legacy fields (`city`, `state`, etc.) are deprecated.
- **Airport Data**: `airport_context` dropped (2026-01-14). Airport data now lives in `briefings`.

## Lean Strategies (2026-01-14)

The `strategies` table stores **ONLY** the AI's strategic output linked to a snapshot.

- **Context**: All location/time context lives in `snapshots`.
- **Briefings**: All briefing data lives in `briefings`.
- **Dropped Columns**: `strategy_id`, `correlation_id`, `strategy` (legacy), `error_code`, `attempt`, `latency_ms`, `tokens`, `next_retry_at`, `model_name`, `trigger_reason`, `valid_window_start`, `valid_window_end`, `strategy_timestamp`.

## Database Client & Real-time (2026-02-17)

The `db-client.js` module manages the persistent `LISTEN` connection for Real-time/SSE.

- **Race Condition Prevention**: Uses a `connectPromise` to ensure only one connection attempt occurs during concurrent `getListenClient()` calls (2026-01-09).
- **Reconnection Logic**:
  - **Backoff**: Implements exponential backoff (up to 10s) on connection loss.
  - **Handler Reset**: Resets `notificationHandlerAttached` flag so listeners are properly re-bound on the new client.
  - **Resubscription**: Automatically calls `resubscribeChannels()` to re-issue `LISTEN` commands after a reconnect, preventing orphaned SSE subscribers.
- **Keepalive**: Sends `SELECT 1` every 4 minutes to prevent connection timeouts.

## Connection Manager & Pooling (2026-02-26)

The `connection-manager.js` module handles the standard query pool configuration, shared by development and deployment; only `DATABASE_URL` selects its target.

- **Pool Configuration**:
  - **Max Connections**: Increased to **25** (Issue #22). Accounts for high concurrency (Strategy + Briefing + Blocks = ~8-11 connections per user).
  - **Idle Timeout**: **10000ms** (10s). The configured target still determines provider connection behavior.
  - **Connection Timeout**: **15s**. Slightly increased to handle connection spikes safely.
  - **Statement Timeout**: **30s** global timeout to prevent long-running queries from blocking.
  - **TCP Keepalive**: Enabled (10s delay) to maintain stable connections.
  - **SSL Configuration**: `databaseConnectionConfig()` preserves explicit local TLS and requires verified certificates/hostnames for remote targets. Runtime deployment flags do not disable verification.
- **Monitoring & Health**:
  - **Capacity Warning**: Monitors pool usage every 30s. Logs a warning if usage exceeds **80%** (20 connections).
  - **Health Check**: `getAgentState()` is a legacy compatibility status, not a database probe. Readiness routes run their own checks.
- **Error Handling**:
  - **57P01 (Admin Shutdown)**: Previously common with Neon's proxy, now rare in Helium. Still treated as a warning (not fatal) and the pool auto-recovers by evicting the dead client.

## Schema changes and verification

Canonical DDL lives in `migrations/*.sql`; `shared/schema.js` is its runtime mirror.
Keep column types, nullability and constraints synchronized. Preserve applied
migration bytes and fix forward. Apply reviewed migrations with `npm run db:migrate`
only against the intended environment; do not use Drizzle push to reconcile drift.
`npm run check:schema` reads metadata only and uses the shared connection policy.
Read `server/db/README.md` for exact coverage and limitations.
