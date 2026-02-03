> **Last Verified:** 2026-02-03

# Auth API (`server/api/auth/`)

## Purpose

Full authentication system with JWT tokens, session management, password reset, and profile management.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `auth.js` | `/api/auth/*` | All authentication endpoints |
| `uber.js` | `/api/auth/uber/*` | Uber OAuth and webhook integration (2026-02-03) |

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

### Uber OAuth (2026-02-03)
```
GET  /api/auth/uber              - Initiates Uber OAuth flow
GET  /api/auth/uber/callback     - Handles OAuth callback from Uber
POST /api/auth/uber/webhook      - Receives webhook events from Uber
```

#### Environment Variables
```bash
UBER_CLIENT_ID=...              # From Uber Developer Dashboard
UBER_CLIENT_SECRET=...          # From Uber Developer Dashboard
UBER_REDIRECT_URI=...           # Default: https://vectopilot.com/api/auth/uber/callback
UBER_WEBHOOK_SECRET=...         # Signing key for webhook verification (you create this)
```

#### Webhook Security
Uber uses HMAC-SHA256 signature verification:
- Signature sent in `X-Uber-Signature` header
- Uses dedicated webhook signing key (UBER_WEBHOOK_SECRET) as HMAC key
- Must return 200 OK within 5 seconds
- Uses timing-safe comparison to prevent timing attacks

#### Webhook Event Types
| Event | Description |
|-------|-------------|
| `trips.status_changed` | Trip status updated |
| `trips.completed` | Trip completed |
| `driver.status_changed` | Driver status changed |
| `driver.online` | Driver went online |
| `driver.offline` | Driver went offline |
| `payments.trip_payment` | Payment received |

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

---

*Updated: 2026-01-05 - Session architecture implementation*
