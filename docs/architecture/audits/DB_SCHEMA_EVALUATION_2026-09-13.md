# Database Schema Evaluation — 2026-09-13

**Provenance:** Claude-authored (session 0163XeP4v1wMgDHGUZLdNnSb), at Melody's request
("find issues with the database schema, doing a full evaluation"). Findings only — no
schema, code, or data was changed. Every claim below was verified against the **dev**
database (`DATABASE_URL`, Helium Postgres 16.10, db `heliumdb`) and the working tree on
this date. Prod was not inspected (no prod selector is available in this workspace, by
design — see CLAUDE.md §5).

Method: `shared/schema.js` was loaded through Drizzle's `getTableConfig` and through
`drizzle-kit generate` (to a scratch dir), then diffed column-by-column, FK-by-FK, and
index-by-index against `information_schema` / `pg_catalog`. Code usage was measured by
file references under `server/`, `client/src/`, `scripts/`, `gateway-server.js`.
Migration effects were checked by extracting each canonical migration's DDL targets and
testing for their presence live.

Related prior work: `claude_memory` #364 (boot-time migration runner), #336 (agent_memory
column mismatch, deferred), #159 (indexes are documentation); `lessons_learned` #23
(prod drift), #30 (checksum immutability); `todo` #11 (Foundation Phase 1 schema parity),
#25 (apply pending migrations to prod), #35 (events cleanup + unused-table audit);
`migrations/proposed/20260526_orphaned_tables_CANCELLED.sql`.

---

## Headline numbers

| Measure | Value |
|---|---|
| Tables live / declared in schema.js | 66 / 66 (65 shared; `schema_migrations` only live, `agent_changes` only declared) |
| Column-level drift (real) | 3 columns live but undeclared (`discovered_events.zip/lat/lng`); 1 table declared but absent (`agent_changes`) |
| Foreign keys live / declared | 45 / 42 (3 undeclared: `market_cities→markets`, `app_rules.superseded_by`, `discovered_traffic.snapshot_id`) |
| Indexes Drizzle actually knows about | **0** (drizzle-kit emits 66 tables, 0 indexes, 19 column uniques) |
| Index names written in schema.js / present live | 166 / 42 present, **124 missing** |
| Canonical-migration `CREATE INDEX` targets missing live | 35 of 55 |
| FK columns with no supporting index | 27 |
| Live tables with **no** `CREATE TABLE` anywhere in the repo | **38 of 65** (incl. `snapshots`, `strategies`, `briefings`, `rankings`, `ranking_candidates`, `venue_catalog`, `markets`) |
| `schema_migrations` rows recorded without execution ("baselined") | 40 of 46 |
| Tables with 0 rows | 22 |
| Tables with 0 rows **and** ≤2 referencing files | 12 (list in §4) |

---

## 1. Structural — the schema cannot be rebuilt or trusted from the repo

### 1.1 No path from an empty database to the current schema
- `migrations/001_init.sql` creates exactly one table, `documents` (pgvector), which does
  not exist live. It is not the init of this schema.
- 38 live tables have no `CREATE TABLE` in `migrations/*.sql` or `migrations/manual/*.sql`
  (the legacy drizzle-kit output). The core pipeline tables are all in this set.
- Run in filename order on the current DB, the canonical sequence would **drop
  `snapshots.user_id`** (`20251228_drop_snapshot_user_device.sql`) — a column schema.js
  declares and `requireSnapshotOwnership` depends on. Nothing re-adds it.
- DDL now lives in four places: `migrations/`, `migrations/manual/`,
  `server/db/migrations/`, `server/db/sql/`.
- `drizzle-kit generate` from schema.js produces a syntactically valid 66-table schema
  with zero indexes (see §1.3), so it is not a rebuild path either.

