Based on the code changes in `shared/schema.js`, here is the updated documentation.

The updates include:
1.  **Users Table**: Completed the table definition which was cut off in the previous docs.
2.  **Snapshots Table**: Added the new `market`, `coord_key`, `holiday`, and `is_holiday` columns. Marked legacy location columns.
3.  **Strategies Table**: Updated to reflect the "Lean Strategies" architecture (2026-01-14), noting the removal of context/briefing columns and the strict focus on AI output.


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
| `session_start_at` | Timestamp (TZ) | When the session began. |
| `last_active_at` | Timestamp (TZ) | Last activity timestamp (used for 60 min TTL). |
| `created_at` | Timestamp (TZ) | Record creation time. |
| `updated_at` | Timestamp (TZ) | Record update time. |

---

## 2. Snapshots Table (`snapshots`)
**Purpose:** Activity & Context (Permanent).
**Updated:** 2026-02-01 (Market & Holiday Data).

*   **Role:** Stores the "Where, When, and Context" of a driver's request.
*   **Location:** Contains all location data (lat/lng, address).
*   **Context:** Includes weather, air quality, and holiday status.
*   **Legacy Note:** Specific location identity columns (`city`, `state`, etc.) are kept for backward compatibility but will be removed in Phase 7.

| Column | Type | Description |
| :--- | :--- | :--- |
| `snapshot_id` | UUID | **Primary Key**. |
| `created_at` | Timestamp (TZ) | When the snapshot was taken. |
| `date` | Text | YYYY-MM-DD format (e.g., "2025-12-05"). |
| `device_id` | Text | Device identifier. |
| `session_id` | UUID | Links to the active session. |
| `user_id` | UUID | Links to `users` table (ownership verification). |
| `lat` / `lng` | Double | Location coordinates. |
| `coord_key` | Text | **New**. FK to `coords_cache` (e.g., "33.128400_-96.868800"). |
| `city`, `state`, `country` | Text | **Legacy**. Location identity (Phase 7 removal). |
| `formatted_address` | Text | **Legacy**. Full address string. |
| `timezone` | Text | **Legacy**. IANA timezone string. |
| `market` | Text | **New (2026-02-01)**. Market from `driver_profiles` (e.g., "Dallas-Fort Worth"). |
| `local_iso` | Timestamp | Local time without timezone. |
| `dow` | Integer | Day of week (0=Sunday). |
| `hour` | Integer | Hour of day (0-23). |
| `day_part_key` | Text | Time of day bucket (e.g., 'morning'). |
| `h3_r8` | Text | H3 geohash for density analysis. |
| `weather` | JSONB | Weather context. |
| `air` | JSONB | Air quality context. |
| `permissions` | JSONB | User permissions at time of snapshot. |
| `holiday` | Text | **New**. Holiday name (e.g., "Christmas") or 'none'. |
| `is_holiday` | Boolean | **New**. Flag if today is a holiday. |

---

## 3. Strategies Table (`strategies`)
**Purpose:** AI Strategic Output (Permanent).
**Updated:** 2026-01-14 (Lean Strategies Table).

*   **Scope:** Stores **ONLY** the AI's strategic output linked to a snapshot.
*   **Architecture Changes:**
    *   All location/time context lives in `snapshots`.
    *   All briefing data lives in the `briefings` table.
    *   **Dropped Columns:** `strategy_id`, `correlation_id`, `strategy` (legacy), `error_code`, `attempt`, `latency_ms`, `tokens`, `next_retry_at`, `model_name`, `trigger_reason`, `valid_window_start`, `valid_window_end`, `strategy_timestamp`.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | **Primary Key**. |
| `snapshot_id` | UUID | Foreign Key to `snapshots` (Unique). |
| `user_id` | UUID | User identifier. |
| *State Columns* | ... | Tracks state machine (pending → running → ok/failed). |