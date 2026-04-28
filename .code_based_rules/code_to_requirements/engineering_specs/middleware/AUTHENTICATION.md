# Engineering Specification: Authentication Middleware

## 1. Scope

This specification defines the functional, operational, security, reliability, and non-functional requirements for the authentication middleware, including bearer-token verification, service-account authentication, session enforcement, session expiration handling, optional authentication behavior, database-backed session validation, and failure behavior.

## 2. System purpose

The authentication middleware shall:
- authenticate end users via signed bearer tokens
- authenticate internal agents via a shared secret header
- enforce active-session requirements for protected routes
- support optional authentication for mixed public/private routes
- apply sliding and absolute session expiration rules
- reject unauthorized or invalid requests consistently
- fail closed on authentication service failures

---

## 3. Functional requirements

### 3.1 Authentication modes

#### FR-AUTH-001
The system shall support two authentication modes:
- standard user bearer-token authentication
- service-account or agent authentication via request header

#### FR-AUTH-002
Agent authentication shall take priority over standard bearer-token authentication when present and valid.

#### FR-AUTH-003
Successful authentication shall attach normalized authentication context to the request object.

---

### 3.2 Agent and service-account authentication

#### FR-AGENT-001
The system shall support agent authentication via the `x-vecto-agent-secret` header.

#### FR-AGENT-002
Agent authentication shall map successful requests to a fixed system user identifier.

#### FR-AGENT-003
If no agent secret header is present, agent authentication shall not be attempted.

#### FR-AGENT-004
If `VECTO_AGENT_SECRET` is not configured, agent authentication shall fail in all environments.

#### FR-AGENT-005
Agent-secret validation shall use constant-time comparison.

#### FR-AGENT-006
If the supplied agent secret length differs from the configured secret length, authentication shall fail.

#### FR-AGENT-007
Successful agent authentication shall attach request auth context containing:
- `userId`
- `isAgent`
- `sessionId = null`
- `currentSnapshotId = null`
- `phantom = false`

#### FR-AGENT-008
Agent-auth failure shall not grant anonymous or fallback authenticated access.

---

### 3.3 Bearer-token authentication

#### FR-TOKEN-001
Standard user authentication shall read the bearer token from the `Authorization` header.

#### FR-TOKEN-002
The token format shall be `Bearer <token>`.

#### FR-TOKEN-003
The token payload format shall be `userId.signature`.

#### FR-TOKEN-004
Token verification shall use HMAC-SHA256 over the `userId` value.

#### FR-TOKEN-005
The signing secret shall be resolved from:
- `JWT_SECRET`
- fallback `REPLIT_DEVSERVER_INTERNAL_ID` in development-compatible scenarios

#### FR-TOKEN-006
In production deployments, `JWT_SECRET` shall be required.

#### FR-TOKEN-007
Token verification shall fail if:
- the token format is invalid
- the signature does not match
- no signing secret is available
- the `userId` is missing or too short

#### FR-TOKEN-008
Successful token verification shall return verified user identity information.

---

### 3.4 Required authentication flow

#### FR-REQ-001
Protected routes shall require either:
- valid agent authentication
- valid bearer token plus valid active session

#### FR-REQ-002
If no bearer token is present for protected routes, the system shall return HTTP `401` with `error: "no_token"`.

#### FR-REQ-003
If agent authentication succeeds, the system shall bypass user-session validation and continue the request.

#### FR-REQ-004
If bearer-token authentication succeeds, the system shall validate the authenticated user's session in the database.

#### FR-REQ-005
If authentication and session validation succeed, the middleware shall call `next()` exactly once.

---

### 3.5 Session lookup and enforcement

#### FR-SESSION-001
Protected-route authentication shall load the user's session record from the `users` table.

#### FR-SESSION-002
If no session record is found, the system shall reject the request with HTTP `401` and a session-expired response.

#### FR-SESSION-003
If the session record exists but `session_id` is null, the system shall treat the user as logged out and reject the request.

#### FR-SESSION-004
The system shall enforce a sliding inactivity timeout of 60 minutes.

#### FR-SESSION-005
The system shall enforce an absolute hard session limit of 2 hours from session start.

