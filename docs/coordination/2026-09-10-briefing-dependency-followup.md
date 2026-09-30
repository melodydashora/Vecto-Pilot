# Briefing dependency follow-up — September 10, 2026

This follows `14a02fa1f236742f2f0dc292f4a40f0f1b301494` on base
`2269e628`. Do not deploy the first commit alone: its held session-lock approach
was superseded after review found a write race and pool starvation risk.

The follow-up uses a UUID `briefings.generation_token` and short Drizzle
transactions. The claim retains Claude's exact lock namespace/key:
`pg_try_advisory_xact_lock(hashtext(snapshotId))`. Providers run after the
transaction ends. AsyncLocalStorage carries the owner through all pipelines;
progressive, final and failure UPDATEs atomically require snapshot ID, token and
`status = 'pending'`. The old caller joins its replacement if it loses ownership.
Late writes after completion cannot change the row. Ordinary duplicate requests
wait at most 90 seconds and never claim another pending token.

Legacy partial refresh helpers now use coherent full regeneration. Cached
Strategy responses keep saved text and venues while current Briefing work is
pending, with `status: pending`, `briefingStatus: pending`, `strategyFresh: false`
and `waitFor: ['briefing']`. Polling does not auto-correct this state to complete.
Missing/unowned legacy Briefings, and owned pending work with no progress for
90 seconds, produce `briefing_failed` with `retry: new_snapshot` and a concrete
explanation. This does not mutate or steal generation ownership. The existing
red-screen retry creates the new snapshot. The final venue-model guard releases
its pending_blocks claim before propagating a Briefing readiness failure.

Event category failures/timeouts now fail the section even when cached rows exist.
Missing source dates/times are rejected before normalization can supply defaults.
Canonical validation errors for required content fail; genuine date-window
exclusions remain explained empty results. Model empty-result explanations are
retained. Discovery, event persistence and DB-read failures propagate to the
section error marker. Claude's unused `hour` removal remains removed.

## Verification

The final runtime tree in this follow-up passed **98 server tests** across six
focused suites, and the existing **4 rendered UI tests** passed. Provider/network,
database and auth boundaries are mocked. Fencing tests compile actual Drizzle SQL
predicates and evaluate their bound token/status conditions after deferred writes;
they are not a substitute for integration testing against Postgres. Event tests
also exercise the actual normalizer/validator for malformed dates and date-window
exclusions. Cached GET/POST/poll tests invoke the real route handlers.

```powershell
$env:NODE_ENV='test'
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/briefing/briefing-readiness.test.js tests/briefing/briefing-dependency.test.js tests/briefing/briefing-provider-failures.test.js tests/briefing/briefing-events-failures.test.js tests/briefing/briefing-error-poll.test.js tests/briefing/briefing-cached-route.test.js
node node_modules/typescript/bin/tsc -p tsconfig.client.json --noEmit
node node_modules/eslint/bin/eslint.js server/lib/briefing/briefing-readiness.js server/lib/briefing/briefing-aggregator.js server/lib/briefing/briefing-generation.js server/lib/briefing/briefing-notify.js server/lib/briefing/pipelines/events.js server/api/strategy/content-blocks.js server/api/strategy/blocks-fast.js
git diff --check
```

Client type checking uses the root `tsconfig.client.json`, which includes the
Google Maps types. The separate `client/tsconfig.json` omits those types and fails
on existing map files. Scoped runtime ESLint and whitespace checks pass. Linting
the entire `shared/schema.js` separately finds one pre-existing unused `table`
argument warning; the only schema change is the new column.

The UI suite needs TSX transformation and jsdom; base Jest configuration only
selects JS. The temporary local harness uses ts-jest with ESM, React JSX,
`@/` mapped to `client/src/`, and this worktree as `rootDir`. Point rootDir at the
integration worktree before rerunning. No shared test/package configuration was
changed. Node VM/ts-jest deprecation warnings do not fail these focused suites.

## Integration and rollout

Apply `migrations/20260910_briefing_generation_token.sql` before enabling the new
writer. This deliverable only adds migration source; it does not execute it.
Drain/replace every old generation worker before routing work to the new code.
Mixed-version writers are unsafe because the old UPDATEs lack token predicates.
The additive column leaves old completed rows readable; it does not certify
unmarked old rows as complete. A new snapshot/retry regenerates those contexts.

When combining Claude's branch, preserve his ownership/operator guards and
short-transaction intent, and retain this follow-up's full aggregator behavior.
Parent-owned FAA changes remain separate. Root/CLI owns broader retained-Strategy
UI state and account-scoped cache/session behavior; it should consume the pending
and retry metadata rather than promote retained data to fresh while pending.

No live DB/provider calls, migrations, gateway startup, application deployment,
push, or edits to another worktree were performed. No durable queue or automatic
lease takeover is introduced. Shared event/venue ETL stores and opportunistic
cleanup helpers retain their separate ownership/maintenance behavior; the token
fences the Briefing row, not every shared catalog write.
