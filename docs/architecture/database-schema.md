# Database Schema

PostgreSQL database using Drizzle ORM. Schema defined in `shared/schema.js`.

## Core Tables

### `users` - User Location Authority

**Purpose:** Authoritative source for user GPS coordinates and resolved location

**Files:**
- Schema: `shared/schema.js`
- Insert/Update: `server/api/location/location.js`
- Query: `server/lib/ai/coach-dal.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID (PK) | Primary identifier |
| `device_id` | VARCHAR | Unique device identifier |
| `lat`, `lng` | DECIMAL | GPS coordinates |
| `formatted_address` | TEXT | Full street address |
| `city`, `state`, `country` | VARCHAR | Resolved location |
| `timezone` | VARCHAR | IANA timezone |
| `created_at`, `updated_at` | TIMESTAMP | Timestamps |

---

### `snapshots` - Point-in-Time Context

**Purpose:** Self-contained context snapshot (location, time, weather, air quality)

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

### `strategies` - AI Strategy Generation

**Purpose:** Strategy outputs from TRIAD pipeline (Strategist → Briefer → Consolidator)

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
| `strategy_for_now` | TEXT | **Strategy Tab**: 1hr immediate strategy (GPT-5.2, automatic) |
| `consolidated_strategy` | TEXT | **Briefing Tab**: 8-12hr daily strategy (Gemini 3 Pro, manual) |
| `strategy` | TEXT | Internal: raw strategist output (not user-facing) |
| `status` | VARCHAR | pending/ok/failed |
| `phase` | VARCHAR | starting/resolving/analyzing/consolidator/venues/enriching/complete |
| `phase_started_at` | TIMESTAMP | When current phase started |
| `trigger_reason` | VARCHAR | initial/retry/refresh |
| `model_name` | VARCHAR | Model route (e.g., 'gemini-3-pro→gpt-5.2') |
| `latency_ms` | INTEGER | Total generation time |

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

**Purpose:** Events found by multi-model AI search (SerpAPI, GPT-5.2, Gemini, Claude, Perplexity) for rideshare demand prediction

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/scripts/sync-events.mjs`
- Query: `server/api/briefing/briefing.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `title` | TEXT | Event name |
| `venue_name` | TEXT | Venue name |
| `address` | TEXT | Full address |
| `city`, `state` | TEXT | Location |
| `event_date` | TEXT | Date (YYYY-MM-DD) |
| `event_time` | TEXT | Start time (e.g., "7:00 PM") |
| `event_end_time` | TEXT | End time (e.g., "10:00 PM") |
| `lat`, `lng` | DOUBLE PRECISION | Coordinates |
| `category` | TEXT | concert/sports/festival/etc. |
| `expected_attendance` | TEXT | high/medium/low |
| `source_model` | TEXT | SerpAPI, GPT-5.2, Gemini, etc. |
| `event_hash` | TEXT (UNIQUE) | Deduplication key |
| `is_active` | BOOLEAN | False if cancelled |
| `venue_id` | UUID (FK) | Reference to venue_catalog.venue_id (for precise coords & SmartBlocks) |

**Deduplication:** Uses MD5 hash of `normalize(title + venue + date + city)` to prevent duplicates across sources.

See [Event Discovery Architecture](event-discovery.md) for full documentation.

---

### `venue_catalog` - Venue Deduplication & Precision Coordinates

> **Note (2026-01-09):** Formerly `venue_cache`, renamed to `venue_catalog` for clarity.
> PK is `venue_id`, not `id`. Always access via `venue.venue_id`.

**Purpose:** Central venue registry with precise coordinates, normalized names for fuzzy matching, and event linking. Eliminates repeated geocoding and enables SmartBlocks "event tonight" flagging.

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/venue/venue-cache.js`
- Integration: `server/scripts/sync-events.mjs`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `venue_id` | UUID (PK) | Primary identifier |
| `venue_name` | TEXT | Original venue name |
| `normalized_name` | TEXT | Normalized for matching ("The Rustic" → "rustic") |
| `city`, `state`, `country` | TEXT | Location (country defaults to 'USA') |
| `lat`, `lng` | DOUBLE PRECISION | **Full precision coordinates** (15+ decimals) |
| `coord_key` | TEXT | 6-decimal key for proximity lookup (~0.11m accuracy) |
| `address` | TEXT | Street address |
| `formatted_address` | TEXT | Full formatted address |
| `zip` | TEXT | ZIP code |
| `place_id` | TEXT (UNIQUE) | Google Place ID |
| `hours` | JSONB | Opening hours from Google Places |
| `hours_source` | TEXT | Where hours came from |
| `venue_type` | TEXT | stadium/arena/bar/restaurant/etc. |
| `capacity_estimate` | INTEGER | Estimated capacity |
| `source` | TEXT | Data source (e.g., 'sync_events_gpt52') |
| `source_model` | TEXT | AI model if from LLM |
| `access_count` | INTEGER | Cache hit counter |
| `last_accessed_at` | TIMESTAMP | Last cache hit time |

**Indexes:**
| Index | Purpose |
|-------|---------|
| `UNIQUE (normalized_name, city, state)` | Prevent venue duplicates |
| `UNIQUE (place_id)` | Google Place ID lookup |
| `idx_venue_catalog_coord_key` | Coordinate proximity lookup |
| `idx_venue_catalog_city_state` | Regional venue queries |
| `idx_venue_catalog_normalized_name` | Fuzzy name search |

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

## JSONB Field Schemas

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
