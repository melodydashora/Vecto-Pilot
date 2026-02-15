Here is the updated documentation. I have removed the conversational preamble to ensure the file starts with the correct markdown header.

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

1.  **`driver_profiles`**: Identity (who you are) - **FOREVER**.
2.  **`users`**: Session (who's online now) - **TEMPORARY** (60 min TTL).
3.  **`snapshots`**: Activity (what you did when) - **FOREVER**.

**Rules:**
- `users` table is ephemeral. Do not store permanent user settings here.
- `users` rows are deleted on logout or inactivity.
- `snapshots` contain all location data. `users` contains **NO** location data.

## Lean Strategies & Data Separation (202