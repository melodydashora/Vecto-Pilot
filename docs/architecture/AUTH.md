# Authentication and session ownership

Source traced October 5, 2026. This replaces the April implementation guide;
its useful history (JWT migration, logout data preservation and zombie-snapshot
races) is retained below. Source is authoritative. Verification uses mocked routes,
synthetic isolated PostgreSQL/PGlite databases and browser API fixtures, not a
production login or application database read.

## Entry points and credential flow

[auth.js](../../server/api/auth/auth.js) is mounted at `/api/auth` by
[bootstrap/routes.js](../../server/bootstrap/routes.js).

| Entry | Current behavior |
|---|---|
| `POST /register` | Validates submitted identity/password/phone/terms/profile, resolves address when available, transactionally creates account/profile/vehicle/credentials with no active session. The web client asks the driver to sign in afterward. The compatibility token is bound to an unused UUID and cannot authenticate; `sessionId` is null. Address-provider uncertainty is not confirmation; see [independent pipelines](INDEPENDENT_PIPELINES.md). |
| `POST /login` | Reads profile/credentials and compares bcrypt outside the transaction. Under the credential row lock it rechecks the same stored hash and lockout state; five failed attempts impose a 15-minute lock. A verified login locks the owner row and rejects another live session with 409. Successful credential/session writes and local token signing complete in one transaction. |
| `POST /login/recovery` | Uses the browser's saved login-attempt proof to recover only that attempt's committed, still-live session. It never creates a session or advances its clocks. |
| `POST /login/recovery/cancel` | Records cancellation even if the original request has not arrived. A completed attempt can clear only its own current session; a delayed login cannot commit after cancellation. |
| `GET /google`, `POST /google/exchange` | Google authorization-code flow with one-time expiring state and verified Google identity. New OAuth profiles can be incomplete. Account/session writes use transactions and the same response projection as password login. |
| `GET /me` | Requires authentication. Reads the owner profile and active primary vehicle under the shared owner row lock so one response cannot mix settings revisions. |
| `PUT /profile` | Requires the saved settings revision and a live driver session; see [preferences and admission](USER_PREFERENCES.md). |
| `POST /forgot-password`, `POST /reset-password` | Email token or SMS code reset. Reset claims are consumed atomically with credential changes and session invalidation; replay cannot succeed twice. |
| `POST /logout` | Clears session/current snapshot/current MAIN pointer only for the session authenticated by this request. A delayed logout cannot erase a newer login. Account rows are preserved. |
| `GET /apple` | Stub redirect, not an implemented Apple flow. |
| `POST /token` | Development helper; disabled in production. It does not establish a verified driver session. |

Uber OAuth was removed at Melody's request on September 13 because the app has no
Uber API relationship. It must not be inferred from supported driving services.
Password hashing/strength is owned by [password.js](../../server/lib/auth/password.js);
OAuth/email/SMS helpers live under `server/lib/auth/`. Model/provider pins do not
belong in this authentication document.

## Tokens and live sessions

[jwt.js](../../server/lib/jwt.js) signs/verifies HS256 JWTs with issuer
`vecto-pilot`, audience `vecto-pilot-api`, subject, issued time and two-hour expiry.
Current login tokens also carry `sid`, the newly created session identity.
Configured secrets are read by name; never paste them into docs or test receipts.
The development fallback is the existing workspace-specific environment value.

[middleware/auth.js](../../server/middleware/auth.js) dispatches three-segment
JWTs and the still-present two-segment legacy HMAC path separately. Failed JWT
verification does not downgrade to HMAC. Legacy/unbound tokens lack `sid`; they
still require a live database session but do not acquire modern token binding by
assertion. Their retirement remains separate work, not a completed cleanup.

`requireAuth` first accepts configured agent/bridge credentials, otherwise
verifies Bearer credentials, reads `users`, checks the token's session binding,
and applies [session-policy.js](../../server/lib/auth/session-policy.js):

- A real nonempty session and finite, nonfuture start/activity timestamps are
  required; activity cannot precede session start.
