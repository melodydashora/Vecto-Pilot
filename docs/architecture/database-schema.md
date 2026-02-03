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
| `city`, `state`, `timezone` | VARCHAR | Resolved location |
| `date` | DATE | Snapshot date (YYYY-MM-DD) |
| `dow` | INTEGER | Day of week (0=Sunday) |
| `hour` | INTEGER | Hour (0-23) |
| `day_part_key` | VARCHAR | morning/afternoon/evening/night |
| `weather` | JSONB | `{tempF, conditions, description}` |
| `air` | JSONB | `{aqi, category, dominantPollutant}` |
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
| `venue_types` | JSONB | Array: ['bar', 'event_host', 'restaurant'] |
| `market_slug` | TEXT | References markets table |
| `expense_rank` | INTEGER | 1-4 for $/$$/$$$/$$$$ filtering |
| `crowd_level` | TEXT | 'low', 'medium', 'high' |
| `rideshare_potential` | TEXT | 'low', 'medium', 'high' |
| `capacity_estimate` | INTEGER | Venue capacity |
| **Progressive Enrichment (2026-01-14)** | | |
| `is_bar` | BOOLEAN | Quick filter flag |
| `is_event_venue` | BOOLEAN | Discovered via events |
| `record_status` | TEXT | 'stub', 'enriched', 'verified' |
| **Tracking** | | |
| `access_count` | INTEGER | Cache hit counter |
| `last_accessed_at` | TIMESTAMP | Last cache access |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Indexes (13 total):**
| Index | Purpose |
|-------|---------|
| `UNIQUE (normalized_name, city, state)` | Prevent venue duplicates |
| `UNIQUE (place_id)` | Google Place ID lookup |
| `UNIQUE (coord_key)` | Coordinate key lookup |
| `idx_venue_catalog_normalized_name` | Fuzzy name search |
| `idx_venue_catalog_city_state` | Regional venue queries |
| `idx_venue_catalog_market_slug` | Market-based queries |
| `idx_venue_catalog_venue_types` | GIN index for JSONB array |
| `idx_venue_catalog_expense_rank` | Price filtering (partial) |
| `idx_venue_catalog_is_bar` | Bar filtering (partial: where true) |
| `idx_venue_catalog_is_event_venue` | Event venue filtering (partial) |
| `idx_venue_catalog_record_status` | Enrichment status queries |

**Relationship:** `discovered_events.venue_id` → `venue_catalog.venue_id` (FK, ON DELETE SET NULL)

**Normalization Algorithm:**
```javascript
// "AT&T Stadium" → "att stadium"
// "The Rustic" → "rustic"
function normalizeVenueName(name) {
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')     // Remove "The"
    .replace(/&/g, ' and ')      // AT&T → att
    .replace(/[^\w\s]/g, '')     // Remove punctuation
    .replace(/\s+/g, ' ')        // Collapse whitespace
    .trim();
}
```

**Benefits:**
1. **Precise Coordinates**: Full 15+ decimal precision vs coord_cache's 6 decimals (~0.11m)
2. **Event Linking**: SmartBlocks can check "event tonight at this venue?" via FK join
3. **Deduplication**: Same venue from different LLMs resolves to single cache entry
4. **Reduced API Calls**: Reuse cached venue data instead of repeated geocoding

---

## Authentication & Driver Profile Tables

### `driver_profiles` - Registered Driver Information

**Purpose:** Extended user information for registered drivers (linked to users table)

