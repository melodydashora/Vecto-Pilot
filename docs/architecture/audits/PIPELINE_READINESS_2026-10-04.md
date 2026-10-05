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

The reviewed workspace ran Node 20.20.0. The earlier phone Node 18 install failed;
its partial dependencies are not used as test evidence. The original review
reported tests in isolated copies with application/provider credentials removed.
Its blanket claim that Replit Agent was not invoked is superseded by the October 5
correction below. No commit, push, gateway restart, production migration or
publication was part of that original source review.

Live project continuity was read through the existing MCP SDK stdio server over
SSH in read-only mode. Tasks 91 and 75 remain the existing readiness umbrellas.
Historical successful checks and current source checks are separate receipts.

## October 5 provenance correction

Melody supplied the verified `2026-10-05-Android-Astra-handoff-agent-invocation-correction.json`.
It records the prior root Codex session invoking `replit_ask_question` at
2026-10-04T22:09:10.842Z for workspace inspection and branch comparison. The call
timed out; cancellation, charges and absence of file changes were not established.
Earlier blanket denials were wrong and are superseded. Original handoffs,
screenshots and source records remain preserved as historical evidence.

The identified request was for inspection, not a test run. That distinction does
not validate earlier testing claims or establish the effects of other Agent
activity. The historical verification receipts below remain attributed to the
earlier review; fresh direct-shell checks are recorded separately. Replit Agent
must never be invoked, including for read-only inspection, planning or tests.

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

## October 5 independent verification and Git synchronization

After Melody questioned the earlier provenance, a fresh direct-shell
`npm run verify` completed uninterrupted with exit 0 in **372.244 seconds** on
commit `7f8934e12777e4dc683d47ed51b6f0ac14db5074`. It ran in an isolated source
copy using the existing installed dependencies, without application/provider
credentials or environment files. Replit Agent was not used for this run.

All **2,990 tests passed**: 191 Jest suites / 2,950 cases, 21 Node cases and 19
Python startup cases. JSON validation checked 49 files with no failures; lint,
TypeScript and the production client build also passed. The separate earlier
122-case targeted run overlaps this coverage and is not added to that total.
The Browserslist age and 1,560.88 kB main-chunk warnings remain. Workspace-local
logs, command result and source fingerprint are preserved under
`astra/verification/2026-10-05-direct-shell-full/` outside Git. The log SHA256 is
`f5d1443effbb8d2d4b1c3b37db528ef8b68bb033344abfd2e8f84c06d4aad4cb`.
Dependencies were not reinstalled, and GitHub Actions was not run.

The 62 pending paths were committed and pushed to
`origin/astra/pipeline-readiness-20261004` as `7f8934e1`. The initial push failed
because the default OAuth credential lacked workflow permission; selecting the
existing repository-scoped push credential fixed it without storing its value.
The subsequent change to this audit only corrects provenance and records the
fresh result. Remote `main` remains `b4bba633`; no deployment, gateway restart,
production migration, real-provider acceptance or physical-phone test occurred.
The older failed and timed-out verification receipts remain preserved.

## Current next step

Use the single verified candidate for the next real development acceptance run
against an explicitly prepared target. Confirm a current approved product-rule
export before calling a clean installation complete. When Melody is parked,
recheck the installed MacroDroid export and trace one authenticated Offer Analyzer
capture through speech and storage; then prove the smallest automatic source.
Tasks 91/75 and the automatic-capture milestone remain open. Preserve the exact
stage receipts and remaining deployment prerequisites.

## October 5 live workspace acceptance and remaining findings

The later authorized workspace run exercised actual providers and persistence
through an isolated authenticated test account. It supersedes the earlier
statement that real-provider acceptance had not occurred; it does not erase
the historical verification or establish production deployment. The reviewed
initial implementation was committed as `ac9d23b3` on the same candidate branch;
the later progressive Events follow-up is covered below. This
checkpoint records workspace behavior; publication and production acceptance
remain separate.

