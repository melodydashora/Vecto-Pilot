# VectoPilot release-readiness backlog, September 7, 2026

Provenance: Astra consolidated review input responding to the owner's new requirements. Baseline source: `87a31c00245a76dc8e925f0152733551b82ef450`, branch `codex/vectopilot-mcp-preserve-20260907`. This document contains no test credentials or private account identity. It supplements existing roadmaps and the live `todo` table; it does not replace their doctrine or declare a naming migration approved.

**Every item below is OPEN. Nothing is marked fixed.** P0 means identity, privacy, data-integrity or merge/release verification gate; P1 establishes a reliable, operable supported release; P2 follows with measured scale and prioritized features. These are proposed execution priorities, not a claim that every P0 is an observed production exploit. Root's bounded runtime findings are recorded below; acceptance tests remain open.

Evidence labels: **Owner report** = user-observed failure not independently reproduced here; **Source confirmed** = current control flow/schema/configuration inspected; **CI observed** = previously recorded check result; **Runtime pending** = acceptance behavior still unproven. The 29 passing MCP tests do not establish authentication, pipeline, database or whole-app correctness.

## P0 — Identity, privacy and data integrity

### VP-001 — Reproduce repeated signup and enforce canonical account uniqueness
Status: OPEN. Evidence: Owner report; existing normalized-email check and exact-text unique indexes source confirmed; root's dev read found zero normalized duplicate-email groups and real email uniqueness, but the reported signup flow/production constraints remain unverified. References: [auth review](../architecture/audits/2026-09-07-auth-identity-review.md#auth-i01--the-exact-repeat-signup-report-needs-deployed-data-reproduction), `server/api/auth/auth.js:236`, `shared/schema.js:995`; existing open todo **60** (public OAuth).
- Objective/approach: establish deployed revision, real constraints and duplicate identity fields before changing checks. Define one canonical account across accepted login methods; distinguish “same email” from “same natural person using another email.” Do not silently equate names, shared phones, plus-tags or dotted addresses.
- Acceptance: isolated same-email, case and whitespace variants result in one complete account and a stable already-exists response. Cover imported noncanonical rows and concurrent requests. Record the different-email/provider identity policy; frontend-only rejection is insufficient.

### VP-002 — Complete Google callback through the active authentication context
Status: OPEN. Evidence: Source confirmed; browser/provider runtime pending. References: auth review AUTH-I02, `client/src/pages/auth/google/Callback.tsx:83`, `client/src/contexts/auth-context.tsx:50`, `ProtectedRoute.tsx:29`; existing open todo **60** (public OAuth).
- Objective/approach: one successful-auth completion path must set token, user, profile, vehicle and React state together; callback currently writes localStorage then navigates without updating the mounted provider.
- Acceptance: clean signed-out browser reaches a protected page without reload after existing-user Google login and new-user terms completion. Cancelled/failed exchange remains signed out. Assert authenticated requests and UI agree on the same account.

### VP-003 — Make registration and provider creation atomic
Status: OPEN. Evidence: Source confirmed separate inserts/conflict behavior; transaction/race tests pending. References: auth review AUTH-I03, `server/api/auth/auth.js:414`, `:426`, `:482`, `:493`, `:1637`.
- Objective/approach: use a transaction for related account records and explicit uniqueness-conflict outcomes; perform external provider/address work outside the short database transaction where appropriate.
- Acceptance: inject failure at each insert and prove rollback; race password/password, Google/Google and password/Google signup for one canonical identity. Exactly one complete account remains, with no orphan users/credentials/vehicles and no raw database error disclosed.

### VP-004 — Resolve and link Google identity without retaining unproven access
Status: OPEN. Evidence: Source confirmed identity/email OR lookup and auto-link behavior; adversarial runtime pending. References: auth review AUTH-I04, `server/api/auth/auth.js:1611`, `:1690`.
- Objective/approach: resolve verified provider subject first; handle email collision through a documented secure linking policy. An unverified password preregistration must not retain unintended access after the email owner adopts Google sign-in.
- Acceptance: cover password-first, Google-first, changed provider email, subject/email pointing at different users, concurrent linking and unverified preregistration. Accepted methods resolve to one intended user ID; conflicts are explicit and existing driver data is never silently merged.

### VP-005 — Bind OAuth state to its initiating browser and consume it once
Status: OPEN. Evidence: Source confirmed missing browser correlation/separate read-delete; runtime pending. References: auth review AUTH-I05, `server/api/auth/auth.js:1505`, `:1555`, `:1579`.
- Objective/approach: implement browser-bound authorization state and atomic single-use consumption; verify actual registered callback origins without recording secrets.
- Acceptance: browser A's valid flow cannot sign browser B in. Reject missing, wrong, expired, reused and concurrently consumed state; distinguish exchange failure from a restartable login. Verify both dev and production callback configuration separately.

