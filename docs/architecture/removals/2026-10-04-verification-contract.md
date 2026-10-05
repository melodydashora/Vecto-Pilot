# October 4, 2026 — Verification contract cleanup

Codex/Astra, for Melody's request to repair root causes and make repository,
schema and build verification consistent. Base: `b4bba633a8495cd147f565cf8f3a541e4f39ad93`.
This records source changes, not a deployed app or a successful live-provider,
database or phone test. Exact previous text is recoverable from the base commit.

1. **package.json / package-lock.json, engines.** Removed `"node": ">=18.0.0"`.
   Locked Vite 7.3.6 and plugin-react 5.1.3 require Node 20.19+ or 22.12+;
   Jest 30 excludes odd Node 21/23. The declared range now matches their
   intersection: `^20.19.0 || ^22.12.0 || >=24.0.0`. No dependency version changed.
2. **package.json, check:ts.** Removed `|| true` from `npm run typecheck || true`.
   That suffix made TypeScript errors report success to callers. The alias now
   propagates the actual compiler result.
3. **package.json, db:push.** Retired `drizzle-kit generate && drizzle-kit push`
   from this public script. Direct pushes bypass versioned SQL and the migration
   ledger. The command now stops without opening a database, with instructions
   to review migrations and explicitly select the target before `db:migrate`.
   It is not silently redirected into an actual migration.
4. **jest.client.config.js, harness exclusion comment.** Replaced the dated
   paragraph beginning “2026-09-15: these suites use CommonJS `jest.mock`
   hoisting…” with the current separation rationale. The airport suite had its
   own harness but was also selected by the ESM client runner; it now runs once.
5. **tests/README.md, introduction / test commands / harness paragraph.** Replaced
   the September 15 date and four-suites-all-require-hoisting claim with the
   actual harness split, sequential workers, runtime requirements and the
   repeatable `verify` command. Live tests and fixture tests remain distinct.
6. **.github/PULL_REQUEST_TEMPLATE.md, Testing / Database / CI Status.** Removed
   mandatory seed advice, nonexistent `test:blocks` and `scripts/test-all.sh`,
   direct `db:push` guidance, and the unsupported assertion that GitHub already
   ran lint/typecheck/Jest/Playwright. The template now asks for actual gate
   results and separate evidence for migrations and live integration.
7. **package.json, test / verify.** The existing Node-test FAA/airport fixtures,
   separate Offer Analyzer and venue-feedback API/PGlite harnesses, and Python
   startup-tool fixtures were not selected by the normal Jest configs or any
   npm test command. They now have explicit commands in both aggregate runners.
   Those fixtures make no live FAA/application-database requests or real agent
   sessions. The tests README inventories each runner and the intentionally
   separate live-target/operational helpers.
8. **docs/architecture/TESTING.md, opening status.** Retired the unqualified
   “Canonical reference” claim for its April 14 counts/commands and planning
   tables. Retained the dated document with an explicit historical scope and
   pointer to current runnable checks; no historical result was rewritten as a
   fresh verification.
9. **tests/markets/ensure-market.test.js, opening comment.** Removed the dated
   assertion that `ensureMarket` "is exercised by the live smoke"; this suite
   only proves the pure slug transformation. Both this test and token-dispatch
   fixtures imported modules that eagerly opened the app database, so the new
   credential-free aggregate run failed before assertions. They now replace
   storage/provider dependencies with fail-loud mocks before dynamically
   importing the actual function under test, and assert that those boundaries
   were not touched. Application connection requirements remain unchanged.
10. **tests/feedback/venue-feedback.api.integration.mjs, seedScope.** Replaced
    manually incomplete snapshot/Briefing/strategy rows with the existing
    coherent fixtures and matching generation provenance. The newly included
    cached-route test failed because its fixture omitted MAIN admission and
    predates source-readiness checks. It now uses the existing synthetic MAIN
    boundary (whose SQL has dedicated tests), while retaining the real route,
    source validation, feedback SQL and fail-loud provider guards. No runtime
    admission or completeness requirement was removed.

11. **tests/startup/test_codex_persistence.py, socket fixture.** Replaced the
    absolute `listener.bind(str(self.home / "fixture.sock"))` address with a short
    relative bind inside the disposable fixture home, restoring the previous
    directory in `finally`. A long `TMPDIR` exceeded the Unix-socket address
    limit before the persistence assertion ran. The test still creates and
    explicitly verifies a real socket and checks that the checkpoint excludes
    it. All 19 startup cases pass under a 139-byte temporary-root path. No
    persistence/runtime code changed.

