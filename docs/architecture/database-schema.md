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

**Purpose:** Model-agnostic strategy outputs from parallel pipeline

**Files:**
- Schema: `shared/schema.js`
- Insert/Update: `server/lib/ai/providers/minstrategy.js`, `consolidator.js`
- Query: `server/api/strategy/strategy.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `strategy_id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `minstrategy` | TEXT | Raw strategist output |
| `consolidated_strategy` | TEXT | 8-12hr daily strategy |
| `strategy_for_now` | TEXT | 1hr immediate strategy |
| `strategy_model` | VARCHAR | Model used (e.g., claude-opus-4-5) |
| `consolidator_model` | VARCHAR | Consolidator model |
| `status` | VARCHAR | pending/ok/failed |

---

### `briefings` - Real-Time Intelligence

**Purpose:** Events, traffic, news, weather summaries

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/lib/briefing/briefing-service.js`
- Query: `server/api/briefing/briefing.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `briefing_id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `events` | JSONB | Local events array |
| `traffic` | JSONB | Traffic conditions |
| `news` | JSONB | Rideshare-relevant news |
| `weather_summary` | TEXT | Weather narrative |
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

**Purpose:** Individual venue recommendations within a ranking

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/lib/strategy/tactical-planner.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL (PK) | Primary identifier |
| `ranking_id` | UUID (FK) | Reference to rankings |
| `rank` | INTEGER | Position in list (1-6) |
| `name` | VARCHAR | Venue name |
| `lat`, `lng` | DECIMAL | Venue coordinates |
| `place_id` | VARCHAR | Google Place ID |
| `distance_miles` | DECIMAL | Distance from driver |
| `drive_time_min` | INTEGER | Drive time in minutes |
| `is_open` | BOOLEAN | Currently open |
| `business_hours` | TEXT | Business hours string |

---

### `feedback` - User Feedback

**Purpose:** Thumbs up/down feedback for ML training

**Files:**
- Schema: `shared/schema.js`
- Insert: `server/api/feedback/feedback.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `feedback_id` | UUID (PK) | Primary identifier |
| `snapshot_id` | UUID (FK) | Reference to snapshots |
| `ranking_id` | UUID (FK) | Reference to rankings |
| `sentiment` | VARCHAR | up/down |
| `feedback_type` | VARCHAR | venue/strategy/app |
| `place_id` | VARCHAR | Google Place ID (for venue) |
| `comment` | TEXT | Optional user comment |

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

**Purpose:** Cache geocode lookups (~11m precision)

**Files:**
- Schema: `shared/schema.js`
- Insert/Query: `server/lib/location/geo.js`

**Key Columns:**
| Column | Type | Description |
|--------|------|-------------|
| `key` | VARCHAR (PK) | `lat_lng` with 4 decimals |
| `city`, `state`, `country` | VARCHAR | Resolved location |
| `formatted_address` | TEXT | Full address |
| `created_at` | TIMESTAMP | Cache time |

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
