Here is the updated documentation. I have completed the Session Rules section based on the code comments, added the `current_snapshot_id` field, and included the new sections for Snapshots and Lean Strategies to reflect the schema changes.


# Pre-flight: Database

Quick reference for database operations. Read before modifying any DB code.

## snapshot_id Linking Rule

**All data links to `snapshot_id`.** This is the moment-in-time anchor.

javascript
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


## Identity & Session Architecture (2026-01-05)

**Three Tables, Three Purposes:**

1.  **`driver_profiles`**: Identity (who you are) - **FOREVER**.
2.  **`users`**: Session (who's online now) - **TEMPORARY** (60 min TTL).
3.  **`snapshots`**: Activity (what you did when) - **FOREVER**.

**Session Rules:**
- **Ephemeral**: `users` rows are deleted on logout or inactivity (60 min TTL). Do not store permanent settings here.
- **Sliding Window**: `last_active_at` updates on every request.
- **Highlander Rule**: One device per user (login on new device kills old session).
- **Lazy Cleanup**: Expired sessions deleted on next `requireAuth` check.

**Key Fields:**
- `current_snapshot_id`: Links to the user's ONE active snapshot.

## Snapshots Architecture (2026-02-01)

The `snapshots` table is the authoritative source for location and time context.

- **Market Data**: Now captures `market` from `driver_profiles.market` at creation time.
- **Holiday Data**: Now captures `holiday` and `is_holiday` flags at creation time.
- **Location**: Uses `coord_key` to link to `coords_cache`. Legacy fields (`city`, `state`, etc.) are deprecated.

## Lean Strategies (2026-01-14)

The `strategies` table stores **ONLY** the AI's strategic output linked to a snapshot.

- **Context**: All location/time context lives in `snapshots`.
- **Briefings**: All briefing data lives in `briefings`.
- **Dropped Columns**: `strategy_id`, `correlation_id`, `strategy` (legacy), `error_code`, `attempt`, `latency_ms`, `tokens`, `next_retry_at`, `model_name`, `trigger_reason`, `valid_window_start`, `valid_window_end`, `strategy_timestamp`.