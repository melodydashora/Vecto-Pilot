# Strategy source generation, September 12, 2026

Provenance: Desktop Astra implementation of Melody's complete-data and timestamp
requirements, supported by Claude's bounded read-only review. Database columns
and tables remain unchanged. No development/production migration is required.

## Problem and decision

Refreshing Briefing A to B left A's Strategy text and venues in the database.
Once B completed, readiness checks treated the old text as current. An in-flight
Consolidator could also save A's late answer or failure after B completed.
Comparing `strategies.updated_at` with `briefings.generated_at` cannot fix this:
venue retries and phase progress also update the Strategy timestamp.

Each newly saved Strategy now carries an exact receipt in the existing JSONB
column `strategies.venue_cache_metrics.strategy_source`:

- `snapshot_id`
- `briefing_generation_token`
- `briefing_generated_at`, copied from the persisted complete Briefing
- `strategy_generated_at`, the actual Strategy persistence time

The column retains its existing `hits`, `misses`, and `hit_rate` members. Its
name predates this receipt; this is an explicit tradeoff to preserve the schema.
The only metrics writer now atomically merges those three known counters, so it
cannot replace or inject the reserved receipt. A later schema redesign may give
this provenance its own column; that is outside the current task.

## Persistence and reads

The Consolidator captures the persisted Briefing token before model dispatch.
Its final write uses a short transaction and locks that Briefing row `FOR UPDATE`.
The token and complete-data checks happen while holding that row lock. Briefing
refresh must update the same row, so it cannot change the token between the
check and Strategy persistence. No database transaction is held during a model
request. Superseded success and failure do not mutate Strategy.

An already stored non-null Strategy cannot be overwritten by another completion
or a late failure, including a duplicate for the same generation. A completed
duplicate from the same current source can reuse the first durable result.

Current-data readers read Strategy and Briefing in one joined SQL statement.
Once a replacement Briefing completes, mismatched or absent receipts produce an
explicit `strategy_source_changed` / `retry: new_snapshot` response. Pending
Briefing still permits clearly historical context. Original stored text is kept.
A clean location refresh starts a new Snapshot, Briefing, Strategy, and venue
plan; old venue rankings are never silently assigned to a new Strategy.

The legacy Strategy route now also requires complete Snapshot/Briefing data.
The venue generator verifies the persisted source and input text before model
work. Cached routes check it before returning current results. Coach retains all
source records but marks mismatched Strategy as partial/historical. The polling
endpoint's `generatedAt` comes from the Strategy receipt; its `strategyUpdatedAt`
continues to report the actual row update separately.

## Verification

The in-memory PostgreSQL-compatible PGlite tests execute the real SQL and actual
Consolidator with a deferred synthetic provider. They cover saved receipts,
refresh while a model is running, late success and failure, duplicate writes,
phase timestamp changes, and metrics overwrites. Cached GET/POST and polling
tests reject old Strategy after the replacement Briefing completes.

`scripts/test-strategy-source-postgres.mjs` is an opt-in real PostgreSQL lock
regression guarded to the existing disposable loopback55432/vecto_preview DB.
It creates only its own synthetic rows, observes actual lock contention, checks
obsolete-write rejection and the current receipt, then removes its exact fixture
IDs. It runs no providers or schema migrations. Its actual result belongs in the
private integration receipt; the presence of this script is not proof it ran.

Physical-phone voice and launch verification, authoritative V1 location
enrichment, and main/runtime integration remain separate work. No claim that
these checks prove the entire application release-ready is intended.
