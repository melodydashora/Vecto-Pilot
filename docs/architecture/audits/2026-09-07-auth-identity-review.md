# VectoPilot authentication and account identity review — September 7, 2026

Provenance: Astra authentication review agent, read-only source inspection requested by the coordinating Astra session after Melody reported broken OAuth and successful repeat signup. Melody's report is user-observed evidence; the findings below distinguish code-confirmed behavior from untested live behavior. This report contains no supplied account credentials.

Inspected clone: `C:\Users\melod\OneDrive\Documents\GitHub\VectoPilot`.
Inspected branch: `codex/vectopilot-mcp-preserve-20260907`.
Inspected commit: `87a31c00245a76dc8e925f0152733551b82ef450`.
Working tree was clean at the beginning and after the review. No project files, database rows, Git state, or deployed app configuration were changed. No live authentication endpoint was called by this review agent. No provider secrets or saved credentials were read. No runtime test is represented as passing here.

## Read first / evidence limits

Read `CLAUDE.md`, `AI_PARTNERSHIP_AGREEMENT.md`, database preflight, the canonical auth document, relevant latest audit/hardening material, actual auth route handlers, Google OAuth helper, client callback and AuthProvider, route guards, signup submission and login code, auth schema sections, SQL migrations, the migration runner, and existing auth-test sources.

The May security hardening plan and July location audit are AI-authored context, not proof that their findings still exist. Findings here were checked against the current source. The database preflight still says session rows are deleted on logout, while the actual logout handler correctly updates them; do not implement the old preflight wording. Database continuity and deployed schema inspection belong to the coordinating session and were not available to this source-only pass.

## Outcome

The code already attempts to reject a repeated normalized email. It does not implement one-account-per-natural-person identification. A fresh Google callback also has a concrete disconnect between its token storage and React authentication state. Account creation, Google linking, browser binding of OAuth state, onboarding enforcement, and database reproducibility need a focused hardening pass before claiming OAuth and repeat-signup behavior are corrected.

### AUTH-I01 — The exact repeat-signup report needs deployed-data reproduction

**Status:** Existing protection confirmed in source; reported live failure remains unverified in this review.

`server/api/auth/auth.js:236` queries `driver_profiles.email` using `email.toLowerCase().trim()`; lines 241–245 return HTTP 409 / `EMAIL_EXISTS` when found. The profile insert at line 430 uses the same normalization. Login at line 621 also normalizes this way. `shared/schema.js:995` declares email as non-null unique text and line 1094 declares an email unique index. The initial auth migration declares the same exact-text uniqueness (`migrations/20251228_auth_system_tables.sql:15` and 57).

Therefore two sequential requests using the identical canonical email should not create two profiles under this code and matching database constraints. Do not simply add another frontend duplicate check and announce this fixed. The next diagnostic must establish the deployed revision, selected database, real constraints, API responses, and resulting profile/user counts.

Normalization exists at the application boundary, not as a case-insensitive database constraint: `TEXT UNIQUE` protects exact stored strings. A legacy/manual/imported mixed-case or whitespace-padded record can differ from the canonical lookup. No lower-email unique expression, `citext`, or explicit normalization check was found in the inspected schema/migrations.

The same phone number, name, address, or person using a different email is not rejected: phone has a nonunique index (`shared/schema.js:1095`) and registration only validates/formats it (`auth.js:227`, 431). Google identities use a unique nullable `google_id` (`shared/schema.js:1000`). There is no provider-identity table or general person identifier in the inspected auth model.

**Acceptance:** On an isolated database matching both dev and prod schema, register once, then repeat with the same email, mixed casing, and surrounding whitespace. Exactly one profile, credentials row, and associated user must remain, with a stable account-already-exists response. Cover existing legacy noncanonical data explicitly. Record the chosen policy for different emails or linked providers; do not strip dots/plus tags or make names/phones unique without an explicit policy because those transformations can conflate distinct users.

### AUTH-I02 — Google success does not update the active authentication context

**Status:** Code-confirmed control-flow gap; production browser reproduction pending.

`client/src/pages/auth/google/Callback.tsx:83` and 87 write the app token to localStorage; lines 89 and 128 navigate within the SPA to `/co-pilot/strategy`. The callback never updates AuthProvider or invokes a shared authenticated-session completion function.

`client/src/contexts/auth-context.tsx:50` reads localStorage only in a mount effect with empty dependencies. Its normal password login updates both localStorage and React state at lines 179–188, but the callback does not use that path. `client/src/App.tsx:30` wraps the router in AuthProvider, so SPA navigation leaves that provider mounted. `client/src/components/auth/ProtectedRoute.tsx:13` and 29 gate the destination on `isAuthenticated`.