### 1.2 `schema_migrations` is an unverified ledger
The boot runner (`server/db/run-migrations.js`, #364) baselines every file older than
`20260703` as applied without executing it. All 46 rows carry `applied_at` within a
two-second window on 2026-08-06. Verified against live:

| Migration | Recorded | Actually in effect? |
|---|---|---|
| `003_rls_security.sql` | baselined | **No** — RLS enabled on 0 of the 18 listed tables (only `agent_memory`, from 20260430) |
| `20260110_drop_discovered_events_unused_cols.sql` | baselined | **No** — `zip`, `lat`, `lng` still present |
| `20251228_auth_system_tables.sql` | baselined | Tables yes; **all 17 indexes missing** |
| `20251214_discovered_events.sql`, `20260110_rename_event_columns.sql`, `20260205_add_event_cleanup_indices.sql` | baselined | Tables/columns yes; **9 indexes missing** |
| `20251229_district_tagging.sql` | baselined | Columns yes; 3 indexes missing |
| `20260703…20260806` (6 files) | executed | Yes |

### 1.3 Every index and unique in schema.js is decorative
All extra-config entries are raw `sql\`create index if not exists …\`` templates.
Drizzle only recognises `index()`, `uniqueIndex()`, `unique()`, `check()`; raw `sql`
values in that object are silently ignored. `getTableConfig` reports 0 indexes and 0
table-level uniques for all 66 tables. Consequences live:

- **Hot tables have only their primary key:** `snapshots` (no `user_id`, `created_at`,
  `session_id`, `coord_key` index), `rankings` (no `snapshot_id`), `coach_conversations`
  (no `user_id`/`conversation_id`), `platform_data` (51,390 rows, no index at all beyond
  PK — schema.js declares seven).
- `ranking_candidates.ranking_id` (6,132 rows) has no index, so every cascade from
  `rankings` seq-scans it; the same for `actions`, `strategy_feedback`,
  `venue_feedback`. 27 FK columns total are unindexed.
- **Declared invariants that are not enforced anywhere:** `venue_feedback(user_id,
  ranking_id, place_id)` and `strategy_feedback(user_id, ranking_id)` "one vote"
  uniques; `(scope, key, user_id)` on `assistant_memory`, `eidolon_memory`,
  `cross_thread_memory`; `staging_saturation(h3_cell, window_start)`;
  `platform_data(platform, country, region, city)`; `vehicle_models_cache`
  make/model/year; `coords_cache`/`venue_catalog` partial coord_key indexes (the column
  UNIQUE constraints do cover these two).
- Live has 2 indexes schema.js doesn't mention (`idx_airports_lat_lng`,
  `idx_market_cities_market_slug`), 1 exact duplicate pair on `market_cities`
  (`idx_market_cities_market_slug` = `idx_umc_market_slug`), and 3 single-column
  indexes fully covered by a wider one (`news_deactivations`, `discovered_traffic`,
  `agent_memory`).

---

## 2. Runtime defects caused by schema/code mismatch

### 2.1 Concierge "events near me" silently returns nothing
`discovered_events.lat/lng` are gone from schema.js (comment at line 609 says the
migration dropped them), still exist live (never populated: 0 of 1,269 rows), and
`server/lib/concierge/concierge-service.js:365` still builds
`sql\`${discovered_events.lat} BETWEEN …\``. Because the column object is `undefined`,
Drizzle renders ` BETWEEN $1 AND $2` (verified), Postgres raises a syntax error, the
`catch` at line 420 logs and returns `[]`. `queryNearbyEvents` is on the live path
(called at line 727 from the AskConcierge feature). Same pattern in
`server/lib/briefing/context-loader.js:140` (`getTrafficImpactingEvents`), which has no
callers — dead code.

