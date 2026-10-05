# Pipeline readiness — October 4, 2026

Melody requested root-cause bug fixes, consistent schemas and requests, and a
pipeline-by-pipeline path to deployment readiness. This is an evidence register,
not a claim that every feature is complete or that this source is deployed.

## Baseline and preservation

Direct SSH inspection found `/home/runner/workspace` on `main` at
`b4bba633a8495cd147f565cf8f3a541e4f39ad93`, with a clean tracked/untracked working
tree, one registered worktree and no stash. The original September 30 pre-rebase
branch has the same complete tree. Existing recovery branches and ignored private
coordination folders are preserved; a clean main does not establish that every
archived candidate was integrated. The historical `replit-agent` branch ends on
September 28 and is divergent, not a new result from this review.

The current workspace runs Node 20.20.0. The earlier phone Node 18 install failed;
its partial dependencies are not used as test evidence. Tests run in isolated
copies with the application/provider environment removed. Replit Agent is not
invoked. No commit, push, gateway restart, production migration or publication is
part of this source review.

Live project continuity was read through the existing MCP SDK stdio server over
SSH in read-only mode. Tasks 91 and 75 remain the existing readiness umbrellas.
Historical successful checks and current source checks are separate receipts.

## Pipeline contracts and acceptance map

Each row names a source contract to trace from request through persistence and
consumer. A source link or test name is not proof that a live run passed.

| Pipeline | Request/ownership boundary | Durable contract and consumer | Source and fixture checks | Live acceptance still required |
|---|---|---|---|---|
| Preferences, authentication and MAIN admission | Current stored user/session; explicit Continue identity and expected settings/run/snapshot revisions | Saved profile/vehicle/services and `main_run_admissions`; replay reuses its receipt, an obsolete response cannot replace current intent | [Auth](../AUTH.md), [preferences](../USER_PREFERENCES.md), `tests/auth`, `tests/strategy/main-run-admission.test.js`, `tests/client/run-setup.test.tsx` | Legitimate login, edit/confirm, lost-response retry and account switch against reviewed runtime |
| GPS and snapshot | Fresh precise observation and capture UUID bound to current owner/session; GPS-derived timezone | One validated saved snapshot with original observation time and measured environment; current canonical readback | [Location](../LOCATION.md), [snapshot](../SNAPSHOT.md), `tests/location`, location client lifecycle fixtures | Parked device GPS and real Google responses; missing data must fail truthfully |
| Briefing | Owned persisted snapshot and one generation token | Seven sections with reasons, status and generation; incomplete sections cannot admit Strategy | [MAIN trace](../ai-pipeline.md), `tests/briefing`, client Briefing fixtures | One real current generation through all required provider sections; a model-list check is insufficient |
| Strategy and worker | Explicit admission plus complete, matching Briefing source | Saved Strategy/claim bound to snapshot and generation; stale output cannot replace current context | [MAIN trace](../ai-pipeline.md), `tests/strategy`, worker lifecycle fixtures | Actual admitted run and reconnect/retry against reviewed worker/runtime |
| Venue planner/catalog/Routes | Admitted source and verified place identity; model coordinates never become location evidence | Canonical catalog, measured Routes cells, ranking candidates and atomic completion | [Venues](../VENUES.md), `tests/venue`, Strategy map fixtures | Real Places/Routes identities and measured routes, scoped feedback/replacement |
| Offer Analyzer | Selected capture input; optional shortcut token resolves owner/rules; authenticated records/outcomes; observation and driver outcome remain distinct | Phase-1 spoken verdict; later enrichment/history/outcome; reply currently precedes durable storage | [Offer Analyzer](../OFFER_ANALYZER.md), `tests/offers`, dedicated offer UI harness | Existing phone screenshot/voice baseline and authenticated record trace; automatic notification/outbox milestone remains separate |
| Coach text/voice/TTS | Current authenticated owner, snapshot, voice session and cancellation | Owned saved history/context and scoped actions; longitudinal offers do not authorize real-time Coach verdicts | [Coach](../RIDESHARE_COACH.md), `tests/coach`, voice client fixtures | Real text/voice lifecycle and cancellation on the device; missing earnings remain unknown |
| Events and Bars | Country/market/venue identity, explicit timezone/date and coverage; independent discovery boundaries | Shared validated event writer, moderation receipts and time-aware saved reads; measured provider hours | [Venues](../VENUES.md), [MAIN](../ai-pipeline.md), `tests/events`, Bars client fixtures | Actual provider coverage and refresh behavior; empty cache is not verified absence |
| Concierge, welcome and translation | Separate anonymous/public token or shortcut lifetime, input validation and cancellation | Verified venue/event writes where applicable; truthful bounded provider result | [Independent pipelines](../INDEPENDENT_PIPELINES.md), `tests/concierge`, `tests/independent`, public client fixtures | Scoped public end-to-end requests, actual provider responses and late-response behavior |
| Feedback, SSE, DB and startup | Owner-scoped idempotency keys; subscribed source/session; one DATABASE_URL | Atomic action/counters, source-scoped notifications, shared TLS and versioned schema | [SSE](../SSE.md), [DB runtime](../../../server/db/README.md), `tests/feedback`, `tests/db`, `tests/schema-validation.test.js` | Real reconnect/multi-process behavior, disposable fresh DB, and separate production parity evidence |