### VP-006 — Clear the active private-data cache on logout/account switch
Status: OPEN. Evidence: Source confirmed two QueryClient instances; two-account runtime pending. References: [release review](../architecture/audits/2026-09-07-release-code-review.md), `client/src/App.tsx:14`, `auth-context.tsx:223`, `OffersCard.tsx:339`, `apiRoutes.ts:310`.
- Objective/approach: cancellation/cleanup must target the provider's active client; key private data by stable user identity and clear prior-user UI state during authentication transitions.
- Acceptance: mocked account A → logout → B in one SPA lifetime never shows A's offers, even before B's response. Slow A responses cannot repopulate B's cache; repeat for auth expiry and OAuth completion.

### VP-007 — Verify and close snapshot ownership and location-log exposure gaps
Status: OPEN. Evidence: Source confirmed candidate route gap and precise-location normal logs; cross-user runtime pending. References: [pipeline baseline](../architecture/audits/2026-09-07-pipeline-baseline.md), `server/api/strategy/tactical-plan.js:126-152`, `server/api/location/snapshot.js:177`; related existing open todo **57** (ingest security), without assuming it covers every route here.
- Objective/approach: authenticated snapshot reads and derived model calls must require the same user's ownership; normal logs must omit exact coordinates/address and secrets.
- Acceptance: account B cannot use A's snapshot on tactical-plan or any inventory-listed snapshot route; no paid call executes on denial. Capture synthetic request/error logs and assert sensitive fields are absent. Check internal monitoring authorization separately from ordinary driver login.

### VP-008 — Verify dev/prod data and reproducible schema before repairing “empty tables”
Status: OPEN. Evidence: Owner report; source-confirmed bootstrap/migration discrepancy; root verified populated dev tables and some actual constraints, plus 139 production offer rows. Production schema and six permission-denied analytical tables remain unknown. References: auth review AUTH-I07, `docs/architecture/DATABASE_ENVIRONMENTS.md`, `server/db/run-migrations.js`, `shared/schema.js` and runtime ledger below.
- Objective/approach: read-only inventory per environment must distinguish missing tables, schema drift, legitimate empty user tables, missing reference seeds, orphan records and absent continuity rows. `DATABASE_URL` remains the only selector.
- Acceptance: record schema/index/nullability/migration parity plus aggregate counts without account rows or secrets. Prove fresh-environment bootstrap and an additive existing-environment migration on isolated data. Never reset prod or copy private rows into dev to produce a passing result.

### VP-009 — Prevent stale outcome edits from overwriting newer earnings
Status: OPEN. Evidence: Source confirmed stale full-payload updates; controlled multi-tab runtime pending. References: release review, `OffersCard.tsx:182-225`, `server/api/offer-analyzer/index.js:259-297`, `OFFER_ANALYZER_ROADMAP.md` L8b.
- Objective/approach: explicit partial updates and/or expected-version conflicts; preserve the deliberate clearing policy for Rejected/Cancelled rather than guessing.
- Acceptance: two tabs load earnings 10; A saves 25; B changes decision. Server preserves 25 or rejects B with a recoverable conflict. Earnings edits likewise cannot silently restore a stale decision.