**Eligibility Taxonomy:** Platform-agnostic vehicle class, attributes, and preferences.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK, UNIQUE) | Reference to users |
| `first_name`, `last_name` | TEXT | Driver name |
| `driver_nickname` | TEXT | Custom greeting name (defaults to first_name) |
| `email` | TEXT (UNIQUE) | Email address |
| `phone` | TEXT | Phone number |
| `address_1`, `city`, `state_territory`, `country` | TEXT | Home address |
| `home_lat`, `home_lng` | DECIMAL | Geocoded home coordinates |
| `home_timezone` | TEXT | IANA timezone |
| `market` | TEXT | Rideshare market area |
| `rideshare_platforms` | JSONB | Array: ['uber', 'lyft', 'ridehail', 'private'] |
| **Vehicle Class** | | |
| `elig_economy` | BOOLEAN | Standard 4-seat sedan (UberX, Lyft Standard) |
| `elig_xl` | BOOLEAN | 6+ seat SUV/minivan |
| `elig_xxl` | BOOLEAN | 6+ seat + extra cargo |
| `elig_comfort` | BOOLEAN | Newer vehicle, extra legroom |
| `elig_luxury_sedan` | BOOLEAN | Premium sedan (Uber Black) |
| `elig_luxury_suv` | BOOLEAN | Premium SUV, 6+ seats |
| **Vehicle Attributes** | | |
| `attr_electric` | BOOLEAN | Fully electric vehicle |
| `attr_green` | BOOLEAN | Hybrid or low-emission |
| `attr_wav` | BOOLEAN | Wheelchair accessible |
| `attr_ski` | BOOLEAN | Ski rack / winter ready |
| `attr_car_seat` | BOOLEAN | Child safety seat available |
| **Service Preferences** | | |
| `pref_pet_friendly` | BOOLEAN | Accept passengers with pets |
| `pref_teen` | BOOLEAN | Unaccompanied minors (13-17) |
| `pref_assist` | BOOLEAN | Door-to-door assistance for seniors |
| `pref_shared` | BOOLEAN | Carpool/shared rides |
| `email_verified`, `phone_verified` | BOOLEAN | Verification status |
| `terms_accepted`, `terms_accepted_at` | BOOLEAN/TIMESTAMP | Terms & Conditions |

### `driver_vehicles` - Vehicle Information

**Purpose:** Vehicle details for each registered driver

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `driver_profile_id` | UUID (FK) | Reference to driver_profiles |
| `year` | INTEGER | Vehicle year |
| `make`, `model` | TEXT | Vehicle make and model |
| `color` | TEXT | Vehicle color |
| `license_plate` | TEXT | License plate |
| `seatbelts` | INTEGER | Seatbelt count (default 4) |
| `is_primary` | BOOLEAN | Primary vehicle flag |
| `is_active` | BOOLEAN | Active status |

### `auth_credentials` - Password & Security

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK, UNIQUE) | Reference to users |
| `password_hash` | TEXT | bcrypt hashed password |
| `failed_login_attempts` | INTEGER | Lockout counter |
| `locked_until` | TIMESTAMP | Account lockout time |
| `password_reset_token` | TEXT | Reset token |
| `password_reset_expires` | TIMESTAMP | Token expiry |

### `verification_codes` - Email/SMS Verification

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `code` | TEXT | Verification code |
| `code_type` | TEXT | 'email_verify', 'phone_verify', 'password_reset_*' |
| `destination` | TEXT | Email or phone number |
| `expires_at` | TIMESTAMP | Code expiry |
| `attempts` | INTEGER | Attempt counter |

---

## Platform & Reference Tables

### `platform_data` - Rideshare Platform Coverage

**Purpose:** Which rideshare platforms operate in each city/market

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `platform` | TEXT | 'uber', 'lyft', etc. |
| `country` | TEXT | Country name |
| `country_code` | TEXT | ISO 2-letter code (e.g., 'US', 'CA') |
| `region` | TEXT | State/province/region |
| `city` | TEXT | City name |
| `market` | TEXT | Market name (e.g., 'Dallas-Fort Worth') |
| `market_anchor` | TEXT | Core market city |
| `region_type` | TEXT | 'Core', 'Satellite', or 'Rural' |
| `timezone` | TEXT | IANA timezone |
| `center_lat`, `center_lng` | DECIMAL | Market center coordinates |
| `coord_boundary` | JSONB | GeoJSON polygon for service area |
| `is_active` | BOOLEAN | Whether service is active |

### `countries` - Country Reference Data

**Purpose:** ISO 3166-1 country codes for registration dropdowns

| Column | Type | Description |
|--------|------|-------------|
| `code` | VARCHAR(2) PK | ISO alpha-2 code (e.g., 'US') |
| `name` | TEXT | Official country name |
| `alpha3` | VARCHAR(3) | ISO alpha-3 code (e.g., 'USA') |
| `phone_code` | TEXT | Calling code (e.g., '+1') |
| `has_platform_data` | BOOLEAN | Has rideshare coverage in our data |
| `display_order` | INTEGER | Dropdown priority (US = 0) |
| `is_active` | BOOLEAN | Active for filtering |

---

## AI Coach Tables

### `coach_conversations` - User-Level Memory

