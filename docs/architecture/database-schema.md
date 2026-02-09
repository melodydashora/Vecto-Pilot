# Database Schema

PostgreSQL database using Drizzle ORM. Schema defined in `shared/schema.js`.

## Core Tables

### `users` - Session Tracking

**Purpose:** Session tracking only (no location data - location lives in snapshots)

**Files:**
- Schema: `shared/schema.js`
- Insert/Update: `server/middleware/auth.js`
- Query: `server/middleware/auth.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID (PK) | Primary identifier (links to driver_profiles) |
| `device_id` | TEXT | Device making request |
| `session_id` | UUID | Current session UUID |
| `current_snapshot_id` | UUID | Active snapshot reference |
| `session_start_at` | TIMESTAMP | When session began |
| `last_active_at` | TIMESTAMP | Last activity (60 min sliding TTL) |
| `created_at`, `updated_at` | TIMESTAMP | Timestamps |

**Note:** Location data (lat, lng, city, state, timezone) was removed from users table on 2026-01-05 per SAVE-IMPORTANT.md architecture simplification. All location data now lives in snapshots table.

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
| `user_id` | UUID (FK) | Reference to users |
| `lat`, `lng` | DECIMAL | GPS coordinates at snapshot time |
| `coord_key` | VARCHAR | FK to coords_cache (lat6d_lng6d) |
| `city`, `state`, `country` | VARCHAR | Resolved location |
| `formatted_address` | TEXT | Full address |
| `timezone` | VARCHAR | IANA timezone |
| `market` | VARCHAR | Market identifier (e.g., "Dallas-Fort Worth") |
| `date` | DATE | Snapshot date (YYYY-MM-DD) |
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
The following columns were removed in the LEAN refactoring: `strategy`, `error_code`, `attempt`, `latency_ms`, `tokens`, `next_retry_at`, `model_name`, `trigger_reason`, `valid_window_start`, `valid_window_end`, `strategy_timestamp`

---

### `briefings` - Real-Time Intelligence

**Purpose:** Events, traffic, news, weather summaries from Perplexity + Gemini + Google APIs

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/api/briefing/briefing.js`
- Query: `server/api/briefing/briefing.js`, `server/lib/ai/providers/consolidator.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK, UNIQUE) | Reference to snapshots |
| `news` | JSONB | Rideshare-relevant news |
| `weather_current` | JSONB | Current conditions from Google Weather API |
| `weather_forecast` | JSONB | Hourly forecast (next 3-6 hours) |
| `traffic_conditions` | JSONB | Traffic incidents, construction, closures |
| `events` | JSONB | Local events (concerts, sports, festivals) |
| `school_closures` | JSONB | School district & college closures |
| `airport_conditions` | JSONB | Airport delays, arrivals, busy periods |
| `created_at` | TIMESTAMP | Generation time |

---

### `rankings` - Venue Recommendations

**Purpose:** Ranked venue lists for ML training

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/api/strategy/blocks-fast.js`
- Query: `server/api/strategy/content-blocks.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `ranking_id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `model_route` | VARCHAR | AI models used |
| `created_at` | TIMESTAMP | Generation time |

---

### `ranking_candidates` - Individual Venues

**Purpose:** Individual venue recommendations within a ranking, with enrichment data

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/lib/strategy/tactical-planner.js`, `server/lib/venue/venue-enrichment.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `ranking_id` | UUID (FK) | Reference to rankings |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `rank` | INTEGER | Position in list (1-6) |
| `name` | VARCHAR | Venue name |
| `lat`, `lng` | DECIMAL | Venue coordinates |
| `place_id` | VARCHAR | Google Place ID |
| `distance_miles` | DECIMAL | Distance from driver |
| `drive_minutes` | INTEGER | Drive time in minutes |
| `features` | JSONB | `{isOpen, businessStatus, hoursToday}` |
| `business_hours` | JSONB | Full hours from Google Places API |
| `pro_tips` | TEXT[] | Array of tactical tips from GPT-5 |
| `staging_tips` | TEXT | Where to park/stage |
| `staging_lat`, `staging_lng` | DECIMAL | Staging coordinates |
| `district` | TEXT | Neighborhood (e.g., "Deep Ellum") |
| `venue_events` | JSONB | Today's events at this venue |

---

### Feedback Tables (3 separate tables)

