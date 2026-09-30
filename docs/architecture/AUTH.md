# Authentication and session ownership

Source traced September 29, 2026. This replaces the April implementation guide;
its useful history (JWT migration, logout data preservation and zombie-snapshot
races) is retained below. Source is authoritative. This review used mocked routes
and synthetic in-memory PostgreSQL tests, not a production login or database read.

## Entry points and credential flow

[auth.js](../../server/api/auth/auth.js) is mounted at `/api/auth` by
[bootstrap/routes.js](../../server/bootstrap/routes.js).

| Entry | Current behavior |
|---|---|
| `POST /register` | Validates submitted identity/password/phone/terms/profile, resolves address when available, transactionally creates account/profile/vehicle/credentials. Registration returns a compatibility token; the web client deliberately asks the driver to sign in afterward. Address-provider uncertainty is not confirmation; see [independent pipelines](INDEPENDENT_PIPELINES.md). |
| `POST /login` | Reads profile/credentials and compares bcrypt outside the transaction. Under the credential row lock it rechecks the same stored hash and lockout state; five failed attempts impose a 15-minute lock. Successful credential/session writes commit together. |
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

Successful password and Google login use `createDriverSession` to replace the
session UUID, reset both current pointers, and read a consistent profile/vehicle
revision. The login, `/me`, profile-save and setup surfaces use
[driver-profile-response.js](../../server/lib/driver-profile-response.js): explicit
public fields, session ID, settings revision, selected services and active primary
vehicle. Whole database rows, credentials and Shortcut secrets are not serialized.

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

Logout tears down local auth immediately, cancels/clears queries, closes SSE and
clears saved snapshot/Strategy state before the best-effort server call completes.
The captured old token is used for that call; its eventual result cannot clear a
later login. Cross-tab token/logout events clear the previous owner immediately,
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

The server session is one current row per user; a new login replaces the prior
session. There is no refresh-token endpoint or JWT blacklist. Session checks are
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
failed login, session-clock races, revision conflicts and owner transitions.
The long-lived request helper tests actual JWT/legacy/agent verification with a
mocked session store; transport lifecycle is tested separately by its caller.
