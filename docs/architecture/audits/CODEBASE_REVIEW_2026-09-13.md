# Codebase review and fixes — September 13, 2026

Codex/Astra, at Melody's request. Review and reversible fixes are prepared in
`.worktrees/astra-codebase-fixes-20260913`, branch
`astra/codebase-fixes-20260913`, based on
`6a97c0584cc868fe8e2c7610c79f44a1b53ed1db`. They are uncommitted and have not been
merged, deployed, or applied to another checkout.

Melody authorized schema-consistent fixes, clearer names, duplicate/dead-code and
artifact cleanup, and removal of the broken browser Translator. This patch makes
no changes to `shared/schema.js` or migrations. Concurrent work on main changed
both application code and the live database during this review; the integration
requirements below are material, not a claim that this old-base branch is ready
to deploy.

## Scope and evidence

The initial inventory covered 711 code/configuration files, about 181,508 lines,
with syntax, import, duplicate-code, route, test-discovery, and artifact checks.
Deeper source and behavior review covered authentication, client state, Coach,
Briefing/events, intelligence routes, ownership checks, and verification tooling.
This is a broad repository review, not a claim that every line was manually
audited or every possible defect found.

Startup used the current partnership files, relevant preflight cards, handoffs,
and actual working-tree state. Live continuity was read through a separate SDK
client connected to `node mcp-server.js --stdio`; it was not a native Codex MCP
tool connection. Relevant memory rows included 311–314, 366, 374, 377, 439–442,
plus related tasks, lessons, definitions, and product rules. The referenced
September 7 release-readiness plan was missing from main. Private memory contents
and driver data are not reproduced here.

## Confirmed fixes

| Priority | Before → after | Principal implementation / verification |
| --- | --- | --- |
| High | Account creation could leave partial users/profiles/credentials → related writes now commit or roll back together. | `server/api/auth/auth.js`; account transaction tests |
| High | OAuth state could be consumed twice → conditional `DELETE RETURNING` gives one request ownership. | Auth exchange routes; actual-handler tests |
| High | Tokens were not bound to the current login → newly issued JWTs include a session ID checked by middleware. Delayed logout/expiry/activity writes cannot alter a newer session. | `server/lib/jwt.js`, `server/middleware/auth.js`; deferred race tests |
| High | Concurrent password resets could reuse a token or SMS code → conditional unexpired, unused claims occur inside the password/session transaction. | `auth.js`; concurrent requests, expiry/reissue and rollback/retry tests |
| High | Global memory/intelligence writes lacked an operator boundary; message starring lacked an owner predicate → existing operator policy and caller ownership now apply. | `require-operator.js`, memory/intelligence routers, Coach DAL; authorization tests |
| High | Separate client query caches and late replies could retain previous-user state → one shared query client, identity-bound requests, aborts and response fences. | Auth context, query client, OffersCard; client behavior tests |
| Medium | Google callback replay, hidden reset-form email validation, and feedback failure handling broke ordinary flows → one-time exchange reuse, flow-specific validation, explicit success and preserved drafts. | Auth pages, FeedbackModal; component tests |
| Medium | Briefing failures could retry indefinitely or appear ready; consumers discarded failure metadata → bounded retries, preserved section envelopes, visible unavailable state and working Retry. | `useBriefingQueries`, context, BriefingPage/Tab; actual provider/page tests |
| Medium | A second header query could replace Briefing fetching behavior → header observes the existing aggregate cache. | `GlobalHeader.tsx`; Briefing coverage |
| Medium | Coach stream parsers duplicated logic and mishandled partial chunks → one shared decoder buffers complete SSE lines and releases its reader. | `utils/coach/readCoachEvents.ts`; stream tests |
| Medium | Tactical staging/plan requests omitted authentication → both use the existing authenticated request helper. Four intelligence routes were shadowed by `/:id`; staging reads now also verify snapshot ownership. | TacticalStagingMap, intelligence router; type/build and route tests |
| Medium | Event cleanup used the caller's timezone and could remove valid records → authoritative venue timezones, guarded invalid schedules and conservative daylight-saving handling. | `cleanup-events.js`; six SQL tests and one mocked failure-policy test |
| Medium | Malformed event schedules became invented times; non-ASCII names could collapse; conflicting place IDs could merge → strict schedule validation, Unicode-aware keys, authoritative distinct place IDs. | Event pipeline, consolidator, venue matcher; regression suites |
| Medium | Failed event reads looked like verified empty data; next-day openings had incorrect countdowns → failures propagate and countdown uses the actual interval. | Events pipeline and hours evaluator; regression tests |
| Medium | Same-process Briefing calls passed admission before the first await → generation promise is registered synchronously and cleared after settlement. | `briefing-aggregator.js`; contention/failure tests. Cross-process issue remains below. |
| Medium | Passing test commands could hang forever → background pool monitoring no longer keeps an otherwise finished process alive. | `connection-manager.js`; before/after process-exit probe and complete Jest run |

Historical no-session-ID JWT compatibility remains; the new session guarantee
must not be described as universal revocation of old tokens. Google account
linking policy was not changed.

## Removal, naming and verification cleanup

The browser Translator tab, overlay, quick phrases, dedicated page and
`/api/translate` router were removed with their navigation, exports and misleading
product claims. Old `/co-pilot/translate` bookmarks redirect to Coach. The separate
Siri `/api/hooks/translate` endpoint and Coach speech/TTS remain active; see
`../removals/2026-09-13-browser-translator.md`.

