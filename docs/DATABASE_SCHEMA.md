# Database Schema Reference

> Auto-generated database schema documentation for Vecto Pilot.
> **Includes data flow traceability: which files PUSH (write) and FETCH (read) each table.**

| Metric | Value |
|--------|-------|
| **Generated** | 2026-01-05 04:18:10 |
| **Tables** | 47 |
| **Total Columns** | 735 |
| **Database** | PostgreSQL |

---

## Quick Navigation

### Core User Data
- [users](#users) *(19 cols, ↑2 push, ↓3 fetch)*
- [driver_profiles](#driver_profiles) *(48 cols, ↑1 push, ↓1 fetch)*
- [driver_vehicles](#driver_vehicles) *(12 cols, ↑1 push, ↓1 fetch)*
- [auth_credentials](#auth_credentials) *(12 cols, ↑1 push, ↓0 fetch)*
- [verification_codes](#verification_codes) *(10 cols, ↑1 push, ↓0 fetch)*

### Location & Snapshots
- [snapshots](#snapshots) *(25 cols, ↑15 push, ↓30 fetch)*
- [coords_cache](#coords_cache) *(13 cols, ↑2 push, ↓2 fetch)*

### AI Strategy Pipeline
- [strategies](#strategies) *(43 cols, ↑12 push, ↓21 fetch)*
- [rankings](#rankings) *(15 cols, ↑3 push, ↓8 fetch)*
- [ranking_candidates](#ranking_candidates) *(43 cols, ↑4 push, ↓7 fetch)*
- [briefings](#briefings) *(15 cols, ↑6 push, ↓14 fetch)*
- [triad_jobs](#triad_jobs) *(8 cols, ↑2 push, ↓2 fetch)*
- [block_jobs](#block_jobs) *(7 cols, ↑0 push, ↓0 fetch)*

### Venues
- [venue_cache](#venue_cache) *(23 cols, ↑1 push, ↓1 fetch)*
- [venue_catalog](#venue_catalog) *(26 cols, ↑4 push, ↓4 fetch)*
- [venue_events](#venue_events) *(12 cols, ↑0 push, ↓0 fetch)*
- [venue_metrics](#venue_metrics) *(7 cols, ↑2 push, ↓2 fetch)*
- [nearby_venues](#nearby_venues) *(30 cols, ↑1 push, ↓1 fetch)*
- [llm_venue_suggestions](#llm_venue_suggestions) *(13 cols, ↑0 push, ↓0 fetch)*
- [places_cache](#places_cache) *(4 cols, ↑1 push, ↓1 fetch)*

### Events
- [discovered_events](#discovered_events) *(27 cols, ↑5 push, ↓6 fetch)*
- [events_facts](#events_facts) *(20 cols, ↑0 push, ↓0 fetch)*

### AI Coach
- [coach_conversations](#coach_conversations) *(22 cols, ↑1 push, ↓1 fetch)*
- [coach_system_notes](#coach_system_notes) *(20 cols, ↑1 push, ↓1 fetch)*
- [user_intel_notes](#user_intel_notes) *(21 cols, ↑2 push, ↓1 fetch)*

### Intelligence
- [market_intelligence](#market_intelligence) *(29 cols, ↑3 push, ↓3 fetch)*
- [zone_intelligence](#zone_intelligence) *(22 cols, ↑1 push, ↓1 fetch)*
- [traffic_zones](#traffic_zones) *(13 cols, ↑0 push, ↓0 fetch)*
- [travel_disruptions](#travel_disruptions) *(14 cols, ↑1 push, ↓0 fetch)*

### Reference Data
- [markets](#markets) *(14 cols, ↑1 push, ↓1 fetch)*
- [countries](#countries) *(8 cols, ↑0 push, ↓0 fetch)*
- [platform_data](#platform_data) *(16 cols, ↑1 push, ↓4 fetch)*
- [vehicle_makes_cache](#vehicle_makes_cache) *(5 cols, ↑1 push, ↓1 fetch)*
- [vehicle_models_cache](#vehicle_models_cache) *(7 cols, ↑1 push, ↓1 fetch)*

### Feedback & Actions
- [actions](#actions) *(13 cols, ↑5 push, ↓7 fetch)*
- [app_feedback](#app_feedback) *(8 cols, ↑1 push, ↓1 fetch)*
- [venue_feedback](#venue_feedback) *(12 cols, ↑1 push, ↓3 fetch)*
- [strategy_feedback](#strategy_feedback) *(10 cols, ↑1 push, ↓2 fetch)*
- [news_deactivations](#news_deactivations) *(9 cols, ↑3 push, ↓3 fetch)*

### System & Memory
- [agent_memory](#agent_memory) *(8 cols, ↑0 push, ↓0 fetch)*
- [assistant_memory](#assistant_memory) *(8 cols, ↑0 push, ↓0 fetch)*
- [eidolon_memory](#eidolon_memory) *(8 cols, ↑0 push, ↓0 fetch)*
- [eidolon_snapshots](#eidolon_snapshots) *(10 cols, ↑0 push, ↓0 fetch)*
- [cross_thread_memory](#cross_thread_memory) *(8 cols, ↑0 push, ↓0 fetch)*
- [agent_changes](#agent_changes) *(6 cols, ↑0 push, ↓0 fetch)*
- [connection_audit](#connection_audit) *(8 cols, ↑0 push, ↓0 fetch)*
- [http_idem](#http_idem) *(4 cols, ↑1 push, ↓1 fetch)*

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔑 PK | Primary Key |
| → table(col) | Foreign Key reference |
| 🔒 UNIQUE | Unique constraint |
| ✓ | Nullable (YES) |
| ✗ | Not Nullable (NO) |
| ↑ Push | Files that INSERT/UPDATE this table |
| ↓ Fetch | Files that SELECT from this table |

---

## actions

### Data Flow

**↑ Push (INSERT/UPDATE):** 5 file(s)
- `agent/enhanced-context.js`
- `api/feedback/actions.js`
- `api/feedback/feedback.js`
- `assistant/enhanced-context.js`
- `eidolon/enhanced-context.js`

**↓ Fetch (SELECT):** 7 file(s)
- `agent/context-awareness.js`
- `agent/enhanced-context.js`
- `api/feedback/actions.js`
- `api/feedback/feedback.js`
- `assistant/enhanced-context.js`
- `eidolon/enhanced-context.js`
- `lib/ai/coach-dal.js`

### Columns (13)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `action_id` | uuid | ✗ | `` | 🔑 PK |
| 2 | `created_at` | timestamp with time zone | ✗ | `` |  |
| 3 | `ranking_id` | uuid | ✓ | `` | → rankings(ranking_id) |
| 4 | `snapshot_id` | uuid | ✗ | `` | → snapshots(snapshot_id) |
| 5 | `user_id` | uuid | ✓ | `` |  |
| 6 | `action` | text | ✗ | `` |  |
| 7 | `block_id` | text | ✓ | `` |  |
| 8 | `dwell_ms` | integer | ✓ | `` |  |
| 9 | `from_rank` | integer | ✓ | `` |  |
| 10 | `raw` | jsonb | ✓ | `` |  |
| 11 | `formatted_address` | text | ✓ | `` |  |
| 12 | `city` | text | ✓ | `` |  |
| 13 | `state` | text | ✓ | `` |  |

## agent_changes

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (6)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `change_type` | text | ✗ | `` |  |
| 3 | `description` | text | ✗ | `` |  |
| 4 | `file_path` | text | ✓ | `` |  |
| 5 | `details` | jsonb | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone | ✗ | `now()` |  |

## agent_memory

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `scope` | text | ✗ | `` |  |
| 3 | `key` | text | ✗ | `` |  |
| 4 | `user_id` | uuid | ✓ | `` |  |
| 5 | `content` | text | ✗ | `` |  |
| 6 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 7 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 8 | `expires_at` | timestamp with time zone | ✓ | `` |  |

## app_feedback

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/feedback/feedback.js`

**↓ Fetch (SELECT):** 1 file(s)
- `api/feedback/feedback.js`

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `snapshot_id` | uuid | ✓ | `` | → snapshots(snapshot_id) |
| 3 | `sentiment` | text | ✗ | `` |  |
| 4 | `comment` | text | ✓ | `` |  |
| 5 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 6 | `formatted_address` | text | ✓ | `` |  |
| 7 | `city` | text | ✓ | `` |  |
| 8 | `state` | text | ✓ | `` |  |

## assistant_memory

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `scope` | text | ✗ | `` |  |
| 3 | `key` | text | ✗ | `` |  |
| 4 | `user_id` | uuid | ✓ | `` |  |
| 5 | `content` | text | ✗ | `` |  |
| 6 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 7 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 8 | `expires_at` | timestamp with time zone | ✓ | `` |  |

## auth_credentials

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/auth/auth.js`

**↓ Fetch:** *No direct reads found*

### Columns (12)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✗ | `` | → users(user_id), 🔒 UNIQUE |
| 3 | `password_hash` | text | ✗ | `` |  |
| 4 | `failed_login_attempts` | integer | ✓ | `0` |  |
| 5 | `locked_until` | timestamp with time zone | ✓ | `` |  |
| 6 | `last_login_at` | timestamp with time zone | ✓ | `` |  |
| 7 | `last_login_ip` | text | ✓ | `` |  |
| 8 | `password_reset_token` | text | ✓ | `` |  |
| 9 | `password_reset_expires` | timestamp with time zone | ✓ | `` |  |
| 10 | `password_changed_at` | timestamp with time zone | ✓ | `` |  |
| 11 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 12 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## block_jobs

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (7)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `` | 🔑 PK |
| 2 | `status` | text | ✗ | `` |  |
| 3 | `request_body` | jsonb | ✗ | `` |  |
| 4 | `result` | jsonb | ✓ | `` |  |
| 5 | `error` | text | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 7 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## briefings

### Data Flow

**↑ Push (INSERT/UPDATE):** 6 file(s)
- `api/briefing/briefing.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/strategy.js`
- `lib/ai/providers/consolidator.js`
- `lib/briefing/briefing-service.js`
- `lib/briefing/dump-last-briefing.js`

**↓ Fetch (SELECT):** 14 file(s)
- `api/briefing/briefing.js`
- `api/health/diagnostics-strategy.js`
- `api/health/diagnostics.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/content-blocks.js`
- `api/strategy/strategy.js`
- `jobs/triad-worker.js`
- `lib/ai/coach-dal.js`
- `lib/ai/providers/consolidator.js`
- `lib/briefing/briefing-service.js`
- `lib/briefing/dump-last-briefing.js`
- `lib/briefing/dump-latest.js`
- `lib/briefing/dump-traffic-format.js`
- `lib/briefing/test-api.js`

### Columns (15)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `snapshot_id` | uuid | ✗ | `` | → snapshots(snapshot_id), 🔒 UNIQUE |
| 15 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 16 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 20 | `news` | jsonb | ✓ | `` |  |
| 21 | `weather_current` | jsonb | ✓ | `` |  |
| 22 | `weather_forecast` | jsonb | ✓ | `` |  |
| 23 | `traffic_conditions` | jsonb | ✓ | `` |  |
| 24 | `events` | jsonb | ✓ | `` |  |
| 25 | `school_closures` | jsonb | ✓ | `` |  |
| 39 | `airport_conditions` | jsonb | ✓ | `` |  |
| 40 | `holiday` | text | ✓ | `` |  |
| 41 | `holidays` | jsonb | ✓ | `'[]'::jsonb` |  |
| 42 | `status` | text | ✓ | `'pending'::text` |  |
| 43 | `generated_at` | timestamp with time zone | ✓ | `` |  |

## coach_conversations

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `lib/ai/coach-dal.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/ai/coach-dal.js`

### Columns (22)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✗ | `` | → users(user_id) |
| 3 | `snapshot_id` | uuid | ✓ | `` | → snapshots(snapshot_id) |
| 4 | `conversation_id` | uuid | ✗ | `` |  |
| 5 | `parent_message_id` | uuid | ✓ | `` |  |
| 6 | `role` | text | ✗ | `` |  |
| 7 | `content` | text | ✗ | `` |  |
| 8 | `content_type` | text | ✓ | `'text'::text` |  |
| 9 | `topic_tags` | jsonb | ✓ | `'[]'::jsonb` |  |
| 10 | `extracted_tips` | jsonb | ✓ | `'[]'::jsonb` |  |
| 11 | `sentiment` | text | ✓ | `` |  |
| 12 | `location_context` | jsonb | ✓ | `` |  |
| 13 | `time_context` | jsonb | ✓ | `` |  |
| 14 | `tokens_in` | integer | ✓ | `` |  |
| 15 | `tokens_out` | integer | ✓ | `` |  |
| 16 | `model_used` | text | ✓ | `` |  |
| 17 | `is_edited` | boolean | ✓ | `false` |  |
| 18 | `is_regenerated` | boolean | ✓ | `false` |  |
| 19 | `is_starred` | boolean | ✓ | `false` |  |
| 20 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 21 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 22 | `market_slug` | text | ✓ | `` |  |

## coach_system_notes

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `lib/ai/coach-dal.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/ai/coach-dal.js`

### Columns (20)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `note_type` | text | ✗ | `` |  |
| 3 | `category` | text | ✗ | `` |  |
| 4 | `priority` | integer | ✓ | `50` |  |
| 5 | `title` | text | ✗ | `` |  |
| 6 | `description` | text | ✗ | `` |  |
| 7 | `user_quote` | text | ✓ | `` |  |
| 8 | `triggering_user_id` | uuid | ✓ | `` | → users(user_id) |
| 9 | `triggering_conversation_id` | uuid | ✓ | `` |  |
| 10 | `triggering_snapshot_id` | uuid | ✓ | `` | → snapshots(snapshot_id) |
| 11 | `occurrence_count` | integer | ✓ | `1` |  |
| 12 | `affected_users` | jsonb | ✓ | `'[]'::jsonb` |  |
| 13 | `market_slug` | text | ✓ | `` |  |
| 14 | `is_market_specific` | boolean | ✓ | `false` |  |
| 15 | `status` | text | ✓ | `'new'::text` |  |
| 16 | `reviewed_at` | timestamp with time zone | ✓ | `` |  |
| 17 | `reviewed_by` | text | ✓ | `` |  |
| 18 | `implementation_notes` | text | ✓ | `` |  |
| 19 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 20 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## connection_audit

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `occurred_at` | timestamp with time zone | ✗ | `now()` |  |
| 3 | `event` | text | ✗ | `` |  |
| 4 | `backend_pid` | integer | ✓ | `` |  |
| 5 | `application_name` | text | ✓ | `` |  |
| 6 | `reason` | text | ✓ | `` |  |
| 7 | `deploy_mode` | text | ✓ | `` |  |
| 8 | `details` | jsonb | ✓ | `` |  |

## coords_cache

### Data Flow

**↑ Push (INSERT/UPDATE):** 2 file(s)
- `api/location/location.js`
- `api/location/snapshot.js`

**↓ Fetch (SELECT):** 2 file(s)
- `api/location/location.js`
- `api/location/snapshot.js`

### Columns (13)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `coord_key` | text | ✗ | `` | 🔒 UNIQUE |
| 3 | `lat` | double precision | ✗ | `` |  |
| 4 | `lng` | double precision | ✗ | `` |  |
| 5 | `formatted_address` | text | ✗ | `` |  |
| 6 | `city` | text | ✗ | `` |  |
| 7 | `state` | text | ✗ | `` |  |
| 8 | `country` | text | ✗ | `` |  |
| 9 | `timezone` | text | ✗ | `` |  |
| 10 | `closest_airport` | text | ✓ | `` |  |
| 11 | `closest_airport_code` | text | ✓ | `` |  |
| 12 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 13 | `hit_count` | integer | ✗ | `0` |  |

## countries

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `code` | character varying(2) | ✗ | `` | 🔑 PK |
| 2 | `name` | text | ✗ | `` |  |
| 3 | `alpha3` | character varying(3) | ✓ | `` |  |
| 4 | `phone_code` | text | ✓ | `` |  |
| 5 | `has_platform_data` | boolean | ✗ | `false` |  |
| 6 | `display_order` | integer | ✗ | `999` |  |
| 7 | `is_active` | boolean | ✗ | `true` |  |
| 8 | `created_at` | timestamp with time zone | ✗ | `now()` |  |

## cross_thread_memory

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `scope` | text | ✗ | `` |  |
| 3 | `key` | text | ✗ | `` |  |
| 4 | `user_id` | uuid | ✓ | `` |  |
| 5 | `content` | text | ✗ | `` |  |
| 6 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 7 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 8 | `expires_at` | timestamp with time zone | ✓ | `` |  |

## discovered_events

### Data Flow

**↑ Push (INSERT/UPDATE):** 5 file(s)
- `api/briefing/briefing.js`
- `jobs/event-sync-job.js`
- `lib/ai/coach-dal.js`
- `lib/briefing/briefing-service.js`
- `lib/venue/venue-cache.js`

**↓ Fetch (SELECT):** 6 file(s)
- `api/briefing/briefing.js`
- `jobs/event-sync-job.js`
- `lib/ai/coach-dal.js`
- `lib/briefing/briefing-service.js`
- `lib/venue/event-matcher.js`
- `lib/venue/venue-cache.js`

### Columns (27)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `title` | text | ✗ | `` |  |
| 3 | `venue_name` | text | ✓ | `` |  |
| 4 | `address` | text | ✓ | `` |  |
| 5 | `city` | text | ✗ | `` |  |
| 6 | `state` | text | ✗ | `` |  |
| 7 | `zip` | text | ✓ | `` |  |
| 8 | `event_date` | text | ✗ | `` |  |
| 9 | `event_time` | text | ✓ | `` |  |
| 10 | `event_end_date` | text | ✓ | `` |  |
| 11 | `lat` | double precision | ✓ | `` |  |
| 12 | `lng` | double precision | ✓ | `` |  |
| 13 | `category` | text | ✗ | `'other'::text` |  |
| 14 | `expected_attendance` | text | ✓ | `'medium'::text` |  |
| 15 | `source_model` | text | ✗ | `` |  |
| 16 | `source_url` | text | ✓ | `` |  |
| 17 | `raw_source_data` | jsonb | ✓ | `` |  |
| 18 | `event_hash` | text | ✗ | `` | 🔒 UNIQUE |
| 19 | `discovered_at` | timestamp with time zone | ✗ | `now()` |  |
| 20 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 21 | `is_verified` | boolean | ✓ | `false` |  |
| 22 | `is_active` | boolean | ✓ | `true` |  |
| 23 | `event_end_time` | text | ✓ | `` |  |
| 24 | `deactivation_reason` | text | ✓ | `` |  |
| 25 | `deactivated_at` | timestamp with time zone | ✓ | `` |  |
| 26 | `deactivated_by` | text | ✓ | `` |  |
| 27 | `venue_id` | uuid | ✓ | `` | → venue_cache(id) |

## driver_profiles

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/auth/auth.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/ai/coach-dal.js`

### Columns (48)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✗ | `` | → users(user_id), 🔒 UNIQUE |
| 3 | `first_name` | text | ✗ | `` |  |
| 4 | `last_name` | text | ✗ | `` |  |
| 5 | `email` | text | ✗ | `` | 🔒 UNIQUE |
| 6 | `phone` | text | ✗ | `` |  |
| 7 | `address_1` | text | ✗ | `` |  |
| 8 | `address_2` | text | ✓ | `` |  |
| 9 | `city` | text | ✗ | `` |  |
| 10 | `state_territory` | text | ✗ | `` |  |
| 11 | `zip_code` | text | ✓ | `` |  |
| 12 | `country` | text | ✗ | `'US'::text` |  |
| 13 | `market` | text | ✗ | `` |  |
| 14 | `rideshare_platforms` | jsonb | ✗ | `'["uber"]'::jsonb` |  |
| 15 | `uber_black` | boolean | ✓ | `false` |  |
| 16 | `uber_xxl` | boolean | ✓ | `false` |  |
| 17 | `uber_comfort` | boolean | ✓ | `false` |  |
| 18 | `uber_x` | boolean | ✓ | `false` |  |
| 19 | `uber_x_share` | boolean | ✓ | `false` |  |
| 20 | `marketing_opt_in` | boolean | ✗ | `false` |  |
| 21 | `terms_accepted_at` | timestamp with time zone | ✓ | `` |  |
| 22 | `terms_version` | text | ✓ | `` |  |
| 23 | `email_verified` | boolean | ✓ | `false` |  |
| 24 | `phone_verified` | boolean | ✓ | `false` |  |
| 25 | `profile_complete` | boolean | ✓ | `false` |  |
| 26 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 27 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 28 | `home_lat` | double precision | ✓ | `` |  |
| 29 | `home_lng` | double precision | ✓ | `` |  |
| 30 | `home_formatted_address` | text | ✓ | `` |  |
| 31 | `home_timezone` | text | ✓ | `` |  |
| 32 | `driver_nickname` | text | ✓ | `` |  |
| 33 | `elig_economy` | boolean | ✓ | `true` |  |
| 34 | `elig_xl` | boolean | ✓ | `false` |  |
| 35 | `elig_xxl` | boolean | ✓ | `false` |  |
| 36 | `elig_comfort` | boolean | ✓ | `false` |  |
| 37 | `elig_luxury_sedan` | boolean | ✓ | `false` |  |
| 38 | `elig_luxury_suv` | boolean | ✓ | `false` |  |
| 39 | `attr_electric` | boolean | ✓ | `false` |  |
| 40 | `attr_green` | boolean | ✓ | `false` |  |
| 41 | `attr_wav` | boolean | ✓ | `false` |  |
| 42 | `attr_ski` | boolean | ✓ | `false` |  |
| 43 | `attr_car_seat` | boolean | ✓ | `false` |  |
| 44 | `pref_pet_friendly` | boolean | ✓ | `false` |  |
| 45 | `pref_teen` | boolean | ✓ | `false` |  |
| 46 | `pref_assist` | boolean | ✓ | `false` |  |
| 47 | `pref_shared` | boolean | ✓ | `false` |  |
| 48 | `terms_accepted` | boolean | ✗ | `false` |  |

## driver_vehicles

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/auth/auth.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/ai/coach-dal.js`

### Columns (12)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `driver_profile_id` | uuid | ✗ | `` | → driver_profiles(id) |
| 3 | `year` | integer | ✗ | `` |  |
| 4 | `make` | text | ✗ | `` |  |
| 5 | `model` | text | ✗ | `` |  |
| 6 | `color` | text | ✓ | `` |  |
| 7 | `license_plate` | text | ✓ | `` |  |
| 8 | `seatbelts` | integer | ✗ | `4` |  |
| 9 | `is_primary` | boolean | ✓ | `true` |  |
| 10 | `is_active` | boolean | ✓ | `true` |  |
| 11 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 12 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## eidolon_memory

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `scope` | text | ✗ | `` |  |
| 3 | `key` | text | ✗ | `` |  |
| 4 | `user_id` | uuid | ✓ | `` |  |
| 5 | `content` | text | ✗ | `` |  |
| 6 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 7 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 8 | `expires_at` | timestamp with time zone | ✓ | `` |  |

## eidolon_snapshots

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (10)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `snapshot_id` | uuid | ✓ | `` |  |
| 3 | `user_id` | uuid | ✓ | `` |  |
| 4 | `session_id` | text | ✓ | `` |  |
| 5 | `scope` | text | ✗ | `` |  |
| 6 | `state` | jsonb | ✗ | `` |  |
| 7 | `metadata` | jsonb | ✓ | `` |  |
| 8 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 9 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 10 | `expires_at` | timestamp with time zone | ✓ | `` |  |

## events_facts

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (20)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `event_id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `source` | text | ✗ | `` |  |
| 3 | `source_url` | text | ✓ | `` |  |
| 4 | `venue_place_id` | text | ✓ | `` |  |
| 5 | `venue_name` | text | ✓ | `` |  |
| 6 | `event_title` | text | ✗ | `` |  |
| 7 | `event_type` | text | ✓ | `` |  |
| 8 | `start_time` | timestamp with time zone | ✗ | `` |  |
| 9 | `end_time` | timestamp with time zone | ✗ | `` |  |
| 10 | `confidence` | double precision | ✓ | `0.0` |  |
| 11 | `coordinates` | jsonb | ✓ | `` |  |
| 12 | `description` | text | ✓ | `` |  |
| 13 | `tags` | ARRAY | ✓ | `` |  |
| 14 | `expires_at` | timestamp with time zone | ✓ | `` |  |
| 15 | `coordinates_source` | text | ✓ | `'manual'::text` |  |
| 16 | `location_quality` | text | ✓ | `'exact'::text` |  |
| 17 | `radius_hint_m` | integer | ✓ | `` |  |
| 18 | `impact_hint` | text | ✓ | `'none'::text` |  |
| 19 | `created_at` | timestamp with time zone | ✓ | `now()` |  |
| 20 | `updated_at` | timestamp with time zone | ✓ | `now()` |  |

## http_idem

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `middleware/idempotency.js`

**↓ Fetch (SELECT):** 1 file(s)
- `middleware/idempotency.js`

### Columns (4)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `key` | text | ✗ | `` | 🔑 PK |
| 2 | `status` | integer | ✗ | `` |  |
| 3 | `body` | jsonb | ✗ | `` |  |
| 4 | `created_at` | timestamp with time zone | ✗ | `now()` |  |

## llm_venue_suggestions

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (13)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `suggestion_id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `suggested_at` | timestamp with time zone | ✗ | `now()` |  |
| 3 | `model_name` | text | ✗ | `` |  |
| 4 | `ranking_id` | uuid | ✓ | `` | → rankings(ranking_id) |
| 5 | `venue_name` | text | ✗ | `` |  |
| 6 | `suggested_category` | text | ✓ | `` |  |
| 7 | `llm_reasoning` | text | ✓ | `` |  |
| 8 | `validation_status` | text | ✗ | `'pending'::text` |  |
| 9 | `place_id_found` | text | ✓ | `` |  |
| 10 | `venue_id_created` | uuid | ✓ | `` | → venue_catalog(venue_id) |
| 11 | `validated_at` | timestamp with time zone | ✓ | `` |  |
| 12 | `rejection_reason` | text | ✓ | `` |  |
| 13 | `llm_analysis` | jsonb | ✓ | `` |  |

## market_intelligence

### Data Flow

**↑ Push (INSERT/UPDATE):** 3 file(s)
- `api/intelligence/index.js`
- `lib/ai/coach-dal.js`
- `scripts/parse-market-research.js`

**↓ Fetch (SELECT):** 3 file(s)
- `api/intelligence/index.js`
- `lib/ai/coach-dal.js`
- `scripts/parse-market-research.js`

### Columns (29)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `market` | text | ✗ | `` |  |
| 3 | `market_slug` | text | ✗ | `` |  |
| 4 | `platform` | text | ✗ | `'both'::text` |  |
| 5 | `intel_type` | text | ✗ | `` |  |
| 6 | `intel_subtype` | text | ✓ | `` |  |
| 7 | `title` | text | ✗ | `` |  |
| 8 | `summary` | text | ✓ | `` |  |
| 9 | `content` | text | ✗ | `` |  |
| 10 | `neighborhoods` | jsonb | ✓ | `` |  |
| 11 | `boundaries` | jsonb | ✓ | `` |  |
| 12 | `time_context` | jsonb | ✓ | `` |  |
| 13 | `tags` | jsonb | ✓ | `'[]'::jsonb` |  |
| 14 | `priority` | integer | ✓ | `50` |  |
| 15 | `source` | text | ✗ | `'research'::text` |  |
| 16 | `source_file` | text | ✓ | `` |  |
| 17 | `source_section` | text | ✓ | `` |  |
| 18 | `confidence` | integer | ✓ | `80` |  |
| 19 | `version` | integer | ✓ | `1` |  |
| 20 | `effective_date` | timestamp with time zone | ✓ | `` |  |
| 21 | `expiry_date` | timestamp with time zone | ✓ | `` |  |
| 22 | `is_active` | boolean | ✓ | `true` |  |
| 23 | `is_verified` | boolean | ✓ | `false` |  |
| 24 | `coach_can_cite` | boolean | ✓ | `true` |  |
| 25 | `coach_priority` | integer | ✓ | `50` |  |
| 26 | `created_by` | text | ✗ | `'system'::text` |  |
| 27 | `updated_by` | text | ✓ | `` |  |
| 28 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 29 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## markets

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/location/location.js`

**↓ Fetch (SELECT):** 1 file(s)
- `api/location/location.js`

### Columns (14)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `market_slug` | text | ✗ | `` | 🔑 PK |
| 2 | `market_name` | text | ✗ | `` |  |
| 3 | `primary_city` | text | ✗ | `` |  |
| 4 | `state` | text | ✗ | `` |  |
| 5 | `country_code` | character varying(2) | ✗ | `'US'::character varying` |  |
| 6 | `timezone` | text | ✗ | `` |  |
| 7 | `primary_airport_code` | text | ✓ | `` |  |
| 8 | `secondary_airports` | jsonb | ✓ | `` |  |
| 9 | `city_aliases` | jsonb | ✓ | `` |  |
| 10 | `has_uber` | boolean | ✗ | `true` |  |
| 11 | `has_lyft` | boolean | ✗ | `true` |  |
| 12 | `is_active` | boolean | ✗ | `true` |  |
| 13 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 14 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## nearby_venues

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `lib/venue/venue-intelligence.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/venue/venue-intelligence.js`

### Columns (30)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `snapshot_id` | uuid | ✓ | `` | → snapshots(snapshot_id) |
| 3 | `name` | text | ✗ | `` |  |
| 4 | `venue_type` | text | ✗ | `` |  |
| 5 | `address` | text | ✓ | `` |  |
| 6 | `lat` | double precision | ✗ | `` |  |
| 7 | `lng` | double precision | ✗ | `` |  |
| 8 | `distance_miles` | double precision | ✓ | `` |  |
| 9 | `expense_level` | text | ✓ | `` |  |
| 10 | `expense_rank` | integer | ✓ | `` |  |
| 11 | `phone` | text | ✓ | `` |  |
| 12 | `is_open` | boolean | ✓ | `true` |  |
| 13 | `hours_today` | text | ✓ | `` |  |
| 14 | `hours_full_week` | jsonb | ✓ | `` |  |
| 15 | `closing_soon` | boolean | ✓ | `false` |  |
| 16 | `minutes_until_close` | integer | ✓ | `` |  |
| 17 | `opens_in_minutes` | integer | ✓ | `` |  |
| 18 | `opens_in_future` | boolean | ✓ | `` |  |
| 19 | `was_filtered` | boolean | ✓ | `false` |  |
| 20 | `crowd_level` | text | ✓ | `` |  |
| 21 | `rideshare_potential` | text | ✓ | `` |  |
| 22 | `city` | text | ✓ | `` |  |
| 23 | `state` | text | ✓ | `` |  |
| 24 | `day_of_week` | integer | ✓ | `` |  |
| 25 | `is_holiday` | boolean | ✓ | `false` |  |
| 26 | `holiday_name` | text | ✓ | `` |  |
| 27 | `search_sources` | jsonb | ✓ | `` |  |
| 28 | `user_corrections` | jsonb | ✓ | `'[]'::jsonb` |  |
| 29 | `correction_count` | integer | ✓ | `0` |  |
| 30 | `created_at` | timestamp with time zone | ✗ | `now()` |  |

## news_deactivations

### Data Flow

**↑ Push (INSERT/UPDATE):** 3 file(s)
- `api/briefing/briefing.js`
- `lib/ai/coach-dal.js`
- `lib/ai/providers/consolidator.js`

**↓ Fetch (SELECT):** 3 file(s)
- `api/briefing/briefing.js`
- `lib/ai/coach-dal.js`
- `lib/ai/providers/consolidator.js`

### Columns (9)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✗ | `` | → users(user_id) |
| 3 | `news_hash` | text | ✗ | `` |  |
| 4 | `news_title` | text | ✗ | `` |  |
| 5 | `news_source` | text | ✓ | `` |  |
| 6 | `reason` | text | ✗ | `` |  |
| 8 | `deactivated_by` | text | ✗ | `'user'::text` |  |
| 9 | `scope` | text | ✓ | `'user'::text` |  |
| 10 | `created_at` | timestamp with time zone | ✗ | `now()` |  |

## places_cache

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `lib/venue/venue-enrichment.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/venue/venue-enrichment.js`

### Columns (4)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `place_id` | text | ✗ | `` | 🔑 PK |
| 2 | `formatted_hours` | jsonb | ✓ | `` |  |
| 3 | `cached_at` | timestamp with time zone | ✗ | `` |  |
| 4 | `access_count` | integer | ✗ | `0` |  |

## platform_data

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/intelligence/index.js`

**↓ Fetch (SELECT):** 4 file(s)
- `api/auth/auth.js`
- `api/intelligence/index.js`
- `api/platform/index.js`
- `lib/ai/coach-dal.js`

### Columns (16)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `country` | text | ✗ | `` |  |
| 4 | `city` | text | ✗ | `` |  |
| 5 | `platform` | text | ✗ | `` |  |
| 6 | `coord_boundary` | jsonb | ✓ | `` |  |
| 7 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 8 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 9 | `country_code` | text | ✓ | `` |  |
| 10 | `region` | text | ✓ | `` |  |
| 11 | `market` | text | ✓ | `` |  |
| 12 | `timezone` | text | ✓ | `` |  |
| 13 | `center_lat` | double precision | ✓ | `` |  |
| 14 | `center_lng` | double precision | ✓ | `` |  |
| 15 | `is_active` | boolean | ✓ | `true` |  |
| 16 | `market_anchor` | text | ✓ | `` |  |
| 17 | `region_type` | text | ✓ | `` |  |

## ranking_candidates

### Data Flow

**↑ Push (INSERT/UPDATE):** 4 file(s)
- `api/feedback/feedback.js`
- `api/intelligence/index.js`
- `api/strategy/blocks-fast.js`
- `lib/venue/enhanced-smart-blocks.js`

**↓ Fetch (SELECT):** 7 file(s)
- `api/chat/chat-context.js`
- `api/feedback/feedback.js`
- `api/intelligence/index.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/content-blocks.js`
- `lib/ai/coach-dal.js`
- `lib/venue/enhanced-smart-blocks.js`

### Columns (43)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `` | 🔑 PK |
| 2 | `ranking_id` | uuid | ✗ | `` | → rankings(ranking_id) |
| 3 | `block_id` | text | ✗ | `` |  |
| 4 | `name` | text | ✗ | `` |  |
| 5 | `lat` | double precision | ✗ | `` |  |
| 6 | `lng` | double precision | ✗ | `` |  |
| 7 | `drive_time_min` | integer | ✓ | `` |  |
| 8 | `straight_line_km` | double precision | ✓ | `` |  |
| 9 | `est_earnings_per_ride` | double precision | ✓ | `` |  |
| 10 | `model_score` | double precision | ✓ | `` |  |
| 11 | `rank` | integer | ✗ | `` |  |
| 12 | `exploration_policy` | text | ✗ | `` |  |
| 13 | `epsilon` | double precision | ✓ | `` |  |
| 14 | `was_forced` | boolean | ✓ | `` |  |
| 15 | `propensity` | double precision | ✓ | `` |  |
| 16 | `features` | jsonb | ✓ | `` |  |
| 17 | `h3_r8` | text | ✓ | `` |  |
| 18 | `distance_miles` | double precision | ✓ | `` |  |
| 19 | `drive_minutes` | integer | ✓ | `` |  |
| 20 | `value_per_min` | double precision | ✓ | `` |  |
| 21 | `value_grade` | text | ✓ | `` |  |
| 22 | `not_worth` | boolean | ✓ | `` |  |
| 23 | `rate_per_min_used` | double precision | ✓ | `` |  |
| 24 | `trip_minutes_used` | integer | ✓ | `` |  |
| 25 | `wait_minutes_used` | integer | ✓ | `` |  |
| 26 | `snapshot_id` | uuid | ✓ | `` |  |
| 27 | `place_id` | text | ✓ | `` |  |
| 28 | `estimated_distance_miles` | double precision | ✓ | `` |  |
| 29 | `drive_time_minutes` | integer | ✓ | `` |  |
| 30 | `distance_source` | text | ✓ | `` |  |
| 31 | `pro_tips` | ARRAY | ✓ | `` |  |
| 32 | `closed_reasoning` | text | ✓ | `` |  |
| 33 | `staging_tips` | text | ✓ | `` |  |
| 34 | `staging_name` | text | ✓ | `` |  |
| 35 | `staging_lat` | double precision | ✓ | `` |  |
| 36 | `staging_lng` | double precision | ✓ | `` |  |
| 37 | `business_hours` | jsonb | ✓ | `` |  |
| 38 | `venue_events` | jsonb | ✓ | `` |  |
| 39 | `event_badge_missing` | boolean | ✓ | `` |  |
| 40 | `node_type` | text | ✓ | `` |  |
| 41 | `access_status` | text | ✓ | `` |  |
| 42 | `aliases` | ARRAY | ✓ | `` |  |
| 43 | `district` | text | ✓ | `` |  |

## rankings

### Data Flow

**↑ Push (INSERT/UPDATE):** 3 file(s)
- `api/feedback/actions.js`
- `api/strategy/blocks-fast.js`
- `lib/venue/enhanced-smart-blocks.js`

**↓ Fetch (SELECT):** 8 file(s)
- `agent/context-awareness.js`
- `api/chat/chat-context.js`
- `api/feedback/actions.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/content-blocks.js`
- `lib/ai/coach-dal.js`
- `lib/external/semantic-search.js`
- `lib/venue/enhanced-smart-blocks.js`

### Columns (15)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `ranking_id` | uuid | ✗ | `` | 🔑 PK |
| 2 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 3 | `snapshot_id` | uuid | ✓ | `` | → snapshots(snapshot_id) |
| 4 | `user_id` | uuid | ✓ | `` |  |
| 5 | `city` | text | ✓ | `` |  |
| 6 | `ui` | jsonb | ✓ | `` |  |
| 7 | `model_name` | text | ✗ | `` |  |
| 8 | `correlation_id` | uuid | ✓ | `` |  |
| 9 | `scoring_ms` | integer | ✓ | `` |  |
| 10 | `planner_ms` | integer | ✓ | `` |  |
| 11 | `total_ms` | integer | ✓ | `` |  |
| 12 | `timed_out` | boolean | ✓ | `false` |  |
| 13 | `path_taken` | text | ✓ | `` |  |
| 14 | `formatted_address` | text | ✓ | `` |  |
| 15 | `state` | text | ✓ | `` |  |

## snapshots

### Data Flow

**↑ Push (INSERT/UPDATE):** 15 file(s)
- `agent/enhanced-context.js`
- `api/briefing/briefing.js`
- `api/chat/chat.js`
- `api/feedback/actions.js`
- `api/location/location.js`
- `api/location/snapshot.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/strategy.js`
- `api/strategy/tactical-plan.js`
- `assistant/enhanced-context.js`
- `bootstrap/enqueue-initial.js`
- `eidolon/enhanced-context.js`
- `jobs/event-sync-job.js`
- `lib/briefing/briefing-service.js`
- `lib/strategy/strategy-generator-parallel.js`

**↓ Fetch (SELECT):** 30 file(s)
- `agent/context-awareness.js`
- `agent/enhanced-context.js`
- `api/briefing/briefing.js`
- `api/chat/chat-context.js`
- `api/chat/chat.js`
- `api/feedback/actions.js`
- `api/health/diagnostics-strategy.js`
- `api/health/diagnostics.js`
- `api/location/location.js`
- `api/location/snapshot.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/content-blocks.js`
- `api/strategy/strategy.js`
- `api/strategy/tactical-plan.js`
- `assistant/enhanced-context.js`
- `bootstrap/enqueue-initial.js`
- `eidolon/enhanced-context.js`
- `jobs/event-sync-job.js`
- `jobs/triad-worker.js`
- `lib/ai/coach-dal.js`
- `lib/ai/providers/briefing.js`
- `lib/ai/providers/consolidator.js`
- `lib/briefing/briefing-service.js`
- `lib/external/semantic-search.js`
- `lib/location/get-snapshot-context.js`
- `lib/strategy/strategy-generator-parallel.js`
- `lib/strategy/strategy-generator.js`
- `lib/strategy/strategy-utils.js`
- `middleware/require-snapshot-ownership.js`
- `scripts/self-healing-monitor.js`

### Columns (25)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `snapshot_id` | uuid | ✗ | `` | 🔑 PK |
| 2 | `created_at` | timestamp with time zone | ✗ | `` |  |
| 4 | `device_id` | text | ✗ | `` |  |
| 5 | `session_id` | uuid | ✗ | `` |  |
| 19 | `h3_r8` | text | ✓ | `` |  |
| 20 | `weather` | jsonb | ✓ | `` |  |
| 21 | `air` | jsonb | ✓ | `` |  |
| 23 | `permissions` | jsonb | ✓ | `` |  |
| 28 | `airport_context` | jsonb | ✓ | `` |  |
| 33 | `holiday` | text | ✗ | `'none'::text` |  |
| 34 | `is_holiday` | boolean | ✗ | `false` |  |
| 35 | `lat` | double precision | ✗ | `` |  |
| 36 | `lng` | double precision | ✗ | `` |  |
| 37 | `city` | text | ✗ | `` |  |
| 38 | `state` | text | ✗ | `` |  |
| 39 | `country` | text | ✗ | `` |  |
| 40 | `formatted_address` | text | ✗ | `` |  |
| 41 | `timezone` | text | ✗ | `` |  |
| 42 | `local_iso` | timestamp without time zone | ✗ | `` |  |
| 43 | `dow` | integer | ✗ | `` |  |
| 44 | `hour` | integer | ✗ | `` |  |
| 45 | `day_part_key` | text | ✗ | `` |  |
| 46 | `date` | text | ✓ | `` |  |
| 47 | `coord_key` | text | ✓ | `` |  |
| 48 | `user_id` | uuid | ✓ | `` |  |

## strategies

### Data Flow

**↑ Push (INSERT/UPDATE):** 12 file(s)
- `agent/enhanced-context.js`
- `api/chat/chat.js`
- `api/location/location.js`
- `api/location/snapshot.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/strategy.js`
- `assistant/enhanced-context.js`
- `eidolon/enhanced-context.js`
- `lib/ai/providers/consolidator.js`
- `lib/strategy/dump-last-strategy.js`
- `lib/strategy/strategy-generator-parallel.js`
- `lib/strategy/strategy-utils.js`

**↓ Fetch (SELECT):** 21 file(s)
- `agent/context-awareness.js`
- `agent/enhanced-context.js`
- `api/chat/chat-context.js`
- `api/chat/chat.js`
- `api/health/diagnostics-strategy.js`
- `api/health/diagnostics.js`
- `api/location/location.js`
- `api/location/snapshot.js`
- `api/strategy/blocks-fast.js`
- `api/strategy/content-blocks.js`
- `api/strategy/strategy.js`
- `assistant/enhanced-context.js`
- `eidolon/enhanced-context.js`
- `jobs/triad-worker.js`
- `lib/ai/coach-dal.js`
- `lib/ai/providers/consolidator.js`
- `lib/external/semantic-search.js`
- `lib/strategy/dump-last-strategy.js`
- `lib/strategy/strategy-generator-parallel.js`
- `lib/strategy/strategy-utils.js`
- `scripts/self-healing-monitor.js`

### Columns (43)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `snapshot_id` | uuid | ✗ | `` | → snapshots(snapshot_id), 🔒 UNIQUE |
| 3 | `strategy` | text | ✓ | `` |  |
| 4 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 5 | `status` | text | ✗ | `'pending'::text` |  |
| 6 | `error_code` | integer | ✓ | `` |  |
| 7 | `error_message` | text | ✓ | `` |  |
| 8 | `attempt` | integer | ✗ | `1` |  |
| 9 | `latency_ms` | integer | ✓ | `` |  |
| 10 | `tokens` | integer | ✓ | `` |  |
| 11 | `next_retry_at` | timestamp with time zone | ✓ | `` |  |
| 12 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 13 | `correlation_id` | uuid | ✓ | `` |  |
| 14 | `model_name` | text | ✓ | `` |  |
| 17 | `strategy_for_now` | text | ✓ | `` |  |
| 18 | `strategy_id` | uuid | ✓ | `` | 🔒 UNIQUE |
| 24 | `user_id` | uuid | ✓ | `` |  |
| 28 | `valid_window_start` | timestamp with time zone | ✓ | `` |  |
| 29 | `valid_window_end` | timestamp with time zone | ✓ | `` |  |
| 30 | `strategy_timestamp` | timestamp with time zone | ✓ | `` |  |
| 35 | `consolidated_strategy` | text | ✓ | `` |  |
| 40 | `trigger_reason` | text | ✓ | `` |  |
| 41 | `phase` | text | ✓ | `'starting'::text` |  |
| 48 | `phase_started_at` | timestamp with time zone | ✓ | `` |  |
| 49 | `briefing` | jsonb | ✓ | `` |  |
| 50 | `model_params` | jsonb | ✓ | `` |  |
| 51 | `prompt_version` | text | ✓ | `` |  |
| 52 | `lat` | double precision | ✓ | `` |  |
| 53 | `lng` | double precision | ✓ | `` |  |
| 54 | `city` | text | ✓ | `` |  |
| 55 | `state` | text | ✓ | `` |  |
| 56 | `user_address` | text | ✓ | `` |  |
| 57 | `events` | jsonb | ✓ | `'[]'::jsonb` |  |
| 58 | `news` | jsonb | ✓ | `'[]'::jsonb` |  |
| 59 | `traffic` | jsonb | ✓ | `'[]'::jsonb` |  |
| 60 | `user_resolved_address` | text | ✓ | `` |  |
| 61 | `user_resolved_city` | text | ✓ | `` |  |
| 62 | `user_resolved_state` | text | ✓ | `` |  |
| 63 | `holiday` | text | ✓ | `` |  |
| 64 | `briefing_news` | jsonb | ✓ | `` |  |
| 65 | `briefing_events` | jsonb | ✓ | `` |  |
| 66 | `briefing_traffic` | jsonb | ✓ | `` |  |
| 67 | `minstrategy` | text | ✓ | `` |  |

## strategy_feedback

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/feedback/feedback.js`

**↓ Fetch (SELECT):** 2 file(s)
- `api/feedback/feedback.js`
- `lib/ai/coach-dal.js`

### Columns (10)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✓ | `` |  |
| 3 | `snapshot_id` | uuid | ✗ | `` | → snapshots(snapshot_id) |
| 4 | `ranking_id` | uuid | ✗ | `` | → rankings(ranking_id) |
| 5 | `sentiment` | text | ✗ | `` |  |
| 6 | `comment` | text | ✓ | `` |  |
| 7 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 8 | `formatted_address` | text | ✓ | `` |  |
| 9 | `city` | text | ✓ | `` |  |
| 10 | `state` | text | ✓ | `` |  |

## traffic_zones

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (13)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `lat` | double precision | ✗ | `` |  |
| 3 | `lng` | double precision | ✗ | `` |  |
| 4 | `city` | text | ✓ | `` |  |
| 5 | `state` | text | ✓ | `` |  |
| 6 | `traffic_density` | integer | ✓ | `` |  |
| 7 | `density_level` | text | ✓ | `` |  |
| 8 | `congestion_areas` | jsonb | ✓ | `` |  |
| 9 | `high_demand_zones` | jsonb | ✓ | `` |  |
| 10 | `driver_advice` | text | ✓ | `` |  |
| 11 | `sources` | jsonb | ✓ | `` |  |
| 12 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 13 | `expires_at` | timestamp with time zone | ✓ | `` |  |

## travel_disruptions

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/location/location.js`

**↓ Fetch:** *No direct reads found*

### Columns (14)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `country_code` | text | ✗ | `'US'::text` |  |
| 3 | `airport_code` | text | ✗ | `` |  |
| 4 | `airport_name` | text | ✓ | `` |  |
| 5 | `delay_minutes` | integer | ✓ | `0` |  |
| 6 | `ground_stops` | jsonb | ✓ | `'[]'::jsonb` |  |
| 7 | `ground_delay_programs` | jsonb | ✓ | `'[]'::jsonb` |  |
| 8 | `closure_status` | text | ✓ | `'open'::text` |  |
| 9 | `delay_reason` | text | ✓ | `` |  |
| 10 | `ai_summary` | text | ✓ | `` |  |
| 11 | `impact_level` | text | ✓ | `'none'::text` |  |
| 12 | `data_source` | text | ✗ | `'FAA'::text` |  |
| 13 | `last_updated` | timestamp with time zone | ✗ | `now()` |  |
| 14 | `next_update_at` | timestamp with time zone | ✓ | `` |  |

## triad_jobs

### Data Flow

**↑ Push (INSERT/UPDATE):** 2 file(s)
- `api/strategy/blocks-fast.js`
- `bootstrap/enqueue-initial.js`

**↓ Fetch (SELECT):** 2 file(s)
- `api/strategy/blocks-fast.js`
- `bootstrap/enqueue-initial.js`

### Columns (8)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `snapshot_id` | uuid | ✗ | `` | → snapshots(snapshot_id), 🔒 UNIQUE |
| 3 | `kind` | text | ✗ | `'triad'::text` |  |
| 4 | `status` | text | ✗ | `'queued'::text` |  |
| 5 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 6 | `formatted_address` | text | ✓ | `` |  |
| 7 | `city` | text | ✓ | `` |  |
| 8 | `state` | text | ✓ | `` |  |

## user_intel_notes

### Data Flow

**↑ Push (INSERT/UPDATE):** 2 file(s)
- `api/chat/chat.js`
- `lib/ai/coach-dal.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/ai/coach-dal.js`

### Columns (21)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✓ | `` | → users(user_id) |
| 3 | `snapshot_id` | uuid | ✓ | `` | → snapshots(snapshot_id) |
| 4 | `note_type` | text | ✗ | `'insight'::text` |  |
| 5 | `category` | text | ✓ | `` |  |
| 6 | `title` | text | ✓ | `` |  |
| 7 | `content` | text | ✗ | `` |  |
| 8 | `context` | text | ✓ | `` |  |
| 9 | `market_slug` | text | ✓ | `` |  |
| 10 | `neighborhoods` | jsonb | ✓ | `` |  |
| 11 | `importance` | integer | ✓ | `50` |  |
| 12 | `confidence` | integer | ✓ | `80` |  |
| 13 | `times_referenced` | integer | ✓ | `0` |  |
| 14 | `valid_from` | timestamp with time zone | ✓ | `now()` |  |
| 15 | `valid_until` | timestamp with time zone | ✓ | `` |  |
| 16 | `is_active` | boolean | ✓ | `true` |  |
| 17 | `is_pinned` | boolean | ✓ | `false` |  |
| 18 | `source_message_id` | text | ✓ | `` |  |
| 19 | `created_by` | text | ✗ | `'ai_coach'::text` |  |
| 20 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 21 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## users

### Data Flow

**↑ Push (INSERT/UPDATE):** 2 file(s)
- `api/auth/auth.js`
- `api/location/location.js`

**↓ Fetch (SELECT):** 3 file(s)
- `api/location/location.js`
- `lib/ai/coach-dal.js`
- `lib/strategy/strategy-generator.js`

### Columns (19)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `user_id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `device_id` | text | ✗ | `` |  |
| 3 | `session_id` | uuid | ✓ | `` |  |
| 4 | `lat` | double precision | ✗ | `` |  |
| 5 | `lng` | double precision | ✗ | `` |  |
| 6 | `accuracy_m` | double precision | ✓ | `` |  |
| 7 | `coord_source` | text | ✗ | `'gps'::text` |  |
| 8 | `new_lat` | double precision | ✓ | `` |  |
| 9 | `new_lng` | double precision | ✓ | `` |  |
| 10 | `new_accuracy_m` | double precision | ✓ | `` |  |
| 11 | `formatted_address` | text | ✓ | `` |  |
| 12 | `city` | text | ✓ | `` |  |
| 13 | `state` | text | ✓ | `` |  |
| 14 | `country` | text | ✓ | `` |  |
| 15 | `timezone` | text | ✓ | `` |  |
| 20 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 21 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 22 | `current_snapshot_id` | uuid | ✓ | `` |  |
| 23 | `coord_key` | text | ✓ | `` |  |

## vehicle_makes_cache

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/vehicle/vehicle.js`

**↓ Fetch (SELECT):** 1 file(s)
- `api/vehicle/vehicle.js`

### Columns (5)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `make_id` | integer | ✗ | `` | 🔒 UNIQUE |
| 3 | `make_name` | text | ✗ | `` |  |
| 4 | `is_common` | boolean | ✓ | `false` |  |
| 5 | `cached_at` | timestamp with time zone | ✗ | `now()` |  |

## vehicle_models_cache

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/vehicle/vehicle.js`

**↓ Fetch (SELECT):** 1 file(s)
- `api/vehicle/vehicle.js`

### Columns (7)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `make_id` | integer | ✗ | `` |  |
| 3 | `make_name` | text | ✗ | `` |  |
| 4 | `model_id` | integer | ✗ | `` |  |
| 5 | `model_name` | text | ✗ | `` |  |
| 6 | `model_year` | integer | ✓ | `` |  |
| 7 | `cached_at` | timestamp with time zone | ✗ | `now()` |  |

## venue_cache

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `lib/venue/venue-cache.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/venue/venue-cache.js`

### Columns (23)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `venue_name` | text | ✗ | `` |  |
| 3 | `normalized_name` | text | ✗ | `` | 🔒 UNIQUE |
| 4 | `city` | text | ✗ | `` | 🔒 UNIQUE |
| 5 | `state` | text | ✗ | `` | 🔒 UNIQUE |
| 6 | `country` | text | ✓ | `'USA'::text` |  |
| 7 | `lat` | double precision | ✗ | `` |  |
| 8 | `lng` | double precision | ✗ | `` |  |
| 9 | `coord_key` | text | ✓ | `` |  |
| 10 | `address` | text | ✓ | `` |  |
| 11 | `formatted_address` | text | ✓ | `` |  |
| 12 | `zip` | text | ✓ | `` |  |
| 13 | `place_id` | text | ✓ | `` | 🔒 UNIQUE |
| 14 | `hours` | jsonb | ✓ | `` |  |
| 15 | `hours_source` | text | ✓ | `` |  |
| 16 | `venue_type` | text | ✓ | `` |  |
| 17 | `capacity_estimate` | integer | ✓ | `` |  |
| 18 | `source` | text | ✗ | `` |  |
| 19 | `source_model` | text | ✓ | `` |  |
| 20 | `cached_at` | timestamp with time zone | ✗ | `now()` |  |
| 21 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |
| 22 | `access_count` | integer | ✗ | `0` |  |
| 23 | `last_accessed_at` | timestamp with time zone | ✓ | `` |  |

## venue_catalog

### Data Flow

**↑ Push (INSERT/UPDATE):** 4 file(s)
- `api/feedback/actions.js`
- `lib/ai/coach-dal.js`
- `lib/venue/district-detection.js`
- `scripts/seed-dfw-venues.js`

**↓ Fetch (SELECT):** 4 file(s)
- `api/feedback/actions.js`
- `lib/ai/coach-dal.js`
- `lib/venue/district-detection.js`
- `scripts/seed-dfw-venues.js`

### Columns (26)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `venue_id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `place_id` | text | ✓ | `` | 🔒 UNIQUE |
| 3 | `venue_name` | character varying(500) | ✗ | `` |  |
| 4 | `address` | character varying(500) | ✗ | `` |  |
| 5 | `lat` | double precision | ✓ | `` |  |
| 6 | `lng` | double precision | ✓ | `` |  |
| 7 | `category` | text | ✗ | `` |  |
| 8 | `staging_notes` | jsonb | ✓ | `` |  |
| 9 | `city` | text | ✓ | `` |  |
| 10 | `metro` | text | ✓ | `` |  |
| 11 | `ai_estimated_hours` | text | ✓ | `` |  |
| 12 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 13 | `business_hours` | jsonb | ✓ | `` |  |
| 14 | `discovery_source` | text | ✗ | `'seed'::text` |  |
| 15 | `validated_at` | timestamp with time zone | ✓ | `` |  |
| 16 | `suggestion_metadata` | jsonb | ✓ | `` |  |
| 17 | `dayparts` | ARRAY | ✓ | `` |  |
| 18 | `last_known_status` | text | ✓ | `'unknown'::text` |  |
| 19 | `status_checked_at` | timestamp with time zone | ✓ | `` |  |
| 20 | `consecutive_closed_checks` | integer | ✓ | `0` |  |
| 21 | `auto_suppressed` | boolean | ✓ | `false` |  |
| 22 | `suppression_reason` | text | ✓ | `` |  |
| 23 | `district` | text | ✓ | `` |  |
| 24 | `district_slug` | text | ✓ | `` |  |
| 25 | `district_centroid_lat` | double precision | ✓ | `` |  |
| 26 | `district_centroid_lng` | double precision | ✓ | `` |  |

## venue_events

### Data Flow

**↑ Push:** *No direct writes found*

**↓ Fetch:** *No direct reads found*

### Columns (12)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `venue_id` | uuid | ✓ | `` |  |
| 3 | `place_id` | text | ✓ | `` |  |
| 4 | `title` | text | ✗ | `` |  |
| 5 | `starts_at` | timestamp with time zone | ✓ | `` |  |
| 6 | `ends_at` | timestamp with time zone | ✓ | `` |  |
| 7 | `lat` | double precision | ✓ | `` |  |
| 8 | `lng` | double precision | ✓ | `` |  |
| 9 | `source` | text | ✗ | `` |  |
| 10 | `radius_m` | integer | ✓ | `` |  |
| 11 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 12 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

## venue_feedback

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/feedback/feedback.js`

**↓ Fetch (SELECT):** 3 file(s)
- `api/feedback/feedback.js`
- `lib/ai/coach-dal.js`
- `lib/external/semantic-search.js`

### Columns (12)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✓ | `` |  |
| 3 | `snapshot_id` | uuid | ✗ | `` | → snapshots(snapshot_id) |
| 4 | `ranking_id` | uuid | ✗ | `` | → rankings(ranking_id) |
| 5 | `place_id` | text | ✓ | `` |  |
| 6 | `venue_name` | text | ✗ | `` |  |
| 7 | `sentiment` | text | ✗ | `` |  |
| 8 | `comment` | text | ✓ | `` |  |
| 9 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 10 | `formatted_address` | text | ✓ | `` |  |
| 11 | `city` | text | ✓ | `` |  |
| 12 | `state` | text | ✓ | `` |  |

## venue_metrics

### Data Flow

**↑ Push (INSERT/UPDATE):** 2 file(s)
- `api/feedback/actions.js`
- `scripts/seed-dfw-venues.js`

**↓ Fetch (SELECT):** 2 file(s)
- `api/feedback/actions.js`
- `scripts/seed-dfw-venues.js`

### Columns (7)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `venue_id` | uuid | ✗ | `` | 🔑 PK, → venue_catalog(venue_id) |
| 2 | `times_recommended` | integer | ✗ | `0` |  |
| 3 | `times_chosen` | integer | ✗ | `0` |  |
| 4 | `positive_feedback` | integer | ✗ | `0` |  |
| 5 | `negative_feedback` | integer | ✗ | `0` |  |
| 6 | `reliability_score` | double precision | ✗ | `0.5` |  |
| 7 | `last_verified_by_driver` | timestamp with time zone | ✓ | `` |  |

## verification_codes

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `api/auth/auth.js`

**↓ Fetch:** *No direct reads found*

### Columns (10)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `user_id` | uuid | ✓ | `` | → users(user_id) |
| 3 | `code` | text | ✗ | `` |  |
| 4 | `code_type` | text | ✗ | `` |  |
| 5 | `destination` | text | ✗ | `` |  |
| 6 | `used_at` | timestamp with time zone | ✓ | `` |  |
| 7 | `expires_at` | timestamp with time zone | ✗ | `` |  |
| 8 | `attempts` | integer | ✓ | `0` |  |
| 9 | `max_attempts` | integer | ✓ | `3` |  |
| 10 | `created_at` | timestamp with time zone | ✗ | `now()` |  |

## zone_intelligence

### Data Flow

**↑ Push (INSERT/UPDATE):** 1 file(s)
- `lib/ai/coach-dal.js`

**↓ Fetch (SELECT):** 1 file(s)
- `lib/ai/coach-dal.js`

### Columns (22)

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid | ✗ | `gen_random_uuid()` | 🔑 PK |
| 2 | `market_slug` | text | ✗ | `` |  |
| 3 | `zone_type` | text | ✗ | `` |  |
| 4 | `zone_name` | text | ✗ | `` |  |
| 5 | `zone_description` | text | ✓ | `` |  |
| 6 | `lat` | double precision | ✓ | `` |  |
| 7 | `lng` | double precision | ✓ | `` |  |
| 8 | `radius_miles` | double precision | ✓ | `0.5` |  |
| 9 | `address_hint` | text | ✓ | `` |  |
| 10 | `time_constraints` | jsonb | ✓ | `'{}'::jsonb` |  |
| 11 | `is_time_specific` | boolean | ✓ | `false` |  |
| 12 | `reports_count` | integer | ✓ | `1` |  |
| 13 | `confidence_score` | integer | ✓ | `50` |  |
| 14 | `contributing_users` | jsonb | ✓ | `'[]'::jsonb` |  |
| 15 | `source_conversations` | jsonb | ✓ | `'[]'::jsonb` |  |
| 16 | `last_reason` | text | ✓ | `` |  |
| 17 | `last_reported_by` | uuid | ✓ | `` | → users(user_id) |
| 18 | `last_reported_at` | timestamp with time zone | ✓ | `` |  |
| 19 | `is_active` | boolean | ✓ | `true` |  |
| 20 | `verified_by_admin` | boolean | ✓ | `false` |  |
| 21 | `created_at` | timestamp with time zone | ✗ | `now()` |  |
| 22 | `updated_at` | timestamp with time zone | ✗ | `now()` |  |

---

## Data Flow Summary

| Table | Push Files | Fetch Files |
|-------|-----------|-------------|
| actions | 5 | 7 |
| agent_changes | 0 | 0 |
| agent_memory | 0 | 0 |
| app_feedback | 1 | 1 |
| assistant_memory | 0 | 0 |
| auth_credentials | 1 | 0 |
| block_jobs | 0 | 0 |
| briefings | 6 | 14 |
| coach_conversations | 1 | 1 |
| coach_system_notes | 1 | 1 |
| connection_audit | 0 | 0 |
| coords_cache | 2 | 2 |
| countries | 0 | 0 |
| cross_thread_memory | 0 | 0 |
| discovered_events | 5 | 6 |
| driver_profiles | 1 | 1 |
| driver_vehicles | 1 | 1 |
| eidolon_memory | 0 | 0 |
| eidolon_snapshots | 0 | 0 |
| events_facts | 0 | 0 |
| http_idem | 1 | 1 |
| llm_venue_suggestions | 0 | 0 |
| market_intelligence | 3 | 3 |
| markets | 1 | 1 |
| nearby_venues | 1 | 1 |
| news_deactivations | 3 | 3 |
| places_cache | 1 | 1 |
| platform_data | 1 | 4 |
| ranking_candidates | 4 | 7 |
| rankings | 3 | 8 |
| snapshots | 15 | 30 |
| strategies | 12 | 21 |
| strategy_feedback | 1 | 2 |
| traffic_zones | 0 | 0 |
| travel_disruptions | 1 | 0 |
| triad_jobs | 2 | 2 |
| user_intel_notes | 2 | 1 |
| users | 2 | 3 |
| vehicle_makes_cache | 1 | 1 |
| vehicle_models_cache | 1 | 1 |
| venue_cache | 1 | 1 |
| venue_catalog | 4 | 4 |
| venue_events | 0 | 0 |
| venue_feedback | 1 | 3 |
| venue_metrics | 2 | 2 |
| verification_codes | 1 | 0 |
| zone_intelligence | 1 | 1 |

---

*Generated by `scripts/generate-schema-docs.js`*
*Data flow analysis saved to `docs/DATA_FLOW_MAP.json`*