### 2.2 The event-cleanup job has never deleted anything
`fn_cleanup_expired_events()`, `fn_upsert_event`, `fn_backfill_event_expiry`,
`fn_refresh_venue_enrichment` all reference `events_facts`, a table that does not
exist. They come from the legacy `migrations/manual/0008_event_ttl_automation.sql` and
are absent from the canonical path. `server/jobs/event-cleanup.js:37` calls the function
on every interval; the "relation events_facts does not exist" error is caught and
logged as "skipping cleanup", so the job is a permanent no-op (verified by calling it
in a rolled-back transaction). This is the mechanism behind Melody's standing complaint
in `todo` #35 that events never clear.

### 2.3 `agent_memory` writer targets non-existent columns (known, still open)
`server/agent/thread-context.js:143` and `enhanced-context-base.js:407` insert
`(session_id, entry_type, title, metadata)`; live columns are `(scope, key, user_id,
content, expires_at, …)`. `claude_memory` #336 recorded this on 2026-05-13 and deferred
it; `agent_memory` still has 0 rows.

### 2.4 Row-level security is inert
Only `agent_memory` has RLS. The app connects as `postgres` (superuser, `bypassrls`),
`server/db/rls-middleware.js` (which would `SET LOCAL app.user_id`) is imported nowhere,
and the one policy is `user_id = app.current_user_id() OR app.current_user_id() IS NULL`
— permit-all when unset. The security model described in `003`/`004` does not exist at
runtime. Not a bug today (single-tenant), but the docs claim it.

---

## 3. Design contradictions

### 3.1 `users` is documented as ephemeral but is the identity root
The header comment (schema.js:4-18) says users rows are "deleted on logout or 60 min
inactivity". Reality: `server/middleware/auth.js` only nulls `session_id`; nothing ever
deletes a `users` row (the `offer_rulesets` comment at line 1935 admits this). Meanwhile
11 tables FK to `users.user_id` with mixed intent — `driver_profiles`,
`auth_credentials`, `coach_conversations`, `news_deactivations`, `offer_rulesets`,
`offer_outcomes` use RESTRICT (deletion would be blocked), while `driver_goals`,
`driver_tasks`, `safe_zones`, `uber_connections`, `coach_offer_decisions` use CASCADE
(deletion would wipe them). Either the comment is wrong or the FK strategy is. This is
a naming/architecture decision for Melody, not a fix Claude should make alone.

### 3.2 Ownership columns without FKs, and one FK without cascade
`snapshots.user_id` (7 dangling), `rankings.user_id`, `strategies.user_id`,
`actions.user_id`, `venue_feedback.user_id`, `oauth_states.user_id`,
`offer_intelligence.user_id` have no FK. `rankings.snapshot_id` is the only snapshot FK
without `ON DELETE`, which `server/api/location/snapshot.js:321` works around with an
explicit pre-delete and a "migration is a follow-up" comment from 2026-05-05.

### 3.3 Logical references that do not resolve
| Reference | Dangling |
|---|---|
| `snapshots.coord_key → coords_cache.coord_key` | **492 of 539** — `coords_cache` rows all date from 2026-08-06 onward (cache was reset); `snapshotsRelations.coords` returns null for 91% of snapshots |
| `coach_conversations.market_slug → markets.market_slug` | 473 of 581 — conversations store city slugs (`frisco-tx`, `plano-tx`); markets are `dfw`-style |
| `market_intelligence.market_slug → markets` | 24 of 33 (`universal`, `los-angeles`, …) |
| `venue_catalog.market_slug` | NULL on 533 of 1,048; comment says "FK added via ALTER" — no such FK exists |
| `users` without `driver_profiles` | 1 |

### 3.4 Drizzle relations / aliases
- `coordsCacheRelations` declares `users: many(users)`; `users` has no `coord_key` and
  no inverse relation — the relation is invalid if ever used with `with:`.
- `us_market_cities` is marked deprecated but still imported in 31 files.

