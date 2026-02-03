# Authentication System

JWT-based authentication with user isolation. **All users must be signed in** to use the app.

## Architecture Overview (December 2025)

```
REQUIRED FLOW (all users):
User opens app → AuthContext checks for token → Redirect to /auth/sign-in if missing
         ↓
   User signs in/registers → /api/auth/login
         ↓
   JWT token returned → localStorage.setItem('vectopilot_auth_token')
         ↓
   GPS access granted → /api/location/resolve creates snapshot with user_id
         ↓
   All API requests include Authorization: Bearer ${token}
         ↓
   [requireAuth middleware] verifies JWT → req.auth.userId
         ↓
   [requireSnapshotOwnership] verifies user owns the snapshot
```

## Key Security Principle

**GPS is gated behind authentication.** Users cannot access location features without signing in first.

## Key Files

| File | Purpose |
|------|---------|
| `server/api/auth/auth.js` | Registration, login, password reset endpoints |
| `server/middleware/auth.js` | `requireAuth` middleware (validates JWT) |
| `server/middleware/require-snapshot-ownership.js` | Verifies user owns snapshot |
| `client/src/contexts/auth-context.tsx` | Auth state, login/logout, token management |
| `client/src/contexts/location-context-clean.tsx` | GPS resolution (requires auth) |
| `client/src/components/auth/AuthRedirect.tsx` | Redirects based on auth state |
| `client/src/utils/co-pilot-helpers.ts` | `getAuthHeader()` helper for API calls |

## Authentication Flow

### Sign-Up (New Users)

```javascript
// Client: SignUpPage.tsx
const response = await fetch('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email, password, firstName, lastName, vehicle, ... })
});
// → Redirects to /auth/sign-in?registered=true

// Server: auth.js
// Creates user, driver_profile, driver_vehicles, auth_credentials
// Geocodes address for home_lat/home_lng
// Looks up market from platform_data
```

### Sign-In (Returning Users)

```javascript
// Client: SignInPage.tsx
const response = await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});
const { token } = await response.json();
localStorage.setItem('vectopilot_auth_token', token);

// Server: auth.js
// Verifies password with bcrypt
// Returns JWT token
```

### Authenticated API Calls

```javascript
// Client: All API calls include auth header
const response = await fetch('/api/briefing/weather/' + snapshotId, {
  headers: getAuthHeader() // { Authorization: 'Bearer xxx' }
});

// Server: requireAuth middleware
const token = req.headers.authorization?.split(' ')[1];
if (!token) return res.status(401).json({ error: 'no_token' });
const payload = verifyAppToken(token); // HMAC verification
req.auth = { userId: payload.userId };
next();

// Server: requireSnapshotOwnership middleware
const snapshot = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId));
if (snapshot.user_id !== req.auth.userId) {
  return res.status(404).json({ error: 'snapshot_not_found' }); // Prevents enumeration
}
req.snapshot = snapshot;
next();
```

## Middleware Chain

All snapshot-based routes use this middleware chain:

```javascript
router.get('/weather/:snapshotId', requireAuth, requireSnapshotOwnership, handler);
//                                 ↑              ↑
//                                 |              |
//                        Validates JWT    Verifies user owns snapshot
```

### requireAuth
- Extracts token from `Authorization: Bearer xxx` header
- Verifies HMAC signature
- Sets `req.auth.userId`
- Returns 401 if no token or invalid token

### requireSnapshotOwnership
- Looks up snapshot by ID
- Verifies `snapshot.user_id === req.auth.userId`
- Returns 404 if user doesn't own snapshot (prevents enumeration)
- Sets `req.snapshot` for use in handler

## Security Principles

### User ID Source
**ALWAYS** get user_id from JWT token (decoded by middleware), **NEVER** from request body:

```javascript
// CORRECT
const user_id = req.auth.userId; // From JWT middleware

// WRONG - Never do this
const { user_id } = req.body; // Attacker can spoof
```

### Database Isolation
All queries filter by authenticated user_id:

```javascript
const results = await db
  .select()
  .from(snapshots)
  .where(eq(snapshots.user_id, req.auth.userId));
```

### Error Responses
Return 404 (not 401/403) for unauthorized access to prevent enumeration:

```javascript
if (resource.user_id !== req.auth.userId) {
  return res.status(404).json({ error: 'Not found' });
}
```

## Token Storage

| Storage | Key | Value |
|---------|-----|-------|
| localStorage | `vectopilot_auth_token` | JWT string |

**Lifecycle:**
- Created: After successful login via `/api/auth/login`
- Used: Every API call (via `getAuthHeader()`)
- Cleared: Manual logout, token expiry, or sign-out

## Routes and Authentication

**All routes require authentication:**

| Route Pattern | Middleware |
|---------------|------------|
| `GET /api/briefing/*/:snapshotId` | `requireAuth` + `requireSnapshotOwnership` |
| `GET /api/blocks/*/:snapshotId` | `requireAuth` + `requireSnapshotOwnership` |
| `POST /api/blocks-fast` | `requireAuth` |
| `POST /api/chat` | `requireAuth` |
| `POST /api/feedback/*` | `requireAuth` |

## IMPORTANT: Legacy /api/auth/token is DISABLED

The legacy endpoint `/api/auth/token` that mints tokens from user_id is **disabled in production** (returns 403). Users must register and login via `/api/auth/login`.

## Verification Checklist

- ✅ User must sign in before GPS access
- ✅ JWT token stored in localStorage
- ✅ All API calls include `Authorization: Bearer` header
- ✅ Backend verifies JWT with `requireAuth` middleware
- ✅ Snapshot ownership verified with `requireSnapshotOwnership`
- ✅ Errors return 404 to prevent enumeration

## See Also

- [Server Structure](server-structure.md) - API route organization
- [Client Structure](client-structure.md) - Frontend auth integration
- [Constraints](constraints.md) - Security constraints