For a signed-out browser returning from Google, the mount effect sees no app token, then the later callback saves one without changing provider state. A successful exchange can consequently display success and navigate back to the sign-in guard. A full reload can appear to fix it because the provider rereads the stored token. Both the existing-user success path and new-user terms-acceptance path have this shape.

**Acceptance:** In a clean signed-out browser, mock a successful exchange and exercise the full mounted router/provider flow. The next protected page and authenticated requests must work without reload. Repeat for an existing Google account, a first Google signup after terms acceptance, callback cancellation, and failed exchange. Verify the active user/profile/vehicle/token consistently update together and stale prior-user state is cleared.

### AUTH-I03 — Account creation is not atomic and duplicate races are not handled

**Status:** Code-confirmed missing transaction/conflict handling; no race executed against live data.

Password registration reads for an existing email at `auth.js:236`, then performs password hashing/address calls before separately inserting `users` at 414, `driver_profiles` at 426, `driver_vehicles` at 482, and `auth_credentials` at 493. No transaction encloses these writes. Its catch at 595–601 treats database uniqueness errors as a generic 500 and returns `err.message`.

Google new-account creation similarly inserts `users` at 1637, profile at 1648, and credentials at 1671 independently. The account lookup at 1611 precedes those writes, and no unique-conflict recovery or transaction is present.

With working email uniqueness, concurrent same-email requests should not create two identical profiles, but the losing request can leave an orphan user row and return a 500. A later failure can leave a profile without a vehicle or credentials; retry then hits `EMAIL_EXISTS`. Different concurrent Google authorization flows can have the same partial-write problem. This is distinct from proving Melody's exact duplicate-profile observation.

**Acceptance:** Concurrently register the same canonical email with controlled barriers; assert one complete account and no orphan users/credentials/vehicles. Inject a failure at each insert and prove rollback. Repeat for Google/Google and password/Google races. A database conflict must become a deliberate deterministic auth outcome without leaking raw SQL or internal error text.

### AUTH-I04 — Google identity lookup conflates provider identity and email, and linking needs protection

**Status:** Code-confirmed behavior with security consequences; isolated adversarial tests pending.

`auth.js:1611` uses one unordered `findFirst` with `(google_id = subject OR email = verifiedEmail)`. If the subject identifies one profile and the email identifies another, there is no priority rule or explicit conflict response. If the email-selected profile already has a different Google subject, the code skips linking at 1691 but still authenticates that selected profile at 1739. Subject uniqueness alone does not resolve this two-record identity conflict.

Password registration issues a usable token/session without proving control of the registered email (`auth.js:475`–507; `email_verified` defaults false in `shared/schema.js:1076`). Google helper verification does check the token cryptographically and requires Google's `email_verified` (`server/lib/auth/oauth/google-oauth.js:110` onward). The email-match path then automatically links a previously password-based account (`auth.js:1690`–1705), retains its password credentials, and does not update `email_verified` for that profile.

This creates a pre-registration/account-linking risk: an account originally created with an unverified address can later be adopted by the address owner using Google while the earlier password remains usable. This is a source-traced risk, not a claim of observed exploitation. The verified Google email does not prove ownership of previously chosen local password credentials.

**Acceptance:** Resolve provider subject first, then handle email collisions according to an explicit secure linking policy. Test password-first/Google-first, changed Google email, pre-existing conflicting subject and email records, concurrent linking, and unverified password preregistration. All accepted authentication methods must resolve to one intended user ID, with no unproven previous credential retaining unintended access. Never merge existing driver data silently.

### AUTH-I05 — OAuth state is global and not bound to the initiating browser

**Status:** Code-confirmed missing binding and non-atomic state consumption; exploit/browser reproduction not performed.

Google initiation at `auth.js:1505`–1515 stores a random state with a nil UUID and expiry. No nonce cookie, session binding, or browser-held PKCE verifier is established by that route or its client redirect handler. The callback receives `code` and `state` directly from URL query parameters (`Callback.tsx:30`–56). Exchange validates only state/provider/expiry (`auth.js:1555`–1564).

Consequently a valid state is recognized globally instead of being bound to the browser that began the flow. Checking that state exists in a database is not, by itself, the missing browser correlation. The callback stores whatever app identity a successful exchange returns.

State is read and then deleted in separate operations (`auth.js:1556`, 1579). Two requests can both read it before either delete; Google authorization-code single-use behavior may reject a later token exchange, but the app has not made its own state consumption atomic. A failed exchange consumes state, so retry needs a deliberate restart flow.