**Purpose:** Full conversation history for AI Coach, enabling thread continuity across sessions

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/ai/coach-dal.js`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users (required) |
| `snapshot_id` | UUID (FK) | Reference to snapshots (optional) |
| `market_slug` | TEXT | Market identifier for cross-driver learning (e.g., "dallas-tx") |
| `conversation_id` | UUID | Groups messages in a thread |
| `role` | TEXT | 'user' / 'assistant' / 'system' |
| `content` | TEXT | Message content |
| `topic_tags` | JSONB | AI-classified topics: ['staging', 'surge'] |
| `extracted_tips` | JSONB | Tips extracted from exchange |
| `location_context` | JSONB | {city, state, lat, lng} at time of message |
| `time_context` | JSONB | {dow, hour, day_part} at time of message |
| `is_starred` | BOOLEAN | User starred for reference |
| `created_at` | TIMESTAMP | When message was sent |

### `coach_system_notes` - AI Observations

**Purpose:** AI Coach observations about potential system enhancements

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/ai/coach-dal.js`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `note_type` | TEXT | 'feature_request' / 'pain_point' / 'aha_moment' |
| `category` | TEXT | 'ui' / 'strategy' / 'coach' / 'venues' |
| `priority` | INTEGER | 1-100 (higher = more urgent) |
| `title` | TEXT | Short descriptive title |
| `description` | TEXT | Full observation |
| `user_quote` | TEXT | Direct user quote that triggered this |
| `occurrence_count` | INTEGER | How many times this has come up |
| `status` | TEXT | 'new' / 'reviewed' / 'planned' / 'implemented' |

### `news_deactivations` - User Content Filtering

**Purpose:** Per-user news deactivation - reasons are free-form, we'll learn patterns as users interact

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/ai/coach-dal.js`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `news_hash` | TEXT | MD5 hash for deduplication |
| `news_title` | TEXT | Original title |
| `reason` | TEXT | Free-form reason from user or AI Coach |
| `deactivated_by` | TEXT | 'user' / 'ai_coach' |

### `zone_intelligence` - Crowd-Sourced Market Knowledge

**Purpose:** Market-specific zone intelligence gathered from driver conversations. Implements **cross-driver learning**: when multiple drivers report the same zone, confidence increases.

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/ai/coach-dal.js`

**Zone Types:**
| Type | Description |
|------|-------------|
| `dead_zone` | Areas with little/no ride demand |
| `danger_zone` | Unsafe/sketchy areas to avoid |
| `honey_hole` | Consistently profitable spots |
| `surge_trap` | Fake/unprofitable surge areas |
| `staging_spot` | Good waiting/staging locations |
| `event_zone` | Temporary high-demand areas |

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `market_slug` | TEXT | Market identifier (e.g., "dallas-tx") |
| `zone_type` | TEXT | Zone classification (see types above) |
| `zone_name` | TEXT | Human-readable name ("Deep Ellum after 2am") |
| `zone_description` | TEXT | Detailed description |
| `lat`, `lng` | DOUBLE | Optional coordinates |
| `radius_miles` | DOUBLE | Approximate zone radius (default 0.5) |
| `address_hint` | TEXT | Location hint ("near Target on Main") |
| `time_constraints` | JSONB | When this applies (e.g., `{after_hour: 22}`) |
| `is_time_specific` | BOOLEAN | True if zone quality depends on time |
| `reports_count` | INTEGER | How many drivers reported this |
| `confidence_score` | INTEGER | 1-100, increases with more reports (max 95) |
| `contributing_users` | JSONB | Array of user_ids who contributed |
| `source_conversations` | JSONB | conversation_ids where learned |
| `last_reason` | TEXT | Most recent reason given |
| `is_active` | BOOLEAN | Soft delete flag |

**Cross-Driver Learning Algorithm:**
1. When driver reports zone intel, search for similar zones (by type + name similarity)
2. If match found: increment `reports_count`, increase `confidence_score` by 10 (max 95), add user to `contributing_users`
3. If no match: create new zone with `confidence_score: 50`

**AI Coach Integration:**
- AI Coach parses `[ZONE_INTEL: {...}]` tags from responses
- Zone intel summary included in AI context for all drivers in that market
- Only zones with `confidence_score >= 40` shown in summaries

---

## Omni-Presence Tables (Level 4 Architecture)

### `intercepted_signals` - External Offer Analysis (Headless Ingestion)

**Purpose:** Store and analyze ride offers intercepted from external sources (iOS Siri Shortcut, etc.). Part of the "Siri Interceptor" feature for hands-free offer evaluation.