The new **Verify** workflow is deliberately separate from the existing **Auto
Fix CI Failures** workflow that reacts to a workflow named **CI**. Verification
has read-only repository permissions, no supplied app secrets, and does not
publish or request automated fixes. Branch protection is an external setting;
adding this file alone does not make the check required for merging.

## Integrated Offer Analyzer and configuration cleanup

Codex/Astra integration, October 4. The Offer patterns row JSDoc in
`server/lib/ai/rideshare-coach-dal.js` previously ended `taken, avg_earned }`;
the `rows` parameter JSDoc in `server/lib/offers/offer-patterns.js` likewise
omitted `reported`. Both now include the count of explicitly reported earnings
used by the average. The former declarations are preserved in the base commit.

Removed the redundant `.eslintrc.cjs` from the candidate. The current ESLint 9
command uses `eslint.config.js`, no legacy-mode switch or runtime consumer was
found, and `scripts/check-standards.js --check=lint` explicitly rejects this old
configuration. The February 4 migration receipt claimed it was removed, but it
survived in the reviewed base. A byte-verified recovery copy and removal receipt
are retained in the Astra workspace outside the app checkout; the original is
also recoverable with `git show b4bba633:.eslintrc.cjs`. Historical receipts are
not rewritten. No original screenshots or project history were removed.

## Canonical vocabulary and source entry points

Melody requested one clean working app and an explicit lexicon on October 4.
The feature name is **Offer Analyzer**; **offer/offers** describe the observed
and tracked records. The existing root `LEXICON.md` is the single term reference.
Its 734-line predecessor mixed obsolete role order, environment overrides,
Coach/MAIN definitions, nonexistent imports and GPS accuracy claims. The complete
old file was read and retained outside the app with SHA256 verification and is
recoverable as `b4bba633:LEXICON.md`. Current definitions link to current source;
the temporary second draft lexicon was removed before integration.

The 457-line root README was read and replaced with a concise source entry point.
It no longer presents old subsecond benchmarks, copied model pins, deployment
claims, conflicting table/market counts, the obsolete MAIN diagram, Node 18 or
direct schema-generation advice as current facts. Its historical changelog and
original prose remain recoverable as `b4bba633:README.md` and in the same external
archive. The partnership originals and authored product requirements remain intact.

`server/lib/location/README.md` now indexes actual modules and canonical contracts.
Removed examples imported deleted snapshot-context/validation modules and equated
coordinate-key resolution with GPS accuracy. `public/README.md` now explains the
actual client static root and the separate JWKS utility output. Both original
documents are hash-preserved outside the app and recoverable from the base.

Removed the unused `formatDate`/`formatCurrency` exports from
`client/src/lib/utils.ts`; all repository consumers use `cn`, which remains.
Removed the unreferenced Hello-world `main.py` scaffold while retaining Python
startup tooling. Removed only root `public/robots.txt`, byte-identical to the
actual Vite input `client/public/robots.txt`. Whole-file recovery copies and their
SHA256 manifest are retained outside the app. These are bounded usage-checked
removals; ignored private runtime files and purposeful images were not cleaned.

The migration-runner baseline header formerly described separate DDL execution
and per-file baseline ledger inserts; the October 4 header describes the new
atomic bootstrap. The old comment is retained in `b4bba633:server/db/run-migrations.js`.
Database guides now distinguish historical provider/schema observations from
the current read-only development result and uninspected production state.
Changing these guides did not execute an application-database migration.

Offer Analyzer naming also updates the former `OFFER ANALYSIS HISTORY (Siri
Shortcuts)` heading and `2026-02-16: Ride offer analysis log for pattern-aware
coaching` comment in `rideshare-coach-dal.js`. Their exact former text is preserved
here and in the base commit; the source handles analyzed offers from multiple
entry paths. Record fields, route names and the legacy external shortcut's actual
name remain compatible.

## Shared distance calculation

The byte-identical private `haversineMiles` implementations in
`server/lib/venue/enhanced-smart-blocks.js` and
`server/lib/ai/providers/consolidator.js` now use one export from
`server/lib/location/geo.js`. All three event/home callers retain the same
3958.7613-mile radius, arithmetic and null/undefined-to-Infinity contract. The
existing meter-based helpers have different semantics and were not substituted.

The removed April 11 rationale/JSDoc and the consolidator's shorter distance
comment are preserved verbatim in the external dated
`2026-10-04-distance-removal-ledger.md`, alongside original source snapshots and
SHA256 values. They are also recoverable from those two paths at `b4bba633`.
Thirteen boundary/null/zero/geometry cases and 55 existing caller tests passed;
4,902 exact comparisons against the original functions found no changed result.
