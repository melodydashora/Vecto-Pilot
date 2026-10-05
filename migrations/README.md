> **Documentation checked:** 2026-10-04. Migrations were tested in disposable databases; no application-database migration or deployment was performed.

# Migrations

Hand-written database migration scripts. **`migrations/*.sql` is the canonical migration
path** — applied in filename order by `npm run db:migrate`. It holds *all* DDL: tables,
columns, indexes, triggers, RLS policies, and functions (despite the historical "tables go
in Drizzle" note, which never matched practice — see _Manual vs Drizzle_ below).

## Structure

| Path | What it is |
|------|-----------|
| `migrations/*.sql` | **Canonical** hand-written migrations, applied at boot by `server/db/run-migrations.js` (and by `npm run db:migrate`) — all DDL: tables, columns, indexes, triggers, RLS, functions. |
| `migrations/00000_baseline.sql` | **Schema-only baseline** (2026-09-13; `BASELINE_THROUGH: 20260913_schema_repair.sql`). Fresh bootstrap atomically executes the reviewed dump and airport seed with the covered ledger. Regeneration requires reviewing the source/checksum manifest and preserving prior coverage mappings. See [bootstrap and recovery](../docs/architecture/DATABASE_BOOTSTRAP.md); the historical zero-difference catalog result did not verify reference data. |
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
| `20260703_offer_rulesets_outcomes.sql` | `offer_rulesets` + `offer_outcomes` tables, `shortcut_token` columns |
| `20260706_airports_table.sql` | `airports` table |
| `20260706_app_rules_table.sql` | `app_rules` table |
| `20260706_daypart_taxonomy_rename.sql` | Daypart taxonomy rename |
| `20260706_holiday_to_briefing.sql` | Move holiday detection from snapshots to briefings |
| `20260806_seed_airports_data.sql` | Seed airports data |
| `00000_baseline.sql` | Full-schema baseline for empty databases (see Structure) |
| `20260913_schema_repair.sql` | Drop 12 verified-dead tables (row-count guarded), drop legacy `events_facts` functions, drop `discovered_events.zip/lat/lng` for real, `rankings.snapshot_id` cascade, `venue_catalog.market_slug` FK, 87 indexes + 5 unique constraints that `shared/schema.js` had declared but never existed, `fn_deactivate_ended_events()`. See `docs/architecture/audits/DB_SCHEMA_EVALUATION_2026-09-13.md` |

## Running Migrations

```bash
# Via npm script (applies migrations/*.sql in order)
npm run db:migrate

# Opt-in read-only metadata inspection; does not apply DDL
npm run check:schema
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

`shared/schema.js` (Drizzle schema) remains the runtime mirror the app reads from;
schema *changes* are shipped as `migrations/*.sql`, with `shared/schema.js` updated to match.

**Source-of-truth decision (2026-09-13):** `migrations/*.sql` is the DDL source of truth;
`shared/schema.js` is a mirror that MUST be kept equal to the live database and is
verified, not trusted. Every index, unique and check in `shared/schema.js` is declared with
Drizzle builders (`index()`, `uniqueIndex()`, `unique()`, `check()`) so `drizzle-kit
generate` sees them — raw `sql\`create index …\`` templates in the extra-config object are
silently ignored by Drizzle and were the cause of 124 phantom indexes (lessons_learned #40).
Parity check: `docs/architecture/audits/DB_SCHEMA_EVALUATION_2026-09-13.md` describes the
method (getTableConfig vs information_schema); 0 diffs is the required state.

## See Also

- [shared/schema.js](../shared/schema.js) — Drizzle runtime mirror, verified against applied SQL and the catalog
- [Fresh database bootstrap](../docs/architecture/DATABASE_BOOTSTRAP.md) — atomic initialization, interruption recovery and reference-data limits
- [migrations/manual/](manual/) — legacy drizzle-generated migrations + meta journal


## Deployment verification limits

Review every pending migration before publishing, including row guards and any
data changes; the gateway runs the canonical runner during boot. Do not substitute
`drizzle-kit push` or individually replay historical SQL to fix a failed parity check.
A nonzero `check:schema` result is a finding to inspect, not authorization to alter data.
The checker has deliberately bounded metadata coverage (see `server/db/README.md`).
A schema-only baseline and a matching ledger do not establish reference-data parity:
a fresh initialization must separately prove required airport identity seeds exist.
