# Fresh database initialization and interrupted baselines

Local implementation and isolated verification: October 4, 2026. No production
migration or deployment was performed for this change.

The canonical runner is `server/db/run-migrations.js`; normal migrations remain
`migrations/*.sql`. `DATABASE_URL` is the sole connection selector. Starting the
gateway invokes the runner, so a gateway start is not a read-only database check.

## The reproduced failures

The September 13 baseline is a schema-only dump. The prior runner recorded every
covered migration as baselined, including the airport identity data migration.
A real PostgreSQL 16.10 initialization with the unmodified SQL produced 54 ledger
rows but zero airports and zero app rules. Repeating the runner skipped all 54
files and left those tables empty. Catalog parity alone could not detect this.

Baseline DDL and its ledger entries also committed separately. Interrupting the
runner after its first baseline ledger insert left the schema and one ledger row.
On restart it classified this as an existing database and replayed 13 later
historical migrations. In the isolated reproduction this deleted a synthetic
coordinate-cache row and inserted ten old app rules, including the superseded
`holiday-required-snapshot-field` rule.

## Current boundary

For an empty database, one transaction now contains:

1. The full baseline DDL.
2. The exact reviewed `20260806_seed_airports_data.sql`, restoring 144 airport
   identities with their existing provenance.
3. Every covered migration ledger row.

The existing advisory lock serializes booting instances. A lost connection before
commit rolls back all three parts. A lost commit acknowledgment leaves a complete
covered ledger, so the next boot skips bootstrap and applies only later migrations.
The baseline and airport seed are recorded as executed (`baseline=false`); other
covered files are marked as schema-covered (`baseline=true`). That flag does not
assert their historical data effects were executed.

The baseline and seed SHA256 values are pinned in `FRESH_BOOTSTRAP_SOURCES`.
Missing or changed reviewed files fail before bootstrap writes. Sources are read
once so executed bytes, marker and ledger checksums describe the same plan.
Regenerating the baseline requires reviewing and updating this manifest, retaining
older checksum-to-coverage entries in `BASELINE_COVERAGE_BY_CHECKSUM`, and rerunning
the fresh-database and interruption tests. Applied migration SQL remains immutable;
this repair changes no historical SQL file.

Existing complete ledgers retain their behavior, including pending forward
migrations. This change does not reseed, rewrite or repair existing application
reference data automatically. A prior completed initialization with empty reference
tables therefore needs a separately reviewed repair.

## Ambiguous or incomplete history

An executed baseline (`baseline=false`) with missing covered ledger rows now stops
before historical replay. A baseline merely recorded on a preexisting database
(`baseline=true`) is different and is not treated as an interrupted fresh boot.
A missing core schema with ledger rows also stops. An existing schema with no
ledger stops because it cannot safely be distinguished from a baseline interrupted
before its first ledger insert.

Inspect these cases and establish a reviewed recovery plan from verified schema
and data evidence. Do not fabricate ledger entries from filenames or rerun old
cleanup migrations to make a status check green. Resetting a disposable test
database is not a recovery plan for a database containing user records.

## Reference data and continuity limits

Only the reviewed airport identity seed is replayed during fresh bootstrap.
The historical app-rules migration contains obsolete doctrine and is deliberately
not executed. A current, reviewed `app_rules` export and import plan remains
unresolved; bootstrap reports this limitation and leaves the table empty. Neither
an empty rules table nor a matching schema ledger is restoration of current
continuity. No private memory rows or current account data are copied by this code.

The baseline also requires its declared PostgreSQL extensions. Plain bundled
PostgreSQL initially failed because `vector.control` was unavailable. Verification
then used a private runtime overlay with the installed pgvector package; the full
baseline ran unchanged. The fixture did not remove or bypass extension SQL.
Deployment must supply compatible extensions too.

## Verification

`tests/db/migration-bootstrap.test.js` exercises reviewed-source checks, atomic
bootstrap ordering, rollback, lost commit acknowledgment, incomplete-history
rejection, ordinary existing ledgers and repeat execution with mocked PostgreSQL.
Nine initial regression tests failed against the old runner. A further regression
protects upgrades when a later dump advances its coverage marker; all twelve pass
with this repair.
The shared connection-policy suite also passes (32 tests together).

A separate disposable PostgreSQL 16.10 cluster listened only on a Unix socket in
an owner-only temporary directory. It verified the full unmodified baseline:

- Fresh bootstrap: 144 airports, zero app rules, 54 ledger rows.
- Repeat execution: no migrations applied; later synthetic reference edits retained.
- Failure after the first ledger insert: schema and ledger rolled back; restart
  initialized successfully.
- Lost commit acknowledgment: 50 covered ledger rows remained; restart applied
  only the four later migrations and did not repeat the airport seed.
- Old partial executed ledger: restart refused historical replay and preserved
  synthetic coordinate-cache and current-rule rows.

The cluster was stopped and independently checked after testing. These tests do
not establish production schema/data parity, a deployed commit, or current
provider data freshness.