| Observed path | Live result and boundary |
|---|---|
| Login, preferences and rules | Real login, saved preferences and rules succeeded. Logout and a new login preserved the profile/economics settings and the original rules version and hash. This was browser acceptance, not physical-phone capture acceptance. See [preferences](../USER_PREFERENCES.md) and [admission](../../../server/lib/main-run-admission.js). |
| Offer Analyzer | One actual OCR observation produced ACCEPT and was saved with its input hash. No claim is made about automatic phone screenshot capture. See [Offer Analyzer](../OFFER_ANALYZER.md). |
| First complete Briefing and MAIN run | Briefing completed in about 65 seconds with all eight persisted payloads representing the seven required sections, including both weather payloads. One explicit Continue produced exactly one admission, Strategy, job and ranking, with six candidates carrying measured Google Routes results. All 22 database verification checks passed. See [MAIN](../ai-pipeline.md), [readiness](../../../server/lib/briefing/briefing-readiness.js) and [venue lifecycle](../../../server/api/strategy/blocks-fast.js). |
| Strategy map | The first rendered map exposed a CSP gap for Google's raster tile host. The [CSP image-source correction](../../../server/bootstrap/middleware.js) was verified with actual raster imagery and venue markers, without the earlier security errors. Markers alone were not treated as map acceptance. |
| Saved Strategy | Same-session reload restored the completed Strategy. A new session did not promote prior-session Strategy as current guidance; the session ownership gate remains intentional. |

The accepted [Airport contract](../../../LEXICON.md) is FAA conditions first,
Gemini conditions research only for airports missing usable observations, then
a separate terminal pass consuming those fixed conditions. The national FAA
JSON read is shared; absence from its disruption feed remains unknown rather
than normal. The [Airport pipeline](../../../server/lib/briefing/pipelines/airport.js)
and [shared prompt formatter](../../../server/lib/briefing/shared/format-airport-context.js)
preserve the source and disruptions through Strategy and VenuePlanner.