**Purpose:** Thumbs up/down feedback for ML training, separated by scope

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/api/feedback/feedback.js`

#### `venue_feedback` - Per-venue thumbs up/down
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `ranking_id` | UUID (FK) | Reference to rankings |
| `place_id` | VARCHAR | Google Place ID |
| `venue_name` | VARCHAR | Venue name |
| `sentiment` | VARCHAR | 'up' or 'down' |
| `comment` | TEXT | Optional comment |

#### `strategy_feedback` - Strategy-level feedback
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `ranking_id` | UUID (FK) | Reference to rankings |
| `sentiment` | VARCHAR | 'up' or 'down' |
| `comment` | TEXT | Optional comment |

#### `app_feedback` - General app feedback
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `sentiment` | VARCHAR | 'up' or 'down' |
| `comment` | TEXT | Optional comment |

---

### `actions` - User Interactions

**Purpose:** Track user actions for ML training

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/api/feedback/actions.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `action_id` | UUID (PK) | Primary identifier |
| `ranking_id` | UUID (FK) | Reference to rankings |
| `action` | VARCHAR | view/click/dwell/navigate/dismiss |
| `block_id` | VARCHAR | Venue identifier |
| `from_rank` | INTEGER | Position clicked |
| `dwell_ms` | INTEGER | Time spent viewing |

---

### `coords_cache` - Geocode Cache

**Purpose:** Cache geocode/timezone lookups (~11cm precision, 6 decimals)

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/location/geo.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `coord_key` | VARCHAR (UNIQUE) | `lat6d_lng6d` format (e.g., "33.128400_-96.868800") |
| `lat`, `lng` | DECIMAL | Full precision coordinates |
| `city`, `state`, `country` | VARCHAR | Resolved location (required) |
| `formatted_address` | TEXT | Full address (required) |
| `timezone` | VARCHAR | IANA timezone (required) |
| `closest_airport` | VARCHAR | Nearest airport name |
| `closest_airport_code` | VARCHAR | Airport code (e.g., "DFW") |
| `hit_count` | INTEGER | Cache utilization counter |
| `created_at` | TIMESTAMP | Cache time |

**Note:** All resolved fields are NOT NULL - incomplete resolutions are not cached.

---

### `markets` - Global Rideshare Markets

**Purpose:** Pre-stored timezone data for 102 major rideshare markets worldwide. Skips Google Timezone API for known markets.

**Files:**
- Schema: `shared/schema.js`
- Seed: `server/scripts/seed-markets.js`
- Query: `server/api/location/location.js` (lookupMarketTimezone function)

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `market_slug` | TEXT (PK) | Unique identifier (e.g., "dfw-metro", "london-uk") |
| `market_name` | TEXT | Display name (e.g., "DFW Metro", "London") |
| `primary_city` | TEXT | Main city (e.g., "Dallas", "London") |
| `state` | TEXT | State/province/region |
| `country_code` | VARCHAR(2) | ISO country code (e.g., "US", "GB") |
| `timezone` | TEXT | IANA timezone (e.g., "America/Chicago") |
| `primary_airport_code` | TEXT | Main airport (e.g., "DFW") |
| `secondary_airports` | JSONB | Array of secondary airports |
| `city_aliases` | JSONB | Array of suburb/neighborhood names |
| `has_uber`, `has_lyft` | BOOLEAN | Platform availability |
| `is_active` | BOOLEAN | Active market flag |

**Coverage (Jan 2026):**
- 69 US markets (67 with airport codes, 1,569 city aliases)
- 71 international markets (1,868 city aliases)
- 140 total markets, 3,437 city aliases
- Multi-airport markets: Chicago (ORD+MDW), Dallas (DFW+DAL), Houston (IAH+HOU), NYC (JFK+LGA)

**Lookup Strategy:**
1. Exact match: `primary_city` + `state`
2. State match: `city_aliases @> [city]` + `state`
3. City-only: `primary_city` (for city-states like Singapore)
4. Alias-only: `city_aliases @> [city]` (for international suburbs)

**Benefits:**
- Saves ~200-300ms per request for known markets
- Reduces Google Timezone API costs ($0.005/request)
- Works offline for known markets

---

### `discovered_events` - AI-Discovered Events

**Purpose:** Events found by AI search (Gemini with Google Search) for rideshare demand prediction

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/scripts/sync-events.mjs`, `server/lib/events/pipeline/`
- Query: `server/api/briefing/briefing.js`, `server/lib/briefing/briefing-service.js`

