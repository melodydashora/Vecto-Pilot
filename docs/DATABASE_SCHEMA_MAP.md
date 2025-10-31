
# Vecto Pilot - Complete Database Schema Map

**Generated:** 2025-01-30  
**Database:** PostgreSQL 16.9 (Neon)  
**ORM:** Drizzle ORM  
**Schema Source:** `shared/schema.js`

---

## Table of Contents

1. [Core Tables](#core-tables)
2. [ML Pipeline Tables](#ml-pipeline-tables)
3. [Feedback Tables](#feedback-tables)
4. [Memory Tables](#memory-tables)
5. [Utility Tables](#utility-tables)
6. [Relationships Diagram](#relationships-diagram)
7. [Indexes](#indexes)

---

## Core Tables

### 1. `snapshots` - Context Snapshots

**Purpose:** Captures user location context at a specific moment in time for AI processing.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `snapshot_id` | UUID | ❌ | Primary key |
| `created_at` | TIMESTAMPTZ | ❌ | Snapshot creation time |
| `user_id` | UUID | ✅ | User identifier |
| `device_id` | UUID | ❌ | Device identifier |
| `session_id` | UUID | ❌ | Session identifier |
| `lat` | DOUBLE PRECISION | ❌ | Latitude |
| `lng` | DOUBLE PRECISION | ❌ | Longitude |
| `accuracy_m` | DOUBLE PRECISION | ✅ | GPS accuracy in meters |
| `coord_source` | TEXT | ❌ | GPS source (browser/google) |
| `city` | TEXT | ✅ | Geocoded city name |
| `state` | TEXT | ✅ | Geocoded state |
| `country` | TEXT | ✅ | Geocoded country |
| `formatted_address` | TEXT | ✅ | Full address string |
| `timezone` | TEXT | ✅ | IANA timezone (e.g., America/Chicago) |
| `local_iso` | TIMESTAMP | ✅ | Local time without timezone |
| `dow` | INTEGER | ✅ | Day of week (0=Sunday, 6=Saturday) |
| `hour` | INTEGER | ✅ | Hour of day (0-23) |
| `day_part_key` | TEXT | ✅ | Time period (morning/afternoon/evening/night) |
| `h3_r8` | TEXT | ✅ | H3 geohash resolution 8 |
| `weather` | JSONB | ✅ | Weather data from API |
| `air` | JSONB | ✅ | Air quality data |
| `airport_context` | JSONB | ✅ | Nearby airport info |
| `local_news` | JSONB | ✅ | Perplexity local news |
| `news_briefing` | JSONB | ✅ | Gemini 60-min briefing |
| `device` | JSONB | ✅ | Device metadata |
| `permissions` | JSONB | ✅ | App permissions state |
| `extras` | JSONB | ✅ | Additional context |
| `last_strategy_day_part` | TEXT | ✅ | Last strategy's day part |
| `trigger_reason` | TEXT | ✅ | Why snapshot was triggered |

**Indexes:**
- Primary key on `snapshot_id`
- Foreign key references from `strategies`, `rankings`, `actions`, `venue_feedback`, `strategy_feedback`, `app_feedback`

---

### 2. `strategies` - AI-Generated Strategies

**Purpose:** Stores AI-generated driving strategies tied to snapshots.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `strategy_id` | UUID | ✅ | External strategy identifier |
| `snapshot_id` | UUID | ❌ | FK to snapshots (UNIQUE, CASCADE DELETE) |
| `correlation_id` | UUID | ✅ | Request correlation ID |
| `strategy` | TEXT | ✅ | Generated strategy text |
| `status` | TEXT | ❌ | pending/ok/failed (default: pending) |
| `error_code` | INTEGER | ✅ | Error code if failed |
| `error_message` | TEXT | ✅ | Error description |
| `attempt` | INTEGER | ❌ | Retry attempt number (default: 1) |
| `latency_ms` | INTEGER | ✅ | Generation time in ms |
| `tokens` | INTEGER | ✅ | LLM tokens used |
| `next_retry_at` | TIMESTAMPTZ | ✅ | Next retry timestamp |
| `created_at` | TIMESTAMPTZ | ❌ | Creation time (default: NOW) |
| `updated_at` | TIMESTAMPTZ | ❌ | Last update time (default: NOW) |
| `model_name` | TEXT | ✅ | LLM model used (e.g., claude-sonnet-4-5) |
| `model_params` | JSONB | ✅ | Model parameters (temperature, max_tokens) |
| `prompt_version` | TEXT | ✅ | Prompt template version |
| `strategy_for_now` | TEXT | ✅ | **Unlimited** strategy text field |
| `lat` | DOUBLE PRECISION | ✅ | Location latitude (copied from snapshot) |
| `lng` | DOUBLE PRECISION | ✅ | Location longitude |
| `city` | TEXT | ✅ | City (copied from snapshot) |
| `state` | TEXT | ✅ | State (copied from snapshot) |
| `user_address` | TEXT | ✅ | User address |
| `user_id` | UUID | ✅ | User identifier |
| `events` | JSONB | ✅ | Gemini events feed (default: []) |
| `news` | JSONB | ✅ | Gemini news feed (default: []) |
| `traffic` | JSONB | ✅ | Gemini traffic feed (default: []) |
| `valid_window_start` | TIMESTAMPTZ | ✅ | Strategy validity start time |
| `valid_window_end` | TIMESTAMPTZ | ✅ | Strategy validity end time (≤60 min) |
| `strategy_timestamp` | TIMESTAMPTZ | ✅ | Generation timestamp |
| `user_resolved_address` | TEXT | ✅ | User-resolved full address |
| `user_resolved_city` | TEXT | ✅ | User-resolved city |
| `user_resolved_state` | TEXT | ✅ | User-resolved state |
| `minstrategy` | TEXT | ✅ | Short strategy from first provider (Claude) |
| `briefing_news` | JSONB | ✅ | News from second provider (Gemini) |
| `briefing_events` | JSONB | ✅ | Events from second provider (Gemini) |
| `briefing_traffic` | JSONB | ✅ | Traffic from second provider (Gemini) |
| `consolidated_strategy` | TEXT | ✅ | Final strategy from third provider (GPT-5) |

**Indexes:**
- Primary key on `id`
- Unique constraint on `snapshot_id`
- Foreign key to `snapshots.snapshot_id` with CASCADE DELETE

---

### 3. `rankings` - Recommendation Sets

**Purpose:** Stores a set of venue recommendations generated for a snapshot.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `ranking_id` | UUID | ❌ | Primary key |
| `created_at` | TIMESTAMPTZ | ❌ | Ranking creation time |
| `snapshot_id` | UUID | ✅ | FK to snapshots |
| `correlation_id` | UUID | ✅ | Request correlation ID |
| `user_id` | UUID | ✅ | User identifier |
| `city` | TEXT | ✅ | City context |
| `ui` | JSONB | ✅ | UI metadata |
| `model_name` | TEXT | ❌ | LLM model used for ranking |
| `scoring_ms` | INTEGER | ✅ | Scoring latency |
| `planner_ms` | INTEGER | ✅ | Planner latency |
| `total_ms` | INTEGER | ✅ | Total latency |
| `timed_out` | BOOLEAN | ✅ | Did request timeout? (default: false) |
| `path_taken` | TEXT | ✅ | Which processing path (tactical/strategic) |

**Indexes:**
- Primary key on `ranking_id`
- Foreign key to `snapshots.snapshot_id`

---

### 4. `ranking_candidates` - Individual Venue Recommendations

**Purpose:** Individual venues within a ranking, with ML features and tactical tips.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key |
| `ranking_id` | UUID | ❌ | FK to rankings (CASCADE DELETE) |
| `block_id` | TEXT | ❌ | Unique venue block identifier |
| `name` | TEXT | ❌ | Venue name |
| `lat` | DOUBLE PRECISION | ❌ | Latitude |
| `lng` | DOUBLE PRECISION | ❌ | Longitude |
| `drive_time_min` | INTEGER | ✅ | Drive time in minutes |
| `straight_line_km` | DOUBLE PRECISION | ✅ | Straight-line distance |
| `est_earnings_per_ride` | DOUBLE PRECISION | ✅ | Estimated earnings |
| `model_score` | DOUBLE PRECISION | ✅ | ML model score |
| `rank` | INTEGER | ❌ | Display rank (1-N) |
| `exploration_policy` | TEXT | ❌ | Epsilon-greedy policy |
| `epsilon` | DOUBLE PRECISION | ✅ | Exploration rate |
| `was_forced` | BOOLEAN | ✅ | Was this a forced exploration? |
| `propensity` | DOUBLE PRECISION | ✅ | Click propensity score |
| `features` | JSONB | ✅ | ML feature vector |
| `h3_r8` | TEXT | ✅ | H3 geohash |
| `distance_miles` | DOUBLE PRECISION | ✅ | Distance in miles |
| `drive_minutes` | INTEGER | ✅ | Drive time |
| `value_per_min` | DOUBLE PRECISION | ✅ | Value per minute metric |
| `value_grade` | TEXT | ✅ | Grade (A/B/C/D/F) |
| `not_worth` | BOOLEAN | ✅ | Below value threshold? |
| `rate_per_min_used` | DOUBLE PRECISION | ✅ | Rate used in calculation |
| `trip_minutes_used` | INTEGER | ✅ | Trip duration assumption |
| `wait_minutes_used` | INTEGER | ✅ | Wait time assumption |
| `snapshot_id` | UUID | ✅ | FK to snapshots |
| `place_id` | TEXT | ✅ | Google Place ID |
| `estimated_distance_miles` | DOUBLE PRECISION | ✅ | Estimated distance |
| `drive_time_minutes` | INTEGER | ✅ | Drive time estimate |
| `distance_source` | TEXT | ✅ | Distance data source |
| `pro_tips` | TEXT[] | ✅ | **Array** of tactical tips from GPT-5 |
| `closed_reasoning` | TEXT | ✅ | Why recommend if closed |
| `staging_tips` | TEXT | ✅ | Parking/staging advice |
| `staging_name` | TEXT | ✅ | Staging location name |
| `staging_lat` | DOUBLE PRECISION | ✅ | Staging latitude |
| `staging_lng` | DOUBLE PRECISION | ✅ | Staging longitude |
| `business_hours` | JSONB | ✅ | Google Places business hours |
| `venue_events` | JSONB | ✅ | Today's events at venue |

**Indexes:**
- Primary key on `id`
- Foreign key to `rankings.ranking_id` with CASCADE DELETE
- Index on `ranking_id` (performance)
- Index on `snapshot_id` (performance)

---

## ML Pipeline Tables

### 5. `actions` - User Interaction Events

**Purpose:** Captures all user interactions for ML training.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `action_id` | UUID | ❌ | Primary key |
| `created_at` | TIMESTAMPTZ | ❌ | Action timestamp |
| `ranking_id` | UUID | ✅ | FK to rankings (CASCADE DELETE) |
| `snapshot_id` | UUID | ❌ | FK to snapshots (CASCADE DELETE) |
| `user_id` | UUID | ✅ | User identifier |
| `action` | TEXT | ❌ | Action type (view/dwell/click/dismiss) |
| `block_id` | TEXT | ✅ | Which venue was acted upon |
| `dwell_ms` | INTEGER | ✅ | Dwell time in milliseconds |
| `from_rank` | INTEGER | ✅ | Venue's rank when clicked |
| `raw` | JSONB | ✅ | Raw event payload |

**Indexes:**
- Primary key on `action_id`
- Foreign key to `rankings.ranking_id` with CASCADE DELETE
- Foreign key to `snapshots.snapshot_id` with CASCADE DELETE
- Index on `snapshot_id` (performance)

---

### 6. `venue_catalog` - Master Venue Database

**Purpose:** Canonical venue database with discovery metadata.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `venue_id` | UUID | ❌ | Primary key (auto-generated) |
| `place_id` | TEXT | ✅ | Google Place ID (UNIQUE) |
| `venue_name` | VARCHAR(500) | ❌ | Venue name (max 500 chars) |
| `address` | VARCHAR(500) | ❌ | Full address (max 500 chars) |
| `lat` | DOUBLE PRECISION | ✅ | Latitude |
| `lng` | DOUBLE PRECISION | ✅ | Longitude |
| `category` | TEXT | ❌ | Venue category |
| `dayparts` | TEXT[] | ✅ | **Array** of active day parts |
| `staging_notes` | JSONB | ✅ | Staging instructions |
| `city` | TEXT | ✅ | City |
| `metro` | TEXT | ✅ | Metro area |
| `ai_estimated_hours` | TEXT | ✅ | AI-estimated hours |
| `business_hours` | JSONB | ✅ | Google Places hours |
| `discovery_source` | TEXT | ❌ | How discovered (default: seed) |
| `validated_at` | TIMESTAMPTZ | ✅ | Last validation timestamp |
| `suggestion_metadata` | JSONB | ✅ | LLM suggestion details |
| `created_at` | TIMESTAMPTZ | ❌ | Creation time (default: NOW) |
| `last_known_status` | TEXT | ✅ | Business status (default: unknown) |
| `status_checked_at` | TIMESTAMPTZ | ✅ | Status check timestamp |
| `consecutive_closed_checks` | INTEGER | ✅ | Closed check counter (default: 0) |
| `auto_suppressed` | BOOLEAN | ✅ | Auto-suppressed flag (default: false) |
| `suppression_reason` | TEXT | ✅ | Why suppressed |

**Indexes:**
- Primary key on `venue_id`
- Unique constraint on `place_id`

---

### 7. `venue_metrics` - Aggregated Venue Stats

**Purpose:** Real-time venue performance metrics for ranking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `venue_id` | UUID | ❌ | Primary key, FK to venue_catalog |
| `times_recommended` | INTEGER | ❌ | Recommendation count (default: 0) |
| `times_chosen` | INTEGER | ❌ | Click count (default: 0) |
| `positive_feedback` | INTEGER | ❌ | Thumbs up count (default: 0) |
| `negative_feedback` | INTEGER | ❌ | Thumbs down count (default: 0) |
| `reliability_score` | DOUBLE PRECISION | ❌ | Score 0-1 (default: 0.5) |
| `last_verified_by_driver` | TIMESTAMPTZ | ✅ | Last feedback timestamp |

**Indexes:**
- Primary key on `venue_id`
- Foreign key to `venue_catalog.venue_id`

---

## Feedback Tables

### 8. `venue_feedback` - Per-Venue Feedback

**Purpose:** User thumbs up/down feedback on individual venues.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `user_id` | UUID | ✅ | User identifier |
| `snapshot_id` | UUID | ❌ | FK to snapshots (CASCADE DELETE) |
| `ranking_id` | UUID | ❌ | FK to rankings (CASCADE DELETE) |
| `place_id` | TEXT | ✅ | Google Place ID |
| `venue_name` | TEXT | ❌ | Venue name |
| `sentiment` | TEXT | ❌ | 'up' or 'down' |
| `comment` | TEXT | ✅ | Optional comment |
| `created_at` | TIMESTAMPTZ | ❌ | Feedback timestamp (default: NOW) |

**Indexes:**
- Primary key on `id`
- Unique constraint on `(user_id, ranking_id, place_id)`
- Index on `ranking_id`
- Index on `place_id`
- Index on `snapshot_id`

---

### 9. `strategy_feedback` - Strategy-Level Feedback

**Purpose:** User feedback on AI-generated strategies.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `user_id` | UUID | ✅ | User identifier |
| `snapshot_id` | UUID | ❌ | FK to snapshots (CASCADE DELETE) |
| `ranking_id` | UUID | ❌ | FK to rankings (CASCADE DELETE) |
| `sentiment` | TEXT | ❌ | 'up' or 'down' |
| `comment` | TEXT | ✅ | Optional comment |
| `created_at` | TIMESTAMPTZ | ❌ | Feedback timestamp (default: NOW) |

**Indexes:**
- Primary key on `id`
- Unique constraint on `(user_id, ranking_id)`

---

### 10. `app_feedback` - General App Feedback

**Purpose:** General app feedback not tied to specific venues or strategies.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `snapshot_id` | UUID | ✅ | FK to snapshots (CASCADE DELETE) |
| `sentiment` | TEXT | ❌ | 'up' or 'down' |
| `comment` | TEXT | ✅ | Optional comment |
| `created_at` | TIMESTAMPTZ | ❌ | Feedback timestamp (default: NOW) |

**Indexes:**
- Primary key on `id`
- Foreign key to `snapshots.snapshot_id` with CASCADE DELETE

---

## Memory Tables

### 11. `agent_memory` - Agent Session Memory

**Purpose:** Agent conversation history and memory.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `session_id` | TEXT | ❌ | Session identifier |
| `entry_type` | TEXT | ❌ | Memory type |
| `title` | TEXT | ❌ | Memory title |
| `content` | TEXT | ❌ | Memory content |
| `status` | TEXT | ✅ | Status (default: active) |
| `metadata` | JSONB | ✅ | Additional metadata |
| `created_at` | TIMESTAMPTZ | ❌ | Creation time (default: NOW) |
| `expires_at` | TIMESTAMPTZ | ✅ | Expiration time |

**Indexes:**
- Primary key on `id`
- Index on `session_id`
- Index on `entry_type`

---

### 12. `assistant_memory` - Assistant Context Memory

**Purpose:** Thread-aware context tracking for assistant.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `scope` | TEXT | ❌ | Memory scope |
| `key` | TEXT | ❌ | Memory key |
| `user_id` | UUID | ✅ | User identifier |
| `content` | TEXT | ❌ | Memory content |
| `created_at` | TIMESTAMPTZ | ❌ | Creation time (default: NOW) |
| `updated_at` | TIMESTAMPTZ | ❌ | Last update (default: NOW) |
| `expires_at` | TIMESTAMPTZ | ✅ | Expiration time |

**Indexes:**
- Primary key on `id`
- Unique constraint on `(scope, key, user_id)`
- Index on `scope`
- Index on `user_id`
- Index on `expires_at`

---

### 13. `eidolon_memory` - Eidolon SDK Memory

**Purpose:** Enhanced memory for Eidolon SDK operations.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `scope` | TEXT | ❌ | Memory scope |
| `key` | TEXT | ❌ | Memory key |
| `user_id` | UUID | ✅ | User identifier |
| `content` | TEXT | ❌ | Memory content |
| `created_at` | TIMESTAMPTZ | ❌ | Creation time (default: NOW) |
| `updated_at` | TIMESTAMPTZ | ❌ | Last update (default: NOW) |
| `expires_at` | TIMESTAMPTZ | ✅ | Expiration time |

**Indexes:**
- Primary key on `id`
- Unique constraint on `(scope, key, user_id)`
- Index on `scope`
- Index on `user_id`
- Index on `expires_at`

---

### 14. `cross_thread_memory` - Cross-Thread Shared Memory

**Purpose:** Shared memory across conversation threads.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `scope` | TEXT | ❌ | Memory scope |
| `key` | TEXT | ❌ | Memory key |
| `user_id` | UUID | ✅ | User identifier |
| `content` | TEXT | ❌ | Memory content |
| `created_at` | TIMESTAMPTZ | ❌ | Creation time (default: NOW) |
| `updated_at` | TIMESTAMPTZ | ❌ | Last update (default: NOW) |
| `expires_at` | TIMESTAMPTZ | ✅ | Expiration time |

**Indexes:**
- Primary key on `id`
- Unique constraint on `(scope, key, user_id)`
- Index on `scope`
- Index on `user_id`
- Index on `expires_at`

---

## Utility Tables

### 15. `block_jobs` - Async Job Queue (Legacy)

**Purpose:** Asynchronous job processing queue.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key |
| `status` | TEXT | ❌ | pending/running/succeeded/failed |
| `request_body` | JSONB | ❌ | Job payload |
| `result` | JSONB | ✅ | Job result |
| `error` | TEXT | ✅ | Error message if failed |
| `created_at` | TIMESTAMPTZ | ❌ | Job creation (default: NOW) |
| `updated_at` | TIMESTAMPTZ | ❌ | Last update (default: NOW) |

**Indexes:**
- Primary key on `id`

---

### 16. `triad_jobs` - Triad Pipeline Jobs

**Purpose:** Tracks triad strategy generation jobs.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `snapshot_id` | UUID | ❌ | FK to snapshots (CASCADE DELETE) |
| `kind` | TEXT | ❌ | Job type (default: triad) |
| `status` | TEXT | ❌ | queued/running/ok/error (default: queued) |
| `created_at` | TIMESTAMPTZ | ❌ | Job creation (default: NOW) |

**Indexes:**
- Primary key on `id`
- Unique constraint on `(snapshot_id, kind)`
- Foreign key to `snapshots.snapshot_id` with CASCADE DELETE

---

### 17. `http_idem` - HTTP Idempotency Cache

**Purpose:** Prevents duplicate HTTP requests.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `key` | TEXT | ❌ | Primary key (idempotency key) |
| `status` | INTEGER | ❌ | HTTP status code |
| `body` | JSONB | ❌ | Response body |
| `created_at` | TIMESTAMPTZ | ❌ | Cache time (default: NOW) |

**Indexes:**
- Primary key on `key`

---

### 18. `places_cache` - Google Places Cache

**Purpose:** Caches Google Places API responses.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `place_id` | TEXT | ❌ | Primary key (Google Place ID) |
| `formatted_hours` | JSONB | ✅ | Formatted business hours |
| `cached_at` | TIMESTAMPTZ | ❌ | Cache timestamp |
| `access_count` | INTEGER | ❌ | Access counter (default: 0) |

**Indexes:**
- Primary key on `place_id`

---

### 19. `travel_disruptions` - Airport Delay Data

**Purpose:** FAA/airport disruption tracking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `country_code` | TEXT | ❌ | Country (default: US) |
| `airport_code` | TEXT | ❌ | IATA airport code |
| `airport_name` | TEXT | ✅ | Airport full name |
| `delay_minutes` | INTEGER | ✅ | Delay duration (default: 0) |
| `ground_stops` | JSONB | ✅ | Ground stop data (default: []) |
| `ground_delay_programs` | JSONB | ✅ | GDP data (default: []) |
| `closure_status` | TEXT | ✅ | Airport status (default: open) |
| `delay_reason` | TEXT | ✅ | Delay explanation |
| `ai_summary` | TEXT | ✅ | AI-generated summary |
| `impact_level` | TEXT | ✅ | Impact level (default: none) |
| `data_source` | TEXT | ❌ | Data source (default: FAA) |
| `last_updated` | TIMESTAMPTZ | ❌ | Last update (default: NOW) |
| `next_update_at` | TIMESTAMPTZ | ✅ | Next scheduled update |

**Indexes:**
- Primary key on `id`

---

### 20. `llm_venue_suggestions` - AI Venue Discovery

**Purpose:** LLM-suggested venues pending validation.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `suggestion_id` | UUID | ❌ | Primary key (auto-generated) |
| `suggested_at` | TIMESTAMPTZ | ❌ | Suggestion time (default: NOW) |
| `model_name` | TEXT | ❌ | Which LLM suggested it |
| `ranking_id` | UUID | ✅ | FK to rankings |
| `venue_name` | TEXT | ❌ | Suggested venue name |
| `suggested_category` | TEXT | ✅ | Suggested category |
| `llm_reasoning` | TEXT | ✅ | Why LLM suggested it |
| `validation_status` | TEXT | ❌ | pending/approved/rejected (default: pending) |
| `place_id_found` | TEXT | ✅ | Google Place ID if validated |
| `venue_id_created` | UUID | ✅ | FK to venue_catalog if created |
| `validated_at` | TIMESTAMPTZ | ✅ | Validation timestamp |
| `rejection_reason` | TEXT | ✅ | Why rejected |
| `llm_analysis` | JSONB | ✅ | **Unlimited** LLM analysis payload |

**Indexes:**
- Primary key on `suggestion_id`
- Foreign key to `rankings.ranking_id`
- Foreign key to `venue_catalog.venue_id`

---

### 21. `venue_events` - Venue Event Calendar

**Purpose:** Event tracking for venues (concerts, games, festivals).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | ❌ | Primary key (auto-generated) |
| `venue_id` | UUID | ✅ | FK to venue_catalog |
| `place_id` | TEXT | ✅ | Google Place ID |
| `title` | TEXT | ❌ | Event name |
| `starts_at` | TIMESTAMPTZ | ✅ | Event start time |
| `ends_at` | TIMESTAMPTZ | ✅ | Event end time |
| `lat` | DOUBLE PRECISION | ✅ | Event latitude |
| `lng` | DOUBLE PRECISION | ✅ | Event longitude |
| `source` | TEXT | ❌ | Event data source |
| `radius_m` | INTEGER | ✅ | Event radius in meters |
| `created_at` | TIMESTAMPTZ | ❌ | Record creation (default: NOW) |
| `updated_at` | TIMESTAMPTZ | ❌ | Last update (default: NOW) |

**Indexes:**
- Primary key on `id`
- Index on `venue_id`
- Index on `(lat, lng)` (geospatial)
- Index on `starts_at` (temporal)

---

## Relationships Diagram

```
┌─────────────────────┐
│     snapshots       │ ← Core context capture
└─────────────────────┘
         │ 1
         │
         ├─────────────┐
         │ 1:1         │ 1:N
         ▼             ▼
┌─────────────┐  ┌──────────────┐
│ strategies  │  │  rankings    │
└─────────────┘  └──────────────┘
                        │ 1
                        │ 1:N
                        ▼
                ┌────────────────────────┐
                │ ranking_candidates     │
                └────────────────────────┘
                        │
                        │ N:1
                        ▼
                ┌────────────────┐
                │ venue_catalog  │ ← Master venue DB
                └────────────────┘
                        │ 1
                        │ 1:1
                        ▼
                ┌────────────────┐
                │ venue_metrics  │
                └────────────────┘

┌─────────────────────┐
│     snapshots       │
└─────────────────────┘
         │ 1
         ├──────────┬──────────┬─────────────┐
         │ 1:N      │ 1:N      │ 1:N         │ 1:N
         ▼          ▼          ▼             ▼
    ┌─────────┐ ┌──────────────┐ ┌─────────────────┐ ┌────────────┐
    │ actions │ │venue_feedback│ │strategy_feedback│ │app_feedback│
    └─────────┘ └──────────────┘ └─────────────────┘ └────────────┘
```

---

## Indexes Summary

### Performance Indexes (Issue #28 fixes)

**Foreign Key Indexes (automatically improve JOIN performance):**
- `idx_ranking_candidates_ranking_id` on `ranking_candidates(ranking_id)`
- `idx_ranking_candidates_snapshot_id` on `ranking_candidates(snapshot_id)`
- `idx_actions_snapshot_id` on `actions(snapshot_id)`
- `idx_venue_feedback_snapshot_id` on `venue_feedback(snapshot_id)`

**Search Indexes:**
- `idx_agent_memory_session` on `agent_memory(session_id)`
- `idx_agent_memory_type` on `agent_memory(entry_type)`
- `idx_assistant_memory_scope` on `assistant_memory(scope)`
- `idx_assistant_memory_user` on `assistant_memory(user_id)`
- `idx_assistant_memory_expires` on `assistant_memory(expires_at)`
- `idx_eidolon_memory_scope` on `eidolon_memory(scope)`
- `idx_eidolon_memory_user` on `eidolon_memory(user_id)`
- `idx_eidolon_memory_expires` on `eidolon_memory(expires_at)`
- `idx_cross_thread_memory_scope` on `cross_thread_memory(scope)`
- `idx_cross_thread_memory_user` on `cross_thread_memory(user_id)`
- `idx_cross_thread_memory_expires` on `cross_thread_memory(expires_at)`
- `ix_feedback_ranking` on `venue_feedback(ranking_id)`
- `ix_feedback_place` on `venue_feedback(place_id)`
- `idx_venue_events_venue_id` on `venue_events(venue_id)`
- `idx_venue_events_coords` on `venue_events(lat, lng)`
- `idx_venue_events_starts_at` on `venue_events(starts_at)`

---

## Data Types Reference

| Drizzle Type | PostgreSQL Type | Description |
|--------------|----------------|-------------|
| `uuid()` | UUID | Universally unique identifier |
| `text()` | TEXT | Unlimited text |
| `varchar(length)` | VARCHAR(N) | Limited text (e.g., VARCHAR(500)) |
| `timestamp(withTimezone: true)` | TIMESTAMPTZ | Timezone-aware timestamp |
| `timestamp(withTimezone: false)` | TIMESTAMP | Timezone-naive timestamp |
| `integer()` | INTEGER | 32-bit integer |
| `doublePrecision()` | DOUBLE PRECISION | 64-bit float |
| `boolean()` | BOOLEAN | True/false |
| `jsonb()` | JSONB | Binary JSON (indexed) |
| `text().array()` | TEXT[] | Array of text values |

---

## Schema Management

**Source of Truth:** `shared/schema.js` (Drizzle ORM)  
**Migration Tool:** Drizzle Kit  
**Database:** PostgreSQL 16.9 on Neon (serverless)

**Key Files:**
- `shared/schema.js` - Schema definition
- `drizzle.config.js` - Drizzle configuration
- `server/db/drizzle.js` - Database connection
- `migrations/` - SQL migrations (deprecated - use Drizzle)

**Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `PG_USE_SHARED_POOL` - Enable shared connection pool
- `PG_MAX` - Max pool size (default: 10)
- `PG_IDLE_TIMEOUT_MS` - Idle timeout (default: 120000)

---

## Notes

1. **CASCADE DELETE:** Most foreign keys use `onDelete: 'cascade'` to automatically clean up related records when parent is deleted.

2. **Default Values:** Many columns have sensible defaults (e.g., `status: 'pending'`, `created_at: NOW()`).

3. **JSONB Columns:** Used extensively for flexible schema evolution without migrations.

4. **Text Arrays:** `TEXT[]` used for variable-length lists (e.g., `pro_tips`, `dayparts`).

5. **Unlimited Text:** `TEXT` columns have no length limit (unlike `VARCHAR(N)`).

6. **Indexes:** All foreign keys are indexed for performance. Additional indexes on frequently queried fields.

7. **Unique Constraints:** Used to prevent duplicate entries (e.g., one feedback per user per venue per ranking).

---

**Generated:** 2025-01-30  
**Schema Version:** Current (matches `shared/schema.js`)  
**Total Tables:** 21  
**Total Columns:** 300+  
**Database Size:** ~50MB (production)