A **separate new-login generation failed Events** with the recorded provider
classification `google:truncated`. This was an incomplete model-provider result,
not a verified empty event list and not proof that every Events request fails.
The provider log identifies `MAX_TOKENS` at the configured 8,192-token ceiling;
it does not establish model retirement. The [official model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
lists a 65,536-token output limit, and [thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
explains that thinking and visible output share the configured output allowance.
The Events-only output allowance is now 32,768 tokens with numeric truncation
diagnostics; model choice, high reasoning, search grounding and complete-response
validation remain required. A live category then completed in about 66 seconds
using 10,620 thinking tokens and 789 output tokens, directly exceeding the old
allowance. Its parallel category reached the previous 90-second deadline, so
that run still correctly failed discovery. Two later real discovery runs with
a 120-second category allowance passed in 68.700 and 59.373 seconds: 11 found
became 10 unique events, then 13 found became 11 unique events. All four category
responses were HTTP 200 with `STOP`; their recorded thinking-token usage alone
exceeded the former 8,192-token allowance. Melody then requested three minutes
while preserving received Briefing data. The 180-second category allowance,
role-specific router support and matching progress-aware readiness wait are now
implemented and the final uninterrupted integrated run passed. The allowance
applies to category discovery, not a promise that the entire Briefing and later
venue verification finish within three minutes.
The [model adapter](../../../server/lib/ai/adapters/gemini-adapter.js) rejects
truncated output; [Events discovery](../../../server/lib/briefing/pipelines/events.js)
rejects an incomplete required search instead of publishing another category
or cached rows as complete. Briefing correctly remained failed and no second
Strategy was admitted. During a subsequent 39-second browser observation,
there were no further Briefing GETs and zero live EventSources. The error screen
offered no retry/Refresh Briefing action and its Open Coach link worked. See
[Briefing query lifecycle](../../../client/src/hooks/useBriefingQueries.ts) and
[error presentation](../../../client/src/components/CriticalError.tsx).

Melody subsequently approved progressive Events: show verified results as they
arrive, preserve received information if later work fails, and keep Strategy
blocked until the complete Briefing is ready. The pipeline now verifies and
saves events from a completed category while the other category runs. Only
normalized, venue/time-verified in-market items are published to Briefing;
canonical event writes wait for both searches and combined deduplication. Raw
partial model output is not displayed. Pending and failed Events retain those items, and finalization
preserves already saved sections. The client waits for the owner's terminal
status before releasing its listener, without allowing a failed section to
admit Strategy. It preserves received same-source data during transient read
failures and keeps account/snapshot isolation. Successful progress does not
spend the read-error retry budget; saved updates extend the three-minute
inactivity wait. Focused tests and the final live progressive acceptance below
cover these changes separately from the earlier discovery-only probes.

Five client suites passed 99 tests covering actual hook/SSE lifecycle,
provider/page rendering, retained-data isolation, saved Strategy and location
regressions. Five new lifecycle/preservation assertions first failed against
the previous committed hook. These fixture tests establish the specified
transitions; their counts overlap earlier client checks and are not added to
those totals.

The later full client run passed 406 tests across 46 suites, with the separate
Airport UI harness passing 25 tests; lint, TypeScript and the client build
passed. The broader server run passed 524 cases across 24 suites; after the final
reader parity correction, the actual-route and router checks passed 43 cases
across two suites. JSON validation checked 49 files. These scopes include
earlier focused checks and overlap one another, so the totals are not additive.
A later live progressive attempt was interrupted when the workspace gateway
restarted at 11:53:25 UTC after a capture began at 11:53:20 UTC. That receipt is
archived as interrupted, not a pass or a newly diagnosed provider failure.
The prior completed MAIN and Coach checks remain valid separate evidence.
The aggregate reader also now keeps this generation's verified Events separate
from supplemental saved market rows; cached nearby rows must not masquerade as
newly collected progress.

**The final uninterrupted progressive run passed.** The gateway was restarted
only after the browser collaborator acknowledged it was idle; source and
runtime were then held stable for the run. The observer first distinguished
zero current-generation items from one supplemental saved market item, then
saw owned Events progress from 0 to 1, 3 and 4 while pending, followed by a
complete Briefing with nine saved verified nearby events, in about 71 seconds.
The real preferences confirmation and Strategy action produced exactly one
snapshot POST, one MAIN POST and one blocks POST in this attempt, with no MAIN
request before the explicit action. Strategy and six venues completed.
These are six verified candidates, not six displayed shortlist cards: all six
received Grade C, so the existing A/B-only shortlist correctly displayed zero
cards while Recommendations ready and nine loaded map tiles were visible.
That policy was not relaxed. The earlier run's A/B candidates are separate
evidence, not the contents of this final run.

Independent read-only database checks passed 22/22 for this capture: exactly
one completed admission, one successful completed Strategy, one venue job,
one ranking and six distinct catalog-linked candidates with measured Google
Routes. Source generation and observation times were preserved, and admitted
settings revision 2/rules version 1 matched the canonical profile, vehicle and
rules. These are current-capture counts, not lifetime database totals. The
database read began after completion; the browser supplied the earlier
progress evidence. The observer's first 30-second Strategy wait ended while
preferences review was still unconfirmed; resuming through the real button
completed the same flow without a second admission. This test-harness wait is
distinct from the earlier gateway-interrupted attempt.

The [priority helper](../../../server/lib/events/briefing-event-priority.js)
selects high/medium-impact nearby events within 15 straight-line miles, followed
by high-impact wider-market events. Canonical records remain saved even when
excluded from this Briefing selection. Venue capacity is not attendance or
demand evidence. The UI retains genre groups, puts nearby groups before major
market events, and shows verified cards alongside pending or failure notices.
View Briefing is available from the first-failure screen without adding a retry
feature. The [canonical terms](../../../LEXICON.md) and [MAIN contract](../ai-pipeline.md)
record the accepted behavior.

**Coach's missing pre-admission UI context is fixed and verified.**
After the new-login failure there was no admitted run, and the old
[CoachPage](../../../client/src/pages/co-pilot/CoachPage.tsx) passed only
`lastSnapshotId`, so Coach incorrectly showed that it was waiting for location.
This established a UI context/status defect, not
missing context in a model response: the [Coach endpoint](../../../server/api/chat/chat.js)
can resolve the authenticated user's latest owned snapshot when the UI omits
one. The UI now uses `lastSnapshotId || contextSnapshotId` for both the readout
and composer, preserving admitted-run priority. Two failures were reproduced
before the fix; all 10 focused identity tests then passed. A real browser read
of the existing failed snapshot returned authenticated context-summary HTTP 200
and correctly displayed location complete, Briefing failed, Strategy missing
and one saved offer, with the composer available and no false location wait.
That check made zero POSTs, captures, MAIN starts or model calls; no paid Coach
answer is claimed. The later progressive-visibility change adds View Briefing
alongside Open Coach; neither action promises a completed Strategy.

Discovery deduplication also remains bounded. The existing coordinate-precision
and similar-name changes were already present in the reviewed base; their
109-test check is evidence for those existing changes, not a newly implemented
release fix. [Discovery title matching](../../../server/lib/events/pipeline/deduplicateEventsSemantic.js)
can still merge similar events across different venues, and its scope differs
from [saved-event read reconciliation](../../../server/lib/events/event-read-reconciliation.js).
That limitation remains open. Earlier bounded review findings involving event
coordinates, ongoing-event/timezone filtering, conflicting reports, saved event
shapes, event-read failure handling and saved-Strategy read recovery have not
all been fixed or certified by the successful first MAIN run.

Workspace acceptance is complete for the bounded paths above; commit/push is
pending at this verification checkpoint. The successful runs, correctly
terminated provider failure and interrupted attempt are all retained. Tasks
91/75, physical-device capture, the separate open review findings and production
publication/acceptance are not marked complete. Private account
identifiers, credentials, GPS, raw provider output and detailed live receipts
remain outside Git.