Duplicate Coach schema/validation suites now live under `tests/coach/`. Five stale
client suites were replaced with current behavior coverage. The near-event
ranking test now asserts against the production comparator. Stale Coach schema
field names and Zod validation handling were corrected. Unused query-key/query
helpers were removed; the PostgreSQL unique-error helper is named
`server/db/postgres-errors.js` to reflect its purpose.

Removed obsolete duplicate snapshot/dedup/parity scripts, standalone provider
examples, a tracked terminal transcript, a briefing row dump, and generated test
screenshots/reports. Original evidence in other checkouts/history was preserved.
Useful snapshot/news/holiday scripts had stale imports or columns corrected.
Historical plans and unproven dead code were not indiscriminately deleted.

Jest now excludes nested worktree/config copies: initial discovery found 239
tests, including 205 foreign copies; final unit discovery finds 40 canonical
suites and zero nested copies. Client TypeScript/TSX tests run through a restored
configuration. The Replit Verify action uses `tsc -b`; its old bare TypeScript
command checked zero project files. JSON validation now enumerates actual files
instead of passing a literal glob. Generated output belongs in ignored folders
or `/tmp`, not Git.

## Verification

Commands run from the isolated checkout:

```sh
VECTO_TEST_PGLITE_MODULE=/tmp/vecto-audit-test-tools/node_modules/@electric-sql/pglite/dist/index.cjs npm run test:unit -- --runInBand
npm run test:client -- --runInBand
npm run lint
npm run typecheck
npm run guard
npm run build:client -- --outDir /tmp/vecto-fixes-client-build
git diff --check
npm run check:schema
```

The final run passed **40 JavaScript suites / 983 tests**, with zero skips and
natural process exit. Client coverage passed **9 suites / 43 tests**. Lint, type
checking, JSON/dependency guards, build and whitespace checks passed. The reset
follow-up also passed four synthetic SQL probe groups using the actual handler
and generated Drizzle SQL: one winner for each reset channel, and rollback/retry
for each channel.

PGlite 0.3.16 was installed only under `/tmp` for synthetic SQL fixtures. Its
six cleanup cases execute PostgreSQL-compatible SQL; a seventh checks failure
policy with a mocked database. These tests do not establish
production load, multi-session advisory-lock behavior, or complete migration
coverage. Handler tests mock database/provider boundaries. No application
gateway, migrations, provider calls or driver-data writes were used for testing.

Two legacy suites that start the gateway or write database rows are retained in
`jest.integration.config.js`, explicitly gated for a prepared disposable
`DATABASE_URL`. They were not run. Playwright end-to-end flows were not run.
The client build still reports an oversized main chunk and an old Browserslist
dataset. See `tests/README.md` for commands and boundaries.

## Schema state and integration requirements

The metadata checker uses the supplied `DATABASE_URL` inside `BEGIN READ ONLY`.
It checks declared columns, basic types and weaker database nullability; it does
not certify indexes, foreign keys, constraints, migrations or other environments.

At the first read, the base schema declared 67 tables / 976 columns; only the six
columns of absent `agent_changes` were missing, with no detected type/nullability
differences. At the later read, 147 declared columns across 12 absent tables were
reported, again without differences in remaining column types/nullability:

`agent_changes`, `block_jobs`, `driver_goals`, `driver_tasks`, `eidolon_snapshots`,
`llm_venue_suggestions`, `market_intel`, `safe_zones`, `staging_saturation`,
`traffic_zones`, `uber_connections`, `venue_events`.

That final check correctly exited 1. Concurrent main work has retired tables and
the Uber feature, and revised schema/index/migration declarations. Its separate
`DB_SCHEMA_EVALUATION_2026-09-13.md` records additional findings. These changes
were not made by this patch and must not be overwritten by this older checkout.

Before integration, review the **current** main diff, retain its schema/table
retirement, and reconcile shared routes, Google callback, intelligence router,
bootstrap and Replit configuration. Early Uber URL/status/UI repairs in this
branch are superseded by main's retirement: omit those repairs and their new
Uber-route test when integrating; do not restore deleted Uber files or tables.
Re-run checks and disposable integration tests after reconciliation. This report
does not certify either the concurrent main patch or the combined result.

## Remaining work

Cross-process Briefing generation still needs durable ownership at every
progressive/final/failure write. Current session advisory locks are used through
a pool and released before generation. Holding one of the shared 25 connections
per Briefing can starve the writers; loss of that connection also cannot prevent
old provider tasks writing after a new owner starts. A partial lock-only repair
was therefore not added.

The existing September 12 candidate contains a generation-token approach,
including `briefing-generation.js`, writer/readiness changes and a
`briefings.generation_token` migration. It needs coordinated review/integration
and multi-process PostgreSQL tests; importing only its lock helper is incomplete.
This review deliberately leaves that schema work with the coordinated pipeline
integration rather than silently adding a new schema contract.

Broader audit and release tasks remain open. This pass does not certify every
dormant script, runtime integration, identity-linking policy or deployment.
Permissions recovery was separately verified with normal root and fresh/resumed
worker probes; the stale frontend worker was replaced with its work preserved.
The tooling receipt is in
`.config/astra-vecto-coordination/2026-09-13-permissions-recovery-reply.md` in the
main workspace. The separate codex-security MCP EACCES is not claimed repaired.

An attributable completion/integration handoff was added to existing continuity
memory as row 443, threaded under 439, and read back successfully. Existing broad
audit and release task statuses were preserved.
