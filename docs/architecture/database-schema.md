# Database Schema Documentation

This document outlines the database schema definitions found in `shared/schema.js`.

## Architecture Overview
The system follows a specific separation of concerns (updated 2026-01-05):
- **driver_profiles**: Identity (who you are) - *Persisted Forever*
- **users**: Session (who's online now) - *Ephemeral (60 min TTL)*
- **snapshots**: Activity (what you did when) - *Persisted Forever*

---

## Users Table (`users`)
**Type**: Session Tracking (Ephemeral)
**Updated**: 2026-01-05

This table manages active user sessions. It does not store permanent user identity or location data.

### Session Rules
*   **Lifecycle**: Created on login, deleted on logout or after 60 minutes of inactivity.
*   **Sliding Window**: `last_active_at` updates on every request.
*   **Highlander Rule**: One device per user (login on a new device kills the old session).
*   **Lazy Cleanup**: Expired sessions are deleted on the next `requireAuth` check.
*   **No Location**: All location data is stored in the `snapshots` table.

### Schema
| Column | Type | Description |
| :--- | :--- | :--- |
| `user_id` | UUID | Primary Key. Links to `driver_profiles`. |
| `device_id` | Text | Device making the request. |
| `session_id` | UUID | Current session UUID. |
| `current_snapshot_id` | UUID | The user's ONE active snapshot. |
| `session_start_at` | Timestamp | When the session began. |
| `last_active_at` | Timestamp | Last activity (starts 60 min TTL). |
| `created_at` | Timestamp | Record creation time. |
| `updated_at` | Timestamp | Record update time. |

---

## Snapshots Table (`snapshots`)
**Type**: Activity & Context
**Updated**: 2026-02-01

Stores the context (location, time, environment) for every activity event.

### Schema
| Column | Type | Description |
| :--- | :--- | :--- |
| `snapshot_id` | UUID | Primary Key. |
| `created_at` | Timestamp | Creation timestamp. |
| `date` | Text | YYYY-MM-DD format. |
| `device_id` | Text | Device ID. |
| `session_id` | UUID | Session ID. |
| `user_id` | UUID | User ID (for ownership verification). |
| `lat` / `lng` | Double | Location coordinates. |
| `coord_key` | Text | Cache key (FK to `coords_cache`). |
| `city` | Text | **Legacy**: City name (Phase 7 removal). |
| `state` | Text | **Legacy**: State code (Phase 7 removal). |
| `country` | Text | **Legacy**: Country code (Phase 7 removal). |
| `formatted_address` | Text | **Legacy**: Full address (Phase 7 removal). |
| `timezone` | Text | **Legacy**: Timezone string (Phase 7 removal). |
| `market` | Text | **New (2026-02-01)**: Market from `driver_profiles.market` (e.g., "Dallas-Fort Worth"). |
| `local_iso` | Timestamp | Local time. |
| `dow` | Integer | Day of week (0=Sunday). |
| `hour` | Integer | Hour of day. |
| `day_part_key` | Text | Time of day (e.g., 'morning'). |
| `h3_r8` | Text | H3 geohash for density analysis. |
| `weather` | JSONB | API-enriched weather data. |
| `air` | JSONB | API-enriched air quality data. |
| `permissions` | JSONB | User permissions context. |
| `holiday` | Text | Holiday name (e.g., "Thanksgiving") or 'none'. |
| `is_holiday` | Boolean | Flag: true if today is a holiday. |

---

## Strategies Table (`strategies`)
**Type**: AI Strategic Output
**Updated**: 2026-01-14

This table stores **ONLY** the AI's strategic output linked to a snapshot. It is a "lean" table; all location/time context lives in `snapshots`, and briefing data lives in `briefings`.

### Schema
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key. |
| `snapshot_id` | UUID | Foreign Key to `snapshots`. Unique. |
| `user_id` | UUID | User ID. |