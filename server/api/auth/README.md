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
POST /api/auth/logout           - End session (delete users row)
POST /api/auth/token            - Generate JWT (DEV ONLY, disabled in prod)
```

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
2. DELETE existing `users` row (Highlander Rule - one session per user)
3. INSERT new `users` row with fresh `session_start_at` and `last_active_at`
4. Return JWT token

**Logout:**
1. DELETE `users` row for the authenticated user
2. Client clears JWT from localStorage

**Session Expiration (handled by `requireAuth` middleware):**
- Sliding window: 60 min from `last_active_at`
- Hard limit: 2 hours from `session_start_at`
- If expired: DELETE `users` row, return 401

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
