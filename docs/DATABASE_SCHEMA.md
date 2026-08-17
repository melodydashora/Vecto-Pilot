# Database Schema Reference

> Auto-generated database schema documentation for Vecto Pilot — **from the live database** (`scripts/generate-schema-docs.sh`, reads `information_schema` of `$DATABASE_URL`; generated against the DEV database — dev and prod share the same migrations via the boot runner). Regenerate: `bash scripts/generate-schema-docs.sh`. The former `scripts/generate-schema-docs.js` (source-regex) was retired 2026-08-17: it mis-attributed comments and skipped tables with index callbacks.

| Metric | Value |
|--------|-------|
| **Generated** | 2026-08-17 11:05:30 |
| **Tables** | 66 |
| **Total Columns** | 965 |
| **Database** | PostgreSQL |

---

## Table of Contents

- [actions](#actions)
- [agent_memory](#agent_memory)
- [airports](#airports)
- [app_feedback](#app_feedback)
- [app_rules](#app_rules)
- [assistant_memory](#assistant_memory)
- [auth_credentials](#auth_credentials)
- [block_jobs](#block_jobs)
- [briefings](#briefings)
- [claude_memory](#claude_memory)
- [coach_conversations](#coach_conversations)
- [coach_memos](#coach_memos)
- [coach_offer_decisions](#coach_offer_decisions)
- [coach_system_notes](#coach_system_notes)
- [concierge_feedback](#concierge_feedback)
- [connection_audit](#connection_audit)
- [coords_cache](#coords_cache)
- [countries](#countries)
- [cross_thread_memory](#cross_thread_memory)
- [definitions](#definitions)
- [discovered_events](#discovered_events)
- [discovered_traffic](#discovered_traffic)
- [driver_goals](#driver_goals)
- [driver_profiles](#driver_profiles)
- [driver_tasks](#driver_tasks)
- [driver_vehicles](#driver_vehicles)
- [eidolon_memory](#eidolon_memory)
- [eidolon_snapshots](#eidolon_snapshots)
- [http_idem](#http_idem)
- [intercepted_signals](#intercepted_signals)
- [lessons_learned](#lessons_learned)
- [llm_venue_suggestions](#llm_venue_suggestions)
- [market_cities](#market_cities)
- [market_intelligence](#market_intelligence)
- [market_intel](#market_intel)
- [markets](#markets)
- [news_deactivations](#news_deactivations)
- [oauth_states](#oauth_states)
- [offer_intelligence](#offer_intelligence)
- [offer_outcomes](#offer_outcomes)
- [offer_rulesets](#offer_rulesets)
- [places_cache](#places_cache)
- [platform_data](#platform_data)
- [ranking_candidates](#ranking_candidates)
- [rankings](#rankings)
- [safe_zones](#safe_zones)
- [schema_migrations](#schema_migrations)
- [snapshots](#snapshots)
- [staging_saturation](#staging_saturation)
- [strategies](#strategies)
- [strategy_feedback](#strategy_feedback)
- [todo](#todo)
- [traffic_zones](#traffic_zones)
- [travel_disruptions](#travel_disruptions)
- [triad_jobs](#triad_jobs)
- [uber_connections](#uber_connections)
- [user_intel_notes](#user_intel_notes)
- [users](#users)
- [vehicle_makes_cache](#vehicle_makes_cache)
- [vehicle_models_cache](#vehicle_models_cache)
- [venue_catalog](#venue_catalog)
- [venue_events](#venue_events)
- [venue_feedback](#venue_feedback)
- [venue_metrics](#venue_metrics)
- [verification_codes](#verification_codes)
- [zone_intelligence](#zone_intelligence)

---

## actions

**Columns:** 13

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `action_id` | uuid(NO) | ✓ | `` |  |
| 2 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 3 | `ranking_id` | uuid(YES) | ✓ | `` |  |
| 4 | `snapshot_id` | uuid(NO) | ✓ | `` |  |
| 5 | `user_id` | uuid(YES) | ✓ | `` |  |
| 6 | `action` | text(NO) | ✓ | `` |  |
| 7 | `block_id` | text(YES) | ✓ | `` |  |
| 8 | `dwell_ms` | integer(YES) | ✓ | `` |  |
| 9 | `from_rank` | integer(YES) | ✓ | `` |  |
| 10 | `raw` | jsonb(YES) | ✓ | `` |  |
| 11 | `formatted_address` | text(YES) | ✓ | `` |  |
| 12 | `city` | text(YES) | ✓ | `` |  |
| 13 | `state` | text(YES) | ✓ | `` |  |

## agent_memory

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `scope` | text(NO) | ✓ | `` |  |
| 3 | `key` | text(NO) | ✓ | `` |  |
| 4 | `user_id` | uuid(YES) | ✓ | `` |  |
| 5 | `content` | text(NO) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `expires_at` | timestamp with time zone(YES) | ✓ | `` |  |

## airports

**Columns:** 12

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `iata` | text(NO) | ✓ | `` |  |
| 2 | `name` | text(NO) | ✓ | `` |  |
| 3 | `city` | text(YES) | ✓ | `` |  |
| 4 | `country` | text(NO) | ✓ | `` |  |
| 5 | `lat` | double precision(NO) | ✓ | `` |  |
| 6 | `lng` | double precision(NO) | ✓ | `` |  |
| 7 | `coord_source` | text(NO) | ✓ | `` |  |
| 8 | `is_major` | boolean(NO) | ✓ | `` |  |
| 9 | `terminals` | jsonb(YES) | ✓ | `` |  |
| 10 | `terminals_provenance` | text(YES) | ✓ | `` |  |
| 11 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 12 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## app_feedback

**Columns:** 9

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `snapshot_id` | uuid(YES) | ✓ | `` |  |
| 3 | `sentiment` | text(NO) | ✓ | `` |  |
| 4 | `comment` | text(YES) | ✓ | `` |  |
| 5 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 6 | `formatted_address` | text(YES) | ✓ | `` |  |
| 7 | `city` | text(YES) | ✓ | `` |  |
| 8 | `state` | text(YES) | ✓ | `` |  |
| 9 | `user_id` | uuid(YES) | ✓ | `` |  |

## app_rules

**Columns:** 10

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | integer(NO) | ✓ | `PK` |  |
| 2 | `rule_key` | text(NO) | ✓ | `` |  |
| 3 | `rule_text` | text(NO) | ✓ | `` |  |
| 4 | `rationale` | text(YES) | ✓ | `` |  |
| 5 | `provenance` | text(NO) | ✓ | `` |  |
| 6 | `status` | text(NO) | ✓ | `` |  |
| 7 | `superseded_by` | integer(YES) | ✓ | `` |  |
| 8 | `enforced_by` | text(YES) | ✓ | `` |  |
| 9 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 10 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## assistant_memory

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `scope` | text(NO) | ✓ | `` |  |
| 3 | `key` | text(NO) | ✓ | `` |  |
| 4 | `user_id` | uuid(YES) | ✓ | `` |  |
| 5 | `content` | text(NO) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `expires_at` | timestamp with time zone(YES) | ✓ | `` |  |

## auth_credentials

**Columns:** 12

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 3 | `password_hash` | text(YES) | ✓ | `` |  |
| 4 | `failed_login_attempts` | integer(YES) | ✓ | `` |  |
| 5 | `locked_until` | timestamp with time zone(YES) | ✓ | `` |  |
| 6 | `last_login_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 7 | `last_login_ip` | text(YES) | ✓ | `` |  |
| 8 | `password_reset_token` | text(YES) | ✓ | `` |  |
| 9 | `password_reset_expires` | timestamp with time zone(YES) | ✓ | `` |  |
| 10 | `password_changed_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 11 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 12 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## block_jobs

**Columns:** 7

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `` |  |
| 2 | `status` | text(NO) | ✓ | `` |  |
| 3 | `request_body` | jsonb(NO) | ✓ | `` |  |
| 4 | `result` | jsonb(YES) | ✓ | `` |  |
| 5 | `error` | text(YES) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## briefings

**Columns:** 14

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `snapshot_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 3 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 4 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 5 | `news` | jsonb(YES) | ✓ | `` |  |
| 6 | `weather_current` | jsonb(YES) | ✓ | `` |  |
| 7 | `weather_forecast` | jsonb(YES) | ✓ | `` |  |
| 8 | `traffic_conditions` | jsonb(YES) | ✓ | `` |  |
| 9 | `events` | jsonb(YES) | ✓ | `` |  |
| 10 | `school_closures` | jsonb(YES) | ✓ | `` |  |
| 11 | `airport_conditions` | jsonb(YES) | ✓ | `` |  |
| 12 | `holiday` | jsonb(YES) | ✓ | `` |  |
| 13 | `status` | text(YES) | ✓ | `` |  |
| 14 | `generated_at` | timestamp with time zone(YES) | ✓ | `` |  |

## claude_memory

**Columns:** 14

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | integer(NO) | ✓ | `PK` |  |
| 2 | `session_id` | text(NO) | ✓ | `` |  |
| 3 | `category` | text(NO) | ✓ | `` |  |
| 4 | `title` | text(NO) | ✓ | `` |  |
| 5 | `content` | text(NO) | ✓ | `` |  |
| 6 | `source` | text(YES) | ✓ | `` |  |
| 7 | `priority` | text(YES) | ✓ | `` |  |
| 8 | `status` | text(YES) | ✓ | `` |  |
| 9 | `tags` | jsonb(YES) | ✓ | `` |  |
| 10 | `related_files` | jsonb(YES) | ✓ | `` |  |
| 11 | `parent_id` | integer(YES) | ✓ | `` |  |
| 12 | `metadata` | jsonb(YES) | ✓ | `` |  |
| 13 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 14 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## coach_conversations

**Columns:** 22

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `` |  |
| 3 | `snapshot_id` | uuid(YES) | ✓ | `` |  |
| 4 | `conversation_id` | uuid(NO) | ✓ | `` |  |
| 5 | `parent_message_id` | uuid(YES) | ✓ | `` |  |
| 6 | `role` | text(NO) | ✓ | `` |  |
| 7 | `content` | text(NO) | ✓ | `` |  |
| 8 | `content_type` | text(YES) | ✓ | `` |  |
| 9 | `topic_tags` | jsonb(YES) | ✓ | `` |  |
| 10 | `extracted_tips` | jsonb(YES) | ✓ | `` |  |
| 11 | `sentiment` | text(YES) | ✓ | `` |  |
| 12 | `location_context` | jsonb(YES) | ✓ | `` |  |
| 13 | `time_context` | jsonb(YES) | ✓ | `` |  |
| 14 | `tokens_in` | integer(YES) | ✓ | `` |  |
| 15 | `tokens_out` | integer(YES) | ✓ | `` |  |
| 16 | `model_used` | text(YES) | ✓ | `` |  |
| 17 | `is_edited` | boolean(YES) | ✓ | `` |  |
| 18 | `is_regenerated` | boolean(YES) | ✓ | `` |  |
| 19 | `is_starred` | boolean(YES) | ✓ | `` |  |
| 20 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 21 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 22 | `market_slug` | text(YES) | ✓ | `` |  |

## coach_memos

**Columns:** 14

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `type` | text(NO) | ✓ | `` |  |
| 3 | `title` | text(NO) | ✓ | `` |  |
| 4 | `detail` | text(NO) | ✓ | `` |  |
| 5 | `priority` | text(NO) | ✓ | `` |  |
| 6 | `related_files` | jsonb(YES) | ✓ | `` |  |
| 7 | `status` | text(NO) | ✓ | `` |  |
| 8 | `source` | text(NO) | ✓ | `` |  |
| 9 | `exported_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 10 | `triggering_user_id` | uuid(YES) | ✓ | `` |  |
| 11 | `triggering_conversation_id` | uuid(YES) | ✓ | `` |  |
| 12 | `triggering_snapshot_id` | uuid(YES) | ✓ | `` |  |
| 13 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 14 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## coach_offer_decisions

**Columns:** 25

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `` |  |
| 3 | `conversation_id` | uuid(YES) | ✓ | `` |  |
| 4 | `snapshot_id` | uuid(YES) | ✓ | `` |  |
| 5 | `offer_intelligence_id` | uuid(YES) | ✓ | `` |  |
| 6 | `platform` | text(YES) | ✓ | `` |  |
| 7 | `ride_tier` | text(YES) | ✓ | `` |  |
| 8 | `fare_amount` | double precision(YES) | ✓ | `` |  |
| 9 | `pickup_miles` | double precision(YES) | ✓ | `` |  |
| 10 | `pickup_minutes` | integer(YES) | ✓ | `` |  |
| 11 | `trip_miles` | double precision(YES) | ✓ | `` |  |
| 12 | `trip_minutes` | integer(YES) | ✓ | `` |  |
| 13 | `pickup_location` | text(YES) | ✓ | `` |  |
| 14 | `dropoff_location` | text(YES) | ✓ | `` |  |
| 15 | `surge_attached` | double precision(YES) | ✓ | `` |  |
| 16 | `dollar_per_mile` | double precision(YES) | ✓ | `` |  |
| 17 | `dollar_per_hour` | double precision(YES) | ✓ | `` |  |
| 18 | `deadhead_risk` | text(YES) | ✓ | `` |  |
| 19 | `ai_recommendation` | text(YES) | ✓ | `` |  |
| 20 | `ai_reasoning` | text(YES) | ✓ | `` |  |
| 21 | `user_decision` | text(YES) | ✓ | `` |  |
| 22 | `user_reasoning` | text(YES) | ✓ | `` |  |
| 23 | `screenshot_url` | text(YES) | ✓ | `` |  |
| 24 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 25 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## coach_system_notes

**Columns:** 20

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `note_type` | text(NO) | ✓ | `` |  |
| 3 | `category` | text(NO) | ✓ | `` |  |
| 4 | `priority` | integer(YES) | ✓ | `` |  |
| 5 | `title` | text(NO) | ✓ | `` |  |
| 6 | `description` | text(NO) | ✓ | `` |  |
| 7 | `user_quote` | text(YES) | ✓ | `` |  |
| 8 | `triggering_user_id` | uuid(YES) | ✓ | `` |  |
| 9 | `triggering_conversation_id` | uuid(YES) | ✓ | `` |  |
| 10 | `triggering_snapshot_id` | uuid(YES) | ✓ | `` |  |
| 11 | `occurrence_count` | integer(YES) | ✓ | `` |  |
| 12 | `affected_users` | jsonb(YES) | ✓ | `` |  |
| 13 | `market_slug` | text(YES) | ✓ | `` |  |
| 14 | `is_market_specific` | boolean(YES) | ✓ | `` |  |
| 15 | `status` | text(YES) | ✓ | `` |  |
| 16 | `reviewed_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 17 | `reviewed_by` | text(YES) | ✓ | `` |  |
| 18 | `implementation_notes` | text(YES) | ✓ | `` |  |
| 19 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 20 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## concierge_feedback

**Columns:** 6

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `driver_profile_id` | uuid(NO) | ✓ | `` |  |
| 3 | `share_token` | character varying(12) | ✗ | `` |  |
| 4 | `rating` | integer(NO) | ✓ | `` |  |
| 5 | `comment` | text(YES) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |

## connection_audit

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `occurred_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 3 | `event` | text(NO) | ✓ | `` |  |
| 4 | `backend_pid` | integer(YES) | ✓ | `` |  |
| 5 | `application_name` | text(YES) | ✓ | `` |  |
| 6 | `reason` | text(YES) | ✓ | `` |  |
| 7 | `deploy_mode` | text(YES) | ✓ | `` |  |
| 8 | `details` | jsonb(YES) | ✓ | `` |  |

## coords_cache

**Columns:** 13

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `coord_key` | text(NO) | ✓ | `` |  |
| 3 | `lat` | double precision(NO) | ✓ | `` |  |
| 4 | `lng` | double precision(NO) | ✓ | `` |  |
| 5 | `formatted_address` | text(NO) | ✓ | `` |  |
| 6 | `city` | text(NO) | ✓ | `` |  |
| 7 | `state` | text(NO) | ✓ | `` |  |
| 8 | `country` | text(NO) | ✓ | `` |  |
| 9 | `timezone` | text(NO) | ✓ | `` |  |
| 10 | `closest_airport` | text(YES) | ✓ | `` |  |
| 11 | `closest_airport_code` | text(YES) | ✓ | `` |  |
| 12 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 13 | `hit_count` | integer(NO) | ✓ | `` |  |

## countries

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `code` | character varying(2) | ✗ | `PK` |  |
| 2 | `name` | text(NO) | ✓ | `` |  |
| 3 | `alpha3` | character varying(3) | ✓ | `` |  |
| 4 | `phone_code` | text(YES) | ✓ | `` |  |
| 5 | `has_platform_data` | boolean(NO) | ✓ | `` |  |
| 6 | `display_order` | integer(NO) | ✓ | `` |  |
| 7 | `is_active` | boolean(NO) | ✓ | `` |  |
| 8 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |

## cross_thread_memory

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | integer(NO) | ✓ | `PK` |  |
| 2 | `scope` | text(NO) | ✓ | `` |  |
| 3 | `key` | text(NO) | ✓ | `` |  |
| 4 | `user_id` | uuid(YES) | ✓ | `` |  |
| 5 | `content` | text(NO) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `expires_at` | timestamp with time zone(YES) | ✓ | `` |  |

## definitions

**Columns:** 7

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | integer(NO) | ✓ | `PK` |  |
| 2 | `term` | text(NO) | ✓ | `` |  |
| 3 | `meaning` | text(NO) | ✓ | `` |  |
| 4 | `location` | text(YES) | ✓ | `` |  |
| 5 | `aliases` | text(YES) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## discovered_events

**Columns:** 25

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `title` | text(NO) | ✓ | `` |  |
| 3 | `venue_name` | text(YES) | ✓ | `` |  |
| 4 | `address` | text(YES) | ✓ | `` |  |
| 5 | `city` | text(NO) | ✓ | `` |  |
| 6 | `state` | text(NO) | ✓ | `` |  |
| 7 | `event_start_date` | text(NO) | ✓ | `` |  |
| 8 | `event_start_time` | text(YES) | ✓ | `` |  |
| 9 | `event_end_date` | text(YES) | ✓ | `` |  |
| 10 | `category` | text(NO) | ✓ | `` |  |
| 11 | `expected_attendance` | text(YES) | ✓ | `` |  |
| 12 | `event_hash` | text(NO) | ✓ | `` |  |
| 13 | `discovered_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 14 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 15 | `is_verified` | boolean(YES) | ✓ | `` |  |
| 16 | `is_active` | boolean(YES) | ✓ | `` |  |
| 17 | `event_end_time` | text(NO) | ✓ | `` |  |
| 18 | `deactivation_reason` | text(YES) | ✓ | `` |  |
| 19 | `deactivated_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 20 | `deactivated_by` | text(YES) | ✓ | `` |  |
| 21 | `venue_id` | uuid(YES) | ✓ | `` |  |
| 22 | `zip` | text(YES) | ✓ | `` |  |
| 23 | `lat` | double precision(YES) | ✓ | `` |  |
| 24 | `lng` | double precision(YES) | ✓ | `` |  |
| 25 | `schema_version` | integer(NO) | ✓ | `` |  |

## discovered_traffic

**Columns:** 16

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `snapshot_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 4 | `incident_id` | text(NO) | ✓ | `` |  |
| 5 | `category` | text(NO) | ✓ | `` |  |
| 6 | `severity` | text(NO) | ✓ | `` |  |
| 7 | `description` | text(YES) | ✓ | `` |  |
| 8 | `road` | text(YES) | ✓ | `` |  |
| 9 | `location` | text(YES) | ✓ | `` |  |
| 10 | `is_highway` | boolean(NO) | ✓ | `` |  |
| 11 | `delay_minutes` | integer(YES) | ✓ | `` |  |
| 12 | `length_miles` | double precision(YES) | ✓ | `` |  |
| 13 | `distance_miles` | double precision(YES) | ✓ | `` |  |
| 14 | `lat` | double precision(NO) | ✓ | `` |  |
| 15 | `lng` | double precision(NO) | ✓ | `` |  |
| 16 | `raw_payload` | jsonb(YES) | ✓ | `` |  |
| 17 | `fetched_at` | timestamp with time zone(NO) | ✓ | `` |  |

## driver_goals

**Columns:** 13

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `` |  |
| 3 | `goal_type` | text(NO) | ✓ | `` |  |
| 4 | `deadline` | timestamp with time zone(YES) | ✓ | `` |  |
| 5 | `is_active` | boolean(YES) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `target_amount` | double precision(YES) | ✓ | `` |  |
| 9 | `target_unit` | text(YES) | ✓ | `` |  |
| 10 | `min_hourly_rate` | double precision(YES) | ✓ | `` |  |
| 11 | `urgency` | text(YES) | ✓ | `` |  |
| 12 | `progress_amount` | double precision(YES) | ✓ | `` |  |
| 13 | `completed_at` | timestamp with time zone(YES) | ✓ | `` |  |

## driver_profiles

**Columns:** 57

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 3 | `first_name` | text(NO) | ✓ | `` |  |
| 4 | `last_name` | text(NO) | ✓ | `` |  |
| 5 | `email` | text(NO) | ✓ | `` |  |
| 6 | `phone` | text(YES) | ✓ | `` |  |
| 7 | `address_1` | text(YES) | ✓ | `` |  |
| 8 | `address_2` | text(YES) | ✓ | `` |  |
| 9 | `city` | text(YES) | ✓ | `` |  |
| 10 | `state_territory` | text(YES) | ✓ | `` |  |
| 11 | `zip_code` | text(YES) | ✓ | `` |  |
| 12 | `country` | text(NO) | ✓ | `` |  |
| 13 | `market` | text(YES) | ✓ | `` |  |
| 14 | `rideshare_platforms` | jsonb(NO) | ✓ | `` |  |
| 15 | `uber_black` | boolean(YES) | ✓ | `` |  |
| 16 | `uber_xxl` | boolean(YES) | ✓ | `` |  |
| 17 | `uber_comfort` | boolean(YES) | ✓ | `` |  |
| 18 | `uber_x` | boolean(YES) | ✓ | `` |  |
| 19 | `uber_x_share` | boolean(YES) | ✓ | `` |  |
| 20 | `marketing_opt_in` | boolean(NO) | ✓ | `` |  |
| 21 | `terms_accepted_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 22 | `terms_version` | text(YES) | ✓ | `` |  |
| 23 | `email_verified` | boolean(YES) | ✓ | `` |  |
| 24 | `phone_verified` | boolean(YES) | ✓ | `` |  |
| 25 | `profile_complete` | boolean(YES) | ✓ | `` |  |
| 26 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 27 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 28 | `home_lat` | double precision(YES) | ✓ | `` |  |
| 29 | `home_lng` | double precision(YES) | ✓ | `` |  |
| 30 | `home_formatted_address` | text(YES) | ✓ | `` |  |
| 31 | `home_timezone` | text(YES) | ✓ | `` |  |
| 32 | `driver_nickname` | text(YES) | ✓ | `` |  |
| 33 | `elig_economy` | boolean(YES) | ✓ | `` |  |
| 34 | `elig_xl` | boolean(YES) | ✓ | `` |  |
| 35 | `elig_xxl` | boolean(YES) | ✓ | `` |  |
| 36 | `elig_comfort` | boolean(YES) | ✓ | `` |  |
| 37 | `elig_luxury_sedan` | boolean(YES) | ✓ | `` |  |
| 38 | `elig_luxury_suv` | boolean(YES) | ✓ | `` |  |
| 39 | `attr_electric` | boolean(YES) | ✓ | `` |  |
| 40 | `attr_green` | boolean(YES) | ✓ | `` |  |
| 41 | `attr_wav` | boolean(YES) | ✓ | `` |  |
| 42 | `attr_ski` | boolean(YES) | ✓ | `` |  |
| 43 | `attr_car_seat` | boolean(YES) | ✓ | `` |  |
| 44 | `pref_pet_friendly` | boolean(YES) | ✓ | `` |  |
| 45 | `pref_teen` | boolean(YES) | ✓ | `` |  |
| 46 | `pref_assist` | boolean(YES) | ✓ | `` |  |
| 47 | `pref_shared` | boolean(YES) | ✓ | `` |  |
| 48 | `terms_accepted` | boolean(NO) | ✓ | `` |  |
| 49 | `google_id` | text(YES) | ✓ | `` |  |
| 50 | `concierge_share_token` | character varying(12) | ✓ | `UNIQUE` |  |
| 51 | `fuel_economy_mpg` | integer(YES) | ✓ | `` |  |
| 52 | `earnings_goal_daily` | numeric(YES) | ✓ | `` |  |
| 53 | `shift_hours_target` | numeric(YES) | ✓ | `` |  |
| 54 | `max_deadhead_mi` | integer(YES) | ✓ | `` |  |
| 55 | `shortcut_token` | character varying(43) | ✓ | `UNIQUE` |  |
| 56 | `shortcut_token_created_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 57 | `shortcut_device_label` | text(YES) | ✓ | `` |  |

## driver_tasks

**Columns:** 17

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `` |  |
| 3 | `title` | text(NO) | ✓ | `` |  |
| 4 | `description` | text(YES) | ✓ | `` |  |
| 5 | `due_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 6 | `duration_minutes` | integer(YES) | ✓ | `` |  |
| 7 | `location` | text(YES) | ✓ | `` |  |
| 8 | `place_id` | text(YES) | ✓ | `` |  |
| 9 | `lat` | double precision(YES) | ✓ | `` |  |
| 10 | `lng` | double precision(YES) | ✓ | `` |  |
| 11 | `is_hard_stop` | boolean(YES) | ✓ | `` |  |
| 12 | `priority` | integer(YES) | ✓ | `` |  |
| 13 | `is_complete` | boolean(YES) | ✓ | `` |  |
| 14 | `completed_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 15 | `recurrence` | text(YES) | ✓ | `` |  |
| 16 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 17 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## driver_vehicles

**Columns:** 12

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `driver_profile_id` | uuid(NO) | ✓ | `` |  |
| 3 | `year` | integer(NO) | ✓ | `` |  |
| 4 | `make` | text(NO) | ✓ | `` |  |
| 5 | `model` | text(NO) | ✓ | `` |  |
| 6 | `color` | text(YES) | ✓ | `` |  |
| 7 | `license_plate` | text(YES) | ✓ | `` |  |
| 8 | `seatbelts` | integer(NO) | ✓ | `` |  |
| 9 | `is_primary` | boolean(YES) | ✓ | `` |  |
| 10 | `is_active` | boolean(YES) | ✓ | `` |  |
| 11 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 12 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## eidolon_memory

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `scope` | text(NO) | ✓ | `` |  |
| 3 | `key` | text(NO) | ✓ | `` |  |
| 4 | `user_id` | uuid(YES) | ✓ | `` |  |
| 5 | `content` | text(NO) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `expires_at` | timestamp with time zone(YES) | ✓ | `` |  |

## eidolon_snapshots

**Columns:** 10

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `snapshot_id` | uuid(YES) | ✓ | `` |  |
| 3 | `user_id` | uuid(YES) | ✓ | `` |  |
| 4 | `session_id` | text(YES) | ✓ | `` |  |
| 5 | `scope` | text(NO) | ✓ | `` |  |
| 6 | `state` | jsonb(NO) | ✓ | `` |  |
| 7 | `metadata` | jsonb(YES) | ✓ | `` |  |
| 8 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 9 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 10 | `expires_at` | timestamp with time zone(YES) | ✓ | `` |  |

## http_idem

**Columns:** 4

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `key` | text(NO) | ✓ | `` |  |
| 2 | `status` | integer(NO) | ✓ | `` |  |
| 3 | `body` | jsonb(NO) | ✓ | `` |  |
| 4 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |

## intercepted_signals

**Columns:** 16

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `device_id` | character varying(255) | ✗ | `` |  |
| 3 | `user_id` | uuid(YES) | ✓ | `` |  |
| 4 | `raw_text` | text(NO) | ✓ | `` |  |
| 5 | `parsed_data` | jsonb(YES) | ✓ | `` |  |
| 6 | `decision` | text(NO) | ✓ | `` |  |
| 7 | `decision_reasoning` | text(YES) | ✓ | `` |  |
| 8 | `confidence_score` | double precision(YES) | ✓ | `` |  |
| 9 | `user_override` | text(YES) | ✓ | `` |  |
| 10 | `source` | character varying(50) | ✗ | `'siri_shortcut'::chara...` |  |
| 11 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 12 | `latitude` | double precision(YES) | ✓ | `` |  |
| 13 | `longitude` | double precision(YES) | ✓ | `` |  |
| 14 | `market` | character varying(100) | ✓ | `` |  |
| 15 | `platform` | character varying(20) | ✓ | `` |  |
| 16 | `response_time_ms` | integer(YES) | ✓ | `` |  |

## lessons_learned

**Columns:** 6

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | integer(NO) | ✓ | `PK` |  |
| 2 | `lesson` | text(NO) | ✓ | `` |  |
| 3 | `trigger` | text(YES) | ✓ | `` |  |
| 4 | `rule` | text(YES) | ✓ | `` |  |
| 5 | `severity` | text(YES) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |

## llm_venue_suggestions

**Columns:** 13

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `suggestion_id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `suggested_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 3 | `model_name` | text(NO) | ✓ | `` |  |
| 4 | `ranking_id` | uuid(YES) | ✓ | `` |  |
| 5 | `venue_name` | text(NO) | ✓ | `` |  |
| 6 | `suggested_category` | text(YES) | ✓ | `` |  |
| 7 | `llm_reasoning` | text(YES) | ✓ | `` |  |
| 8 | `validation_status` | text(NO) | ✓ | `` |  |
| 9 | `place_id_found` | text(YES) | ✓ | `` |  |
| 10 | `venue_id_created` | uuid(YES) | ✓ | `` |  |
| 11 | `validated_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 12 | `rejection_reason` | text(YES) | ✓ | `` |  |
| 13 | `llm_analysis` | jsonb(YES) | ✓ | `` |  |

## market_cities

**Columns:** 12

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `state` | text(NO) | ✓ | `` |  |
| 3 | `state_abbr` | text(YES) | ✓ | `` |  |
| 4 | `city` | text(NO) | ✓ | `` |  |
| 5 | `market_name` | text(NO) | ✓ | `` |  |
| 6 | `region_type` | text(NO) | ✓ | `` |  |
| 7 | `source_ref` | text(YES) | ✓ | `` |  |
| 8 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 9 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 10 | `timezone` | text(YES) | ✓ | `` |  |
| 11 | `market_slug` | text(NO) | ✓ | `` |  |
| 12 | `country_code` | character varying(2) | ✗ | `'US'::character varying` |  |

## market_intel

**Columns:** 19

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `market_name` | text(NO) | ✓ | `` |  |
| 3 | `intel_type` | text(NO) | ✓ | `` |  |
| 4 | `title` | text(NO) | ✓ | `` |  |
| 5 | `content` | text(NO) | ✓ | `` |  |
| 6 | `insight_data` | jsonb(YES) | ✓ | `` |  |
| 7 | `valid_from` | timestamp with time zone(YES) | ✓ | `` |  |
| 8 | `valid_until` | timestamp with time zone(YES) | ✓ | `` |  |
| 9 | `day_of_week` | text(YES) | ✓ | `` |  |
| 10 | `time_of_day` | text(YES) | ✓ | `` |  |
| 11 | `source` | text(NO) | ✓ | `` |  |
| 12 | `source_model` | text(YES) | ✓ | `` |  |
| 13 | `contributed_by` | uuid(YES) | ✓ | `` |  |
| 14 | `priority` | integer(NO) | ✓ | `` |  |
| 15 | `confidence_score` | double precision(YES) | ✓ | `` |  |
| 16 | `is_active` | boolean(NO) | ✓ | `` |  |
| 17 | `view_count` | integer(NO) | ✓ | `` |  |
| 18 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 19 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## market_intelligence

**Columns:** 29

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `market` | text(NO) | ✓ | `` |  |
| 3 | `market_slug` | text(NO) | ✓ | `` |  |
| 4 | `platform` | text(NO) | ✓ | `` |  |
| 5 | `intel_type` | text(NO) | ✓ | `` |  |
| 6 | `intel_subtype` | text(YES) | ✓ | `` |  |
| 7 | `title` | text(NO) | ✓ | `` |  |
| 8 | `summary` | text(YES) | ✓ | `` |  |
| 9 | `content` | text(NO) | ✓ | `` |  |
| 10 | `neighborhoods` | jsonb(YES) | ✓ | `` |  |
| 11 | `boundaries` | jsonb(YES) | ✓ | `` |  |
| 12 | `time_context` | jsonb(YES) | ✓ | `` |  |
| 13 | `tags` | jsonb(YES) | ✓ | `` |  |
| 14 | `priority` | integer(YES) | ✓ | `` |  |
| 15 | `source` | text(NO) | ✓ | `` |  |
| 16 | `source_file` | text(YES) | ✓ | `` |  |
| 17 | `source_section` | text(YES) | ✓ | `` |  |
| 18 | `confidence` | integer(YES) | ✓ | `` |  |
| 19 | `version` | integer(YES) | ✓ | `` |  |
| 20 | `effective_date` | timestamp with time zone(YES) | ✓ | `` |  |
| 21 | `expiry_date` | timestamp with time zone(YES) | ✓ | `` |  |
| 22 | `is_active` | boolean(YES) | ✓ | `` |  |
| 23 | `is_verified` | boolean(YES) | ✓ | `` |  |
| 24 | `coach_can_cite` | boolean(YES) | ✓ | `` |  |
| 25 | `coach_priority` | integer(YES) | ✓ | `` |  |
| 26 | `created_by` | text(NO) | ✓ | `` |  |
| 27 | `updated_by` | text(YES) | ✓ | `` |  |
| 28 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 29 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## markets

**Columns:** 15

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `market_slug` | text(NO) | ✓ | `` |  |
| 2 | `market_name` | text(NO) | ✓ | `` |  |
| 3 | `primary_city` | text(NO) | ✓ | `` |  |
| 4 | `state` | text(NO) | ✓ | `` |  |
| 5 | `country_code` | character varying(2) | ✗ | `'US'::character varying` |  |
| 6 | `timezone` | text(NO) | ✓ | `` |  |
| 7 | `primary_airport_code` | text(YES) | ✓ | `` |  |
| 8 | `secondary_airports` | jsonb(YES) | ✓ | `` |  |
| 9 | `city_aliases` | jsonb(YES) | ✓ | `` |  |
| 10 | `has_uber` | boolean(NO) | ✓ | `` |  |
| 11 | `has_lyft` | boolean(NO) | ✓ | `` |  |
| 12 | `is_active` | boolean(NO) | ✓ | `` |  |
| 13 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 14 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 15 | `state_abbr` | character varying(5) | ✓ | `` |  |

## news_deactivations

**Columns:** 9

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `` |  |
| 3 | `news_hash` | text(NO) | ✓ | `` |  |
| 4 | `news_title` | text(NO) | ✓ | `` |  |
| 5 | `news_source` | text(YES) | ✓ | `` |  |
| 6 | `reason` | text(NO) | ✓ | `` |  |
| 7 | `deactivated_by` | text(NO) | ✓ | `` |  |
| 8 | `scope` | text(YES) | ✓ | `` |  |
| 9 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |

## oauth_states

**Columns:** 7

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `state` | text(NO) | ✓ | `` |  |
| 3 | `provider` | text(NO) | ✓ | `` |  |
| 4 | `user_id` | uuid(NO) | ✓ | `` |  |
| 5 | `redirect_uri` | text(YES) | ✓ | `` |  |
| 6 | `expires_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |

## offer_intelligence

**Columns:** 54

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `device_id` | character varying(255) | ✗ | `` |  |
| 3 | `user_id` | uuid(YES) | ✓ | `` |  |
| 4 | `price` | double precision(YES) | ✓ | `` |  |
| 5 | `per_mile` | double precision(YES) | ✓ | `` |  |
| 6 | `per_minute` | double precision(YES) | ✓ | `` |  |
| 7 | `hourly_rate` | double precision(YES) | ✓ | `` |  |
| 8 | `surge` | double precision(YES) | ✓ | `` |  |
| 9 | `advantage_pct` | integer(YES) | ✓ | `` |  |
| 10 | `pickup_minutes` | integer(YES) | ✓ | `` |  |
| 11 | `pickup_miles` | double precision(YES) | ✓ | `` |  |
| 12 | `ride_minutes` | integer(YES) | ✓ | `` |  |
| 13 | `ride_miles` | double precision(YES) | ✓ | `` |  |
| 14 | `total_miles` | double precision(YES) | ✓ | `` |  |
| 15 | `total_minutes` | integer(YES) | ✓ | `` |  |
| 16 | `product_type` | character varying(50) | ✓ | `` |  |
| 17 | `platform` | character varying(20) | ✗ | `'unknown'::character v...` |  |
| 18 | `pickup_address` | text(YES) | ✓ | `` |  |
| 19 | `dropoff_address` | text(YES) | ✓ | `` |  |
| 20 | `pickup_lat` | double precision(YES) | ✓ | `` |  |
| 21 | `pickup_lng` | double precision(YES) | ✓ | `` |  |
| 22 | `dropoff_lat` | double precision(YES) | ✓ | `` |  |
| 23 | `dropoff_lng` | double precision(YES) | ✓ | `` |  |
| 24 | `geocoded_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 25 | `driver_lat` | double precision(YES) | ✓ | `` |  |
| 26 | `driver_lng` | double precision(YES) | ✓ | `` |  |
| 27 | `coord_key` | text(YES) | ✓ | `` |  |
| 28 | `h3_index` | text(YES) | ✓ | `` |  |
| 29 | `market` | character varying(100) | ✓ | `` |  |
| 30 | `local_date` | text(YES) | ✓ | `` |  |
| 31 | `local_hour` | integer(YES) | ✓ | `` |  |
| 32 | `day_of_week` | integer(YES) | ✓ | `` |  |
| 33 | `day_part` | text(YES) | ✓ | `` |  |
| 34 | `is_weekend` | boolean(YES) | ✓ | `` |  |
| 35 | `timezone` | text(YES) | ✓ | `` |  |
| 36 | `decision` | text(NO) | ✓ | `` |  |
| 37 | `decision_reasoning` | text(YES) | ✓ | `` |  |
| 38 | `confidence_score` | integer(YES) | ✓ | `` |  |
| 39 | `ai_model` | text(YES) | ✓ | `` |  |
| 40 | `response_time_ms` | integer(YES) | ✓ | `` |  |
| 41 | `user_override` | text(YES) | ✓ | `` |  |
| 42 | `offer_session_id` | uuid(YES) | ✓ | `` |  |
| 43 | `offer_sequence_num` | integer(YES) | ✓ | `` |  |
| 44 | `seconds_since_last` | integer(YES) | ✓ | `` |  |
| 45 | `parse_confidence` | character varying(20) | ✓ | `` |  |
| 46 | `source` | character varying(50) | ✗ | `'siri_shortcut'::chara...` |  |
| 47 | `input_mode` | character varying(20) | ✗ | `'text'::character varying` |  |
| 48 | `raw_text` | text(YES) | ✓ | `` |  |
| 49 | `raw_ai_response` | text(YES) | ✓ | `` |  |
| 50 | `parsed_data_json` | jsonb(YES) | ✓ | `` |  |
| 51 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 52 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 53 | `ruleset_version` | integer(YES) | ✓ | `` |  |
| 54 | `ruleset_hash` | text(YES) | ✓ | `` |  |

## offer_outcomes

**Columns:** 13

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `` |  |
| 3 | `offer_intelligence_id` | uuid(YES) | ✓ | `` |  |
| 4 | `driver_decision` | text(YES) | ✓ | `` |  |
| 5 | `driver_reasoning` | text(YES) | ✓ | `` |  |
| 6 | `actual_pay` | double precision(YES) | ✓ | `` |  |
| 7 | `reimbursements` | double precision(YES) | ✓ | `` |  |
| 8 | `extras` | double precision(YES) | ✓ | `` |  |
| 9 | `other` | double precision(YES) | ✓ | `` |  |
| 10 | `total_earned` | double precision(YES) | ✓ | `` |  |
| 11 | `outcome_source` | text(NO) | ✓ | `` |  |
| 12 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 13 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## offer_rulesets

**Columns:** 7

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 3 | `version` | integer(NO) | ✓ | `` |  |
| 4 | `config` | jsonb(NO) | ✓ | `` |  |
| 5 | `config_hash` | text(NO) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## places_cache

**Columns:** 4

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `coords_key` | text(NO) | ✓ | `` |  |
| 2 | `formatted_hours` | jsonb(YES) | ✓ | `` |  |
| 3 | `cached_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 4 | `access_count` | integer(NO) | ✓ | `` |  |

## platform_data

**Columns:** 16

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `country` | text(NO) | ✓ | `` |  |
| 3 | `city` | text(NO) | ✓ | `` |  |
| 4 | `platform` | text(NO) | ✓ | `` |  |
| 5 | `coord_boundary` | jsonb(YES) | ✓ | `` |  |
| 6 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `country_code` | text(YES) | ✓ | `` |  |
| 9 | `region` | text(YES) | ✓ | `` |  |
| 10 | `market` | text(YES) | ✓ | `` |  |
| 11 | `timezone` | text(YES) | ✓ | `` |  |
| 12 | `center_lat` | double precision(YES) | ✓ | `` |  |
| 13 | `center_lng` | double precision(YES) | ✓ | `` |  |
| 14 | `is_active` | boolean(NO) | ✓ | `` |  |
| 15 | `market_anchor` | text(YES) | ✓ | `` |  |
| 16 | `region_type` | text(YES) | ✓ | `` |  |

## ranking_candidates

**Columns:** 46

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `` |  |
| 2 | `ranking_id` | uuid(NO) | ✓ | `` |  |
| 3 | `block_id` | text(NO) | ✓ | `` |  |
| 4 | `name` | text(NO) | ✓ | `` |  |
| 5 | `lat` | double precision(NO) | ✓ | `` |  |
| 6 | `lng` | double precision(NO) | ✓ | `` |  |
| 7 | `drive_time_min` | integer(YES) | ✓ | `` |  |
| 8 | `straight_line_km` | double precision(YES) | ✓ | `` |  |
| 9 | `est_earnings_per_ride` | double precision(YES) | ✓ | `` |  |
| 10 | `model_score` | double precision(YES) | ✓ | `` |  |
| 11 | `rank` | integer(NO) | ✓ | `` |  |
| 12 | `exploration_policy` | text(NO) | ✓ | `` |  |
| 13 | `epsilon` | double precision(YES) | ✓ | `` |  |
| 14 | `was_forced` | boolean(YES) | ✓ | `` |  |
| 15 | `propensity` | double precision(YES) | ✓ | `` |  |
| 16 | `features` | jsonb(YES) | ✓ | `` |  |
| 17 | `h3_r8` | text(YES) | ✓ | `` |  |
| 18 | `distance_miles` | double precision(YES) | ✓ | `` |  |
| 19 | `drive_minutes` | integer(YES) | ✓ | `` |  |
| 20 | `value_per_min` | double precision(YES) | ✓ | `` |  |
| 21 | `value_grade` | text(YES) | ✓ | `` |  |
| 22 | `not_worth` | boolean(YES) | ✓ | `` |  |
| 23 | `rate_per_min_used` | double precision(YES) | ✓ | `` |  |
| 24 | `trip_minutes_used` | integer(YES) | ✓ | `` |  |
| 25 | `wait_minutes_used` | integer(YES) | ✓ | `` |  |
| 26 | `snapshot_id` | uuid(YES) | ✓ | `` |  |
| 27 | `place_id` | text(YES) | ✓ | `` |  |
| 28 | `estimated_distance_miles` | double precision(YES) | ✓ | `` |  |
| 29 | `drive_time_minutes` | integer(YES) | ✓ | `` |  |
| 30 | `distance_source` | text(YES) | ✓ | `` |  |
| 31 | `pro_tips` | ARRAY(YES) | ✓ | `` |  |
| 32 | `closed_reasoning` | text(YES) | ✓ | `` |  |
| 33 | `staging_tips` | text(YES) | ✓ | `` |  |
| 34 | `staging_name` | text(YES) | ✓ | `` |  |
| 35 | `staging_lat` | double precision(YES) | ✓ | `` |  |
| 36 | `staging_lng` | double precision(YES) | ✓ | `` |  |
| 37 | `business_hours` | jsonb(YES) | ✓ | `` |  |
| 38 | `venue_events` | jsonb(YES) | ✓ | `` |  |
| 39 | `event_badge_missing` | boolean(YES) | ✓ | `` |  |
| 40 | `node_type` | text(YES) | ✓ | `` |  |
| 41 | `access_status` | text(YES) | ✓ | `` |  |
| 42 | `aliases` | ARRAY(YES) | ✓ | `` |  |
| 43 | `district` | text(YES) | ✓ | `` |  |
| 44 | `venue_id` | uuid(YES) | ✓ | `` |  |
| 45 | `beyond_deadhead` | boolean(YES) | ✓ | `` |  |
| 46 | `distance_from_home_mi` | double precision(YES) | ✓ | `` |  |

## rankings

**Columns:** 15

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `ranking_id` | uuid(NO) | ✓ | `` |  |
| 2 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 3 | `snapshot_id` | uuid(YES) | ✓ | `` |  |
| 4 | `user_id` | uuid(YES) | ✓ | `` |  |
| 5 | `city` | text(YES) | ✓ | `` |  |
| 6 | `ui` | jsonb(YES) | ✓ | `` |  |
| 7 | `model_name` | text(NO) | ✓ | `` |  |
| 8 | `correlation_id` | uuid(YES) | ✓ | `` |  |
| 9 | `scoring_ms` | integer(YES) | ✓ | `` |  |
| 10 | `planner_ms` | integer(YES) | ✓ | `` |  |
| 11 | `total_ms` | integer(YES) | ✓ | `` |  |
| 12 | `timed_out` | boolean(YES) | ✓ | `` |  |
| 13 | `path_taken` | text(YES) | ✓ | `` |  |
| 14 | `formatted_address` | text(YES) | ✓ | `` |  |
| 15 | `state` | text(YES) | ✓ | `` |  |

## safe_zones

**Columns:** 16

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `` |  |
| 3 | `zone_name` | text(NO) | ✓ | `` |  |
| 4 | `zone_type` | text(NO) | ✓ | `` |  |
| 5 | `geometry` | text(YES) | ✓ | `` |  |
| 6 | `center_lat` | double precision(YES) | ✓ | `` |  |
| 7 | `center_lng` | double precision(YES) | ✓ | `` |  |
| 8 | `radius_miles` | double precision(YES) | ✓ | `` |  |
| 9 | `neighborhoods` | text(YES) | ✓ | `` |  |
| 10 | `risk_level` | integer(YES) | ✓ | `` |  |
| 11 | `risk_notes` | text(YES) | ✓ | `` |  |
| 12 | `is_active` | boolean(YES) | ✓ | `` |  |
| 13 | `applies_at_night` | boolean(YES) | ✓ | `` |  |
| 14 | `applies_at_day` | boolean(YES) | ✓ | `` |  |
| 15 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 16 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## schema_migrations

**Columns:** 4

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `filename` | text(NO) | ✓ | `` |  |
| 2 | `checksum` | text(NO) | ✓ | `` |  |
| 3 | `baseline` | boolean(NO) | ✓ | `` |  |
| 4 | `applied_at` | timestamp with time zone(NO) | ✓ | `` |  |

## snapshots

**Columns:** 23

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `snapshot_id` | uuid(NO) | ✓ | `` |  |
| 2 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 4 | `session_id` | uuid(NO) | ✓ | `` |  |
| 5 | `h3_r8` | text(YES) | ✓ | `` |  |
| 6 | `weather` | jsonb(YES) | ✓ | `` |  |
| 7 | `air` | jsonb(YES) | ✓ | `` |  |
| 8 | `permissions` | jsonb(YES) | ✓ | `` |  |
| 11 | `lat` | double precision(NO) | ✓ | `` |  |
| 12 | `lng` | double precision(NO) | ✓ | `` |  |
| 13 | `city` | text(NO) | ✓ | `` |  |
| 14 | `state` | text(NO) | ✓ | `` |  |
| 15 | `country` | text(NO) | ✓ | `` |  |
| 16 | `formatted_address` | text(NO) | ✓ | `` |  |
| 17 | `timezone` | text(NO) | ✓ | `` |  |
| 18 | `local_iso` | timestamp without time zone(NO) | ✓ | `` |  |
| 19 | `dow` | integer(NO) | ✓ | `` |  |
| 20 | `hour` | integer(NO) | ✓ | `` |  |
| 21 | `day_part_key` | text(NO) | ✓ | `` |  |
| 22 | `date` | text(NO) | ✓ | `` |  |
| 23 | `coord_key` | text(YES) | ✓ | `` |  |
| 24 | `user_id` | uuid(YES) | ✓ | `` |  |
| 25 | `market` | text(YES) | ✓ | `` |  |
| 26 | `status` | text(YES) | ✓ | `` |  |

## staging_saturation

**Columns:** 10

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `h3_cell` | text(NO) | ✓ | `` |  |
| 3 | `venue_name` | text(YES) | ✓ | `` |  |
| 4 | `window_start` | timestamp with time zone(NO) | ✓ | `` |  |
| 5 | `window_end` | timestamp with time zone(NO) | ✓ | `` |  |
| 6 | `suggestion_count` | integer(NO) | ✓ | `` |  |
| 7 | `active_drivers` | integer(YES) | ✓ | `` |  |
| 8 | `market_slug` | text(YES) | ✓ | `` |  |
| 9 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 10 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## strategies

**Columns:** 11

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `snapshot_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 3 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 4 | `status` | text(NO) | ✓ | `` |  |
| 5 | `error_message` | text(YES) | ✓ | `` |  |
| 6 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 7 | `strategy_for_now` | text(YES) | ✓ | `` |  |
| 8 | `user_id` | uuid(YES) | ✓ | `` |  |
| 10 | `phase` | text(YES) | ✓ | `` |  |
| 11 | `phase_started_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 12 | `venue_cache_metrics` | jsonb(YES) | ✓ | `` |  |

## strategy_feedback

**Columns:** 10

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(YES) | ✓ | `` |  |
| 3 | `snapshot_id` | uuid(NO) | ✓ | `` |  |
| 4 | `ranking_id` | uuid(NO) | ✓ | `` |  |
| 5 | `sentiment` | text(NO) | ✓ | `` |  |
| 6 | `comment` | text(YES) | ✓ | `` |  |
| 7 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `formatted_address` | text(YES) | ✓ | `` |  |
| 9 | `city` | text(YES) | ✓ | `` |  |
| 10 | `state` | text(YES) | ✓ | `` |  |

## todo

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | integer(NO) | ✓ | `PK` |  |
| 2 | `title` | text(NO) | ✓ | `` |  |
| 3 | `detail` | text(YES) | ✓ | `` |  |
| 4 | `status` | text(NO) | ✓ | `` |  |
| 5 | `priority` | integer(YES) | ✓ | `` |  |
| 6 | `source_memory_id` | integer(YES) | ✓ | `` |  |
| 7 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## traffic_zones

**Columns:** 13

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `lat` | double precision(NO) | ✓ | `` |  |
| 3 | `lng` | double precision(NO) | ✓ | `` |  |
| 4 | `city` | text(YES) | ✓ | `` |  |
| 5 | `state` | text(YES) | ✓ | `` |  |
| 6 | `traffic_density` | integer(YES) | ✓ | `` |  |
| 7 | `density_level` | text(YES) | ✓ | `` |  |
| 8 | `congestion_areas` | jsonb(YES) | ✓ | `` |  |
| 9 | `high_demand_zones` | jsonb(YES) | ✓ | `` |  |
| 10 | `driver_advice` | text(YES) | ✓ | `` |  |
| 11 | `sources` | jsonb(YES) | ✓ | `` |  |
| 12 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 13 | `expires_at` | timestamp with time zone(YES) | ✓ | `` |  |

## travel_disruptions

**Columns:** 14

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `country_code` | text(NO) | ✓ | `` |  |
| 3 | `airport_code` | text(NO) | ✓ | `` |  |
| 4 | `airport_name` | text(YES) | ✓ | `` |  |
| 5 | `delay_minutes` | integer(YES) | ✓ | `` |  |
| 6 | `ground_stops` | jsonb(YES) | ✓ | `` |  |
| 7 | `ground_delay_programs` | jsonb(YES) | ✓ | `` |  |
| 8 | `closure_status` | text(YES) | ✓ | `` |  |
| 9 | `delay_reason` | text(YES) | ✓ | `` |  |
| 10 | `ai_summary` | text(YES) | ✓ | `` |  |
| 11 | `impact_level` | text(YES) | ✓ | `` |  |
| 12 | `data_source` | text(NO) | ✓ | `` |  |
| 13 | `last_updated` | timestamp with time zone(NO) | ✓ | `` |  |
| 14 | `next_update_at` | timestamp with time zone(YES) | ✓ | `` |  |

## triad_jobs

**Columns:** 8

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `snapshot_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 3 | `kind` | text(NO) | ✓ | `` |  |
| 4 | `status` | text(NO) | ✓ | `` |  |
| 5 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 6 | `formatted_address` | text(YES) | ✓ | `` |  |
| 7 | `city` | text(YES) | ✓ | `` |  |
| 8 | `state` | text(YES) | ✓ | `` |  |

## uber_connections

**Columns:** 11

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(NO) | ✓ | `UNIQUE` |  |
| 3 | `access_token_encrypted` | text(NO) | ✓ | `` |  |
| 4 | `refresh_token_encrypted` | text(YES) | ✓ | `` |  |
| 5 | `token_expires_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 6 | `scopes` | ARRAY(YES) | ✓ | `` |  |
| 7 | `is_active` | boolean(YES) | ✓ | `` |  |
| 8 | `connected_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 9 | `last_sync_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 10 | `created_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 11 | `updated_at` | timestamp with time zone(YES) | ✓ | `` |  |

## user_intel_notes

**Columns:** 21

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(YES) | ✓ | `` |  |
| 3 | `snapshot_id` | uuid(YES) | ✓ | `` |  |
| 4 | `note_type` | text(NO) | ✓ | `` |  |
| 5 | `category` | text(YES) | ✓ | `` |  |
| 6 | `title` | text(YES) | ✓ | `` |  |
| 7 | `content` | text(NO) | ✓ | `` |  |
| 8 | `context` | text(YES) | ✓ | `` |  |
| 9 | `market_slug` | text(YES) | ✓ | `` |  |
| 10 | `neighborhoods` | jsonb(YES) | ✓ | `` |  |
| 11 | `importance` | integer(YES) | ✓ | `` |  |
| 12 | `confidence` | integer(YES) | ✓ | `` |  |
| 13 | `times_referenced` | integer(YES) | ✓ | `` |  |
| 14 | `valid_from` | timestamp with time zone(YES) | ✓ | `` |  |
| 15 | `valid_until` | timestamp with time zone(YES) | ✓ | `` |  |
| 16 | `is_active` | boolean(YES) | ✓ | `` |  |
| 17 | `is_pinned` | boolean(YES) | ✓ | `` |  |
| 18 | `source_message_id` | text(YES) | ✓ | `` |  |
| 19 | `created_by` | text(NO) | ✓ | `` |  |
| 20 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 21 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## users

**Columns:** 7

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `user_id` | uuid(NO) | ✓ | `PK` |  |
| 3 | `session_id` | uuid(YES) | ✓ | `` |  |
| 4 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 5 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 6 | `current_snapshot_id` | uuid(YES) | ✓ | `` |  |
| 7 | `session_start_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `last_active_at` | timestamp with time zone(NO) | ✓ | `` |  |

## vehicle_makes_cache

**Columns:** 5

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `make_id` | integer(NO) | ✓ | `` |  |
| 3 | `make_name` | text(NO) | ✓ | `` |  |
| 4 | `is_common` | boolean(YES) | ✓ | `` |  |
| 5 | `cached_at` | timestamp with time zone(NO) | ✓ | `` |  |

## vehicle_models_cache

**Columns:** 7

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `make_id` | integer(NO) | ✓ | `` |  |
| 3 | `make_name` | text(NO) | ✓ | `` |  |
| 4 | `model_id` | integer(NO) | ✓ | `` |  |
| 5 | `model_name` | text(NO) | ✓ | `` |  |
| 6 | `model_year` | integer(YES) | ✓ | `` |  |
| 7 | `cached_at` | timestamp with time zone(NO) | ✓ | `` |  |

## venue_catalog

**Columns:** 53

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `venue_id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `place_id` | text(YES) | ✓ | `` |  |
| 3 | `venue_name` | character varying(500) | ✗ | `` |  |
| 4 | `address` | character varying(500) | ✗ | `` |  |
| 5 | `lat` | double precision(YES) | ✓ | `` |  |
| 6 | `lng` | double precision(YES) | ✓ | `` |  |
| 7 | `category` | text(NO) | ✓ | `` |  |
| 8 | `staging_notes` | jsonb(YES) | ✓ | `` |  |
| 9 | `city` | text(YES) | ✓ | `` |  |
| 10 | `metro` | text(YES) | ✓ | `` |  |
| 11 | `ai_estimated_hours` | text(YES) | ✓ | `` |  |
| 12 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 13 | `business_hours` | jsonb(YES) | ✓ | `` |  |
| 14 | `discovery_source` | text(NO) | ✓ | `` |  |
| 15 | `validated_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 16 | `suggestion_metadata` | jsonb(YES) | ✓ | `` |  |
| 17 | `dayparts` | ARRAY(YES) | ✓ | `` |  |
| 18 | `last_known_status` | text(YES) | ✓ | `` |  |
| 19 | `status_checked_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 20 | `consecutive_closed_checks` | integer(YES) | ✓ | `` |  |
| 21 | `auto_suppressed` | boolean(YES) | ✓ | `` |  |
| 22 | `suppression_reason` | text(YES) | ✓ | `` |  |
| 23 | `district` | text(YES) | ✓ | `` |  |
| 24 | `district_slug` | text(YES) | ✓ | `` |  |
| 25 | `district_centroid_lat` | double precision(YES) | ✓ | `` |  |
| 26 | `district_centroid_lng` | double precision(YES) | ✓ | `` |  |
| 27 | `state` | text(YES) | ✓ | `` |  |
| 28 | `address_1` | text(YES) | ✓ | `` |  |
| 29 | `address_2` | text(YES) | ✓ | `` |  |
| 30 | `zip` | text(YES) | ✓ | `` |  |
| 31 | `country` | text(YES) | ✓ | `` |  |
| 32 | `formatted_address` | text(YES) | ✓ | `` |  |
| 33 | `normalized_name` | text(YES) | ✓ | `` |  |
| 34 | `coord_key` | text(YES) | ✓ | `` |  |
| 35 | `venue_types` | jsonb(YES) | ✓ | `` |  |
| 36 | `market_slug` | text(YES) | ✓ | `` |  |
| 37 | `expense_rank` | integer(YES) | ✓ | `` |  |
| 38 | `hours_full_week` | jsonb(YES) | ✓ | `` |  |
| 39 | `crowd_level` | text(YES) | ✓ | `` |  |
| 40 | `rideshare_potential` | text(YES) | ✓ | `` |  |
| 41 | `hours_source` | text(YES) | ✓ | `` |  |
| 42 | `capacity_estimate` | integer(YES) | ✓ | `` |  |
| 43 | `source` | text(YES) | ✓ | `` |  |
| 45 | `access_count` | integer(YES) | ✓ | `` |  |
| 46 | `last_accessed_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 47 | `updated_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 48 | `is_bar` | boolean(NO) | ✓ | `` |  |
| 49 | `is_event_venue` | boolean(NO) | ✓ | `` |  |
| 50 | `record_status` | text(NO) | ✓ | `` |  |
| 51 | `timezone` | text(YES) | ✓ | `` |  |
| 52 | `google_rating` | double precision(YES) | ✓ | `` |  |
| 53 | `phone_number` | text(YES) | ✓ | `` |  |
| 54 | `venue_quality_tier` | text(YES) | ✓ | `` |  |

## venue_events

**Columns:** 12

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `venue_id` | uuid(YES) | ✓ | `` |  |
| 3 | `place_id` | text(YES) | ✓ | `` |  |
| 4 | `title` | text(NO) | ✓ | `` |  |
| 5 | `starts_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 6 | `ends_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 7 | `lat` | double precision(YES) | ✓ | `` |  |
| 8 | `lng` | double precision(YES) | ✓ | `` |  |
| 9 | `source` | text(NO) | ✓ | `` |  |
| 10 | `radius_m` | integer(YES) | ✓ | `` |  |
| 11 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 12 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

## venue_feedback

**Columns:** 12

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(YES) | ✓ | `` |  |
| 3 | `snapshot_id` | uuid(NO) | ✓ | `` |  |
| 4 | `ranking_id` | uuid(NO) | ✓ | `` |  |
| 5 | `place_id` | text(YES) | ✓ | `` |  |
| 6 | `venue_name` | text(NO) | ✓ | `` |  |
| 7 | `sentiment` | text(NO) | ✓ | `` |  |
| 8 | `comment` | text(YES) | ✓ | `` |  |
| 9 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 10 | `formatted_address` | text(YES) | ✓ | `` |  |
| 11 | `city` | text(YES) | ✓ | `` |  |
| 12 | `state` | text(YES) | ✓ | `` |  |

## venue_metrics

**Columns:** 7

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `venue_id` | uuid(NO) | ✓ | `venue_catalog(venue_id)` |  |
| 2 | `times_recommended` | integer(NO) | ✓ | `` |  |
| 3 | `times_chosen` | integer(NO) | ✓ | `` |  |
| 4 | `positive_feedback` | integer(NO) | ✓ | `` |  |
| 5 | `negative_feedback` | integer(NO) | ✓ | `` |  |
| 6 | `reliability_score` | double precision(NO) | ✓ | `` |  |
| 7 | `last_verified_by_driver` | timestamp with time zone(YES) | ✓ | `` |  |

## verification_codes

**Columns:** 10

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `user_id` | uuid(YES) | ✓ | `` |  |
| 3 | `code` | text(NO) | ✓ | `` |  |
| 4 | `code_type` | text(NO) | ✓ | `` |  |
| 5 | `destination` | text(NO) | ✓ | `` |  |
| 6 | `used_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 7 | `expires_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 8 | `attempts` | integer(YES) | ✓ | `` |  |
| 9 | `max_attempts` | integer(YES) | ✓ | `` |  |
| 10 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |

## zone_intelligence

**Columns:** 22

| # | Column | Type | Null | Default | Constraints |
|--:|--------|------|:----:|---------|-------------|
| 1 | `id` | uuid(NO) | ✓ | `PK` |  |
| 2 | `market_slug` | text(NO) | ✓ | `` |  |
| 3 | `zone_type` | text(NO) | ✓ | `` |  |
| 4 | `zone_name` | text(NO) | ✓ | `` |  |
| 5 | `zone_description` | text(YES) | ✓ | `` |  |
| 6 | `lat` | double precision(YES) | ✓ | `` |  |
| 7 | `lng` | double precision(YES) | ✓ | `` |  |
| 8 | `radius_miles` | double precision(YES) | ✓ | `` |  |
| 9 | `address_hint` | text(YES) | ✓ | `` |  |
| 10 | `time_constraints` | jsonb(YES) | ✓ | `` |  |
| 11 | `is_time_specific` | boolean(YES) | ✓ | `` |  |
| 12 | `reports_count` | integer(YES) | ✓ | `` |  |
| 13 | `confidence_score` | integer(YES) | ✓ | `` |  |
| 14 | `contributing_users` | jsonb(YES) | ✓ | `` |  |
| 15 | `source_conversations` | jsonb(YES) | ✓ | `` |  |
| 16 | `last_reason` | text(YES) | ✓ | `` |  |
| 17 | `last_reported_by` | uuid(YES) | ✓ | `` |  |
| 18 | `last_reported_at` | timestamp with time zone(YES) | ✓ | `` |  |
| 19 | `is_active` | boolean(YES) | ✓ | `` |  |
| 20 | `verified_by_admin` | boolean(YES) | ✓ | `` |  |
| 21 | `created_at` | timestamp with time zone(NO) | ✓ | `` |  |
| 22 | `updated_at` | timestamp with time zone(NO) | ✓ | `` |  |

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔑 PK | Primary Key |
| → table(col) | Foreign Key reference |
| 🔒 UNIQUE | Unique constraint |
| ✓ | Nullable (YES) |
| ✗ | Not Nullable (NO) |

---

*Generated by `scripts/generate-schema-docs.sh`*