- The sliding inactivity window is one hour; the absolute session limit is two
  hours. These are checked against the stored timestamps, not inferred from UI.
- Expiry clears only the captured session/timestamps. If a concurrent renewal
  wins, middleware rereads and revalidates rather than clearing a newer state.
- Authenticated request activity uses SQL `GREATEST`, scoped to the same session;
  an older delayed request cannot move the activity clock backward.
- Session-store failure returns 503; missing/invalid/expired credentials or
  session return 401. Invalid timestamp state does not authenticate.

Password and Google login use [createDriverSession](../../server/lib/auth/driver-session.js)
under a `users` row lock. An existing live session returns
`409 { error: 'session_already_active', message: 'You already have an active session. Log out of that session before starting a new one.' }`.
That refusal leaves its session UUID, activity clock and current pointers intact;
it also rolls back successful-login credential writes. Only an absent, expired or
invalid session can be replaced. Successful admission resets both current pointers
and reads a consistent profile/vehicle revision. Token signing happens before
commit so a signing failure cannot strand a live session without a usable token.
The login, `/me`, profile-save and setup surfaces use
[driver-profile-response.js](../../server/lib/driver-profile-response.js): explicit
public fields, session ID, settings revision, selected services and active primary
vehicle. Whole database rows, credentials and Shortcut secrets are not serialized.

The existing Google account-adoption protection remains a narrow exception: a
verified Google owner may revoke an unverified password registrant's password,
phone and session. This decision is reread under credential and owner locks before
any revocation. Concurrent adoption cannot revoke the verified owner's new session
a second time. Linking, account creation and session admission commit together.

## Interrupted login recovery

Before password login or Google code exchange, the web client saves a fresh
256-bit random proof in a separate localStorage record for that attempt. Records
contain no password or Google authorization code. Independent keys prevent two
same-origin tabs from overwriting each other's pending proof. If durable storage
fails, the client stops before sending a request that could create a session.

The server stores only the SHA-256 proof digest in `auth_login_attempts`, with an
attempt identity, status and session binding. Claiming an attempt precedes
credential verification or the one-time Google exchange. The final transaction
locks the attempt before credentials and the user, then commits the session and
completed receipt together. Duplicate attempts do not repeat authentication or
consume another Google code. An expired or cancelled attempt cannot commit.

Recovery returns the original session only while its recorded session ID still
matches the live user session. It preserves session start, last activity, current
snapshot and MAIN pointers. Reissued JWTs retain the original issued time and
expiry, and Google results retain their terms/adoption flags. No password, Google
code or replacement session is needed to recover a response lost in transit.
Saved-session hydration with an explicit `termsAccepted: false` restores the terms
step before publishing authenticated React state. A saved session at the Google
callback resumes through that session instead of exchanging its consumed code.

An unknown or still-processing attempt returns `202`; it is not proof that the
first request failed. Network errors, malformed replies and server failures keep
the browser's proof and show a recovery action instead of inviting another login.
Terminal attempts return `410`. Cancellation records a tombstone before the client
discards its proof, including when the initial request has not reached the server.
The browser retains cancellation in a separate record so a concurrent successful
response cannot delete it while removing its own recovery record. It checks the
attempt again after token storage and when other tabs update storage, clearing
only the associated session if cancellation won. For a completed attempt, server
cancellation clears only its matching session. Logout,
password reset, session expiry or a later session also invalidate recovery through
the same session binding. Recovery responses use `Cache-Control: no-store`; proofs
are bearer credentials and must never appear in URLs, logs or public evidence.

The additive [login-recovery migration](../../migrations/20261005_login_recovery.sql)
for `auth_login_attempts` must run before deploying the new server. Older clients
that omit the optional proof retain the prior login API,
but cannot recover a completely lost response through this mechanism.

## Client transitions and long-lived requests

[auth-context.tsx](../../client/src/contexts/auth-context.tsx) publishes password
and Google login through one provider path. Token storage uses
[storageKeys.ts](../../client/src/constants/storageKeys.ts); localStorage contains
the token and React owns current profile/vehicle state. Captured generation,
request and token identities reject late hydration/save/login responses after
an account change. Successful response ownership is checked before publication.

