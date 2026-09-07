# VectoPilot bounded release review — September 7, 2026

Provenance: Astra subagent read-only code review. Inspected GitHub main commit `609e935b495f7381073218e7214b0d41cf3d6b7c` in melodydashora/Vecto-Pilot. Read CLAUDE.md, AI_PARTNERSHIP_AGREEMENT.md, README, root architecture pointer, relevant auth/Offer Analyzer code and test configuration. No repository files changed; no package installs, builds, logins, paid AI calls, database reads/writes, or deployments performed. Replit's concurrent uncommitted MCP integration and the desktop clone were outside this review. Runtime findings below still require controlled verification unless explicitly identified as source-confirmed.

## Highest priority: logout does not clear the active query cache

Source-confirmed two-instance defect:
- `client/src/App.tsx:14` constructs its own QueryClient; line 29 supplies it to QueryClientProvider.
- `client/src/lib/queryClient.ts:64` exports a different QueryClient.
- `client/src/contexts/auth-context.tsx:17` imports that second client; lines 85–86 and 223–224 cancel/clear it for auth failure and ordinary logout.
- `client/src/components/offer-analyzer/OffersCard.tsx:337` uses the provider's client; lines 339–351 load offers with a 30-second stale time.
- `client/src/constants/apiRoutes.ts:310` makes the offers key `['/api/offer-analyzer/offers', limit]`, without user identity.

Impact inferred directly from those contracts: when driver A logs out and B logs in within the same SPA lifetime, A's offers remain in the real client cache and can render initially in B's Offer Analyzer page. A subsequent fetch/SSE handshake can replace them, but it does not make the initial cached render correct. The intended in-flight query cancellation also targets the wrong client. This is a focused release blocker for multiple accounts on one browser.

Recommended verification/fix: use the provider's client for auth cleanup (or one shared client consistently), scope private cache keys by user, and add a mocked two-account logout/login browser regression. Confirm prior offers are absent before B's network response. No real accounts or paid calls are needed.

## High priority: a stale outcome edit can erase newer earnings

Source-confirmed:
- `client/src/components/offer-analyzer/OffersCard.tsx:182–202`: changing Accepted → Completed posts every earnings field from the last-fetched offer object.
- `server/api/offer-analyzer/index.js:259–297`: endpoint fully upserts driver_decision, driver_reasoning, actual_pay, reimbursements, extras, and other, without an expected version.
- Earnings save at OffersCard.tsx:210–225 similarly posts the previously loaded decision.
- This is already acknowledged as open in OFFER_ANALYZER_ROADMAP.md L8b, but remains present in the actual source inspected.

Concrete reproduction for a controlled fixture: two tabs load the same accepted offer with $10. Tab A saves $25. Before tab B receives refreshed data, B changes Accepted to Completed. B posts its cached $10 and the server overwrites the saved $25. Ownership checks are present; this is lost updates within one driver's data, not a missing ownership check.

Recommendation: explicit partial updates and/or expected-version conflict handling; preserve the intentional clearing of earnings when selecting Rejected/Cancelled. Verify stale edits conflict or preserve new earnings instead of reverting them.

## Release onboarding gap: Offer Analyzer setup still presents an old iPhone-only flow

Source-confirmed:
- `client/src/components/offer-analyzer/SetupCard.tsx:28` has a single old iCloud shortcut URL.
- Lines 37–48 reference “Analyze 2,” manual latitude typo correction, and adding an image field.
- Lines 141–155 present “Siri Shortcut Setup,” “Add Analyze 2 to your iPhone,” and a Location permission requirement.
- There is no Android setup choice in this component.
- The current roadmap G2/G3 and L3 call for separate canonical Text/Vision shortcuts and updated Android setup; the current code still predates that UI.
- Roadmap G1 reports synthetic-card endpoint timing but explicitly leaves real-device p95 and real-screenshot acceptance unconfirmed. Its later August 26 note reports Android text lane field success, so do not repeat older “Android never tested” statements.

This is an adoption/release gate, not proof the analyzer backend fails. Before inviting new drivers, ship verified import links/instructions for the platform being released and one real-device acceptance record. Do not invent replacement iCloud links.

## Verification is not yet a reliable end-to-end release gate

Source-confirmed wiring gaps:
- `package.json:22` runs only `tests/e2e/copilot.spec.ts`.
- That file navigates to `/` (line 16), expects a co-pilot global header/tab (lines 24–30), and supplies no authentication fixture.
- Current `client/src/routes.tsx:58–59` maps / to AuthRedirect; `client/src/components/auth/AuthRedirect.tsx:35` redirects logged-out visitors to /auth/sign-in. A clean Playwright browser therefore does not enter the page the old tests claim to test.
- Some old E2E checks are conditional on element count, so absence can pass rather than fail.
- `jest.config.js:10–13` selects JS only and has `transform: {}`, leaving the six tracked TS/TSX tests (including useChatPersistence and snapshot-ownership-event) outside the default unit suite.
- `.replit:62` uses `npx tsc --noEmit` while root `tsconfig.json` has `files: []` and project references. The package's `typecheck` script correctly uses `tsc -b`; confirm the Replit Verify workflow actually checks referenced projects rather than the empty root.
- Playwright config explicitly relies on an already running port-5000 server and has no webServer setup.
- No test command was run by this subagent; these are configuration/code findings, not claimed failures from an executed suite.

Recommended bounded gate: authenticated fixture (mock local responses), logout/account switch, rules save/conflict, failed rules load/retry, offer outcome concurrency, and small-screen navigation. Use build-mode TypeScript checking and make frontend tests actually selectable. Then separately do the real-device analyzer test with authorized test credentials.

## What is implemented, based on code read

The app is substantial: routed protected strategy/coach/briefing/offer pages; public landing and passenger flows; email login, Google callback; explicit rule save with optimistic version conflict handling; token setup and rotation UI; offer history with outcome/earnings entry; query focus/reconnect refresh and SSE hooks; branded route error handling. Apple sign-in is clearly disabled and labeled coming soon, not a clickable broken promise.

The code review does not establish that all these features work in the deployed environment. Remaining evidence gaps: the actual deployed commit, current production configuration, real signup/signin completion, real phone shortcut setup and end-to-end latency, current DB todo/memory, and concurrent Replit changes. Root is checking live UI and workspace separately.

## Useful handoff

Keep the release path narrow: first fix private-cache cleanup and outcome lost updates, then make one supported new-driver onboarding path demonstrably work, then repair/run the meaningful release checks. Do not expand this pass into a framework rewrite or broad dependency audit. This report is review input for Melody and the project agent, not an instruction to change architecture.