The accepted automatic-offer feature also requires durable capture before upload,
authenticated commit-before-ack admission, stable event identity through retries,
and genuine phone-source evidence. Fixes in this review do not implement or certify
that feature. Screenshots and the existing spoken-response flow are preserved.

Melody clarified the naming on October 4: **Offer Analyzer** names the feature;
**offer/offers** name the observations and tracked records. This distinction is
recorded in the [root lexicon](../../../LEXICON.md) and project startup
instructions, and governs current labels/docs.

## One working candidate

Melody's current instruction is one usable app without a multi-branch operating
method. The combined working candidate is `astra/pipeline-readiness-20261004`.
The temporary work copies below isolate concurrent edits during this review;
they are not separate product versions or branches she must maintain. All start
from the exact baseline above. Changes remain uncommitted until requested.

| Work area | Responsibility | Current evidence |
|---|---|---|
| Build and verification | Accurate runtime requirements; TypeScript failures propagate; repeatable offline verification; canonical migration command guidance | TypeScript missing-project fixture exits 0 before repair and 1 after; 21 Node fixtures and 20 airport UI fixtures pass; all verification stages covered below |
| Schema consistency | Type/precision/nullability and CHECK-name metadata drift; shared TLS; missing removal-revision mirror | Seven new regressions failed before fix; 34 tests across three suites passed afterward; read-only development metadata check reports 55 distinct tables/837 columns without covered drift |
| Offer Analyzer contracts | Offer-list consistency, image platform propagation and unknown earnings projection | Nine regressions failed before repair; 98 unit and 16 real-router/PGlite fixture tests pass after repair; targeted lint passes |
| Database bootstrap | Atomic fresh schema/reference seed/covered ledger; refuse ambiguous interrupted old bootstrap | Full unmodified baseline reproduced both failures; 32 targeted tests pass; real PostgreSQL fresh/repeat/interruption/lost-acknowledgment and incomplete-ledger checks pass |
| Combined candidate | Reviewed integration, release matrix and exact verification receipt | Schema, Offer Analyzer, naming, bootstrap and cleanup integrated; 2,990 test cases and production bundle pass across source-matched stages; full repeated command reached its 20-minute limit |

Repository cleanup includes demonstrated stale commands, duplicate test selection,
unused generated files and contradictory documentation. Recoverable originals and
the cleanup manifest belong outside the app checkout. An assigned documentation
agent maintains the detailed findings and test evidence outside the app; this map
is the concise in-repository status entry point.
Unmerged historical features are not merged merely because they are missing from
main. File removals require a usage/reference check and a verified recovery copy;
cleanup does not rewrite Git history or remove phone screenshots.

