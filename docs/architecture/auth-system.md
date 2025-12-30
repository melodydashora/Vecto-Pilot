# Authentication System

JWT-based authentication with user isolation. Supports both anonymous and registered users.

## Two Authentication Modes

### 1. Anonymous Mode (Default)
Users can access the app without registration. Access is controlled by **snapshot ownership**:
- GPS → `/api/location/resolve` → creates snapshot with user_id
- Snapshot ID acts as capability token (UUID is unguessable)
- Endpoints use `optionalAuth` + `requireSnapshotOwnership` middleware
- No JWT token required - snapshot ownership is verified instead

### 2. Registered Mode (Full Features)
Registered drivers get JWT tokens for authenticated access:
- Sign up via `/api/auth/register`
- Login via `/api/auth/login` → returns JWT token
- Token stored in `localStorage.setItem('vecto_auth_token', token)`
- Endpoints use `requireAuth` middleware

## Architecture Overview

```
ANONYMOUS FLOW (no registration):
Browser GPS → [LocationContext] → /api/location/resolve
         ↓
   Creates snapshot with user_id + snapshot_id
         ↓
   Snapshot ID stored in context (not localStorage token)
         ↓
   Endpoints check snapshot ownership (optionalAuth + requireSnapshotOwnership)

REGISTERED FLOW (with account):
User registers/logs in → /api/auth/login
         ↓
   JWT token returned → localStorage.setItem('vecto_auth_token')
         ↓
   All requests include Authorization: Bearer ${token}
         ↓
   [requireAuth middleware] verifies JWT → req.auth.userId
```

## IMPORTANT: /api/auth/token is DISABLED in Production

The legacy endpoint `/api/auth/token` that mints tokens from user_id is **disabled in production** (returns 403). This was a dev-only convenience endpoint.

In production, users must either:
- Use anonymous mode (snapshot ownership)
- Register and login via `/api/auth/login`

## Key Files

| File | Purpose |
|------|---------|
| `server/api/auth/auth.js` | Registration, login, password reset endpoints |
| `server/middleware/auth.js` | `requireAuth` and `optionalAuth` middleware |
| `server/middleware/require-snapshot-ownership.js` | Verifies user owns snapshot (anonymous mode) |
| `client/src/contexts/location-context-clean.tsx` | GPS resolution, snapshot creation |
| `client/src/utils/co-pilot-helpers.ts` | `getAuthHeader()` helper for API calls |
| `client/src/hooks/useBriefingQueries.ts` | Briefing data fetches with auth headers |

## Authentication Flows

### Anonymous Flow (Most Users)

```javascript
// Step 1: GPS Resolution creates snapshot
// Client: location-context-clean.tsx
const response = await fetch(`/api/location/resolve?lat=${lat}&lng=${lng}&device_id=${deviceId}`);
const { snapshot_id, user_id } = await response.json();
// snapshot_id is stored in context state, NOT localStorage

// Step 2: API calls include snapshot_id in URL
// Client: useBriefingQueries.ts
const response = await fetch(`/api/briefing/weather/${snapshotId}`, {
  headers: getAuthHeader() // Returns {} if no token, or { Authorization: Bearer... } if logged in
});

// Step 3: Server verifies snapshot ownership
// Server: requireSnapshotOwnership middleware
const snapshot = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId));
if (snapshot.user_id && req.auth?.userId && snapshot.user_id !== req.auth.userId) {
  return res.status(404).json({ error: 'snapshot_not_found' }); // Prevents enumeration
}
req.snapshot = snapshot;
next();
```

### Registered Flow (Logged-in Users)

```javascript
// Step 1: User logs in
const response = await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});
const { token } = await response.json();
localStorage.setItem('vecto_auth_token', token);

// Step 2: All API calls include Authorization header
const response = await fetch('/api/chat', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message })
});

// Step 3: Server verifies JWT
// Server: requireAuth middleware
const token = req.headers.authorization?.split(' ')[1];
const payload = verifyAppToken(token); // HMAC verification
req.auth = { userId: payload.userId };
next();
```

## Security Principles

### User ID Source
- **ALWAYS** get user_id from JWT token (decoded by middleware)
- **NEVER** trust user_id from request body

```javascript
// CORRECT
const user_id = req.user_id; // From JWT middleware

// WRONG - Never do this
const { user_id } = req.body; // Attacker can spoof
```

### Database Isolation
All queries filter by authenticated user_id:

```javascript
const results = await db
  .select()
  .from(snapshots)
  .where(eq(snapshots.user_id, req.user_id));
```

### Error Responses
Return 404 (not 401) for unauthorized access to prevent enumeration:

```javascript
// If user tries to access another user's data
if (resource.user_id !== req.user_id) {
  return res.status(404).json({ error: 'Not found' });
}
```

## Database Security

### Row-Level Security (RLS)
```sql
-- migrations/003_rls_security.sql
CREATE POLICY user_isolation ON snapshots
  USING (user_id = current_user_id());
```

### JWT Helper Functions
```sql
-- migrations/004_jwt_helpers.sql
CREATE FUNCTION current_user_id() RETURNS UUID AS $$
  SELECT current_setting('app.user_id')::UUID;
$$ LANGUAGE SQL;
```

## Token Storage

### Anonymous Mode
No token stored. Snapshot ID is kept in React context state (not localStorage).

### Registered Mode
| Storage | Key | Value |
|---------|-----|-------|
| localStorage | `vecto_auth_token` | JWT string |

**Lifecycle:**
- Created: After successful login via `/api/auth/login`
- Used: Every authenticated API call (via `getAuthHeader()`)
- Cleared: Manual logout or token expiry

## Routes and Authentication

### Anonymous-Compatible Routes (optionalAuth + requireSnapshotOwnership)
| Route | Description |
|-------|-------------|
| `GET /api/briefing/*/:snapshotId` | Weather, traffic, news, events |
| `GET /api/blocks/*/:snapshotId` | Strategy blocks |
| `GET /api/venue/*/:snapshotId` | Venue data |

### Registered-Only Routes (requireAuth)
| Route | Description |
|-------|-------------|
| `POST /api/chat` | AI Coach chat |
| `POST /api/feedback/*` | User feedback |
| `POST /api/actions` | Action logging |

## Verification Checklist

### Anonymous Mode
- ✅ GPS coordinates obtained (native browser)
- ✅ Location resolved via `/api/location/resolve`
- ✅ Snapshot created with user_id
- ✅ Snapshot ID passed in API URLs
- ✅ Backend verifies snapshot ownership

### Registered Mode
- ✅ User logs in via `/api/auth/login`
- ✅ JWT token stored in localStorage (`vecto_auth_token`)
- ✅ All API calls include `Authorization: Bearer` header
- ✅ Backend verifies JWT and isolates data

## See Also

- [Server Structure](server-structure.md) - API route organization
- [Client Structure](client-structure.md) - Frontend auth integration
- [Constraints](constraints.md) - Security constraints
