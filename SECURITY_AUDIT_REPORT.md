# Security Audit Report - Vecto Pilot™

**Audit Date:** December 1, 2025  
**Status:** ⚠️ CRITICAL ISSUES FOUND

---

## Executive Summary

Your codebase has **multiple critical security vulnerabilities** that need immediate attention before production deployment:

1. **JWT verification not implemented** - Auth middleware is stubbed out
2. **Open diagnostic endpoints** - Database and migration endpoints accessible to anyone
3. **Client-side API keys exposed** - Multiple OAuth credentials in frontend
4. **Unsecured POST routes** - Multiple endpoints missing authentication
5. **No user-data isolation** - Snapshots and briefings not filtered by user

---

## Critical Issues

### 🔴 1. Authentication Middleware - NOT IMPLEMENTED

**File:** `server/middleware/auth.ts` (lines 4-6)

```typescript
function verifyAppToken(token: string) {
  // TODO: Implement proper JWT verification
  return { userId: 'user_' + Date.now() };  // ← RETURNS FAKE USER ID EVERY TIME!
}
```

**Problem:** The JWT verification is a stub that generates a new fake user ID each time. Any token (even invalid ones) will authenticate as a different user.

**Impact:** Authentication bypass - any user can access any other user's data

**Fix Required:**
- Implement proper JWT verification with signing key
- Store and validate JWT against secret key
- Add expiration checks

---

### 🔴 2. Open Diagnostic Routes

**File:** `server/routes/diagnostics.js`

These routes have NO authentication:

- `GET /api/diagnostics/` - Returns system diagnostics
- `GET /api/diagnostics/db-data` - Returns raw database data
- `POST /api/diagnostics/migrate` - Allows database migrations
- `GET /api/diagnostics/worker-status` - Worker information
- `POST /api/diagnostics/test-consolidate/:snapshotId` - Test endpoint

**Problem:** Anyone can:
- View database structure and contents
- Run database migrations
- Trigger system-level operations
- Access internal diagnostics

**Impact:** Complete system compromise - data breach + database manipulation

**Fix Required:**
- Add `requireAuth` middleware to ALL diagnostic routes
- Consider moving diagnostics to internal-only access
- Require admin role for dangerous operations (migrate)

---

### 🔴 3. Client-Side API Keys Exposed

**File:** `client/src/vite-env.d.ts`

```typescript
readonly VITE_GOOGLE_MAPS_API_KEY: string;
readonly VITE_UBER_CLIENT_ID: string;
readonly VITE_UBER_CLIENT_SECRET: string;      // ← SECRET EXPOSED!
readonly VITE_LYFT_CLIENT_ID: string;
readonly VITE_LYFT_CLIENT_SECRET: string;      // ← SECRET EXPOSED!
readonly VITE_BOLT_CLIENT_ID: string;
readonly VITE_BOLT_CLIENT_SECRET: string;      // ← SECRET EXPOSED!
```

**Problem:** Secrets are accessible in browser DevTools, network requests, and compiled code

**Impact:**
- OAuth hijacking via secret keys
- Unauthorized API calls on behalf of your app
- Credentials available to attackers

**Fix Required:**
- NEVER expose `*_SECRET` keys to frontend
- Keep secrets server-side only
- Use backend proxy for OAuth flows
- Client should only have CLIENT_ID (for some flows, if needed)

---

### 🟡 4. Unsecured POST Routes - Missing Auth

**Files:** Multiple route files

Routes WITHOUT authentication middleware:

```
server/routes/briefing.js:
  - POST /api/briefing/generate
  - POST /api/briefing/refresh

server/routes/chat.js:
  - POST /api/coach/chat (routes/chat.js line 128+)

server/routes/feedback.js:
  - POST /api/feedback/venue
  - POST /api/feedback/strategy
  - POST /api/feedback/app

server/routes/closed-venue-reasoning.js:
  - POST / (generates closed venue reasoning)

server/routes/geocode-proxy.js:
  - POST /api/geocode/geocode
```

**Problem:** Anyone can POST data and trigger backend operations without proving who they are

**Impact:**
- Spam/abuse of briefing generation (cost)
- Feedback manipulation
- Resource exhaustion

**Fix Required:**
- Add `requireAuth` middleware to all POST/PATCH/DELETE routes
- Validate that `req.auth.userId` matches the requesting user
- Rate-limit by user

---

### 🟡 5. No User-Data Isolation

**File:** `server/routes/snapshot.js` (lines 30-108)

```javascript
router.post("/", async (req, res) => {
  // ... 
  user_id: snap.user_id || uuid(),  // ← Uses CLIENT-PROVIDED user_id!
  device_id: snap.device_id || uuid(),
  // ...
});
```

**Problem:** 
- Client can create snapshots with any user_id
- No verification that the authenticated user owns that snapshot
- GET endpoints return snapshots for ANY snapshot_id

**Impact:**
- User A can access/modify User B's snapshots
- User A can impersonate User B in the system

**Fix Required:**
- Extract `user_id` from JWT token (`req.auth.userId`), NOT from request body
- Add user_id filter to all queries:
  ```sql
  WHERE snapshots.user_id = req.auth.userId
  ```
