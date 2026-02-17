Here is the updated documentation reflecting the changes in `shared/schema.js`, specifically completing the `snapshots` table definition and adding the `strategies` table overview based on the provided code.


# Database Schema Reference

This document details the database schema definitions found in `shared/schema.js`.

## Overview
The schema is designed around three core tables serving distinct purposes:
1.  **`driver_profiles`**: Identity (Permanent).
2.  **`users`**: Session Tracking (Ephemeral).
3.  **`snapshots`**: Activity & Context (Permanent).
4.  **`strategies`**: AI Output (Permanent).

---

## 1. Users Table (`users`)
**Purpose:** Session Tracking Only (Ephemeral).
**Updated:** 2026-01-05 (Simplified Architecture).

*   **Retention:** Temporary (60 min TTL).
*   **Session Rules:**
    *   **Highlander Rule:** One device per user (login on a new device terminates the old session).
    *   **Sliding Window:** `last_active_at` updates on every request.
    *   **Lazy Cleanup:** Expired sessions are deleted on the next `requireAuth` check.

| Column | Type | Description |
| :--- | :--- | :--- |
| `user_id` | UUID | **Primary Key**. Links to `driver_profiles`. |
| `device_id` | Text | Device identifier making the request. |
| `session_id` | UUID | Current session UUID. |
| `current_snapshot_id` | UUID | The user's ONE active snapshot. |
| `session_start_at` | Timestamp | When the session began. |
| `last_active_at` | Timestamp | Last activity timestamp (used for 60 min TTL). |
| `created_at` | Timestamp | Record creation time. |
| `updated_at` | Timestamp | Record update time. |

---

## 2. Snapshots Table (`snapshots`)
**Purpose:** Activity History & Context (What you did when).
**Updated:** 2026-02-01.

*   **Content:** Stores location, time, weather, and computed context at the moment of activity.
*   **Note:** Location data is stored here, not in the `users` table.

| Column | Type | Description |
| :--- | :--- | :--- |
| `snapshot_id` | UUID | **Primary Key**. |
| `created_at` | Timestamp | Timestamp when snapshot was created. |
| `date` | Text | Date in `YYYY-MM-DD` format. |
| `device_id` | Text | Device identifier. |
| `session_id` | UUID | Linked session ID. |
| `user_id` | UUID | User ID for ownership verification. |
| `lat` | Double | Latitude. |
| `lng` | Double | Longitude. |
| `coord_key` | Text | Cache key (e.g., "lat6d_lng6d") linking to `coords_cache`. |
| `city` | Text | Legacy location identity. |
| `state` | Text | Legacy location identity. |
| `country` | Text | Legacy location identity. |
| `formatted_address` | Text | Legacy location identity. |
| `timezone` | Text | Legacy location identity. |
| `market` | Text | **New (2026-02-01):** Market from `driver_profiles` (e.g., "Dallas-Fort Worth"). Used for market-wide event discovery. |
| `local_iso` | Timestamp | Local time context. |
| `dow` | Integer | Day of week (0=Sunday, 1=Monday, etc.). |
| `hour` | Integer | Hour of day. |
| `day_part_key` | Text | Time of day category (e.g., 'morning', 'evening'). |
| `h3_r8` | Text | H3 geohash for density analysis. |
| `weather` | JSONB | API-enriched weather data. |
| `air` | JSONB | API-enriched air quality data. |
| `permissions` | JSONB | User permissions snapshot. |
| `holiday` | Text | Holiday name (e.g., "Thanksgiving") or 'none'. |
| `is_holiday` | Boolean | Flag indicating if today is a holiday. |

---

## 3. Strategies Table (`strategies`)
**Purpose:** AI Strategic Output Only.
**Updated:** 2026-01-14 (Lean Architecture).

*   **Scope:** Stores ONLY the AI's strategic output linked to a snapshot.
*   **Separation of Concerns:**
    *   Location/Time context lives in `snapshots`.
    *   Briefing data lives in `briefings`.
*   **Dropped Columns (Legacy):** `strategy_id`, `correlation_id`, `strategy`, `error_code`, `attempt`, `latency_ms`, `tokens`, `next_retry_at`, `model_name`, `trigger_reason`, `valid_window_start`, `valid_window_end`, `strategy_timestamp`.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | **Primary Key**. |
| `snapshot_id` | UUID | Foreign Key to `snapshots`. Unique (One strategy per snapshot). |
| `user_id` | UUID | User ID associated with the strategy. |