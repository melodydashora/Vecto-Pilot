# Tests

Updated October 4, 2026. Run commands from the checkout you are verifying.
Jest excludes nested `.worktrees/` and `.config/` copies relative to that checkout.

`npm run verify` is the repeatable local/CI gate: JSON syntax, lint, typecheck,
backend tests, Node FAA/airport fixtures, Offer Analyzer and venue-feedback
API/PGlite fixtures, client tests, dedicated UI harnesses, startup-tool fixtures,
and the production client build. It stops at the first
failure. The **Verify** GitHub workflow runs this
command on a fresh checkout with development dependencies installed and no
application secrets supplied. It does not publish or enable the separate
write-capable **Auto Fix CI Failures** workflow (which listens for **CI**).

Use Node `^20.19.0 || ^22.12.0 || >=24.0.0`, matching the locked Vite/plugin
and Jest requirements. Node 18 is unsupported. `check:ts` is a fail-loud alias
of `typecheck`; its exit status is no longer discarded.
The existing startup-tool fixtures also require Python 3 and Git; they use only
the Python standard library, temporary directories and synthetic credentials.

```sh
npm ci --include=dev
npm run verify

# Individual checks when investigating a failure:
npm run test:unit -- --runInBand
npm run test:node
npm run test:offers:api
npm run test:feedback:api
npm run test:client -- --runInBand
npm run test:client:harness
npm run test:startup
npm run lint
npm run typecheck
npm run guard:json
```

`test:unit` runs JavaScript Jest tests. `test:node` runs the two existing
FAA/airport `*.node.test.mjs` fixture suites; their provider fetches are replaced
with synthetic responses. `test:offers:api` runs the actual Offer Analyzer router/DAL and
SQL against disposable in-memory PGlite; it never connects to the workspace
database. `test:feedback:api` does the same for venue-feedback and saved-block
routers, with provider/learning calls replaced by fixtures. `test:client` runs TypeScript/TSX tests with
jsdom, Vite environment support, and the application's path aliases.
`test:client:harness` runs four dedicated UI harnesses
(`offers/*.ui`, `feedback/*.ui`, `settings/*`, `briefing/airport-status.ui`)
under their own `tests/*/jest.*.config.cjs` configurations, sequentially with one
worker. The first three rely on CommonJS mock hoisting; all four are excluded
from the ESM client config so each suite runs once. `npm test`
also includes both API harnesses and the Python startup-tool fixtures, followed
by the existing Playwright end-to-end suite.

Run the verification gate in a clean checkout without real `.env*` files or
application credentials in its environment. A shared Replit environment can
contain `DATABASE_URL`, provider credentials and database-test opt-ins; do not
treat that as an isolated test environment. The default unit fixtures use mocked
providers and in-memory PGlite. Keep `VECTO_RUN_DATABASE_TESTS` unset for them.
`verify` deliberately excludes the live model-list guard, database/schema
commands and Playwright against the running gateway. Successful fixture tests
and a client bundle do not certify live providers, a physical phone, deployment
schema or end-to-end product behavior.

## Test entrypoint inventory

These are the existing configured fixture groups included by `verify`:

| Entrypoint | Selection | Isolation |
| --- | --- | --- |
| `test:unit` | `jest.config.js`, JavaScript Jest suites | Mocked providers/DB or in-memory PGlite; real-DB opt-in must stay unset |
| `test:node` | `tests/briefing/*.node.test.mjs` | Node test runner, mocked FAA fetches and pure airport mapping |
| `test:offers:api` | `tests/offers/jest.api.config.cjs` | Real Offer Analyzer router/DAL against in-memory PGlite |
| `test:feedback:api` | `tests/feedback/jest.api.config.cjs` | Real venue-feedback/saved-block routers against in-memory PGlite |
| `test:client` | `jest.client.config.js`, TypeScript/TSX Jest suites | jsdom and synthetic transports; dedicated harness paths excluded |
| `test:client:harness` | Offer Analyzer records UI, feedback UI, Settings, airport UI configs under `tests/` | Four sequential jsdom/CommonJS harnesses, one owner per suite |
| `test:startup` | `tests/startup/test_*.py` | Temporary Codex homes, synthetic credentials, SQLite fixtures and fake executables; no real agent session |

