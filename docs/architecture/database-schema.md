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
| `user_id` | UUID (FK) | Reference to users |
| `lat`, `lng` | DECIMAL | GPS coordinates at snapshot time |
| `coord_key` | VARCHAR | FK to coords_cache (lat6d_lng6d) |
| `city`, `state`, `country` | VARCHAR | Resolved location |
| `formatted_address` | TEXT | Full address |
| `timezone` | VARCHAR | IANA timezone |
| `market` | VARCHAR | Market identifier (e.g., "Dallas-Fort Worth") |
| `local_iso` | TIMESTAMP | Local time (no timezone) |
| `dow` | INTEGER | Day of week (0=Sunday) |
| `hour` | INTEGER | Hour (0-23) |
| `day_part_key` | VARCHAR | morning/afternoon/evening/night |
| `h3_r8` | VARCHAR | H3 geohash (resolution 8) |
| `weather` | JSONB | `{tempF, conditions, description}` |
| `air` | JSONB | `{aqi, category, dominantPollutant}` |
| `permissions` | JSONB | Device permissions state |
| `holiday` | VARCHAR | Holiday name or 'none' |
| `is_holiday` | BOOLEAN | True if holiday or override active |

---

### `strategies` - AI Strategy Generation (LEAN - Refactored 2026-01-14)

**Purpose:** Strategy outputs from TRIAD pipeline. Stores ONLY the AI's strategic output linked to a snapshot.

> **LEAN Architecture (2026-01-14):** All location/time context lives in `snapshots` table. All briefing data lives in `briefings` table. Legacy columns were dropped - see `migrations/20260114_lean_strategies_table.sql`.

**Files:**
- Schema: `shared/schema.js`
- Insert/Update: `server/lib/ai/providers/consolidator.js`, `server/api/strategy/blocks-fast.js`
- Query: `server/api/strategy/strategy.js`

**User-Facing Strategies (2 types):**
| Strategy | Tab | Trigger | Model |
|----------|-----|---------|-------|
| `strategy_for_now` | Strategy Tab | Automatic (on GPS resolve) | GPT-5.2 |
| `consolidated_strategy` | Briefing Tab | Manual (user clicks button) | Gemini 3 Pro |

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK, UNIQUE) | Reference to snapshots |
| `user_id` | UUID (FK) | Reference to users |
| `status` | VARCHAR | pending, in_progress, ok, pending_blocks, error |
| `phase` | VARCHAR | strategist, briefer, consolidator, venues (current pipeline phase) |
| `phase_started_at` | TIMESTAMP | When current phase started (for timeout detection) |
| `error_message` | TEXT | Error details if status='error' |
| `strategy_for_now` | TEXT | **Strategy Tab**: 1hr immediate strategy (GPT-5.2, automatic) |
| `consolidated_strategy` | TEXT | **Briefing Tab**: 8-12hr daily strategy (Gemini 3 Pro, manual) |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Dropped Columns (2026-01-14):**
The following columns were removed in the LEAN refactoring: `strategy_id`, `correlation_id`, `strategy`, `error_code`, `attempt`, `latency_ms`, `tokens`, `next_retry_at`, `model_name`, `trigger_reason`, `valid_window_start`, `valid_window_end`, `strategy_timestamp`