**⚠️ CRITICAL: Headless Ingestion Pattern**

This table supports **headless clients** (iOS Shortcuts, Android automations) that cannot authenticate via JWT. The `user_id` column is **intentionally NOT a Foreign Key** to allow "fire and forget" inserts.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  WHY NO FK CONSTRAINT ON user_id?                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Problem: Siri Shortcuts run WITHOUT an authenticated user session.      │
│  They can't carry JWT tokens or create valid user sessions.              │
│                                                                          │
│  Solution: Use device_id as PRIMARY identifier, user_id as OPTIONAL.     │
│                                                                          │
│  ❌ WITH FK: INSERT fails → "foreign key violation" → rejection loop     │
│  ✅ NO FK:   INSERT succeeds → signals stored → user linked later        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/api/hooks/analyze-offer.js` (planned)
- Query: `client/src/components/omni/SignalTerminal.tsx` via SSE/Polling

**Data Flow:**
```
iOS Shortcut → OCR extracts text → POST /api/hooks/analyze-offer
    → Parse price/miles/time → AI decision → INSERT intercepted_signals
    → SSE push to SignalTerminal UI
```

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `device_id` | VARCHAR (NOT NULL) | **PRIMARY identifier for headless clients** |
| `user_id` | UUID (nullable, **NO FK**) | Optional - linked later when driver logs in |
| `raw_text` | TEXT | Raw OCR text from screenshot |
| `parsed_data` | JSONB | `{price, miles, time, pickup, dropoff, platform}` |
| `decision` | TEXT | 'ACCEPT' / 'REJECT' |
| `decision_reasoning` | TEXT | AI explanation for decision |
| `confidence_score` | DECIMAL | 0.0-1.0 confidence in decision |
| `user_override` | TEXT | null / 'ACCEPT' / 'REJECT' (if driver overrode AI) |
| `source` | VARCHAR | 'siri_shortcut' / 'android_automation' / 'manual' |
| `created_at` | TIMESTAMP | When signal was received |

**Parsed Data JSONB Schema:**
```json
{
  "price": 12.50,          // Dollar amount
  "miles": 4.2,            // Trip distance
  "time": 8,               // Estimated minutes
  "pickup": "Main St",     // Pickup location (if parsed)
  "dropoff": "Airport",    // Dropoff location (if parsed)
  "platform": "uber",      // Detected platform
  "surge": 1.5,            // Surge multiplier (if detected)
  "per_mile": 2.98         // Calculated $/mile
}
```

**Decision Logic:**
| Metric | ACCEPT Threshold | REJECT Threshold |
|--------|------------------|------------------|
| $/mile | ≥ $2.00 | < $1.50 |
| $/minute | ≥ $1.50 | < $1.00 |
| Distance | ≤ 15 miles | > 25 miles |

**Indexes:**
- `idx_intercepted_signals_user_id` on `user_id`
- `idx_intercepted_signals_created` on `(user_id, created_at DESC)`

---

## Dispatch Primitives Tables

### `driver_goals` - Earning & Trip Targets

**Purpose:** Track driver earning goals, trip targets, and time constraints. Enables goal-aware recommendations like "I want to make $500 by 6pm".

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/dispatch/goals-dal.js` (planned)

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `goal_type` | TEXT | 'earnings' / 'trips' / 'hours' / 'custom' |
| `target_amount` | DOUBLE | Target value (e.g., 500 for $500) |
| `target_unit` | TEXT | 'dollars' / 'trips' / 'hours' |
| `deadline` | TIMESTAMP | When goal must be achieved by |
| `min_hourly_rate` | DOUBLE | Minimum acceptable $/hr |
| `urgency` | TEXT | 'low' / 'normal' / 'high' / 'critical' |
| `is_active` | BOOLEAN | Active goal flag |
| `progress_amount` | DOUBLE | Current progress toward goal |
| `completed_at` | TIMESTAMP | When goal was achieved |

**Indexes:**
- `idx_driver_goals_user_id` on `user_id`
- `idx_driver_goals_active` on `(user_id, is_active)` where active

---

### `driver_tasks` - Hard Stops & Obligations