**Acceptance:** A valid code/state originating in browser A must not authenticate browser B. Test wrong, absent, expired, already-consumed, and concurrently-consumed state. Bind the authorization request to the initiating browser and consume the binding atomically. Registered redirect origins and init/exchange URI consistency must also be checked in real provider configuration without exposing secrets.

### AUTH-I06 — OAuth onboarding and sign-in/sign-up semantics are inconsistent

**Status:** Code-confirmed behavior; exact desired product policy needs to be recorded.

The initiation route stores `mode=signup|login` in `oauth_states.redirect_uri` (`auth.js:1513`), but the exchange handler never reads that mode. It creates a new account if no profile matches, even when the entry point was Sign In. The callback's `NO_ACCOUNT` branch (`Callback.tsx:64`) is not emitted by this exchange route.

The callback asks for terms only when `data.isNewUser` is true (`Callback.tsx:82`), rather than inspecting current `profile.termsAccepted`. If a new Google user leaves without accepting, the next Google login treats the existing row as an existing user and bypasses that step. A token/session was already created before terms acceptance. ProtectedRoute checks authentication only, not terms/profile completion.

The server inserts new OAuth profiles with `profile_complete=false` and missing address/market/phone fields (`auth.js:1648`–1667). The profile update handler permits filling these fields but never recomputes `profile_complete` in its complete handler (1219–1448). Completing the form can therefore leave the profile flag false permanently. Apple is an explicit stub (`auth.js:1834`); current Apple UI is disabled/coming soon, and Uber OAuth is a connected-platform data flow rather than the app's login method.

**Acceptance:** Define whether Google Sign In may create a first account. Independently of that choice, abandoned onboarding must resume on subsequent visits until required terms/profile steps are fulfilled. Completing required fields must set profile state correctly. Test reload/direct protected URL access during onboarding and the intended server-side gates; do not rely solely on the callback screen.

### AUTH-I07 — Auth schema reproducibility cannot be inferred from the current schema file

**Status:** Source discrepancy confirmed; actual dev/prod state pending.

The old auth SQL migration declares phone/address/market and password hash NOT NULL and has no `google_id`, while current Drizzle schema allows OAuth-only nulls and declares the Google unique identity. No corresponding Google auth addition/nullability migration was found in tracked migration SQL. This does not prove a running database is wrong: the changes may have been applied manually.

`server/db/run-migrations.js` deliberately records SQL older than `20260703` as already applied without executing it. That is documented as a baseline for two pre-existing databases, not a complete schema bootstrap for an empty database. A new database cannot be assumed to have auth tables merely because the runner completed its baseline bookkeeping.

**Acceptance:** Inspect each environment's actual constraints, nullability, indexes, schema-migration history, account counts, and orphan counts without exporting credentials or personal account rows. Distinguish an empty table from a missing table. Prove a documented new-environment bootstrap and an additive migration path for existing databases; preserve accounts and do not reset databases to obtain parity.

### AUTH-I08 — Existing tests do not establish signup or Google correctness

**Status:** Test-source coverage gap confirmed by bounded search/read, not a full test execution.

`tests/auth/uber-oauth.test.js` concerns Uber helper behavior. `tests/auth-token-validation.test.js` concerns token/middleware behavior and older token expectations. No signup duplicate, Google exchange/identity-linking, Google callback/provider-state, or concurrent account-creation tests were found in the inspected test tree. Passing the 29 MCP tests does not establish any of those flows.

**Acceptance:** Add the focused integration and browser cases above to an actual selected CI command, with isolated databases and mocked Google responses for deterministic coverage. Keep a separate manually verified real-provider smoke check for redirect registration, login consent, callback completion, and persisted identity in dev and production. Avoid creating real duplicate users merely to prove race handling.

## Recommended finite first pass

1. Capture the exact failing deployed flow and actual duplicate identity fields; verify deployed revision and database parity.
2. Add the missing callback-to-AuthProvider completion path and a browser regression.
3. Specify canonical account matching/linking and required onboarding, using one stable app user ID across accepted methods.
4. Add atomic account creation, database-level canonical uniqueness, explicit conflict handling, and safe state binding/consumption.
5. Run the acceptance matrix in an isolated environment, then a bounded real-provider verification. Record dev and prod outcomes separately.

No finding in this report is marked fixed. Broad pipeline naming, observability, scalability, other authorization surfaces, and application feature completion remain separate workstreams owned by the coordinating session.
