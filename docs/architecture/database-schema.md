### `users` - Session Tracking (Ephemeral)

**Purpose:** Tracks active sessions. Simplified architecture (2026-01-05) separates identity (`driver_profiles`) from session state (`users`).

**Files:**
- Schema: `shared/schema.js`

**Session Rules:**
- **Ephemeral:** Rows created on login, deleted on logout or 60 min inactivity.
- **Highlander Rule:** One device per user (login on new device kills old session).
- **Sliding Window:** `last_active_at` updates on every request.
- **No Location:** All location data is stored in `snapshots`.

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID (PK) | Links to `driver_profiles` (Identity) |
| `device_id` | TEXT | Device making the request |
| `session_id` | UUID | Current session UUID |
| `current_snapshot_id` | UUID | Reference to the single active snapshot |
| `session_start_at` | TIMESTAMP | When session began |
| `last_active_at` | TIMESTAMP | Last activity (sliding window for TTL) |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

---

### `snapshots` - Point-in-Time Context (Location Authority)

**Purpose:** Self-contained context snapshot with authoritative location data (lat, lng, city, state, timezone, weather, air quality)

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/api/location/snapshot.js`
- Query: `server/lib/snapshot/get-snapshot-context.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | UUID (PK) | Primary identifier |
| `created_at` | TIMESTAMP | Creation timestamp |
| `date` | TEXT | Snapshot date (YYYY-MM-DD) |
| `device_id` | TEXT | Device identifier |
| `session_id` | UUID | Session identifier |
| `user_id` | UUID | User ID for ownership verification |
| `lat`, `lng` | DOUBLE PRECISION | GPS coordinates at snapshot time |
| `coord_key` | TEXT | FK to coords_cache (lat6d_lng6d) |
| `city`, `state`, `country` | TEXT | Resolved location |
| `formatted_address` | TEXT | Full address |
| `timezone` | TEXT | IANA timezone |
| `market` | TEXT | Market identifier (e.g., "Dallas-Fort Worth") |
| `local_iso` | TIMESTAMP | Local time (no timezone) |
| `dow` | INTEGER | Day of week (0=Sunday) |
| `hour` | INTEGER | Hour (0-23) |
| `day_part_key` | TEXT | morning/afternoon/evening/night |
| `h3_r8` | TEXT | H3 geohash (resolution 8) |
| `weather` | JSONB | `{tempF, conditions, description}` |
| `air` | JSONB | `{aqi, category, dominantPollutant}` |
| `permissions` | JSONB | Device permissions state |
| `holiday` | TEXT | Holiday name or 'none' |
| `is_holiday` | BOOLEAN | True if holiday or override active |

---

### `strategies` - AI Strategic Output

**Purpose:** Stores ONLY the AI's strategic output linked to a snapshot. Lean table (2026-01-14) separating strategy from context and briefings.

**Files:**
- Schema: `shared/schema.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID | Unique reference to `snapshots` (One-to-One) |
| `user_id` | UUID | User identifier |
| `status` | TEXT | State machine status (pending, running, ok, etc.) |