The following entrypoints require a prepared external target or perform
operational mutations. They remain explicit checks outside `verify`:

| Entrypoint | Why it is separate |
| --- | --- |
| `jest.integration.config.js` | `blocksApi.test.js` boots the gateway/migrations; `tactical-planner-cache.test.js` writes/deletes actual DB rows; guarded by `VECTO_RUN_DATABASE_TESTS=1` |
| `tests/briefing/jest.postgres.config.cjs` | Requires disposable `127.0.0.1:55432/vecto_preview`; verifies actual PostgreSQL lock contention |
| `tests/feedback/jest.postgres.config.cjs` | Same explicit disposable PostgreSQL target; real locking, writes and cleanup |
| `playwright.config.ts`, `tests/e2e/*.spec.ts` | Browser flows expect an already running gateway; `test:e2e` currently selects `copilot.spec.ts` |
| `tests/scripts/smoke-test.js`, `preflight-check.js` | Read running-server endpoints or supplied database metadata |
| `tests/run-all-tests.js`, `run-all-phases.js`, `gateway/test-routing.js`, `eidolon/test-sdk-integration.js`, `triad/test-pipeline.js`, `phase-c-infrastructure.js` | Legacy/manual running-service checks, including real pipeline requests; not isolated fixture groups |
| `tests/verify-startup.sh`, `tests/scripts/toggle-rls.js` | Operational helpers that kill/start services or alter DB RLS; not test fixtures and not part of the quality gate |

Fixture/helper modules, `tests/setup/`, transformers, JSON inputs and README files
support these runners; they are not independent test entrypoints. New suites
must have a documented runner and isolation boundary so files cannot silently
fall outside the gate.

| Area | Coverage |
| --- | --- |
| `auth/`, `api/`, `middleware/` | Account writes, session lifecycle, authorization, routing |
| `client/` | Login, reset, feedback, streams, Briefing content/recovery, Strategy event display |
| `coach/` | Current schema metadata, action validation, message ownership |
| `events/`, `briefing/` | Schedule integrity, deduplication, cleanup, generation admission |
| `offers/` | Offer parsing, rules, normalization and request deduplication |
| `schema-validation.test.js` | Pure schema-metadata comparison without database access |

The old duplicate Coach suites were consolidated under `coach/`. The former manual
near-event ranking script now tests the actual production comparator with
assertions that fail the test runner.

## SQL and integration checks

Event-cleanup SQL tests (`events/cleanup-timezone.test.js`) run the real generated
SQL against an in-memory PGlite database with synthetic rows. `@electric-sql/pglite`
is a devDependency and resolves from `node_modules` by default;
`VECTO_TEST_PGLITE_MODULE` optionally points at another module path. They never
touch the workspace database.

```sh
npm run check:schema
```

`check:schema` explicitly reads only metadata through the supplied `DATABASE_URL`,
inside a read-only transaction using the shared TLS configuration. It deduplicates
table exports and reports missing declared columns, exact SQL type differences
(including array elements, varchar limits and numeric/timestamp precision),
nullability drift in either direction, and missing/unmirrored/unvalidated CHECK
names for declared tables. It does not compare CHECK expressions, indexes,
primary/foreign/unique keys, defaults, generated columns, extra tables/columns
or application data. It reports covered drift with exit code 1; one database's
result does not verify another environment or the migration history.

Two legacy suites, `blocksApi.test.js` and
`strategy/tactical-planner-cache.test.js`, start the gateway (including migrations)
or write database rows. They are retained under `jest.integration.config.js`
instead of the unit command. They require an explicitly prepared disposable
database supplied as `DATABASE_URL`, current fixtures, and
`VECTO_RUN_DATABASE_TESTS=1`; then use `npm run test:integration`. The review did
not run or claim those legacy suites or the live browser flow green.

Store generated logs, screenshots and reports in ignored output folders or `/tmp`.