### 3.5 Memory-table sprawl
Four tables with identical shape (`agent_memory`, `assistant_memory`,
`eidolon_memory`, `cross_thread_memory`: 0 / 377 / 1 / 0 rows) plus
`eidolon_snapshots` (0), `claude_memory`, `coach_memos`, `coach_system_notes`,
`user_intel_notes`. Only `assistant_memory` and `claude_memory` receive writes in
practice.

### 3.6 Type and convention smells (lower priority, mostly deliberate)
- Dates/times as text: `discovered_events.event_start_date/_time/_end_*`,
  `snapshots.date`, `offer_intelligence.local_date`. `event_start_time` holds 53 distinct
  forms, predominantly 24-hour `19:00` — schema.js comments say `"7:00 PM"`.
- `snapshots.local_iso` is `timestamp without time zone` (intended wall-clock; worth a
  comment saying so).
- `serial` PKs on `claude_memory`, `todo`, `lessons_learned`, `definitions`, `app_rules`
  vs uuid everywhere else — deliberate per the 2026-05-29 comment; fine.
- `concierge_feedback.rating` CHECK (1..5) exists live but not in schema.js.
- Legacy `driver_profiles.uber_*` booleans still present alongside the `elig_*` taxonomy.

---

## 4. Unused-table candidates (for `todo` #35 — **do not drop without Melody**)
Zero rows **and** ≤2 referencing files: `driver_goals` (0 refs), `driver_tasks` (0),
`safe_zones` (0), `staging_saturation` (1), `traffic_zones` (1), `block_jobs` (2),
`eidolon_snapshots` (2), `market_intel` (2; superseded by `market_intelligence`),
`llm_venue_suggestions` (2), `uber_connections` (2), `verification_codes` (2), plus
`venue_events` (9 comment/type refs, no reader or writer, 0 rows),
`cross_thread_memory` (0 rows), and `agent_changes` (declared in schema.js, absent from
DB, referenced only by `scripts/analyze-data-flow.js`).

Explicitly **not** candidates (active writers despite 0 rows — see the CANCELLED
proposal): `app_feedback`, `agent_memory`, `http_idem`, `coach_offer_decisions`.

---