#### FR-SESSION-006
If the hard session limit is exceeded, the system shall clear server-side session state and reject the request.

#### FR-SESSION-007
If the inactivity window is exceeded, the system shall clear server-side session state and reject the request.

#### FR-SESSION-008
Session clearing on expiration shall update the user record rather than deleting it.

#### FR-SESSION-009
Session clearing on expiration shall null out:
- `session_id`
- `current_snapshot_id`

#### FR-SESSION-010
When a session is still valid, the system shall update `last_active_at` asynchronously to extend the sliding window.

#### FR-SESSION-011
A failure to update `last_active_at` shall not block the request after authentication succeeds.

#### FR-SESSION-012
Successful session validation shall attach request auth context containing:
- `userId`
- `sessionId`
- `currentSnapshotId`
- `phantom`

---

### 3.6 Optional authentication flow

#### FR-OPT-001
The system shall support optional authentication for routes that allow authenticated or unauthenticated access.

#### FR-OPT-002
Optional authentication shall check for agent authentication before bearer-token authentication.

#### FR-OPT-003
If agent authentication succeeds in optional mode, the request shall proceed as authenticated agent traffic.

#### FR-OPT-004
If no bearer token is present in optional mode, the request shall continue without authenticated user context.

#### FR-OPT-005
If a bearer token is present in optional mode, it shall be verified.

#### FR-OPT-006
If a bearer token is present but invalid in optional mode, the request shall be rejected with HTTP `401`.

#### FR-OPT-007
If a bearer token is valid in optional mode, authenticated user context shall be attached to the request.

#### FR-OPT-008
Optional authentication shall call `next()` for anonymous requests when no credentials are provided.

---

### 3.7 Request auth context

#### FR-CTX-001
The middleware shall attach authentication context to `req.auth`.

#### FR-CTX-002
Authenticated user context shall include user identity and session context where available.

#### FR-CTX-003
Agent-authenticated context shall explicitly indicate machine-authenticated access.

#### FR-CTX-004
The middleware shall expose the fixed system agent user ID and agent secret header constant for reuse by other modules.

---

## 4. Security requirements

### 4.1 Secret handling

#### SEC-001
Agent authentication shall require a configured secret in all environments.

#### SEC-002
Agent-secret verification shall use constant-time comparison to reduce timing-attack exposure.

#### SEC-003
Authentication signing secrets shall not be optional in production.

### 4.2 Authentication integrity

#### SEC-004
Protected routes shall not permit access without valid credentials.

#### SEC-005
Agent authentication shall not silently succeed when the expected secret is absent.

#### SEC-006
Invalid or malformed bearer tokens shall be rejected.

#### SEC-007
Session enforcement shall be required after token verification for protected user routes.

### 4.3 Session security

#### SEC-008
Expired sessions shall be invalidated server-side.

#### SEC-009
Logged-out sessions with null `session_id` shall not be accepted as authenticated.

#### SEC-010
Sliding and hard session-expiration policies shall both be enforced.

### 4.4 Failure behavior

#### SEC-011
If database-backed session checks fail, the middleware shall fail closed.

#### SEC-012
Authentication-service failures during required auth shall return service-unavailable behavior rather than allowing the request through.

#### SEC-013
The middleware shall not allow protected requests to proceed when session enforcement cannot be completed.

---

## 5. Operational requirements

### 5.1 Logging and observability

#### OPS-001
The middleware shall log agent-authentication failures and successes through the authentication logger.

#### OPS-002
The middleware shall log token-verification failures.

#### OPS-003
The middleware shall log session-expiration and logged-out conditions for protected routes.

#### OPS-004
Optional authentication may emit diagnostic logs describing token presence and validation outcome.

#### OPS-005
Non-blocking `last_active_at` update failures should be logged as warnings.

### 5.2 Environment behavior

#### OPS-006
Production mode shall be detected from deployment-related environment indicators.

#### OPS-007
Development-compatible fallback behavior for token verification shall only use the development internal identifier when production requirements do not apply.

### 5.3 Data handling

#### OPS-008
Session validation shall query the `users` table using the authenticated `userId`.

#### OPS-009
Session cleanup shall update records in place rather than deleting user rows.

---

## 6. Reliability requirements

### 6.1 Middleware completion