**Purpose:** Track non-driving obligations and hard stops (car wash, pickup kids, appointments). Enables "return-home plan" that respects time constraints.

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/dispatch/tasks-dal.js` (planned)

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `title` | TEXT | Task description (e.g., "Car wash") |
| `description` | TEXT | Optional details |
| `due_at` | TIMESTAMP | When task must be done by |
| `duration_minutes` | INTEGER | How long task takes |
| `location` | TEXT | Address or place description |
| `place_id` | TEXT | Google Place ID if available |
| `lat`, `lng` | DOUBLE | Coordinates if location-bound |
| `is_hard_stop` | BOOLEAN | Must stop driving for this |
| `priority` | INTEGER | 1-100 priority |
| `is_complete` | BOOLEAN | Task completed flag |
| `recurrence` | TEXT | 'daily' / 'weekly' / 'weekdays' / null |

**Indexes:**
- `idx_driver_tasks_user_id` on `user_id`
- `idx_driver_tasks_due_at` on `(user_id, due_at)` where incomplete
- `idx_driver_tasks_hard_stop` on `(user_id, due_at)` where hard stop and incomplete

---

### `safe_zones` - Geofence Boundaries

**Purpose:** Define safety boundaries for dispatch recommendations. Enables "stay inside safe boundary unless goal demands otherwise".

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/dispatch/zones-dal.js` (planned)

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `zone_name` | TEXT | Zone name (e.g., "Home area") |
| `zone_type` | TEXT | 'safe' / 'avoid' / 'prefer' |
| `geometry` | TEXT | GeoJSON polygon |
| `center_lat`, `center_lng` | DOUBLE | Circle center coordinates |
| `radius_miles` | DOUBLE | Circular zone radius |
| `neighborhoods` | TEXT | Comma-separated names (alternative) |
| `risk_level` | INTEGER | 1-5 (1=safest, 5=riskiest) |
| `risk_notes` | TEXT | Why zone has certain risk level |
| `is_active` | BOOLEAN | Active zone flag |
| `applies_at_night` | BOOLEAN | Apply after 9pm |
| `applies_at_day` | BOOLEAN | Apply during day |

**Zone Types:**
- `safe`: Driver prefers to stay in this area
- `avoid`: Driver wants to avoid this area
- `prefer`: Bonus preference for this area

**Indexes:**
- `idx_safe_zones_user_id` on `user_id`
- `idx_safe_zones_active` on `(user_id, is_active)` where active
- `idx_safe_zones_type` on `(user_id, zone_type)`

---

### `staging_saturation` - Anti-Crowding Tracker