A temporary `/me` failure during initial hydration keeps the stored token and
saved data while both root and protected routes show a recoverable session-check
screen. Explicit retry, network recovery or foreground return retries that
interrupted check; only a successful owned response opens private routes. A
verified mounted session does not reauthenticate on focus. Actual `401` responses
still clear the rejected session. This preserves the existing one-hour inactivity
and two-hour absolute limits; it does not extend JWT or database session lifetime.

The sign-in entry also shows the same recoverable session-check screen when
initial `/me` verification fails temporarily, so opening a saved sign-in URL in
another tab does not invite a replacement login. Same-origin tabs reuse the stored
session; a separate login receives the existing-session warning.

Logout tears down local auth immediately, cancels/clears queries, closes SSE and
clears saved snapshot/Strategy state before the server call completes. Its captured
credential is kept only under `PENDING_LOGOUT_TOKEN` until logout returns success
or `401`; it is never used to hydrate private state. Failed or 15-second timed-out
requests keep the sign-in page on **Finish signing out**, with an explicit retry
that also works after reload or in another same-origin tab. No automatic retry
loop or replacement login is started. A late response can remove only its own
pending credential and cannot clear a later login or newer pending logout.
Cross-tab token/logout events clear the previous owner immediately,
then hydrate the currently stored token. Location, MAIN setup, Coach and query
owners also fence their asynchronous work; clearing one React state alone does
not prevent another provider from restoring stale data.

`requireAuthAllowQueryToken` supports existing browser EventSource query-token
transport by moving the token into the authorization header before the same
checks. It does not create a second authentication policy. Query-token transport
is still present; the planned ticket/cookie migration has not landed here.

`isRequestAuthCurrent(req)` revalidates an already-authenticated long-lived
request without touching activity: current credential signature/expiry, captured
user/session, fresh stored session, and clock policy must agree. Agents recheck
the configured secret and captured identity/token source. It fails closed on
errors. Stream callers own when to invoke it and close transport; see
[the MAIN trace](ai-pipeline.md) and the actual SSE route for integration.

Agent requests (`x-vecto-agent-secret` or `x-claude-bridge-token`) use the configured
system identity and `tokenSource`, not a driver's session. `requireAgentOnly`
restricts administrative surfaces. `optionalAuth` verifies presented credentials
but is not interchangeable with the live-session-enforcing `requireAuth`.

## Constraints and evidence

The server session is one current row per user; another login must wait for logout
or expiry of the prior live session. There is no refresh-token endpoint or JWT blacklist. Session checks are
lazy; no background job is required to delete accounts, and logout must never
DELETE `users` because dependent account data must survive. Historical April
“zombie snapshot” fixes established the need for both provider cleanup and auth
checks; current generation/session fences extend that same ownership principle.

Rate limits are defined by [rate-limit.js](../../server/middleware/rate-limit.js)
and mounted middleware; this route has account lockout but no separate login
limiter. Do not treat old proposed hardening checklists as implemented features.
OAuth profile incompleteness now blocks MAIN admission until required saved
setup is ready; the profile flag alone does not prove readiness.

Regression sources: `tests/auth/`, `tests/auth-token-validation.test.js`,
`tests/strategy/main-run-admission.test.js`, and client auth/setup/profile lifecycle
suites. These cover transaction rollback, reset replay, delayed logout, concurrent
login and Google adoption, signup-to-first-login, token-signing rollback,
59-minute return, 61-minute expiry, session-clock races, revision conflicts and owner transitions.
The long-lived request helper tests actual JWT/legacy/agent verification with a
mocked session store; transport lifecycle is tested separately by its caller.

Local SQL tests use isolated databases and synthetic account rows. PGlite's single
connection does not reproduce PostgreSQL lock scheduling across multiple server
processes; separate PostgreSQL connection tests cover the recovery lock races.
Browser checks intercept API responses and do not establish production acceptance.
Recovery depends on retaining the saved proof: deleting browser storage, losing
the device, or using an older client without proof still requires ending the old
session or waiting for expiry. The no-takeover rule remains in force.
