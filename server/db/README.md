# Database runtime (`server/db/`)

October 4 bootstrap correction: read
[fresh initialization and interrupted baselines](../../docs/architecture/DATABASE_BOOTSTRAP.md)
before preparing an empty database. Schema, reviewed airport identities and the
covered ledger now commit together; current product-rule restoration remains a
separate prerequisite. Existing application databases are not reseeded.

> Source checked 2026-09-29. Connection and notification regressions use mocked
> PostgreSQL clients; no deployment or remote TLS handshake is claimed here.

## Ownership and entry points

| File | Current responsibility |
|---|---|
| `connection-config.js` | Parse the supplied `DATABASE_URL`; preserve connection parameters and certificate material; enforce local/remote TLS behavior. |
| `connection-manager.js` | One shared `pg.Pool`, pool monitoring, and raw `query`/`getPool` exports. |
| `drizzle.js` | Eager Drizzle instance using the shared pool and `shared/schema.js`. |
| `drizzle-lazy.js` | Lazily create the Drizzle wrapper using that same pool. |
| `pool.js` | Pool statistics and a shared-pool accessor; does not create a second pool. |
| `db-client.js` | Dedicated PostgreSQL LISTEN connection and notification dispatcher; does **not** export `db`. |
| `run-migrations.js` | Boot migration runner, advisory lock, checksums and migration ledger. Changing its connection config does not execute it. |
| `rls-middleware.js` | Request database context middleware. |

Import the ORM through `server/db/drizzle.js` or `getDb()` through
`server/db/drizzle-lazy.js`. The old README example importing `db` from
`db-client.js` was incorrect.

## Connection and TLS contract

`DATABASE_URL` is the only database selector. Pool connections, the migration
runner, initial LISTEN connections, and reconnects all call
`databaseConnectionConfig()`. Runtime deployment flags do not select a target
or disable its certificate checks.

The helper uses node-postgres's connection-string parser once and passes the
parsed configuration to `Pool`/`Client`. This preserves URL credentials, port,
connection options, and `sslrootcert`/`sslcert`/`sslkey` material. It does not
return `connectionString` for a second parse: [node-postgres documents that URL
SSL parameters can replace an explicitly supplied SSL object](https://node-postgres.com/features/ssl).

- Exact known local targets `helium`, `localhost`, `127.0.0.1`, `::1`, and Unix
  domain sockets retain plaintext when TLS is absent or disabled in the URL.
- Explicit TLS for a local target remains enabled with certificate checks.
- Other hosts always use TLS with `rejectUnauthorized: true` and normal
  hostname verification, including URLs carrying `sslmode=disable`,
  `no-verify`, or libpq compatibility settings. Lookalike host suffixes do not
  qualify for plaintext.
- Supplied private CA/client certificate/key material is retained. Missing or
  invalid TLS files fail configuration; there is no unverifiable TLS fallback.
- Configuration parsing errors do not include a credential-bearing URL,
  password, original parser error, or private certificate path.

See [database environments](../../docs/architecture/DATABASE_ENVIRONMENTS.md)
for deployment history and migration rules. The runtime policy is source
verified; current remote certificate trust must be checked in the actual
connection environment before claiming a successful deployment connection.

## Notification lifecycle

`strategy-events.js` (driver SSE) and `jobs/triad-worker.js` subscribe through
`subscribeToChannel(channel, callback)`. Each subscription has independent,
idempotent cleanup, even when two subscriptions use the same callback.

Desired subscriptions are registered before connection/LISTEN awaits. One
per-connection queue reconciles desired channels with acknowledged LISTENs and
UNLISTENs. A new subscriber during cleanup causes LISTEN restoration before
reconciliation completes. A subscription failure removes only that caller;
it cannot leave an empty channel that suppresses future LISTEN commands.

The dispatcher is attached before initial LISTEN and delivers only for the
current connection. A connection becomes available through `getListenClient()`
only after its subscriptions restore successfully. LISTEN failures invalidate
the candidate; they are not logged as healthy restoration.

Connection errors retain surviving subscriptions and retry after 1, 2, 4, 8,
and 10 seconds, then every 30 seconds while subscribers remain. Connect/query
deadlines are 15 seconds; keepalive is every four minutes. Closing cancels retry
and keepalive timers and invalidates pending connection/query publication.
Unsubscribe never opens a connection. Only a later explicit
`getListenClient()`/subscription can reopen after close.

## Query failures

The shared pool does not transparently replay a failed query. A connection error
can arrive after PostgreSQL executed or committed an operation but before its
response reached the caller. `WITH` can contain writes and `SELECT` can invoke
sequences or volatile functions, so neither prefix proves a safe replay. The
original error reaches the caller; pg still evicts failed clients and subsequent
explicit operations can connect normally. Retries belong to callers that can
prove their operation is idempotent.

The 30-second statement timeout is sent through pg's startup configuration.
The former duplicate, unawaited connect-hook `SET` query was removed. Checked-out
client error listeners remain. `getAgentState()` contains legacy retry-agent
compatibility fields, not a health probe; readiness/health routes perform their
own `SELECT 1`.

## Verification and historical SQL

`tests/db/listen-lifecycle.test.js` exercises delayed connection, LISTEN,
UNLISTEN, failure, reconnect, and shutdown races with mock clients.
`tests/db/connection-config.test.js` checks the actual installed pg parser and
client configuration, including private CA preservation and URL redaction,
without opening database connections. SSE and worker consumers have separate
regressions in `tests/strategy/`.
`tests/db/query-replay.test.js` simulates committed operations with lost replies
and verifies that neither mutation nor ambiguous/read-looking SQL is replayed.

The active migration runner reads root `/migrations/*.sql`. SQL under this
directory (`001_init.sql`, `002_seed_dfw.sql`, `sql/`, and `migrations/`) is
historical/manual material, not an additional boot pipeline.


Final subscription release also tears down the idle physical LISTEN connection,
cancels keepalive/reconnect timers and invalidates any pending connection attempt.
A new subscription can open its own connection while the detached old client ends;
late cleanup cannot close that replacement. Explicit `getListenClient()` consumers
retain ownership until `closeListenClient()`; current production callers use
`subscribeToChannel`, while direct acquisition is exercised by the lifecycle tests.


## Read-only schema metadata check

`npm run check:schema` uses only the supplied `DATABASE_URL` and the shared
`databaseConnectionConfig()` TLS policy. It does not load environment files, boot
the gateway, apply migrations, or read application rows. Its metadata queries run
inside `BEGIN READ ONLY`, with a 15-second statement timeout.

The check counts each table object once, including historical export aliases.
For declared columns it compares SQL types (including array element types,
character limits and numeric precision/scale) and nullability in both directions.
It also compares CHECK constraint names for declared tables and reports unvalidated
checks. Missing declarations and drift return a nonzero exit status.

This is a bounded guard, not a full parity claim: it does not compare CHECK
expressions, indexes, primary/foreign/unique keys, defaults, generated expressions,
triggers, functions, policies, extra columns/tables, or reference-data contents.
Two different CHECK expressions with the same name still require review. A matching
migration ledger does not prove schema effects or required seed data exist.

`tests/schema-validation.test.js` covers drift fixtures and the offer-removal
revision mirror; `tests/db/schema-check-cli.test.js` verifies read-only queries,
TLS configuration, drift exit status and redacted errors with a mocked client.
No live database or deployment is exercised by those tests.