## Database evidence and limits

A read-only transaction against the workspace-supplied connection found all 54
source migration filenames recorded with matching checksums; 41 were marked
baseline. There are 144 airport identities and 16 product-rule rows. The old
column-only checker reported no differences, but double-counted an exported table
alias and could not establish CHECK/index/default/foreign-key/reference-data parity.

The actual database contains `offer_intelligence_removal_revision_check`, while
the baseline Drizzle mirror omits it. The combined candidate adds the mirror declaration
without applying DDL. Its improved checker remains bounded: CHECK names and
validation status do not establish expression equivalence or full catalog parity.

A separate fresh-bootstrap reproduction used disposable PostgreSQL 16.10 and an
installed pgvector extension through a private runtime overlay, with the full
unmodified baseline SQL. A clean first run records all 54 files but leaves airports
and app_rules empty; the next run skips all 54. An injected interruption after the
baseline ledger row causes the old runner to replay 13 migrations, delete a
synthetic coords_cache row, and install obsolete product rules on resume. The
workspace database was not changed. The repair passed the same real PostgreSQL
checks: fresh setup has 144 airports and all 54 ledger rows; interruption rolls
back schema and covered ledger together. A lost commit acknowledgment leaves 50
complete covered entries and the next run applies only four later migrations,
without repeating the airport seed. An old incomplete executed baseline stops
before destructive replay. See [bootstrap](../DATABASE_BOOTSTRAP.md).

Existing populated workspace reference counts do not prove that a clean installation
is complete. Replaying old product-rule seeds would restore an obsolete mandatory
holiday rule, so that is not an acceptable repair. A current approved product-rule
export remains a separate clean-installation prerequisite. Never use a clean ledger
as evidence that every migration effect exists.

## Verification gates

For every fix retain: source fingerprint, failing reproduction, root cause,
changed files, passing regression and limits. The aggregate candidate must pass
JSON validation, lint, TypeScript, backend/client/dedicated harness tests, existing
Node fixtures and production bundle generation. Tests that need a real DB,
providers, gateway or device are explicit separate stages.

The final evidence uses **source-matched stage coverage**, not a claimed
uninterrupted `npm run verify` success. The preceding run passed JSON validation,
lint, TypeScript, 191 Jest suites / 2,950 cases and 21 Node cases, then failed only
the startup socket fixture under a long temporary path. That test-only repair
passes all 19 startup cases; a separate production build exits 0. Hash comparison
confirms the application code and JavaScript tests are identical across those
runs. Total test cases across the completed stages: **2,990**, without counting
repeat runs twice.

The final repeated full command passed JSON/lint/TypeScript/backend/Node stages
but reached the local 1,200-second monitor limit during the later API stage.
Its timeout is retained; it is not rewritten as a successful complete command.
The production build completed October 4 at 19:02 America/Chicago (October 5
00:02 UTC). Existing warnings remain: nine-month-old Browserslist data and a
1,560.88 kB main chunk above the 1,200 kB warning threshold. The built robots.txt
matches the retained client source after the unused root duplicate was removed.
GitHub Actions has not been run; the workflow's cold execution time remains an
external check.

At initial runtime inspection, local port 5000 refused the health connection: the
development gateway was not serving there. It was not started during inspection.
Production deployment identity and schema are unverified. A successful bundle or
public health response cannot establish authenticated end-to-end acceptance.

The older nine-part `todo-docs` redesign package remains distinct from these bug
fixes. Its prepared handoffs and historical plans are not implementation receipts.
This review does not silently mark those phases or readiness tasks 91/75 complete.

## Current next step

Use the single verified candidate for the next real development acceptance run
against an explicitly prepared target. Confirm a current approved product-rule
export before calling a clean installation complete. When Melody is parked,
recheck the installed MacroDroid export and trace one authenticated Offer Analyzer
capture through speech and storage; then prove the smallest automatic source.
Tasks 91/75 and the automatic-capture milestone remain open. Preserve the exact
stage receipts and remaining deployment prerequisites.
