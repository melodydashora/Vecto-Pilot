# Database Schema Reference

## Users Table (`users`)
**Purpose**: Session Tracking (Ephemeral)
**Updated**: 2026-01-05

The `users` table is designed for temporary session management. Records are created on login and deleted on logout or after 60 minutes of inactivity.

**Key Rules:**
*   **Highlander Rule**: One device per user (login on new device kills old session).
*   **Sliding Window**: `last_active_at` updates on every request.
*   **Lazy Cleanup**: Expired sessions deleted on next `requireAuth` check.

**Columns:**
*   `user_id` (UUID, PK): Links to `driver_profiles`.
*   `device_id` (Text): Device making the request.
*   `session_id` (UUID): Current session UUID.
*   `current_snapshot_id` (UUID): The user's one active snapshot.
*   `session_start_at` (Timestamp): Session start time.
*   `last_active_at` (Timestamp): Last activity (60 min TTL).
*   `created_at`, `updated_at` (Timestamp).

## Snapshots Table (`snapshots`)
**Purpose**: Activity Tracking (Permanent)
**Updated**: 2026-02-01

Stores historical activity, location data, and context. Location data is stored here, not in the users table.

**Columns:**
*   `snapshot_id` (UUID, PK)
*   `created_at` (Timestamp)
*   `date` (Text): YYYY-MM-DD format.
*   `device_id` (Text)
*   `session_id` (UUID)
*   `user_id` (UUID): Ownership verification.
*   **Location**:
    *   `lat`, `lng` (Double)
    *   `coord_key` (Text): FK to `coords_cache`.
    *   `market` (Text): Market from `driver_profiles.market` (e.g., "Dallas-Fort Worth").
    *   *Legacy*: `city`, `state`, `country`, `formatted_address`, `timezone`.
*   **Time Context**:
    *   `local_iso` (Timestamp)
    *   `dow` (Integer): Day of week.
    *   `hour` (Integer)
    *   `day_part_key` (Text)
*   **Context**:
    *   `h3_r8` (Text): H3 geohash.
    *   `weather` (JSONB)
    *   `air` (JSONB)
    *   `permissions` (JSONB)
    *   `holiday` (Text): Holiday name or 'none'.
    *   `is_holiday` (Boolean).

## Strategies Table (`strategies`)
**Purpose**: Lean AI Strategy Output
**Updated**: 2026-01-14

Stores ONLY the AI's strategic output linked to a snapshot. All location/time context lives in `snapshots`.

**Columns:**
*   `id` (UUID, PK)
*   `snapshot_id` (UUID): Unique reference to `snapshots`.
*   `user_id` (UUID)