- Never trust client-provided user_id

---

## Moderate Issues

### 🟠 6. No Login Form Security

**Status:** No dedicated login system found

Your app uses `localStorage.getItem('vecto_user_id')` but:
- No login endpoint visible
- No session management
- No password/credential system
- Uses fake User IDs from timestamp

**Recommendation:**
- If you're building a public app, implement proper authentication (OAuth, JWT)
- If you're a beta app, add basic login with user email/password
- Secure session management

---

### 🟠 7. API Keys in Client-Side Code

**File:** `client/src/hooks/use-geolocation.tsx` and `client/src/utils/getGeoPosition.ts`

```typescript
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
// ...used in fetch: `?key=${GOOGLE_API_KEY}`
```

**Problem:** 
- Google Maps API key is embedded in frontend
- Visible in network requests (browser DevTools, logs)
- Key restrictions must be configured in Google Cloud (IP whitelist, etc.)

**Fix Required:**
- Route Google Maps requests through backend proxy
- Backend calls Google with server API key (which can be IP-restricted)
- Frontend talks to `/api/maps/...` endpoints

---

## Non-Critical Issues

### 🔵 8. Missing Auth Checks on GET Routes

Many GET routes return user-specific data without verification:

- `GET /api/briefing/current` - Returns latest snapshot (ANY user's)
- `GET /api/briefing/snapshot/:snapshotId` - Returns ANY snapshot
- `GET /api/coach/context/:snapshotId` - Returns coach context for ANY snapshot
- `GET /api/strategy/:snapshotId` - Returns strategy for ANY snapshot

**Recommendation:**
- Add user_id filter: verify `snapshot.user_id === req.auth.userId`
- Return 404 (not 401) if user doesn't own the resource (prevents enumeration)

---

## Immediate Actions Required (Before Launch)

### Priority 1 (CRITICAL - Do First)
- [ ] Implement JWT verification in `server/middleware/auth.ts`
- [ ] Add `requireAuth` to ALL diagnostic routes (or disable them in production)
- [ ] Remove `*_SECRET` variables from `VITE_` environment variables
- [ ] Extract user_id from JWT token, not from request body
- [ ] Add user_id filter to snapshot/strategy/briefing queries

### Priority 2 (CRITICAL - Do Before Production)
- [ ] Add `requireAuth` to all POST routes
- [ ] Implement backend proxy for Google Maps API
- [ ] Add rate limiting middleware
- [ ] Set up proper user authentication system

### Priority 3 (RECOMMENDED)
- [ ] Add CORS security headers
- [ ] Implement request validation schemas
- [ ] Add audit logging for sensitive operations
- [ ] Set up secret rotation for API keys

---

## Code Fixes Needed

### Fix 1: Auth Middleware (server/middleware/auth.ts)
```typescript
// Replace verifyAppToken with real JWT verification
import jwt from 'jsonwebtoken';

function verifyAppToken(token: string) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload;
  } catch (e) {
    throw new Error('Invalid token');
  }
}
```

### Fix 2: Add User Filtering (server/routes/briefing.js)
```javascript
router.get('/snapshot/:snapshotId', requireAuth, async (req, res) => {
  // MUST verify ownership
  const snapshot = await db.select().from(snapshots)
    .where(
      eq(snapshots.snapshot_id, snapshotId) &&
      eq(snapshots.user_id, req.auth.userId)  // ← ADD THIS
    ).limit(1);
  
  if (!snapshot) return res.status(404).json({ error: 'not_found' });
  // ...
});
```

### Fix 3: Remove Secrets from Frontend
```typescript
// DELETE these from client/src/vite-env.d.ts:
readonly VITE_UBER_CLIENT_SECRET: string;  // DELETE
readonly VITE_LYFT_CLIENT_SECRET: string;  // DELETE
readonly VITE_BOLT_CLIENT_SECRET: string;  // DELETE
```

---

## Compliance Notes

- **GDPR:** Currently no way to verify user consent or delete user data
- **CCPA:** No user data export mechanism
- **PCI-DSS:** If handling payments, NO payment data should be stored/logged
- **SOC 2:** Audit logging, access controls, and data encryption need implementation

---

## Testing Checklist

After fixes are applied:

- [ ] Attempt to access another user's snapshot without authentication → Should fail
- [ ] Attempt to POST without JWT token → Should return 401
- [ ] Attempt to call `/api/diagnostics/db-data` → Should require auth
- [ ] Verify JWT expires and refreshes properly
- [ ] Check that VITE_UBER_CLIENT_SECRET doesn't appear in compiled bundle
- [ ] Verify user_id in token doesn't match client-provided user_id

---

## Questions for Your Team

1. **What's the authentication model?** (OAuth, JWT, Session, Custom?)
2. **Who are your users?** (Internal only? Public? Beta testers?)
3. **Do you need multi-tenant isolation or is it single-tenant?**
4. **Is there a backend admin account for diagnostics?**

---

**Generated:** Dec 1, 2025  
**Next Review:** After fixes applied  
**Status:** Awaiting remediation
