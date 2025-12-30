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

**Deduplication:** Uses MD5 hash of `normalize(title + venue + date + city)` to prevent duplicates across sources.

See [Event Discovery Architecture](event-discovery.md) for full documentation.

---

## Authentication & Driver Profile Tables

### `driver_profiles` - Registered Driver Information

**Purpose:** Extended user information for registered drivers (linked to users table)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Primary identifier |
| `user_id` | UUID (FK, UNIQUE) | Reference to users |
| `first_name`, `last_name` | TEXT | Driver name |
| `email` | TEXT (UNIQUE) | Email address |
| `phone` | TEXT | Phone number |
| `address_1`, `city`, `state_territory`, `country` | TEXT | Home address |
| `home_lat`, `home_lng` | DECIMAL | Geocoded home coordinates |
| `home_timezone` | TEXT | IANA timezone |
| `market` | TEXT | Rideshare market area |
| `rideshare_platforms` | JSONB | Array: ['uber', 'lyft', 'private'] |
| `uber_black`, `uber_xxl`, etc. | BOOLEAN | Service tier flags |
| `email_verified`, `phone_verified` | BOOLEAN | Verification status |

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
