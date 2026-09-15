# Tests

Updated September 13, 2026. Run commands from the checkout you are verifying.
Jest excludes nested `.worktrees/` and `.config/` copies relative to that checkout.

```sh
npm run test:unit -- --runInBand
npm run test:client -- --runInBand
npm run lint
npm run typecheck
npm run guard:json
```

`test:unit` runs JavaScript tests. `test:client` runs TypeScript/TSX tests with
jsdom, Vite environment support, and the application's path aliases. `npm test`
runs those two groups followed by the existing Playwright end-to-end suite.

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
inside a read-only transaction. It reports missing declarations, type differences
and weaker nullability. It does not validate every constraint, index, migration,
or production environment, and reports drift with exit code 1.

Two legacy suites, `blocksApi.test.js` and
`strategy/tactical-planner-cache.test.js`, start the gateway (including migrations)
or write database rows. They are retained under `jest.integration.config.js`
instead of the unit command. They require an explicitly prepared disposable
database supplied as `DATABASE_URL`, current fixtures, and
`VECTO_RUN_DATABASE_TESTS=1`; then use `npm run test:integration`. The review did
not run or claim those legacy suites or the live browser flow green.

Store generated logs, screenshots and reports in ignored output folders or `/tmp`.
