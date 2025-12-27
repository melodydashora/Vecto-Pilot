# Authentication System

JWT-based authentication with user isolation. Production-ready as of December 2025.

## Architecture Overview

```
Browser GPS/Geolocation
         ↓
   [LocationContext]
         ↓
/api/location/resolve → gets user_id from database
         ↓
/api/auth/token → generates JWT with user_id
         ↓
localStorage.setItem('token')
         ↓
[CoachChat] + [BriefingTab] send Authorization: Bearer ${token}
         ↓
[requireAuth middleware] verifies JWT
         ↓
All requests scoped to authenticated user_id
```

## Key Files

| File | Purpose |
|------|---------|
| `client/src/contexts/location-context-clean.tsx` | Token generation with async callback |
| `server/api/auth/auth.js` | `/api/auth/token` endpoint |
| `server/middleware/auth.js` | `requireAuth` middleware |
| `client/src/components/CoachChat.tsx` | Authorization header on /api/chat |
| `client/src/pages/co-pilot.tsx` | Authorization header on briefing calls |

## Authentication Flow

### Step 1: Location Resolution
```javascript
// Client: location-context-clean.tsx
const response = await fetch('/api/location/resolve', {
  method: 'POST',
  body: JSON.stringify({ lat, lng, deviceId })
});
const { user_id } = await response.json();
```

### Step 2: Token Generation
```javascript
// Client: location-context-clean.tsx
const tokenResponse = await fetch('/api/auth/token', {
  method: 'POST',
  body: JSON.stringify({ user_id })
});
const { token } = await tokenResponse.json();
localStorage.setItem('token', token);
```

### Step 3: Authenticated Requests
```javascript
// Client: CoachChat.tsx
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message })
});
```

### Step 4: Server Verification
```javascript
// Server: middleware/auth.js
export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user_id = decoded.user_id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
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

| Storage | Key | Value |
|---------|-----|-------|
| localStorage | `token` | JWT string |

**Lifecycle:**
- Created: After successful location resolution
- Used: Every authenticated API call
- Cleared: Manual logout or token expiry

## Routes Requiring Authentication

| Route | Middleware |
|-------|------------|
| `POST /api/chat` | `requireAuth` |
| `POST /api/feedback/*` | `requireAuth` |
| `POST /api/actions` | `requireAuth` |
| `GET /api/briefing/*` | `requireAuth` |

## Verification Checklist

- ✅ GPS coordinates obtained (native browser or fallback)
- ✅ Location resolved and user_id retrieved
- ✅ JWT token generated and stored in localStorage
- ✅ All API calls include Authorization header
- ✅ Backend verifies JWT and isolates data
- ✅ Graceful error handling with console logs

## See Also

- [Server Structure](server-structure.md) - API route organization
- [Client Structure](client-structure.md) - Frontend auth integration
- [Constraints](constraints.md) - Security constraints