## 5. What was NOT evaluated
- Production database state (cannot be selected from this workspace; `lessons_learned`
  #23 already records that prod drifted and `todo` #25 is open).
- Query plans / actual slow queries — index findings are structural, not measured.
- JSONB payload shapes inside `briefings.*`, `snapshots.weather`, etc.

## 6. Suggested order of attack (Melody's call)
1. Decide the source of truth for DDL (schema.js via drizzle-kit **or** hand-written
   `migrations/*.sql`) and make the other one derived. Today neither can rebuild the DB.
2. Fix the two live defects with no design decision attached: §2.1 (drop the `lat/lng`
   references or restore the columns), §2.2 (replace `fn_cleanup_expired_events` with a
   canonical function against `discovered_events`, and make the job fail loud).
3. Convert schema.js extra-config to real `index()/uniqueIndex()/unique()` calls and
   generate the missing indexes and unique constraints as one additive migration.
4. Resolve §3.1 (users vs driver_profiles as identity root) — naming/architecture.
5. Retire tables from §4 after Melody confirms each.

---

## 7. Applied the same day (Melody: "go ahead and remove them" / "perform the fixes")

Everything below is live on **dev** (`migrations/20260913_schema_repair.sql`, recorded by the
boot runner). Prod application is a manual step (todo #25). Verified after: Drizzle and the
live DB agree on every table, column, FK, index, unique and check; `npm run lint` and
`npm run typecheck` clean; jest shows only the 7 pre-existing failures from todo #19.

**Removed (each verified repo-wide — all file types — and DB-side for views/functions/FKs):**
- 11 empty tables dropped, guarded to refuse if any row exists: `block_jobs`,
  `llm_venue_suggestions`, `eidolon_snapshots`, `venue_events`, `traffic_zones`, `market_intel`
  (its always-empty query removed from `/api/intelligence`), `driver_goals`, `driver_tasks`,
  `safe_zones`, `staging_saturation`, `uber_connections`. `agent_changes` removed from schema.js
  (never existed live). The three dispatch tables were scaffolding for an unbuilt
  "make $500 and get home" feature (ARCHITECTURE_REQUIREMENTS.md:223); recoverable from git.
- **Kept** because live code depends on them: `verification_codes` (SMS password reset),
  `cross_thread_memory` (agent context; part of the memory-sprawl decision), `oauth_states`
  (Google sign-in).
- **Uber OAuth integration removed entirely** at Melody's direction (no Uber API relationship):
  route, two server libs, client Settings section + 3 components + 4 service files, env
  validation, test, script. `generateState()` moved into `google-oauth.js`.
- 7 legacy `events_facts` functions dropped.

**Fixed:**
- §2.1 Concierge nearby events now join `venue_catalog` for coordinates; dead
  `getTrafficImpactingEvents` deleted; `discovered_events.zip/lat/lng` dropped for real.
- §2.2 New `fn_deactivate_ended_events()` (venue-timezone day end; unresolvable timezone →
  skipped and logged, never guessed) + rewritten, fail-loud `server/jobs/event-cleanup.js`,
  now actually started from `gateway-server.js` hourly (todo #35 part 1).
- §1.3 All 47 schema.js extra-config blocks converted from ignored raw `sql` templates to real
  `index()/uniqueIndex()/unique()/check()` calls (drizzle-kit now emits 130 indexes). 87
  missing indexes and 5 missing unique constraints created; 8 declarations redundant with
  UNIQUE constraints removed; duplicate `idx_market_cities_market_slug` dropped.
- §3.2 `rankings.snapshot_id` ON DELETE CASCADE; `venue_catalog.market_slug` FK to markets
  created; 3 live FKs and 1 CHECK now declared in schema.js; `snapshots.user_id` self-heal
  (`ADD COLUMN IF NOT EXISTS`) so the canonical sequence no longer ends without it.
- §3.1/§3.4 `users` header comment corrected; invalid `coordsCacheRelations.users` removed.

**Still open (Melody's decisions):** §1.1 DDL source of truth / baseline for the 38 tables with
no CREATE DDL; §3.1 identity root (users vs driver_profiles) and the RESTRICT/CASCADE mix;
§2.3 + §3.5 memory-table consolidation and the broken `agent_memory` writer (#336); §2.4 RLS
model; §3.3 slug mismatches (`coach_conversations.market_slug`, `market_intelligence`);
`coords_cache` reset. Also: `client/src/pages/co-pilot/PolicyPage.tsx` privacy text still
describes an Uber API integration (product copy — not edited); the `UBER_*` and
`TOKEN_ENCRYPTION_KEY` secrets are still set in the Replit environment and can be deleted.


---

## 8. Second pass the same day (Melody: "document all that you can complete on your own and finish the todo's")

**Completed**
- **§1.1 DDL source of truth — resolved.** `migrations/*.sql` is canonical; `shared/schema.js`
  is a verified mirror (0 diffs). `migrations/00000_baseline.sql` (pg_dump of dev) plus
  baseline handling in `server/db/run-migrations.js` give an empty database a real build path.
  Verified by creating an empty Helium database, running the boot runner against it, and
  diffing every catalog surface against dev: **0 differences** (tables 55, columns 819,
  constraints 126, indexes 209, functions 11, triggers 6, policies 2, RLS 1, extensions 4).
  The scratch database was then dropped. Recorded in `DECISIONS.md`.
- **Platform neutrality.** Privacy policy rewritten; the Welcome-page "open Uber" QR tile,
  `client/src/types/uber.ts`, `UBER_INTEGRATION_TODO.md`, stale `UBER_*` env examples, two
  tracked permission rules that embedded the old webhook secret, and all doc/roadmap claims
  of an Uber integration removed. Remaining "Uber"/"Lyft" mentions are domain data only
  (platform picker, offer-card parsing, market datasets sourced from public Uber listings,
  service-tier education slides, the Siri shortcut's photo-album name "Uber rides" in
  `SetupCard.tsx`, and `server/scripts/seed-uber-*.js` data-seed script names).
- **todo #35** both parts done on dev; **todo #25** closed — its remaining action (publish so
  the runner's first prod boot applies the 20260703+ set) happened on 2026-08-25/26 and the
  app has been serving since, which a fail-loud runner would not allow had it failed
  (inference; prod cannot be inspected from this workspace).

**Prod runbook for `20260913_schema_repair.sql`** (it runs automatically on the next publish):
1. Database Studio → Production Database: confirm the 11 tables listed in
   `docs/architecture/DATABASE_ENVIRONMENTS.md` are empty. If one has rows, boot will fail
   loud naming it; delete the rows or keep the table by deciding first.
2. Confirm `discovered_events.zip/lat/lng` are all NULL (same guard).
3. Publish. Expect log lines `applied 20260913_schema_repair.sql` and
   `baselined 1 file(s)` (the 00000 baseline is recorded, not executed, on prod).

**Deliberately NOT changed — decision records with recommendations (tracked as todos #80–#83)**
- **Identity root (§3.1).** Recommendation: keep `users.user_id` as the key everything joins
  on (it already is, and the RESTRICT FKs make it safe), and stop calling it ephemeral —
  done in the header comment. Do NOT re-point FKs to `driver_profiles.id`: 11 tables and the
  JWT `sub` claim carry `user_id`. The only real cleanup is making the CASCADE set
  (`coach_offer_decisions`, `uber_connections` — now gone) RESTRICT for consistency, which is a
  one-line migration if Melody agrees.
- **RLS (§2.4).** The app connects as a superuser and never sets `app.user_id`, so RLS cannot
  work as designed. Recommendation: retire the RLS doctrine (drop the one inert policy on
  `agent_memory`, mark `003`/`004` historical in DATABASE_ENVIRONMENTS.md) unless a
  multi-tenant deployment is planned; if it is, that is a project (non-superuser role,
  `rls-middleware.js` wiring, `FORCE ROW LEVEL SECURITY`), not a migration.
- **Memory tables (§2.3, §3.5).** The `agent_memory` writer/readers were left broken ON
  PURPOSE by the 2026-05-13 auth-hardening pass as a "passive log signature" pending an
  `ENFORCE_USERID_UUID` guard (code comments in `server/agent/thread-context.js:118-135`,
  `enhanced-context-base.js:389-400`). Overriding that intent silently is not mine to do.
  Fix recipe when approved: replace the raw INSERTs with `memoryPut({table, scope, key,
  userId, content, ttlDays})` from `server/eidolon/memory/pg.js` (already the correct shape,
  already used for `assistant_memory`), and the readers with `memoryQuery` filtered by
  `userId`. Consolidation: `assistant_memory`, `eidolon_memory`, `cross_thread_memory`,
  `agent_memory` share one shape; a single `agent_memory` with a `scope` prefix would do,
  but `assistant_memory` holds 377 live rows and the eidolon policy names the tables.
- **Slug mismatch (§3.3).** `coach_conversations.market_slug` stores city slugs
  (`frisco-tx`) while `markets` uses market slugs (`dfw`); `market_intelligence` uses a third
  vocabulary (`universal`). No code joins these today, so nothing is broken; but the columns
  cannot get FKs until one vocabulary wins. Recommendation: `markets.market_slug` everywhere,
  with a one-time backfill via `market_cities` (city+state → market_slug).
- **`coords_cache` reset (§3.3).** Cache rows only exist from 2026-08-06; 492 older snapshots
  point at keys the cache no longer has. Harmless (cache misses re-resolve) — documented so
  nobody treats the relation as a join.
