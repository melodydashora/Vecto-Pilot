# AUDIT_DB_COUNTS — 2026-04-25

> Snapshot of `COUNT(*)` per table for the audit-fix-2026-04-25 session.
> Active database: Replit Helium (dev) — `$DATABASE_URL` injected by Replit.
> PostgreSQL version: 16.10.

## Method

Executed via `psql $DATABASE_URL` with explicit `SELECT count(*)` per table.

> ⚠️ **Note on `pg_stat_user_tables.n_live_tup`:** The originally-requested
> `pg_stat_user_tables` query reported `n_live_tup = 0` for ALL 15 tables.
> This was confirmed STALE — autovacuum has not run on this DB recently. The
> values below come from real `COUNT(*)` queries and supersede the stat
> table. If you need accurate row counts on this DB, do not trust
> `pg_stat_user_tables` until `VACUUM ANALYZE` has been run.

## Counts

| Table                 | Row Count | Notes                                                           |
|-----------------------|----------:|-----------------------------------------------------------------|
| `users`               |         5 | Live users in dev                                               |
| `driver_profiles`     |         4 |                                                                 |
| `snapshots`           |       231 | Active session history                                          |
| `coords_cache`        |       126 |                                                                 |
| `strategies`          |       226 | One per snapshot; tracks ≈ snapshots                            |
| `briefings`           |       226 | One per snapshot; tracks ≈ snapshots                            |
| `rankings`            |       449 |                                                                 |
| `ranking_candidates`  |     2,331 | ~10 per ranking — looks healthy                                 |
| `triad_jobs`          |       226 | One per snapshot — pipeline tracking                            |
| `actions`             |       169 |                                                                 |
| `markets`             |       338 | **Already seeded** — `seed-markets.js` NOT needed               |
| `venue_metrics`       |         0 | **Empty** — `seed-dfw-venues.js` queued (P3-12)                 |
| `coach_conversations` |       104 |                                                                 |
| `venue_feedback`      |         0 | No driver feedback yet (dev)                                    |
| `strategy_feedback`   |         0 | No strategy feedback yet (dev)                                  |

## Seeding Decisions (P3-12)

| Script                                        | Run? | Reason                                                       |
|-----------------------------------------------|------|--------------------------------------------------------------|
| `node server/scripts/seed-markets.js`         |  No  | `markets` already has 338 rows                               |
| `node server/scripts/seed-dfw-venues.js`      | Yes  | `venue_metrics` is empty (0 rows) — no DFW venue metric data |

## Empty Tables in P3-13 Watch List

Tables Melody flagged for catch-block instrumentation (`users`, `snapshots`,
`strategies`, `briefings`, `rankings`, `triad_jobs`):

- `users` (5), `snapshots` (231), `strategies` (226), `briefings` (226),
  `rankings` (449), `triad_jobs` (226) — **none are 0** in this dev DB.

Per Melody's directive — "for any of these that are 0 in a DB known to have
been used, instrument every catch block on the insert path" — none meet the
trigger condition in this snapshot. P3-13 instrumentation is therefore not
required by the current data state, but the next session should re-check
against the production DB (Neon) since dev/prod have isolated data per Rule 13.
