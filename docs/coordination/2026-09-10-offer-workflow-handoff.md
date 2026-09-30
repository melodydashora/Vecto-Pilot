# Offer workflow candidate — September 10, 2026

Provenance: an Astra Desktop Codex subagent implemented Melody's request after
the coordinator inspected the signed-in Offer Analyzer UI. This is a separate
local source candidate; no live app, private offer record, production migration,
provider, or deployment was changed. The subagent used file-based context and
did not claim a fresh live continuity-table read.

Branch: `codex/vecto-offer-workflow-20260910`.
Base: `2269e628afdc438480e3f4e3889204e926f40459`.
Verified implementation commit: `f6ccada4e3975c53f857778f0b252df118d0bb22`.
The coordinator separately reconciled relevant app source with Replit main
`6a97c058`; that source reconciliation is not deployment of this candidate.

The outcome dropdown now has a distinct Other/error option and optional reason.
Followed is available only for a usable ACCEPT/REJECT recommendation. Changing a
dropdown edits a draft; Save outcome is explicit. A new earnings draft can start
with the trusted offered amount, but this does not persist earnings. Saved zero
and unknown amounts survive Edit. Confirmed saves collapse to a compact summary
with Edit; failures and conflicts keep the draft visible. Inputs are disabled
while saving. Explicit Rejected/Cancelled/Other clears prior earnings, retaining
the existing non-taken-outcome policy.

The chart defaults to a labeled rolling seven days, with 30/90-day choices and
exact returned bounds. Counts use all owned offers received in the selected
`[start,end)` window, independently of the unchanged latest-25 editor list.
Analyzer recommendations and driver decisions remain distinct. Completed joins
Accepted; cancelled, Other/error, unrecorded and analyzer NO DATA remain explicit.
Only driver-submitted monetary fields count as reported earnings. Offered money
and rejected offers are not savings, earnings, or proof of financial impact.

## Coordination and compatibility

The original OffersCard query/auth/SSE block was compared against the base and
is identical. Shared auth, query client, API/query-key constants, package/lockfile,
and shared Jest configuration were not edited. Root must retain the live Astra
CLI's authentication/cache work when integrating this UI extraction.

Claude's fetched `f09e8d58c6bb71fcf47b66d2143d84cf295c16e1` was read during this
implementation. Its outcome timestamp contract is preserved alongside revision:
GET returns `outcome_updated_at`; POST accepts `expected_outcome_updated_at`
(ISO with timezone or null); success returns `updated_at`; stale responses keep
`error: outcome_conflict` and the `outcome` alias as well as new `current`.
Timestamp strings retain PostgreSQL microseconds; no millisecond equality fallback
is used. New UI sends `expected_revision`; it takes precedence if both tokens are
provided. The previous unsafe unconditional path is intentionally rejected with
400 `outcome_version_required` and a refresh instruction, as root approved.
Old cached clients with neither version token must refresh at rollout.

The only schema change is the new forward outcome migration: add revision 1 and
its positive-value CHECK, and extend the existing named decision CHECK with Other.
It preserves old rows and does not modify previously applied migrations. Root
must reconcile these same server/schema edits with Claude's branch rather than
overwrite that branch or assume this worktree contains all its other changes.

## Verification

Final focused results: **19 passed, zero failures/skips** — 11 React DOM tests
and 8 actual Express-router/SQL tests. All ran serially on Node 26.3.0 with existing
dependencies; no package installation was performed.

```text
node node_modules/jest/bin/jest.js --config tests/offers/jest.ui.config.cjs --runInBand
node --experimental-vm-modules node_modules/jest/bin/jest.js --config tests/offers/jest.api.config.cjs --runInBand
node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit --pretty false
```

The SQL command needs an existing `@electric-sql/pglite` package available to Node
(this run supplied another existing dependency directory through temporary
`NODE_PATH`). It creates only disposable in-memory tables and synthetic identities,
runs the original/forward schema there, and closes that database after testing.
The separate `.mjs` integration harness and UI config are opt-in; they do not
change shared test/package ownership or introduce a missing dependency into the
default Jest suite. Coordinate any future normal-CI dependency wiring separately.

Coverage includes canonical partial updates, zero/null retention, version races,
timestamp/microsecond/offset compatibility, stale-write recovery, user ownership,
mismatched legacy joins, first migration preservation, repeated migration, exact
window boundaries, more than 100 offers, empty periods, draft/error/collapse/Edit
flows, old-client refresh instructions and late account/period responses.
Focused ESLint (five changed runtime modules, zero warnings), client TypeScript,
JavaScript syntax and `git diff --check` also pass.

The DOM harness substitutes the existing Radix select and chart rendering
primitives; it verifies component behavior, not geometry. The SQL harness mocks
authentication and uses one PGlite engine; it does not establish real provider
login or multi-connection PostgreSQL behavior. No full application test suite or
production build was run on the deteriorating laptop.

Pending: root combined-source review; preservation/integration of live CLI auth
and cache changes; real browser/mobile/keyboard/chart review; real PostgreSQL
concurrency and rollout schema readback; refreshed-client rollout verification.
No push or deployment is claimed by this handoff. Existing shortcuts remain in
Melody and Claude's scope. No private offer history, token, or account data is in
the synthetic fixtures or this receipt.
