# DB_SCHEMA.md — Database Schema Documentation

> **Canonical reference** for every table, the Drizzle ORM setup, connection management, and query patterns.
> Last updated: 2026-04-14
>
> **Schema rollout exceptions** are tracked in [section 13](#13-migrations). Always check that section before assuming the documented schema matches prod.

## Schema Artifact Trust Tiers

| Tier | Artifact | Trust Level |
|------|----------|-------------|
| **Canonical** | `shared/schema.js` | Always authoritative. The single source of truth for all table definitions. |
| **Operational** | `migrations/` + rollout notes in `pending.md` | Tracks how schema changes are deployed. Check for pending prod migrations. |
| **Deprecated** | `scripts/create-all-tables.sql` | DO NOT use for recovery. Marked deprecated 2026-04-14 (Issue AL). |

## Supersedes
- `docs/architecture/database-schema.md` — Previous schema doc (expanded here with ALL tables)

---

## Table of Contents

1. [Database Configuration](#1-database-configuration)
2. [Core Tables](#2-core-tables)
3. [AI/Strategy Tables](#3-aistrategy-tables)
4. [Venue Tables](#4-venue-tables)
5. [Intelligence Tables](#5-intelligence-tables)
6. [Coach/Memory Tables](#6-coachmemory-tables)
7. [Auth Tables](#7-auth-tables)
8. [Cache Tables](#8-cache-tables)
9. [Feedback Tables](#9-feedback-tables)
10. [Platform/Reference Tables](#10-platformreference-tables)
11. [Drizzle ORM Setup](#11-drizzle-orm-setup)
12. [Connection Pooling](#12-connection-pooling)
13. [Migrations](#13-migrations)
14. [Current State](#14-current-state)
15. [Known Gaps](#15-known-gaps)
16. [TODO — Hardening Work](#16-todo--hardening-work)

---

## 1. Database Configuration

- **Engine:** PostgreSQL 16 (Replit Helium)
- **Connection:** `DATABASE_URL` env var (auto-injected by Replit)
- **Dev vs Prod:** Separate Helium instances. Replit switches automatically.
- **SSL:** `false` for dev, `{ rejectUnauthorized: false }` for prod
- **ORM:** Drizzle ORM (TypeScript type-safe)
- **Schema file:** `shared/schema.js` (2,074 lines)

---

## 2. Core Tables

### `users` — Session Management

| Column | Type | Purpose |
|--------|------|---------|
| `user_id` | UUID PK | Links to driver_profiles |
| `device_id` | text | Device identifier |
| `session_id` | UUID (nullable) | Current session (null = logged out) |
| `current_snapshot_id` | UUID (nullable) | Active snapshot |
| `session_start_at` | timestamp | Session began |
| `last_active_at` | timestamp | Last activity (60-min TTL) |

### `snapshots` — Location Context

| Column | Type | Purpose |
|--------|------|---------|
| `snapshot_id` | UUID PK | Unique identifier |
| `user_id` | UUID FK → users | Owner |
| `lat`, `lng` | double | GPS coordinates |
| `coord_key` | text | 6-decimal dedup key |
| `city`, `state`, `country` | text | Resolved location |
| `formatted_address` | text | Full address (CRITICAL for LLM) |
| `timezone` | text | IANA timezone |
| `market` | text (nullable) | Market name |
| `local_iso` | timestamp w/o tz | Driver's wall-clock time |
| `dow`, `hour`, `day_part_key` | int/text | Time context |
| `weather`, `air` | jsonb | Enriched data |
| `holiday`, `is_holiday` | text/boolean | Holiday info |

---

## 3. AI/Strategy Tables

### `strategies` — 1:1 with snapshots

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Row ID |
| `snapshot_id` | UUID FK (unique, cascade) | One strategy per snapshot |
| `status` | text | pending → running → ok / failed |
| `phase` | text | Pipeline phase |
| `strategy_for_now` | text | 1-hour tactical (NOW) — single live strategy output |
| `consolidated_strategy` | text | unused |

### `briefings` — 1:1 with snapshots

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Row ID |
| `snapshot_id` | UUID FK (unique, cascade) | One briefing per snapshot |
| `news` | jsonb | Rideshare news items |
| `weather_current`, `weather_forecast` | jsonb | Weather data |
| `traffic_conditions` | jsonb | Traffic analysis |
| `events` | jsonb | Local events |
| `school_closures` | jsonb | School closure data |
| `airport_conditions` | jsonb | Airport status |

### `rankings` — SmartBlocks Session

| Column | Type | Key Fields |
|--------|------|-----------|
| `ranking_id` | UUID PK | Session identifier |
| `snapshot_id` | UUID FK | Links to snapshot |
| `model_name` | text | AI model used |
| `planner_ms`, `total_ms` | integer | Latency |

### `ranking_candidates` — Individual Venues

| Column | Type | Key Fields |
|--------|------|-----------|
| `id` | UUID PK | Candidate ID |
| `ranking_id` | UUID FK (cascade) | Session link |
| `venue_id` | UUID FK (set null) | Canonical venue |
| `name`, `lat`, `lng`, `rank` | various | Identity + position |
| `value_per_min`, `value_grade` | numeric/text | Earnings |
| `pro_tips`, `staging_tips` | text[]/text | Intelligence |
| `business_hours`, `venue_events` | jsonb | Hours + events |

---

## 4. Venue Tables

### `venue_catalog` — Master Venue Database

57 columns including: `venue_id` (UUID PK), `place_id` (unique), `venue_name`, `address`, `lat/lng`, `coord_key` (unique), `normalized_name`, `category`, `venue_types` (jsonb), `is_bar`, `is_event_venue`, `expense_rank`, `google_rating`, `venue_quality_tier`, `business_hours`, `hours_full_week`, `last_known_status`, `record_status`.

### `discovered_events` — Auto-Discovered Events

Key fields: `id`, `title`, `venue_name`, `venue_id` (FK), `event_start_date/time`, `event_end_date/time`, `category`, `expected_attendance`, `event_hash` (unique), `is_verified`, `is_active`, `schema_version` (integer, default 1 — enables read-time validation skip when current).

### `venue_metrics` — Feedback Aggregation

Key fields: `venue_id` (PK FK), `times_recommended`, `times_chosen`, `positive_feedback`, `negative_feedback`, `reliability_score`.

---

## 5. Intelligence Tables

### `market_intelligence` — Market Knowledge

Key fields: `id`, `market`, `market_slug`, `platform`, `intel_type`, `intel_subtype`, `title`, `content`, `priority`, `confidence`, `coach_can_cite`, `coach_priority`, `is_active`, `version`, `expiry_date`.

### `zone_intelligence` — Crowd-Sourced Zones

Key fields: `id`, `market_slug`, `zone_type`, `zone_name`, `lat/lng`, `radius_miles`, `time_constraints`, `reports_count`, `confidence_score`, `is_active`.

---

## 6. Coach/Memory Tables

### `coach_conversations` — Chat History

Key fields: `id`, `user_id`, `conversation_id`, `role` (user/assistant), `content`, `content_type`, `model_used`, `market_slug`, `location_context`, `time_context`.

### `user_intel_notes` — Coach Notes About Driver

Key fields: `id`, `user_id`, `note_type`, `category`, `title`, `content`, `importance`, `confidence`, `is_pinned`, `is_active`, `created_by`.

### `coach_system_notes` — AI Observations for Developers

Key fields: `id`, `note_type`, `category`, `title`, `description`, `user_quote`, `triggering_user_id`.

### `claude_memory` — Claude Code Session Memory

Key fields: `id`, `session_id`, `category`, `title`, `content`, `source`, `priority`, `status`, `tags` (JSONB), `related_files` (JSONB), `parent_id`, `metadata` (JSONB). Indexes on session_id, category, status.

### Memory Tables (Eidolon SDK)

- `agent_memory` — Agent-specific state
- `assistant_memory` — Assistant state
- `eidolon_memory` — Cross-session persistence
- `cross_thread_memory` — Cross-chat awareness

---

## 7. Auth Tables

### `driver_profiles` — Driver Account

65+ columns including identity, location preferences, vehicle eligibility, service preferences, account status.

### `driver_vehicles` — Vehicle Info

Key fields: `id`, `driver_profile_id`, `year`, `make`, `model`, `color`, `license_plate`, `seatbelts`.

### `auth_credentials` — Password Hashes

Key fields: `user_id`, `password_hash`, `failed_login_attempts`, `locked_until`, `password_reset_token`, `password_reset_expires`.

### `verification_codes` — SMS/Email Codes

Key fields: `user_id`, `code`, `code_type`, `expires_at`.

### `oauth_states` — CSRF Tokens

Key fields: `state`, `provider`, `user_id`, `redirect_uri`, `expires_at`, `created_at`.

### `uber_connections` — Uber OAuth Tokens

Key fields: `user_id`, `access_token_encrypted`, `refresh_token_encrypted`, `token_expires_at`.

---

## 8. Cache Tables

- `places_cache` — Google Places API responses (coords_key, formatted_hours, cached_at, access_count)
- `coords_cache` — Coordinate/geolocation cache
- `vehicle_makes_cache`, `vehicle_models_cache` — Vehicle data

---

## 9. Feedback Tables

- `venue_feedback` — Venue thumbs up/down
- `strategy_feedback` — Strategy thumbs up/down
- `app_feedback` — General app feedback
- `concierge_feedback` — Passenger ratings
- `actions` — User interactions (dwell time, clicks, venue selections)

---

## 10. Platform/Reference Tables

- `platform_data` — Uber/Lyft platform configuration per market
- `markets` — Market definitions
- `market_cities` — Market → city mappings
- `countries` — Country reference
- `news_deactivations` — User-hidden news items
- `offer_intelligence` — Siri offer analysis results

---

## 11. Drizzle ORM Setup

**Config:** `drizzle.config.js`
**Schema:** `shared/schema.js`
**Driver:** `postgres` (pg native)

All queries use Drizzle's typed query builder with automatic parameterization. Raw SQL uses `sql` template tag (also parameterized).

---

## 12. Connection Pooling

**File:** `server/db/pool.js`

| Setting | Value |
|---------|-------|
| Max connections | 25 |
| Idle timeout | 10,000ms |
| Connection timeout | 15,000ms |
| Statement timeout | 30,000ms |
| Keep-alive | enabled (10s initial delay) |
| Warning threshold | 20 (80% of pool) |

Pool auto-recovers on admin shutdown (code 57P01).

---

## 13. Migrations

**Directory:** `migrations/` (27 migration files)

### Current Migration Policy

| Aspect | Policy |
|--------|--------|
| **Canonical schema definition** | `shared/schema.js` — all tables, columns, indexes, and relations |
| **Standard path** | Drizzle-managed migrations via `npm run db:migrate` (uses `drizzle.config.js` → `./drizzle/` output) |
| **Exception path** | Targeted direct SQL when global `drizzle-kit push` risks drift (e.g., adding a column to a large table without touching unrelated constraints) |
| **Exception rule** | Every direct-SQL exception MUST be recorded in the exceptions table below AND in `docs/review-queue/pending.md` before deployment |
| **Backfill policy** | Direct-SQL exceptions do NOT need to be backfilled as committed migration files. The pending.md queue and this exceptions table are sufficient tracking. |
| **Manual migrations** | `migrations/` folder for RLS policies, triggers, functions, and one-off fixes that Drizzle doesn't manage |

### Current Exceptions (Direct SQL, Not Yet in Drizzle History)

| Change | Dev DB | Prod DB | Logged In |
|--------|--------|---------|-----------|
| `discovered_events.schema_version` (INTEGER NOT NULL DEFAULT 1) | Applied 2026-04-14 | **Pending** | pending.md §Pass 1 |
| `claude_memory` table (14 columns, 3 indexes) | Applied 2026-04-14 | **Pending** | pending.md §Memory Table |
| `driver_profiles` — 4 preference columns (fuel_economy_mpg, earnings_goal_daily, shift_hours_target, max_deadhead_mi) | **Deferred** | **Deferred** | pending.md §Driver Prefs |

---

## 14. Current State

| Area | Status |
|------|--------|
| Schema definition (Drizzle) | Working — 57 tables |
| Connection pooling | Working — 25 max, monitoring |
| Migrations | Working — 27 Drizzle-managed + direct-SQL exceptions (see §13 for current exceptions pending prod) |
| Parameterized queries | Working — all via Drizzle |

---

## 15. Known Gaps

1. **No automated backups** — Relies on Replit Helium's built-in persistence.
2. **No read replicas** — Single DB instance for both read and write.
3. **No table partitioning** — `snapshots` and `coach_conversations` will grow large. No time-based partitioning.
4. **No explicit N+1 prevention** — Application responsible for batching.
5. **No row-level security** — Enforced in API code, not DB-level.
6. ~~No schema versioning on data~~ — **Partially resolved (2026-04-14):** `discovered_events.schema_version` added (Issue B, Pass 1). Enables read-time validation skip for current-version rows. Not yet propagated to other mutable tables.

---

## 16. TODO — Hardening Work

- [ ] **Add automated DB backups** — Nightly pg_dump or Replit backup
- [ ] **Table partitioning** — Partition snapshots and coach_conversations by month
- [ ] **Read replica** — Split read-heavy queries (analytics, intelligence) to replica
- [ ] **Row-level security** — Add PostgreSQL RLS policies for user data isolation
- [x] **Schema versioning** — `schema_version` added to `discovered_events` (2026-04-14). Remaining: propagate to other mutable tables if needed
- [ ] **Index audit** — Verify all FK columns and common query patterns have indexes

---

## Key Files

| File | Purpose |
|------|---------|
| `shared/schema.js` | All table definitions (2,074 lines) |
| `drizzle.config.js` | Drizzle configuration |
| `server/db/pool.js` | Connection pool management |
| `server/db/connection-manager.js` | Connection lifecycle |
| `migrations/` | 27 migration files |
