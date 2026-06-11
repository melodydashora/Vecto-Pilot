> **Last Verified:** 2026-06-11

# Migrations

Hand-written database migration scripts. **`migrations/*.sql` is the canonical migration
path** — applied in filename order by `npm run db:migrate`. It holds *all* DDL: tables,
columns, indexes, triggers, RLS policies, and functions (despite the historical "tables go
in Drizzle" note, which never matched practice — see _Manual vs Drizzle_ below).

## Structure

| Path | What it is |
|------|-----------|
| `migrations/*.sql` | **Canonical** hand-written migrations, applied by `npm run db:migrate` (all DDL — tables, columns, indexes, triggers, RLS, functions). |
| `migrations/manual/` | **Legacy** drizzle-kit-generated migrations (`0000`–`0012`, auto-named) plus a `meta/` journal of snapshot JSON. Not part of the `db:migrate` run; kept for history. |
| `drizzle/` | The output dir configured in `drizzle.config.*` (`out: "./drizzle"`). **Currently empty/unused** — no live `.sql` files; new schema work goes through `migrations/*.sql`. |

## Naming Convention

```
YYYYMMDD_description.sql   # Date-prefixed for manual migrations (current style)
00X_name.sql               # Numbered for the earliest sequential migrations
```

## Current Migrations

| File | Purpose |
|------|---------|
| `001_init.sql` | Initial schema setup |
| `002_memory_tables.sql` | MCP memory system tables |
| `003_rls_security.sql` | Row-Level Security policies |
| `004_jwt_helpers.sql` | JWT helper functions |
| `20251103_add_strategy_notify.sql` | Strategy `NOTIFY` trigger |
| `20251209_drop_unused_briefing_columns.sql` | Drop unused briefing columns |
| `20251209_fix_strategy_notify.sql` | Fix strategy notification trigger |
| `20251214_add_event_end_time.sql` | Add `event_end_time` column |
| `20251214_discovered_events.sql` | `discovered_events` table |
| `20251228_auth_system_tables.sql` | Authentication system tables |
| `20251228_drop_snapshot_user_device.sql` | Drop snapshot user/device columns |
| `20251229_district_tagging.sql` | District tagging feature |
| `20260109_briefing_ready_notify.sql` | Briefing-ready `NOTIFY` trigger |
| `20260110_cleanup_invalid_events.sql` | Clean up invalid discovered events |
| `20260110_drop_discovered_events_unused_cols.sql` | Drop unused `discovered_events` columns |
| `20260110_fix_strategy_now_notify.sql` | Fix `strategy_now` `NOTIFY` |
| `20260110_rename_event_columns.sql` | Rename event columns (`event_date`→`event_start_date`, etc.) |
| `20260114_create_places_cache.sql` | `places_cache` table |
| `20260114_lean_strategies_table.sql` | Slim the `strategies` table |
| `20260114_progressive_enrichment.sql` | Progressive venue-enrichment columns |
| `20260205_add_event_cleanup_indices.sql` | Indices supporting event cleanup |
| `20260205_enforce_event_end_time.sql` | Enforce `event_end_time` NOT NULL |
| `20260208_uber_oauth_tables.sql` | Uber OAuth tables |
| `20260217_drop_briefing_ready_trigger.sql` | Drop the briefing-ready trigger |
| `20260328_ranking_candidates_venue_id.sql` | Add `venue_id` to `ranking_candidates` |
| `20260416_app_feedback_user_link.sql` | Link `app_feedback` to user |
| `20260416_driver_preference_columns.sql` | Driver-preference columns |
| `20260416_news_deactivations_unique.sql` | Unique constraint on news deactivations |
| `20260416_ranking_candidates_deadhead.sql` | Deadhead column on `ranking_candidates` |
| `20260416_venue_capacity_seed.sql` | Seed venue-capacity data |
| `20260429_claude_memory_antecedent_trigger.sql` | `claude_memory` antecedent-check trigger |
| `20260429_discovered_traffic.sql` | `discovered_traffic` table |
| `20260430_add_agent_memory.sql` | `agent_memory` table |
| `20260501_drop_consolidated_strategy.sql` | Drop `consolidated_strategy` |
| `20260503_add_venue_cache_metrics.sql` | `venue_cache_metrics` |
| `20260503_drop_venue_catalog_source_model.sql` | Drop `venue_catalog.source_model` |
| `20260505_coach_offer_decisions.sql` | `coach_offer_decisions` table |
| `20260506_drop_device_id_from_users_snapshots_traffic.sql` | Drop `device_id` columns |
| `20260512_coach_memos.sql` | `coach_memos` table |
| `20260529_add_todo_lessons_definitions.sql` | Repo-clarity tables: `todo`, `lessons_learned`, `definitions` (purely additive — creates 3 new tables, touches no existing table) |

## Running Migrations

```bash
# Via npm script (applies migrations/*.sql in order)
npm run db:migrate

# Manually
psql $DATABASE_URL -f migrations/001_init.sql
```

## Manual vs Drizzle Migrations

> **2026-06-11: corrected.** The old guidance ("schema changes go in `drizzle/`") never
> matched the repo — `drizzle/` is empty and every table/column/index change is a
> hand-written `migrations/*.sql` applied by `npm run db:migrate`.

| Folder | Reality |
|--------|---------|
| `migrations/` | **Canonical.** All DDL (tables, columns, indexes, triggers, RLS, functions) lives here as hand-written, date-prefixed SQL, applied by `npm run db:migrate`. |
| `migrations/manual/` | Legacy drizzle-kit-generated migrations + `meta/` journal. Historical only; not in the `db:migrate` run. |
| `drizzle/` | Configured drizzle-kit output dir (`out: "./drizzle"`); currently unused/empty. |

`shared/schema.js` (Drizzle schema) remains the runtime source of truth the app reads from;
schema *changes* are shipped as `migrations/*.sql`, with `shared/schema.js` updated to match.

## See Also

- [shared/schema.js](../shared/schema.js) — Drizzle schema (runtime source of truth)
- [migrations/manual/](manual/) — legacy drizzle-generated migrations + meta journal
