### `users` - Session Tracking (Ephemeral)

**Purpose:** Tracks active sessions. Simplified architecture (2026-01-05) separates identity (`driver_profiles`) from session state (`users`).

**Files:**
- Schema: `shared/schema.js`

**Session Rules:**
- **Ephemeral:** Rows created on login, deleted on logout or 60 min inactivity.
- **Highlander Rule:** One device per user (login on new device kills old session).
- **Sliding Window:** `last_active_at` updates on every request.
- **Lazy Cleanup:** Expired sessions deleted on next requireAuth check.
- **No Location:** All location data is stored in `snapshots`.

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID (PK) | Links to `driver_profiles` (Identity) |
| `device_id` | TEXT | Device making request |
| `session_id` | UUID | Current session UUID |
| `current_snapshot_id` | UUID | Reference to the single active snapshot |
| `session_start_at` | TIMESTAMP | When session began |
| `last_active_at` | TIMESTAMP | Last activity (60 min TTL from here) |
| `created_at` | TIMESTAMP | Record creation timestamp |
| `updated_at` | TIMESTAMP | Record update timestamp |

### `snapshots` - Activity & Context

**Purpose:** Stores activity history, location data, and environmental context.

**Key Updates:**
- **2026-02-01:** Added `market` column (from `driver_profiles.market`) for market-wide event discovery.
- **2026-01-14:** `airport_context` dropped (moved to `briefings` table).

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | UUID (PK) | Primary Key |
| `created_at` | TIMESTAMP | Creation timestamp |
| `date` | TEXT | YYYY-MM-DD format |
| `device_id` | TEXT | Device identifier |
| `session_id` | UUID | Linked session ID |
| `user_id` | UUID | Owner ID (for ownership verification) |
| `lat` / `lng` | DOUBLE | Location coordinates |
| `coord_key` | TEXT | FK to `coords_cache` (Format: "lat6d_lng6d") |
| `market` | TEXT | Market context (e.g., "Dallas-Fort Worth") |
| `city` / `state` / `country` | TEXT | **LEGACY** Location identity (Phase 7 removal) |
| `formatted_address` | TEXT | **LEGACY** Full address |
| `timezone` | TEXT | **LEGACY** Timezone string |
| `local_iso` | TIMESTAMP | Authoritative local time |
| `dow` | INTEGER | Day of week (0=Sunday, 1=Monday, etc.) |
| `hour` | INTEGER | Hour of day |
| `day_part_key` | TEXT | Time of day (e.g., 'morning', 'evening') |
| `h3_r8` | TEXT | H3 geohash for density analysis |
| `weather` | JSONB | Weather data |
| `air` | JSONB | Air quality data |
| `permissions` | JSONB | User permissions at snapshot time |
| `holiday` | TEXT | Holiday name or 'none' |
| `is_holiday` | BOOLEAN | True if today is a holiday |

### `strategies` - AI Strategic Output (Lean)

**Purpose:** Stores **ONLY** the AI's strategic output linked to a snapshot.
**Architecture:** Lean Table (2026-01-14).
- Context lives in `snapshots`.
- Briefing data lives in `briefings`.

**State Machine:**
`pending` → `running` → `ok` | `pending_blocks` → `ok` | `failed`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary Key |
| `snapshot_id` | UUID | Reference to `snapshots` (Unique, Cascade Delete) |
| `user_id` | UUID | Owner ID |