#### REL-001
Required-auth middleware shall call `next()` after successful authentication and session validation.

#### REL-002
Optional-auth middleware shall call `next()` when anonymous access is allowed and no invalid credentials are present.

#### REL-003
The middleware shall terminate requests with explicit HTTP responses when authentication fails.

### 6.2 Non-blocking behavior

#### REL-004
Successful authentication shall not depend on completion of asynchronous `last_active_at` updates.

#### REL-005
Best-effort session activity updates shall not cause authenticated requests to fail if the update operation errors.

### 6.3 Stable failure handling

#### REL-006
Token-verification errors shall be normalized into unauthorized responses.

#### REL-007
Session-store failures during required auth shall be normalized into unavailable-auth-service responses.

#### REL-008
Unexpected optional-auth failures shall be normalized into server-error responses.

---

## 7. Non-functional requirements

### 7.1 Maintainability

#### NFR-MAINT-001
Authentication concerns shall remain separated into reusable functions for:
- agent-secret validation
- token verification
- required authentication
- optional authentication

#### NFR-MAINT-002
Session timeout values shall be centralized as constants.

#### NFR-MAINT-003
Exported constants for agent identity and header names shall support reuse across the codebase.

### 7.2 Auditability

#### NFR-AUD-001
Security-relevant authentication outcomes should be observable through logs.

#### NFR-AUD-002
Session invalidation and agent-authentication decisions should be diagnosable from emitted log messages.

### 7.3 Usability

#### NFR-USE-001
Unauthorized responses should use stable machine-readable error codes.

#### NFR-USE-002
Session-expiration responses should provide user-facing messages indicating re-login is required.

#### NFR-USE-003
Optional-auth routes should support both anonymous and authenticated client flows without duplicating route handlers.

### 7.4 Security posture

#### NFR-SEC-001
The middleware shall prioritize security over availability for required authentication paths.

#### NFR-SEC-002
The middleware shall prefer explicit rejection over permissive fallback when authentication state cannot be established.

---

## 8. Required authentication sequence

The implementation shall follow this sequence for required authentication:

1. inspect the request for agent-authentication header
2. if valid agent auth succeeds, attach agent auth context and continue
3. otherwise inspect the `Authorization` header for a bearer token
4. reject the request if no token is present
5. verify the token format and HMAC signature
6. load the user's session record from the database
7. reject if no session exists
8. reject if the session indicates logged-out state
9. enforce hard session limit
10. enforce inactivity sliding-window limit
11. clear expired session state where required
12. asynchronously refresh `last_active_at` for valid sessions
13. attach authenticated request context
14. call `next()`

The implementation shall follow this sequence for optional authentication:

1. inspect the request for agent-authentication header
2. if valid agent auth succeeds, attach agent auth context and continue
3. inspect for bearer token
4. if no token is present, continue anonymously
5. if token is present, verify it
6. reject on invalid token
7. attach authenticated context on valid token
8. call `next()`

---

## 9. Explicit prohibitions

The implementation shall not:
- accept agent authentication when `VECTO_AGENT_SECRET` is not configured
- allow invalid bearer tokens to proceed
- allow protected user requests without a valid active session
- permit logged-out sessions with null `session_id` to remain valid
- delete user rows as the mechanism for clearing expired sessions
- fail open when database-backed session checks fail
- omit middleware completion after successful required authentication
- silently treat invalid optional-auth tokens as anonymous access

---

## 10. Acceptance criteria

The system is compliant if all of the following are true:

- agent authentication requires a valid `x-vecto-agent-secret` that matches configured secret material
- agent auth fails when the expected secret is absent
- bearer tokens are verified as `userId.signature` using HMAC-SHA256
- production authentication requires `JWT_SECRET`
- protected routes reject requests with no token, invalid token, missing session, logged-out session, expired session, or unavailable session backend
- valid protected-route sessions update `last_active_at` without blocking successful requests
- session expiration clears `session_id` and `current_snapshot_id` through update operations
- optional-auth routes allow anonymous traffic only when no credentials are provided
- optional-auth routes reject invalid provided tokens
- authenticated requests receive normalized `req.auth` context
- session-check failures fail closed for protected routes
- successful required-auth flows always call `next()`