**Purpose:** Track staging location suggestions to prevent overcrowding. Diversifies suggestions when many drivers ask for recommendations.

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/dispatch/saturation-dal.js` (planned)

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `h3_cell` | TEXT | H3 index at resolution 8 (~0.5km cells) |
| `venue_name` | TEXT | Optional specific venue name |
| `window_start` | TIMESTAMP | Hour window start |
| `window_end` | TIMESTAMP | Hour window end |
| `suggestion_count` | INTEGER | How many times suggested |
| `active_drivers` | INTEGER | Estimated drivers heading there |
| `market_slug` | TEXT | Market identifier |

**Algorithm:**
When suggesting staging locations:
1. Check `staging_saturation` for recent suggestions in same H3 cell
2. If `suggestion_count > threshold`, pick alternative location
3. Increment `suggestion_count` for chosen location

**Indexes:**
- `idx_staging_saturation_h3_window` UNIQUE on `(h3_cell, window_start)`
- `idx_staging_saturation_market` on `(market_slug, window_start)`
- `idx_staging_saturation_count` on `suggestion_count DESC`

---

## Memory & Agent Tables (Added 2026-02-01)

These tables support AI agent memory, context persistence, and cross-session continuity.

### `agent_memory` - General Agent Memory

**Purpose:** Memory layer for agent context across sessions (key-value with tags)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `key` | TEXT | Memory key identifier |
| `content` | TEXT | Memory content |
| `tags` | TEXT[] | Searchable tags array |
| `metadata` | JSONB | Additional metadata |
| `ttl_hours` | INTEGER | Time-to-live in hours |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

### `assistant_memory` - Thread-Aware Enhanced Memory

**Purpose:** Enhanced memory for thread-aware context tracking with session persistence

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `thread_id` | TEXT | Thread/conversation identifier |
| `key` | TEXT | Memory key |
| `content` | TEXT | Memory content |
| `tags` | TEXT[] | Searchable tags |
| `metadata` | JSONB | Additional metadata |
| `expires_at` | TIMESTAMP | Optional expiration |
| `created_at` | TIMESTAMP | Creation timestamp |

### `cross_thread_memory` - Cross-Session Memory

**Purpose:** Memory that persists across different conversation threads

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `scope` | TEXT | Memory scope (global, project, user) |
| `key` | TEXT | Memory key |
| `content` | TEXT | Memory content |
| `metadata` | JSONB | Additional metadata |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

### `eidolon_memory` - Eidolon SDK Memory

**Purpose:** Memory storage for Eidolon SDK operations

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `project_id` | TEXT | Project identifier |
| `key` | TEXT | Memory key |
| `value` | JSONB | Memory value |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

### `eidolon_snapshots` - Eidolon Project State

**Purpose:** Project/session state persistence for Eidolon SDK

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `project_id` | TEXT | Project identifier |
| `snapshot_data` | JSONB | Full state snapshot |
| `created_at` | TIMESTAMP | Creation timestamp |

---

## Job Tracking Tables

### `triad_jobs` - TRIAD Pipeline Job Tracking

**Purpose:** Background job tracking for TRIAD pipeline (strategy generation)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK, UNIQUE) | Reference to snapshots |
| `status` | TEXT | pending, running, complete, failed |
| `started_at` | TIMESTAMP | Job start time |
| `completed_at` | TIMESTAMP | Job completion time |
| `error` | TEXT | Error message if failed |
| `created_at` | TIMESTAMP | Creation timestamp |

### `block_jobs` - Smart Blocks Job Tracking

**Purpose:** Background job tracking for smart blocks generation

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `status` | TEXT | pending, running, complete, failed |
| `blocks_count` | INTEGER | Number of blocks generated |
| `started_at` | TIMESTAMP | Job start time |
| `completed_at` | TIMESTAMP | Job completion time |
| `error` | TEXT | Error message if failed |

---

## Intelligence Tables

### `market_intelligence` - Market-Level Research

**Purpose:** Market-level research intelligence (rules, zones, timing patterns)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `market_slug` | TEXT | Market identifier (e.g., "dallas-tx") |
| `intel_type` | TEXT | rule, pattern, timing, zone |
| `title` | TEXT | Short title |
| `content` | TEXT | Full intelligence content |
| `source` | TEXT | Where intel came from |
| `confidence` | INTEGER | 1-100 confidence score |
| `is_active` | BOOLEAN | Active flag |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

### `user_intel_notes` - Coach-Generated Notes

**Purpose:** Per-user notes from driver interactions with AI Coach

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `note_type` | TEXT | preference, tip, observation, warning |
| `title` | TEXT | Note title |
| `content` | TEXT | Note content |
| `source_conversation_id` | UUID | Conversation that generated note |
| `is_pinned` | BOOLEAN | Pinned for quick reference |
| `is_deleted` | BOOLEAN | Soft delete flag |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

### `traffic_zones` - Real-Time Traffic Intelligence

**Purpose:** Real-time traffic zone intelligence from TomTom

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `market_slug` | TEXT | Market identifier |
| `zone_name` | TEXT | Zone description |
| `severity` | INTEGER | 1-5 severity level |
| `delay_minutes` | INTEGER | Estimated delay |
| `lat`, `lng` | DOUBLE | Zone center |
| `radius_miles` | DOUBLE | Affected radius |
| `expires_at` | TIMESTAMP | When this intel expires |
| `created_at` | TIMESTAMP | Creation timestamp |

### `travel_disruptions` - Airport/Travel Delays

**Purpose:** FAA airport delays and ground stops

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `airport_code` | TEXT | IATA airport code |
| `disruption_type` | TEXT | delay, ground_stop, ground_delay |
| `reason` | TEXT | Weather, volume, equipment, etc. |
| `average_delay` | INTEGER | Minutes of average delay |
| `start_time` | TIMESTAMP | When disruption started |
| `end_time` | TIMESTAMP | Expected end time |
| `is_active` | BOOLEAN | Currently active |
| `created_at` | TIMESTAMP | Creation timestamp |

---

## Venue Intelligence Tables

### `venue_events` - Per-Venue Event Listings

**Purpose:** Events associated with specific venues (different from discovered_events)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `venue_id` | UUID (FK) | Reference to venue_catalog |
| `event_name` | TEXT | Event name |
| `event_date` | DATE | Event date |
| `event_time` | TEXT | Event time |
| `event_type` | TEXT | concert, sports, theater, etc. |
| `expected_attendance` | INTEGER | Estimated attendance |
| `source` | TEXT | Where event was discovered |
| `created_at` | TIMESTAMP | Creation timestamp |

### `venue_feedback` - Per-Venue Thumbs Up/Down

**Purpose:** Driver feedback on venue recommendations

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `venue_id` | UUID (FK) | Reference to venue_catalog |
| `ranking_id` | UUID (FK) | Reference to ranking_candidates |
| `feedback_type` | TEXT | thumbs_up, thumbs_down |
| `reason` | TEXT | Optional reason |
| `created_at` | TIMESTAMP | Creation timestamp |

### `venue_metrics` - Venue Recommendation Metrics

**Purpose:** Track venue recommendation performance

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `venue_id` | UUID (FK) | Reference to venue_catalog |
| `times_recommended` | INTEGER | Total recommendations |
| `times_selected` | INTEGER | Times user selected |
| `thumbs_up_count` | INTEGER | Positive feedback count |
| `thumbs_down_count` | INTEGER | Negative feedback count |
| `avg_score` | DOUBLE | Average recommendation score |
| `updated_at` | TIMESTAMP | Last update timestamp |

### `llm_venue_suggestions` - LLM-Generated Venue Suggestions

**Purpose:** Venue suggestions from LLMs awaiting validation

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `venue_name` | TEXT | Suggested venue name |
| `suggested_address` | TEXT | Address from LLM |
| `category` | TEXT | Bar, restaurant, event venue, etc. |
| `reason` | TEXT | Why LLM suggested this venue |
| `validated` | BOOLEAN | Whether Places API validated |
| `place_id` | TEXT | Google Place ID if validated |
| `created_at` | TIMESTAMP | Creation timestamp |

---

## Cache & Reference Tables

### `places_cache` - Places API Cache

**Purpose:** Cache for Google Places API results (note: `coords_key` column stores coordinate keys like "33.123456_-96.123456")

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `coords_key` | TEXT (UNIQUE) | Coordinate key (lat_lng format) |
| `places_data` | JSONB | Cached Places API response |
| `expires_at` | TIMESTAMP | Cache expiration |
| `created_at` | TIMESTAMP | Creation timestamp |

> **Note (2026-01-10):** Column was renamed from `place_id` to `coords_key` for semantic accuracy per D-013.

### `vehicle_makes_cache` - NHTSA Vehicle Makes Cache

**Purpose:** Cache for NHTSA API vehicle makes

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `make_id` | INTEGER | NHTSA make ID |
| `make_name` | TEXT | Make name (e.g., "Toyota") |
| `created_at` | TIMESTAMP | Creation timestamp |

### `vehicle_models_cache` - NHTSA Vehicle Models Cache

**Purpose:** Cache for NHTSA API vehicle models

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `make_id` | INTEGER | NHTSA make ID |
| `model_id` | INTEGER | NHTSA model ID |
| `model_name` | TEXT | Model name (e.g., "Camry") |
| `created_at` | TIMESTAMP | Creation timestamp |

### `us_market_cities` - City to Market Lookup

**Purpose:** Maps cities to their rideshare markets (e.g., "Frisco, TX" → "Dallas market")

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `city` | TEXT | City name |
| `state` | TEXT | State code |
| `market_slug` | TEXT | Market identifier |
| `is_anchor` | BOOLEAN | Is this the market's main city |
| `created_at` | TIMESTAMP | Creation timestamp |

---

## Feedback & Audit Tables

### `app_feedback` - General App Feedback

**Purpose:** General app-level feedback from users

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `feedback_type` | TEXT | bug, suggestion, compliment, other |
| `content` | TEXT | Feedback content |
| `page` | TEXT | Which page user was on |
| `metadata` | JSONB | Additional context |
| `created_at` | TIMESTAMP | Creation timestamp |

### `strategy_feedback` - Strategy-Level Feedback

**Purpose:** Feedback specifically on strategy recommendations

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK) | Reference to users |
| `strategy_id` | UUID (FK) | Reference to strategies |
| `feedback_type` | TEXT | thumbs_up, thumbs_down |
| `reason` | TEXT | Optional reason |
| `created_at` | TIMESTAMP | Creation timestamp |

### `connection_audit` - Database Connection Audit

**Purpose:** Audit trail for database connection events

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `event_type` | TEXT | connect, disconnect, error, pool_full |
| `connection_id` | TEXT | Connection identifier |
| `details` | JSONB | Event details |
| `created_at` | TIMESTAMP | Event timestamp |

### `http_idem` - HTTP Idempotency Tracking

**Purpose:** Track HTTP request idempotency for replay protection

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `idempotency_key` | TEXT (UNIQUE) | Client-provided key |
| `response` | JSONB | Cached response |
| `status_code` | INTEGER | HTTP status code |
| `expires_at` | TIMESTAMP | When to expire |
| `created_at` | TIMESTAMP | Creation timestamp |

### `agent_changes` - File Change Tracking

**Purpose:** Track file changes and document modifications for Change Analyzer

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `file_path` | TEXT | Relative file path |
| `change_type` | TEXT | added, modified, deleted |
| `commit_hash` | TEXT | Git commit hash |
| `detected_at` | TIMESTAMP | When change was detected |
| `reviewed` | BOOLEAN | Whether change has been reviewed |
| `notes` | TEXT | Review notes |

---

## JSONB Field Schemas (Updated 2026-02-01)

### `weather` (in snapshots)
```json
{
  "tempF": 72,
  "conditions": "Partly Cloudy",
  "description": "Partly cloudy with mild temperatures",
  "humidity": 45,
  "windMph": 8
}
```

### `air` (in snapshots)
```json
{
  "aqi": 42,
  "category": "Good",
  "dominantPollutant": "PM2.5"
}
```

### `events` (in briefings)
```json
[
  {
    "name": "Cowboys vs Eagles",
    "venue": "AT&T Stadium",
    "time": "7:00 PM",
    "category": "sports",
    "impact": "high"
  }
]
```

### `features` (in ranking_candidates)
Venue enrichment data calculated during TRIAD pipeline:
```json
{
  "isOpen": true,
  "businessStatus": "OPERATIONAL",
  "hoursToday": "5:00 PM - 2:00 AM",
  "closingSoon": false,
  "minutesUntilClose": 180,
  "placeId": "ChIJ...",
  "priceLevel": 2
}
```

### `weather_current` (in briefings)
```json
{
  "temperature": 72,
  "feelsLike": 75,
  "condition": "Clear",
  "humidity": 45,
  "windSpeed": 8,
  "windDirection": "NW",
  "icon": "clear_day"
}
```

### `weather_forecast` (in briefings)
```json
[
  {
    "hour": "2:00 PM",
    "temperature": 75,
    "condition": "Partly Cloudy",
    "precipitation": 10
  }
]
```

### `traffic_conditions` (in briefings)
```json
{
  "headline": "Heavy congestion on I-35",
  "keyIssues": [
    "I-35 northbound: 15 min delay due to accident",
    "US-75 heavy traffic near downtown"
  ],
  "avoidAreas": ["I-35 between exits 428-432"],
  "driverImpact": "Expect +10-15 min for downtown pickups",
  "closures": []
}
```

### `school_closures` (in briefings)
```json
[
  {
    "name": "Dallas ISD",
    "type": "district",
    "status": "closed",
    "reason": "Weather"
  }
]
```

### `hours_full_week` (in venue_catalog)
```json
{
  "monday": "4:00 PM - 2:00 AM",
  "tuesday": "4:00 PM - 2:00 AM",
  "wednesday": "4:00 PM - 2:00 AM",
  "thursday": "4:00 PM - 2:00 AM",
  "friday": "4:00 PM - 3:00 AM",
  "saturday": "12:00 PM - 3:00 AM",
  "sunday": "12:00 PM - 12:00 AM"
}
```

### `venue_types` (in venue_catalog)
```json
["bar", "event_host", "restaurant", "nightclub"]
```
**Valid types:** bar, restaurant, nightclub, stadium, arena, theater, event_host, hotel, casino, concert_hall

### `parsed_data` (in intercepted_signals)
```json
{
  "price": 12.50,
  "miles": 4.2,
  "time": 8,
  "pickup": "Main St",
  "dropoff": "Airport",
  "platform": "uber",
  "surge": 1.5,
  "per_mile": 2.98
}
```

### `time_constraints` (in zone_intelligence)
```json
{
  "after_hour": 22,
  "before_hour": 6,
  "days": ["friday", "saturday"]
}
```

---

## Commands

```bash
# Push schema changes
npm run db:push

# Generate migrations
npx drizzle-kit generate

# View database
npx drizzle-kit studio
```

## Connections

- **Schema:** `shared/schema.js`
- **Client:** `server/db/db-client.js`
- **Connection:** `server/db/connection-manager.js`
