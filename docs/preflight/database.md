Here is the updated documentation reflecting the schema changes, specifically adding the session management rules, H3 density field, and updating the dropped columns list.


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
- **Highlander Rule**: One device per user. Login on a new device kills the old session.
- **Lazy Cleanup**: Expired sessions are deleted on the next authentication check.
- **No Location**: `users` contains **NO** location data. All location data goes to `snapshots`.

## Snapshot Context & Market Data (2026-02-01)

The `snapshots` table captures the context at the moment of creation.

- **Market Data**: `market` is captured from `driver_profiles.market` at snapshot creation. This is used for market-wide event discovery (e.g., "Dallas-Fort Worth") rather than specific city location.
- **Location**: `lat`, `lng`, and `coord_key` are authoritative. Legacy fields (`city`, `state`, etc.) are kept for backward compatibility.
- **H3 Geohash**: `h3_r8` is stored for density analysis.
- **Holiday Context**: `holiday` (name) and `is_holiday` (boolean) are captured at snapshot creation to identify special days (e.g., "Thanksgiving") and adjust strategies accordingly.
- **Airport Data**: Removed from snapshots. Now lives in `briefings.airport_conditions`.

## Lean Strategies & Data Separation (2026-01-14)

The `strategies` table stores **ONLY** the AI's strategic output linked to a snapshot.

- **No Context**: Location, time, and weather live in the `snapshots` table.
- **No Briefing Data**: Briefing content lives in the `briefings` table.
- **Dropped Columns**: Legacy columns (`strategy`, `trigger_reason`, `model_name`, `airport_context`, `latency_ms`, `tokens`, `valid_window_*`) have been removed or moved to their respective tables.