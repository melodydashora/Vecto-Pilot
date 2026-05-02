> **Last Verified:** 2026-01-06

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
POST /api/auth/logout           - End session (clear session_id, preserves data)
POST /api/auth/token            - Generate JWT (DEV ONLY, disabled in prod)
```

### Social Login (Stubs - Not Yet Implemented)
```
GET  /api/auth/google           - Google OAuth redirect (stub → returns error)
GET  /api/auth/apple            - Apple Sign In redirect (stub → returns error)
```

> **Note (2026-01-06):** Social login routes are stubs that redirect back to
> `/auth/sign-in?error=social_not_implemented&provider={google|apple}`.
> The frontend displays "Coming soon!" message. TODO: Implement full OAuth.

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

## Session Architecture (2026-01-05)

Three-table architecture for clean separation of concerns:

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `driver_profiles` | **Identity** - who you are | Forever (created at signup) |
| `users` | **Session** - who's online now | Temporary (login → logout/TTL) |
| `snapshots` | **Activity** - what you did when | Forever (historical record) |

### Session Flow

**Login:**
1. Verify credentials against `driver_profiles` + `auth_credentials`
2. UPSERT `users` row: UPDATE if exists, INSERT if new (preserves FK relationships)
3. Reset `session_start_at` and `last_active_at` to now
4. Return JWT token

> **CRITICAL (2026-01-05):** Login uses UPDATE, NOT DELETE+INSERT!
> DELETE caused CASCADE delete of `driver_profiles` and `auth_credentials`, destroying all user data.

**Logout:**
1. UPDATE `users` row: set `session_id = NULL`, `current_snapshot_id = NULL`
2. Preserves user row - does NOT delete (prevents cascade data loss)
3. Client clears JWT from localStorage

**Session Expiration (handled by `requireAuth` middleware):**
- Sliding window: 60 min from `last_active_at`
- Hard limit: 2 hours from `session_start_at`
- If expired: UPDATE `users` row to clear session, return 401

### Highlander Rule

"There can be only one." New login on any device invalidates all existing sessions:
- User logs in on phone → session created
- User logs in on laptop → phone's session deleted
- Phone's next API call returns 401 (session not found)

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
```json
{
  "ok": true,
  "token": "uuid.signature",
  "user": { "userId": "uuid", "email": "..." },
  "profile": { /* full profile object */ },
  "vehicle": { /* primary vehicle */ }
}
```

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