### VP-010 — Resolve the PR #55 bearer-parser alert and recover meaningful CI review
Status: OPEN. Evidence: CI observed plus parser source confirmed; exploitability/fix/review completion pending. References: [preservation handoff](../memory/sessions/2026-09-07-mcp-preservation-handoff.md), `server/mcp/auth.js:34`, [CodeQL check](https://github.com/melodydashora/Vecto-Pilot/runs/101871255639), [Claude job](https://github.com/melodydashora/Vecto-Pilot/actions/runs/34163948286).
- Objective/approach: validate and remove the uncontrolled-input polynomial regex behavior while preserving bearer-auth rules. Diagnose the failed automated reviewer independently; a job execution error is not a completed review rejecting the code.
- Acceptance: valid/invalid/empty/multiple-whitespace/long-header cases retain intended auth outcomes with bounded processing; run focused tests and confirm the alert check clears. Reviewer produces an actual result or a documented actionable failure. Recheck current PR head/checks before any merge decision.

## P1 — Correct onboarding and observable waterfall contracts

### VP-011 — Make onboarding and sign-in versus signup behavior coherent
Status: OPEN. Evidence: Source confirmed mode ignored, abandoned-terms and profile-completion gaps; runtime pending. References: auth review AUTH-I06, `auth.js:1513`, `:1648`, `:1219`, `Callback.tsx:82`.
- Objective/approach: record whether Sign In may create a first account; gate required terms/profile steps on persisted completion, not only `isNewUser` from one callback.
- Acceptance: abandoning onboarding then signing in again resumes required steps; reload/direct URL access cannot bypass required gates. Completing fields updates `profile_complete`. Unsupported providers remain explicitly unavailable rather than appearing functional.

### VP-012 — Map the nested waterfall and establish a migration-safe lexicon
Status: OPEN. Evidence: Source confirmed nested branches and terminology drift; reviewed target naming pending. References: pipeline baseline, `LEXICON.md`, `AI_PARTNERSHIP_AGREEMENT.md` §§13–14, `docs/architecture/ai-pipeline.md`, `server/bootstrap/routes.js`, `client/src/constants/apiRoutes.ts`; existing open todo **71** (taxonomy).
- Objective/approach: inventory mounted method/path, audience, auth/ownership, input/output schema, side effects, timeout, upstream/downstream owner and canonical table; map root/child stages and existing aliases before renaming.
- Acceptance: every supported UI/shortcut/MCP entry traces to its producer and readers; resolve snapshot creation variants, blocks versus blocks-fast, mission tactical-plan versus venue tactical-planner, and diagnostic versus diagnostics. Define case per identifier surface; test compatibility/deprecation before route changes. Mark GET writes/generation explicitly and correct stale diagrams.

### VP-013 — Enforce snapshot and briefing lifecycle/readiness contracts
Status: OPEN. Evidence: Source confirmed zero-to-null handoff in separate snapshot route, non-null readiness gates and proceed-on-timeout; runtime pending. References: pipeline baseline, `snapshot.js:195`, `blocks-fast.js:810-870`, `consolidator.js:1381`, `briefing-notify.js`.
- Objective/approach: pass the validated complete snapshot downstream; define pending/ready/verified-empty/failed sections with reasons and deliberate strategy degradation/abort rules. Resolve supported versus retired snapshot paths first.
- Acceptance: midnight/Sunday, GPS/device timezone disagreement, six-decimal coordinates, missing required values, empty-success, one-provider failure and all-provider failure have deterministic outcomes. Timeout cannot masquerade as successful complete data or strand an indefinite spinner.

### VP-014 — Prove retry/dedup ownership and durable post-response work
Status: OPEN. Evidence: Source confirmed mixed transaction/session locks and process-local state; multi-instance runtime pending. References: pipeline baseline, `briefing-aggregator.js:52`, `blocks-fast.js:171`, `triad-worker.js:127`, offer roadmap L11.
- Objective/approach: identify one claim/retry owner per artifact and a durable lifecycle across request, worker and notification paths; verify pooled advisory-lock semantics and partial-ranking recovery. Evaluate the documented in-process offer phase two against actual current code before selecting its durable owner.
- Acceptance: simultaneous same-snapshot calls, request-plus-worker, two replicas, process death and DB reconnect do not double paid work or leave unrecoverable partial artifacts. A lost offer phase two is visible and safely retryable; no claim of durability from a process-local Map.

### VP-015 — Monitor actual waterfall and data integrity, with actionable alerts
Status: OPEN. Evidence: Source confirmed existing logs/SSE/gates plus unrelated job dashboard and schema-stale ML queries; deployed monitoring pending. References: pipeline baseline, `server/api/health/job-metrics.js`, `ml-health.js`, `server/logger/`, `server/db/db-client.js`.
- Objective/approach: correlate environment, root/child run, snapshot, role and artifact without exposing precise location; distinguish queue health, application health and provider health.
- Acceptance: use real stage records for latency percentiles, failures/retries, age of pending work, produced rows, verified-empty results, quota/spend, pool pressure and SSE disconnect/replay. Inject one failure per class and prove a useful alert and recovery state. No dashboard reports success from phantom columns or an unused queue.

### VP-016 — Make release checks exercise supported user journeys
Status: OPEN. Evidence: Source confirmed E2E/auth-fixture, TS/TSX selection and root typecheck gaps; full suite runtime pending. References: release review, auth review AUTH-I08, `package.json`, `jest.config.js`, `.replit`, `tests/e2e/copilot.spec.ts`.
- Objective/approach: selected CI commands must run the relevant browser, auth, concurrency and frontend tests; use isolated databases and mocked paid providers first, then bounded real-provider smoke checks.
- Acceptance: typecheck referenced projects, build the client, require expected elements rather than passing on absence, and run signup/OAuth/account-switch/rules/outcome/error-retry/small-screen journeys. Record dev and prod smoke results separately. A passing MCP-only suite cannot satisfy this item.

### VP-017 — Finish one supported new-driver Offer Analyzer setup path
Status: OPEN. Evidence: Source confirmed old SetupCard; roadmap reports Android text-lane success; end-to-end current-device acceptance pending. References: release review, `SetupCard.tsx`, `docs/architecture/OFFER_ANALYZER_ROADMAP.md` G1–G3/L3; existing open todo **70** (Android certification).
- Objective/approach: ship verified canonical Text/Vision import links and accurate instructions for the platform being released; preserve working token/rules flows.
- Acceptance: a fresh supported device installs from the published instructions without manual code repairs, sends representative offers, receives the correct response, and sees owned history/outcomes. Measure real-device latency. Verify links rather than inventing replacements; track other platforms explicitly.

## P2 — Measured scale and feature completion

### VP-018 — Set and prove capacity, security and cost budgets across replicas
Status: OPEN. Evidence: Source confirmed per-process provider gate, pool size and default limiter stores; measured fleet behavior pending. References: pipeline baseline, `concurrency-gate.js`, `connection-manager.js`, `server/middleware/rate-limit.js`.
- Objective/approach: derive concurrency/backpressure/retention from supported-driver demand, provider quotas and DB connections; review retry safety and read-only health accuracy before raising limits.
- Acceptance: stubbed-provider load test measures p50/p95/p99, queue bounds, memory, connection usage, cancellation and overload response across replicas; bounded real-provider validation stays within a recorded cost cap. Public routes cannot multiply expensive work by bypassing identity-based limits; recovery and backup restore have a documented drill.

### VP-019 — Reconcile unfinished features into explicit supported-release scope
Status: OPEN. Evidence: Existing roadmaps plus root's current open-todo read; feature acceptance still pending. References: `docs/MASTER_ROADMAP.md`, `docs/architecture/OFFER_ANALYZER_ROADMAP.md` L9–L11/§3, `UBER_INTEGRATION_TODO.md`; existing open todos **69** (OA 3.2), **62** (Concierge zero-event bug), **61** (feedback triage), **58** (venue-replacement feedback).
- Objective/approach: reconcile Uber sync/earnings analytics, Coach continuity/voice, Concierge, offer phase-two delivery/learning integration, maps and native shell; retain existing IDs/ownership and mark superseded claims instead of duplicating them.
- Acceptance: each feature has one current owner, dependency, user journey, supported platform, source of truth and completion evidence. Ship only features meeting their agreed journey; keep incomplete capabilities clearly unavailable. Do not treat the old roadmap's aggregate TODO count as a current verified count.

## Coordination and evidence ledger

- Astra Desktop performed the bounded UI/database checks linked below. Deployed revision, full production schema and acceptance journeys remain unverified.
- Existing naming/role doctrine remains in `LEXICON.md`; the partnership agreement's pipeline/naming requirements guide the contract pass. `docs/plans/README.md` describes older plan lifecycle language; current explicit owner authorization governs routine reversible work. This backlog creates no new permission gate.
- Before implementation, inspect current shared branch/files and relevant live continuity; preserve concurrent agent work, original artifacts and recovery copies. Code changes should be focused and separately reviewable.
- Source reports: [authentication/identity](../architecture/audits/2026-09-07-auth-identity-review.md), [pipeline baseline](../architecture/audits/2026-09-07-pipeline-baseline.md), [bounded release review](../architecture/audits/2026-09-07-release-code-review.md), [preservation/CI handoff](../memory/sessions/2026-09-07-mcp-preservation-handoff.md). These are review evidence, not authority to silently rename architecture or merge accounts.
- VP IDs are stable references under development todo #75; retain cross-links to existing tracker IDs. Update status only with actual tests/evidence, never merely because code or documentation was added.

## Runtime and canonical task linkage — September 7

The existing development queue now contains **todo #75**, status `open`, priority 1, linked to **claude_memory #386**. It is an umbrella for these VP items, not a replacement for existing OAuth #60, ingest-security #57, Android #70, taxonomy #71, Offer Analyzer #69, Concierge #62, feedback #61 or venue-feedback #58 tasks.

[Runtime evidence and limits](../memory/sessions/2026-09-07-auth-data-runtime-check.md): the connected development database is populated (528 snapshots, 515 strategies, 515 briefings, 144 airports); it has the designated test profile and no normalized duplicate-email groups. Actual email/provider uniqueness constraints exist there. The published app rejected the designated test login once; the development server was unavailable on its configured port. An already authenticated owner browser was observed separately. Production's read-only bridge counted 139 offer records but denied six other documented analytical-table queries; those tables are unverified, not empty.

VP-008 includes reconciling actual production read-only grants with the documented allowlist without broadening access implicitly. It also includes the documentation/code TLS discrepancy: current production connection code uses `rejectUnauthorized: false` while the environment document describes certificate verification. Validate the actual provider's requirements and test an appropriate verified connection before changing it. No production grant, schema, secret, or runtime application setting was changed in this pass.