**Key Columns (Updated 2026-01-10):**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `title` | TEXT | Event name |
| `venue_name` | TEXT | Venue name |
| `address` | TEXT | Full address |
| `city`, `state` | TEXT | Location |
| `event_start_date` | TEXT | Start date (YYYY-MM-DD) - **renamed from event_date** |
| `event_start_time` | TEXT | Start time (e.g., "7:00 PM") - **renamed from event_time** |
| `event_end_date` | TEXT | End date for multi-day events (defaults to event_start_date) |
| `event_end_time` | TEXT | End time (e.g., "10:00 PM") |
| `category` | TEXT | concert/sports/festival/etc. |
| `expected_attendance` | TEXT | high/medium/low |
| `event_hash` | TEXT (UNIQUE) | Deduplication key |
| `is_active` | BOOLEAN | False if cancelled |
| `is_verified` | BOOLEAN | Human verified |
| `venue_id` | UUID (FK) | Reference to venue_catalog.venue_id (for precise coords & SmartBlocks) |
| `deactivation_reason` | TEXT | Why event was deactivated (event_ended, cancelled, etc.) |
| `deactivated_at` | TIMESTAMP | When event was deactivated |
| `deactivated_by` | TEXT | 'ai_coach' or user_id |

**Note (2026-01-10):** Columns `lat`, `lng`, `source_model`, `source_url`, `raw_source_data` were removed. Coordinates now come from `venue_catalog` via `venue_id` FK join. All events are discovered via Gemini with Google Search.

**Field Naming Convention (2026-01-10):**
- Old: `event_date`, `event_time`
- New: `event_start_date`, `event_start_time` (symmetric with `event_end_date`, `event_end_time`)

**Deduplication:** Uses MD5 hash of `normalize(title + venue + date + city)` to prevent duplicates across sources.

See [Event Discovery Architecture](event-discovery.md) and [ETL Pipeline Refactoring](etl-pipeline-refactoring-2026-01-09.md) for full documentation.

---

### `venue_catalog` - Venue Deduplication & Precision Coordinates (Updated 2026-02-01)

> **Note (2026-01-09):** Formerly `venue_cache`, renamed to `venue_catalog` for clarity.
> PK is `venue_id`, not `id`. Always access via `venue.venue_id`.

**Purpose:** Central venue registry with precise coordinates, normalized names for fuzzy matching, and event linking. Eliminates repeated geocoding and enables SmartBlocks "event tonight" flagging.

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/venue/venue-cache.js`
- Integration: `server/scripts/sync-events.mjs`

**All Columns:**
| Column | Type | Description |
|--------|------|-------------|
| **Identity & Basic Info** | | |
| `venue_id` | UUID (PK) | Primary identifier |
| `venue_name` | TEXT | Original venue name |
| `place_id` | TEXT (UNIQUE) | Google Place ID |
| `category` | TEXT | Venue category |
| `dayparts` | JSONB | Active dayparts |
| `staging_notes` | TEXT | Driver staging notes |
| **Location - Precise** | | |
| `lat`, `lng` | DOUBLE PRECISION | Full precision coordinates (15+ decimals) |
| `city` | TEXT | City name |
| `state` | TEXT | State abbreviation (e.g., "TX") |
| `country` | TEXT | Country code (ISO alpha-2, default: 'US') |
| `metro` | TEXT | Metro area |
| `district` | TEXT | District/neighborhood name |
| `district_slug` | TEXT | District slug for lookups |
| `district_centroid_lat/lng` | DOUBLE | District center coordinates |
| **Address Fields** | | |
| `address` | TEXT | Short address |
| `address_1` | TEXT | Street number + route |
| `address_2` | TEXT | Suite, floor, unit |
| `zip` | TEXT | Postal code |
| `formatted_address` | TEXT | Full Google-formatted address |
| **Hours & Status** | | |
| `hours` | JSONB | Opening hours from Google Places |
| `ai_estimated_hours` | TEXT | AI-estimated hours if Google unavailable |
| `business_hours` | TEXT | Human-readable business hours |
| `hours_full_week` | JSONB | `{monday: "4:00 PM - 2:00 AM", ...}` |
| `hours_source` | TEXT | 'google_places', 'manual', 'inferred' |
| `last_known_status` | TEXT | OPEN, CLOSED, UNKNOWN |
| `status_checked_at` | TIMESTAMP | When status was last checked |
| `consecutive_closed_checks` | INTEGER | Closed check counter |
| `auto_suppressed` | BOOLEAN | Auto-suppressed after repeated closures |
| `suppression_reason` | TEXT | Why venue was suppressed |
| **Discovery & Validation** | | |
| `discovery_source` | TEXT | How venue was discovered |
| `validated_at` | TIMESTAMP | When venue was validated |
| `suggestion_metadata` | JSONB | LLM suggestion context |
| `source` | TEXT | 'google_places', 'serpapi', 'llm', 'manual' |
| `source_model` | TEXT | Which AI model discovered this |
| **Deduplication** | | |
| `normalized_name` | TEXT | Lowercase alphanumeric for fuzzy matching |
| `coord_key` | TEXT (UNIQUE) | "33.123456_-96.123456" (6 decimal precision) |
| **Classification** | | |
| `venue_types` | JSONB | Array: ['bar', 'event_host', 'restaurant