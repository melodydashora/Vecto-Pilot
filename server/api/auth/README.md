> **Session contract updated:** 2026-10-09; see [authentication](../../../docs/architecture/AUTH.md) for verification boundaries.

# Auth API (`server/api/auth/`)

## Purpose

Full authentication system with JWT tokens, session management, password reset, and profile management.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `auth.js` | `/api/auth/*` | All authentication endpoints |

## Endpoints

### Authentication
```
POST /api/auth/register         - Create new driver account
POST /api/auth/login            - Authenticate with email/password
POST /api/auth/login/recovery   - Recover an interrupted login's original session
POST /api/auth/login/recovery/cancel - Cancel only the saved login attempt
POST /api/auth/logout           - End session (clear session_id, preserves data)
POST /api/auth/token            - Generate JWT (DEV ONLY, disabled in prod)
```

### Social Login
```
GET  /api/auth/google           - Begin Google OAuth with one-time state
POST /api/auth/google/exchange  - Verify Google identity and admit a session
GET  /api/auth/apple            - Apple Sign In redirect (stub → returns error)
```

Google sign-in is implemented. A replacement action starts a fresh Google flow
with `replaceSessionId` bound to server-stored OAuth state. Apple remains a stub.
See [the complete contract](../../../docs/architecture/AUTH.md) for account
adoption, incomplete profiles, recovery and terms handling.

### Password Management
```
POST /api/auth/forgot-password  - Request password reset (email or SMS)
POST /api/auth/reset-password   - Reset password with token/code
```

### Profile
```
GET  /api/auth/me               - Get current user profile
PUT  /api/auth/profile          - Update profile
```

## Session Architecture

Three-table architecture for clean separation of concerns:

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `driver_profiles` | **Identity** - who you are | Forever (created at signup) |
| `users` | Permanent identity and current session pointer | Row survives logout/TTL; session fields expire |
| `snapshots` | **Activity** - what you did when | Forever (historical record) |

### Session Flow

**Login:**
1. Verify credentials against `driver_profiles` + `auth_credentials`
2. Lock the credential and owner rows; recheck the verified credentials and current session
3. Return `409 session_already_active` with `activeSessionId` if an ordinary login finds a live session
4. An explicit replacement must supply the matching `replaceSessionId` and a fresh recovery proof; a stale confirmation cannot replace a newer session
5. Rotate the admitted session, reset its clocks and current snapshot/MAIN pointers, and sign the session-bound JWT within the transaction
6. Commit before returning the token and public profile/vehicle projection

Registration leaves `session_id` null; the web client asks the driver to sign in.
The registration compatibility token is bound to an unused session ID and cannot
authenticate the account.

> **CRITICAL (2026-01-05):** Login uses UPDATE, NOT DELETE+INSERT!
> DELETE caused CASCADE delete of `driver_profiles` and `auth_credentials`, destroying all user data.

**Logout:**
1. UPDATE only the request's current session: clear session, snapshot and MAIN pointers
2. Preserves user row - does NOT delete (prevents cascade data loss)
3. Client clears JWT from localStorage

**Session Expiration (handled by `requireAuth` middleware):**
- Sliding window: 60 min from `last_active_at`
- Hard limit: 2 hours from `session_start_at`
- If expired: UPDATE `users` row to clear session, return 401

### One current session, explicit replacement

A verified conflicting login offers **Close other sessions and sign in**. It
does not replace a live session until the driver chooses that action. Passwords
are verified again; Google uses a fresh OAuth flow and its stored target session.
Replacement changes the session pointer, preserves account data and invalidates
tokens bound to the former session. A delayed logout or recovery cannot affect
the new session. Legacy tokens without session binding remain a separate
retirement limitation; see [authentication](../../../docs/architecture/AUTH.md).

## Security

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number

### Account Lockout
- 5 failed login attempts → 15-minute lockout
- Successful login resets failed attempt counter

### Production Restrictions
- `POST /api/auth/token` returns 403 in production (dev-only endpoint)
- Detection: `NODE_ENV === 'production'` OR `REPLIT_DEPLOYMENT === '1'`

## Response Shapes

### Login/Register Success

Both return `ok`, `token` and the explicit public
[`driverProfileResponse`](../../lib/driver-profile-response.js) projection:
`user`, `sessionId`, `settingsRevision`, `profile` and `vehicle`. Whole database
rows and credentials are never serialized. Login returns a session-bound JWT;
registration has the non-authenticating token and null session described above.

### Active Session (409)

`error: 'session_already_active'`, `message` and `activeSessionId` are returned
only after credentials have been verified. The session ID identifies the target
for an explicit replacement; it is not an authentication credential. A stale
target returns a new active-session conflict or `session_changed` without
replacing anything.

### Session Expired (401)
```json
{
  "error": "session_expired",
  "message": "Session expired due to inactivity. Please log in again."
}
```

## Connections

- **Uses:** `../../lib/auth/password.js` for password hashing
- **Uses:** `../../lib/auth/email.js` for transactional emails
- **Uses:** `../../lib/auth/sms.js` for SMS verification
- **Uses:** `../../middleware/auth.js` for `requireAuth` middleware
- **Creates:** `users` rows for session management
- **Creates:** `driver_profiles` rows for identity
- **Creates:** `auth_credentials` rows for password storage

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { users, driver_profiles, auth_credentials } from '../../../shared/schema.js';

// Auth utilities
import { hashPassword, verifyPassword } from '../../lib/auth/password.js';
import { sendPasswordResetEmail } from '../../lib/auth/email.js';

// Middleware
import { requireAuth } from '../../middleware/auth.js';
```

## Logging Conventions (matrixLog Tier 3 — 2026-05-02)

This module uses the `matrixLog` 8-field structured logger (`server/logger/matrix.js`). All log lines in `auth.js` emit:

```
[AUTH] [<connection>] [<action>] [<location>] -> <message>
```

### Categories used

- `category: 'AUTH'` — base category for all auth-flow lines
- `connection`: `'DB'` for `auth_credentials` / `driver_profiles` / `users` writes; `'API'` for OAuth callbacks; omitted for in-process operations
- `action`: `LOGIN_ATTEMPT`, `LOGIN_SUCCESS`, `LOGIN_FAIL`, `TOKEN_ISSUE`, `PASSWORD_HASH`, `REGISTER`, `RESET_REQUEST`, `RESET_COMPLETE`, etc.
- `location`: `auth.js:<functionName>` (e.g., `auth.js:generateAuthToken`)

### Redaction policy

Per Tier 3 plan §3 (`docs/review-queue/PLAN_matrixlog-tier3-auth-location-strategy-2026-05-02.md`) and matrixLog spec at `server/logger/matrix.js:26-39`:

- **Email** — never appears in messages. Dropped entirely.
- **UserId** — `userId.substring(0, 8)` 8-char hex prefix IS permitted in messages for real-time DX correlation (per 2026-05-02 spec amendment). Full UUID never appears in messages.
- **Password / hash** — never logged.
- **Address (formattedAddress)** — never appears in messages. Field-presence boolean (`address_present: true/false`) may be logged.

### Correlation in JSON sidecar

When `LOG_FORMAT=json|both` (env var), the structured payload includes `category`, `action`, `location`, plus any `request_id` / `snapshot_id` / `user_id` from `withContext(...)` binding. Full UUIDs are allowed in JSON output for log-pipeline correlation; only pretty/console output is constrained.

---

*Updated: 2026-01-05 - Session architecture implementation*
*Updated: 2026-05-02 - matrixLog Tier 3 logging conventions added*
