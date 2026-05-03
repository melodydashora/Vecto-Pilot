# AUTH.md — Authentication Architecture

> **Canonical reference** for all authentication flows, token lifecycle, middleware, session management, and logout sequencing.
> Last updated: 2026-04-10

---

## Table of Contents

1. [Login Methods](#1-login-methods)
2. [Token Lifecycle](#2-token-lifecycle)
3. [Middleware Chain](#3-middleware-chain)
4. [Session Management](#4-session-management)
5. [Logout Sequence](#5-logout-sequence)
6. [Zombie Snapshot Fix (2026-04-10)](#6-zombie-snapshot-fix-2026-04-10)
7. [Current State](#7-current-state)
8. [Known Gaps](#8-known-gaps)
9. [TODO — Hardening Work](#9-todo--hardening-work)

---

## 1. Login Methods

### 1a. Email/Password (IMPLEMENTED)

**Route:** `POST /api/auth/login`
**File:** `server/api/auth/auth.js` (lines 531–750)

**Flow:**
1. Client sends `{ email, password }` from `SignInPage.tsx`
2. Server looks up `driver_profiles` by email
3. Fetches `auth_credentials` for that user
4. Checks account lock status (5 failures = 15-min lock)
5. Verifies password via `bcrypt.compare()` (12 rounds)
6. On success:
   - Resets `failed_login_attempts` to 0
   - Records `last_login_at`, `last_login_ip`
   - Upserts `users` row: sets `session_id` (new UUID), `session_start_at`, `last_active_at`
   - Generates auth token (see [Token Lifecycle](#2-token-lifecycle))
7. Returns `{ token, user, profile, vehicle }`

**Client-side (auth-context.tsx):**
- `login()` stores token in `localStorage(STORAGE_KEYS.AUTH_TOKEN)`
- Clears stale snapshot from `sessionStorage` (2026-02-17 fix)
- Sets `isAuthenticated = true` in React state

**Password requirements:** 8+ chars, 1 uppercase, 1 lowercase, 1 digit
**Hashing:** bcrypt, 12 rounds (`server/lib/auth/password.js`)

### 1b. Google OAuth (IMPLEMENTED)

**Routes:**
- `GET /api/auth/google` — Redirects to Google consent screen
- `POST /api/auth/google/exchange` — Exchanges auth code for token

**File:** `server/api/auth/auth.js` (lines 1307–1597)
**OAuth lib:** `google-auth-library`
**Scopes:** `openid email profile`

**Flow:**
1. Client calls `GET /api/auth/google?mode=signup|login`
2. Server generates CSRF state (64-char hex via `crypto.randomBytes(32)`)
3. State stored in `oauth_states` table with 10-min expiry
4. Redirects to Google consent URL (`access_type=offline`, `prompt=select_account`)
5. Google redirects back with `code` + `state`
6. Client sends `POST /api/auth/google/exchange { code, state }`
7. Server:
   - Validates CSRF state (one-time use, deletes after verification)
   - Exchanges code for `id_token`, `access_token`, `refresh_token`
   - Verifies `id_token` cryptographically via `OAuth2Client`
   - Extracts `sub`, `email`, `email_verified`, name, picture
   - Looks up user by `google_id` or `email` in `driver_profiles`
   - **New user:** Creates `users` + `driver_profiles` + `auth_credentials` (password_hash = null)
   - **Existing user:** Links Google ID if not already set
   - Creates session (upsert pattern)
   - Generates token
8. Returns `{ token, isNewUser, user, profile, vehicle }`

**Config env vars:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### 1c. Uber OAuth (IMPLEMENTED — for platform data, NOT login)

**File:** `server/lib/auth/oauth/uber-oauth.js`

Uber OAuth connects the driver's Uber account for trip/payment data — it does NOT authenticate the user. Separate from login flow.

**Token storage:** AES-256-GCM encrypted at rest in `uber_connections` table
- Format: `iv:authTag:ciphertext` (all base64)
- Fields: `access_token_encrypted`, `refresh_token_encrypted`, `token_expires_at`

**Scopes:** `partner.payments`, `partner.trips`, `profile`
**Config env vars:** `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_REDIRECT_URI`

### 1d. Apple OAuth (NOT IMPLEMENTED)

**Route:** `GET /api/auth/apple` — Returns 501 Not Implemented
**File:** `server/api/auth/auth.js` (lines 1598–1611)

### 1e. Registration

**Route:** `POST /api/auth/register`
**File:** `server/api/auth/auth.js` (lines 63–530)

Creates `users` row + `driver_profiles` + `driver_vehicles` + `auth_credentials`.
Validates and geocodes address via Google Address Validation API.
Registration returns a token in the response body for compatibility and future SDK use. The current web client intentionally does not persist it as a login session — the user must sign in manually after registration. Future clients or SDK consumers should not assume `/register` auto-logs in.

### 1f. Password Reset

**Route:** `POST /api/auth/forgot-password` → `POST /api/auth/reset-password`
**File:** `server/api/auth/auth.js` (lines 753–960)

Two methods:
- **Email (default):** 64-char hex reset token, stored in `auth_credentials.password_reset_token`, 1-hour expiry. Sent via SendGrid.
- **SMS:** 6-digit code, stored in `verification_codes` table, 15-min expiry. Sent via Twilio.

Returns generic success regardless of email existence (prevents enumeration).

### 1g. Dev Token (DISABLED IN PROD)

**Route:** `POST /api/auth/token`
**File:** `server/api/auth/auth.js` (lines 1612–1633)

Returns 403 in production. In dev: generates token for testing without validation.

---

## 2. Token Lifecycle

### Creation

**Function:** `generateAuthToken(userId)` — `server/api/auth/auth.js`. Internally calls `signJWT({ sub: userId })` from `server/lib/jwt.js`.

**Format (since 2026-05-03, AUTH-003):** Standard 3-segment JWT (HS256), per RFC 7519.

```
header  = { "alg": "HS256", "typ": "JWT" }
payload = { "sub": <userId>, "iat": <issued unix>, "exp": <iat + 2h>, "iss": "vecto-pilot", "aud": "vecto-pilot-api" }
sig     = HMAC-SHA256(base64url(header).base64url(payload), secret)
token   = base64url(header) + "." + base64url(payload) + "." + base64url(sig)
```

**Algorithm pinned:** `verifyJWT` passes `algorithms: ['HS256']` to `jose.jwtVerify` — defends against algorithm-confusion attacks (e.g., an attacker crafts a token with `alg: none` or `alg: HS512` to bypass signature validation).

**Secret source:**
- Production: `JWT_SECRET` env var (required, validated at startup via `server/config/validate-env.js`)
- Dev: Falls back to `REPLIT_DEVSERVER_INTERNAL_ID` (per-workspace unique)

**Token-level expiry:** `exp = iat + 2h`, aligned to the existing session hard-limit. When the JWT expires, the server-side session has expired anyway, so no refresh-token endpoint is needed in v1. Future: short-lived (15m) access + long-lived (7d) refresh tokens (separate workstream, not currently scheduled).

**Legacy format (transition window):** Pre-AUTH-003 tokens were `userId.HMAC-SHA256(userId, secret)` — 2 segments, no claims. They are still verified during the transition via the dual-verify dispatcher in `server/middleware/auth.js` (segment-count routing). Legacy verifier deletion is the Phase 1.5 cleanup PR (~T+24h post-deploy, when matrixLog `[AUTH] [LEGACY_HMAC_USED]` count drops to 0).

### Storage

| Where | Key | Scope | Cleared On |
|-------|-----|-------|------------|
| `localStorage` | `vectopilot_auth_token` | Persists across tabs/sessions | Logout, auth error, token expiry |
| React state | `AuthContext.state.token` | In-memory | Logout (`setState`) |

### Verification

**Function:** `verifyAppToken(token)` — `server/middleware/auth.js`. Async dispatcher (since 2026-05-03, AUTH-003).

```
verifyAppToken(token):
  segments = token.split('.')
  if segments.length === 3 → verifyJWT(token)        // server/lib/jwt.js — jose-based, HS256-pinned
  if segments.length === 2 → verifyLegacyHMAC(token) // middleware/auth.js — legacy path, removed in Phase 1.5
  else → throw 'Invalid token format'
```

**JWT verification (`verifyJWT`):**
1. Decodes header + payload (jose)
2. Verifies HMAC-SHA256 signature with the configured secret
3. Validates `iss === 'vecto-pilot'`, `aud === 'vecto-pilot-api'`, `exp > now`, `alg === 'HS256'`
4. Throws on any failure (malformed, tampered, expired, wrong issuer/audience/algorithm, missing `sub`)
5. Returns `{ userId: payload.sub, verified: true }` on success

**Legacy HMAC verification (`verifyLegacyHMAC`, removed in Phase 1.5):**
1. Splits `userId.signature`
2. Recomputes HMAC-SHA256(userId, secret), compares to received signature
3. Validates userId length ≥ 8
4. Emits matrixLog `[AUTH] [LEGACY_HMAC_USED]` per call (drain-tracking metric — Phase 1.5 cleanup gates on this hitting 0)
5. Returns `{ userId, verified: true }` on success

**No fall-through between paths.** A 3-segment token that fails JWT verification does NOT get retried as legacy HMAC. Each segment count maps to exactly one verifier — preventing downgrade attacks where an attacker strips a segment to bypass JWT validation.

### Revocation

Two complementary mechanisms (since 2026-05-03, AUTH-003):

1. **Token-level expiry:** JWT `exp` claim caps validity at 2 hours from issuance. After expiry, `verifyJWT` rejects regardless of server-side session state.
2. **Session-level revocation:** `users.session_id` set to `null` on logout (or when the 2-hour hard limit fires in `requireAuth`). Next `requireAuth` call sees `session_id = null` → returns 401.

There is still no JWT blacklist. A leaked token is valid until `exp` (≤2h) or until the session is cleared, whichever comes first. For a true blacklist, see the deferred refresh-token mechanism (separate workstream).

---

## 3. Middleware Chain

### requireAuth (Primary)

**File:** `server/middleware/auth.js` (lines 116–230)

**Checks (in order):**

1. **Service account auth** (lines 121–132): `x-vecto-agent-secret` header → constant-time comparison via `crypto.timingSafeEqual()`
2. **Bearer token extraction** (lines 137–141): `Authorization: Bearer <token>`
3. **Token verification** (line 143): `verifyAppToken(token)` → extracts `userId`
4. **Session lookup** (line 148): `SELECT * FROM users WHERE user_id = ?`
5. **Session exists check** (line 154): `session_id` must not be null
6. **Hard limit check** (lines 169–183): `now - session_start_at > 2 hours` → 401 + clear session
7. **Sliding window check** (lines 185–197): `now - last_active_at > 60 minutes` → 401 + clear session
8. **Touch session** (lines 200–203): Update `last_active_at = now` (non-blocking, no await)

**Attaches to `req.auth`:**
```javascript
req.auth = {
  userId,      // UUID from token
  sessionId,   // Current session UUID
  currentSnapshotId, // Active snapshot (nullable)
  isAgent,     // Boolean (service account)
  phantom      // Always false currently
}
```

**Failure responses:**

| Condition | Status | Error Code |
|-----------|--------|------------|
| No token | 401 | `no_token` |
| Invalid token | 401 | `unauthorized` |
| Session not found | 401 | `session_expired` |
| Session cleared (logged out) | 401 | `session_expired` |
| Hard 2-hour limit | 401 | `session_expired` |
| 60-min inactivity | 401 | `session_expired` |
| DB error | 503 | `auth_service_unavailable` |

**Security:** Fail-closed on DB errors (returns 503, not pass-through).

### optionalAuth (Secondary)

**File:** `server/middleware/auth.js` (lines 236–279)

Same as `requireAuth` but continues as anonymous if no token provided. Used for endpoints that work for both authenticated and anonymous users.

### Rate Limiting

**File:** `server/middleware/rate-limit.js`

- **Global:** 100 req/min per IP on all `/api/*` routes
- **No dedicated auth endpoint limiter** — relies on global limit
- **Account lockout:** 5 failed passwords = 15-min lock (application-level, not rate limiter)

---

## 4. Session Management

### Server-Side: `users` Table

**File:** `shared/schema.js` (lines 18–30)

```
users table:
  user_id          UUID (PK, FK → driver_profiles)
  device_id        text
  session_id       UUID (nullable — null = logged out)
  current_snapshot_id  UUID (nullable — null = no active snapshot)
  session_start_at     timestamp
  last_active_at       timestamp
  created_at, updated_at
```

### TTL Enforcement

Enforced **lazily** in `requireAuth` middleware — no background cleanup job.

| Limit | Duration | Check | Action on Expiry |
|-------|----------|-------|------------------|
| Sliding window | 60 min from `last_active_at` | Every authenticated request | `session_id = null`, `current_snapshot_id = null` |
| Hard limit | 2 hours from `session_start_at` | Every authenticated request | `session_id = null`, `current_snapshot_id = null` |

Expired sessions are **updated** (set `session_id = null`), NOT deleted — preserves FK relationships.

### Client-Side Storage

| Store | Key | Content | Purpose |
|-------|-----|---------|---------|
| `localStorage` | `vectopilot_auth_token` | JWT-like token | Survives tab close, used for API auth |
| `localStorage` | `vecto_persistent_strategy` | Strategy text | Survives app switches |
| `localStorage` | `vecto_strategy_snapshot_id` | Snapshot ID | Links strategy to snapshot |
| `localStorage` | `vecto_device_id` | Device UUID | Device tracking |
| `sessionStorage` | `vecto_snapshot` | Full snapshot JSON | Resume on tab return |
| `sessionStorage` | `vecto_resume_reason` | `'resume'` flag | Tells CoPilot to skip regeneration |

---

## 5. Logout Sequence

### What Gets Cleared and In What Order

**Trigger:** User clicks logout → `auth-context.tsx` `logout()` (line 209)

```
Step 1: Cancel all React Query operations (prevents 401 cascade)
  └─ queryClient.cancelQueries()
  └─ queryClient.clear()

Step 2: Kill all SSE connections (prevents orphaned EventSource)
  └─ closeAllSSE()  ← closes 4 singleton connections

Step 3: Server-side session teardown
  └─ POST /api/auth/logout (with current token)
  └─ Server: UPDATE users SET session_id=null, current_snapshot_id=null

Step 4: Clear localStorage
  └─ Remove: AUTH_TOKEN, PERSISTENT_STRATEGY, STRATEGY_SNAPSHOT_ID

Step 5: Clear sessionStorage
  └─ Remove: SNAPSHOT (vecto_snapshot)

Step 6: Reset React state
  └─ setState({ user: null, token: null, isAuthenticated: false, ... })

Step 7: React re-render cascade triggers context cleanup:
  └─ LocationContext auth-drop effect (FIX 2026-04-10):
      - Nulls: lastSnapshotId, coords, city, state, timeZone, weather, airQuality
      - Resets: gpsEffectRanRef, sessionRestoreAttemptedRef, enrichment dedup
      - Aborts: in-flight enrichment requests
      - Clears: sessionStorage snapshot
  └─ CoPilotContext auth-drop effect:
      - Nulls: lastSnapshotId, strategy, immediateStrategy
      - Clears: waterfallTriggeredRef dedup set
      - Aborts: in-flight waterfall POST
  └─ CoPilotContext sync effect (FIX 2026-04-10):
      - isAuthenticated guard prevents zombie snapshot restoration
```

### Forced Logout (Auth Error)

**Trigger:** Any API returns 401 → `dispatchAuthError()` → `window.dispatchEvent('vecto-auth-error')`

**Handler:** `auth-context.tsx` `handleAuthError` (line 65) — same cleanup as manual logout, plus:
- Server-side logout attempt (best-effort)
- Module-level state reset in `useBriefingQueries.ts` (cooling off, error cooldowns)

---

## 6. Zombie Snapshot Fix (2026-04-10)

### The Problem

After logout, `CoPilotContext` cleared its `lastSnapshotId`, but `LocationContext` still held the old value in React state. CoPilot's sync effect (line ~188) immediately restored the dead snapshot:

```
22:42:19.575  [CoPilotContext] Auth lost — clearing snapshot     ← setLastSnapshotId(null)
22:42:19.576  🔄 CoPilotContext: Syncing snapshot from context: 034292d5  ← ZOMBIE RESTORED
22:42:19.578  [SSE Manager] Creating singleton connection         ← RECONNECTING TO DEAD DATA
```

### The Fix (Two Changes)

**Fix 1 — `location-context-clean.tsx`:** Added auth-drop effect that clears ALL state when `token` goes null. Resets `gpsEffectRanRef` so next login triggers fresh GPS.

**Fix 2 — `co-pilot-context.tsx`:** Added `!isAuthenticated` guard to the sync effect. Even if LocationContext hasn't cleared yet in the same render cycle, the guard blocks zombie restoration.

**Why both?** React batches state updates. Fix 1's `setLastSnapshotId(null)` is queued, not applied instantly. During the same render cycle, CoPilot's sync effect could still see Location's old value. Fix 2 catches this timing window because `isAuthenticated` is already false (from AuthContext's render, not a local state update).

---

## 7. Current State

| Area | Status |
|------|--------|
| Email/password login | Working, production-tested |
| Google OAuth | Working, production-tested |
| Uber OAuth | Working (platform data integration, not login) |
| Apple OAuth | Stub only — returns 501 |
| Token format | Standard JWT (HS256) — claims `sub`/`iat`/`exp`/`iss`/`aud`. Migrated 2026-05-03 (AUTH-003). Legacy 2-segment HMAC tokens still accepted during transition (Phase 1.5 PR removes legacy path). |
| Session TTL (60 min sliding + 2 hr hard) | Enforced in middleware |
| Logout cleanup | Complete (7-step cascade with zombie fix) |
| Account lockout | 5 failures = 15-min lock |
| Password reset (email + SMS) | Working (SendGrid + Twilio) |
| Rate limiting on auth | Global only (100/min), no dedicated auth limiter |
| CSRF on OAuth | Implemented (10-min state token, one-time use) |

---

## 8. Known Gaps

1. **No dedicated auth rate limiter** — Login/register use the global 100/min limit. A targeted brute-force attack at 99 req/min would not trigger account lockout (lockout is per-account, rate limit is per-IP).

2. **No token refresh/rotation** — Token is valid until session expires. No refresh token mechanism. If token is stolen, attacker has access until 2-hour hard limit.

3. ~~**Token format is non-standard**~~ → **RESOLVED 2026-05-03 (AUTH-003).** Tokens are now standard JWTs (HS256) with `sub`/`iat`/`exp`/`iss`/`aud` claims, signed/verified via `server/lib/jwt.js` using the `jose` library. Algorithm pinned via `algorithms: ['HS256']` to defend against algorithm-confusion attacks. See §2.

4. **No email verification on registration** — Account is immediately usable after registration. No email confirmation flow.

5. **Google OAuth profile_complete flag** — New OAuth users have `profile_complete = false` but the client doesn't enforce profile completion (vehicle, preferences, etc.).

6. **Apple OAuth not implemented** — Stub returns 501.

7. **Session cleanup is lazy** — Expired sessions are only detected on next `requireAuth` call. Orphaned sessions accumulate in DB.

8. **No concurrent session detection** — Token format is `userId.hmacSignature` with no session UUID binding. A new login overwrites the `users` session row (so only one session_id exists), but the old token remains cryptographically valid until the overwritten session check fails. There is no active "logged in elsewhere" notification.

---

## 9. TODO — Hardening Work

- [ ] **Add dedicated auth rate limiter** — 10 login attempts/min per IP, 5/min per email
- [ ] **Implement token refresh** — Short-lived access token (15 min) + refresh token (7 days)
- [x] **Migrate to standard JWT** — DONE 2026-05-03 via AUTH-003. HS256 + claims `sub`/`iat`/`exp`/`iss`/`aud` via `server/lib/jwt.js`. RS256 (asymmetric — third-party verifiers can validate without holding the signing secret) deferred to a separate Phase 2 PR with keypair-rotation runbook.
- [ ] **Add email verification** — Send confirmation link on registration, require verification before first login
- [ ] **Enforce OAuth profile completion** — Redirect new OAuth users to complete vehicle/preferences
- [ ] **Implement Apple OAuth** — Required for iOS App Store submission
- [ ] **Add session cleanup job** — Cron to clear sessions older than 2 hours
- [ ] **Add concurrent session management** — Optionally limit to N devices, show active sessions in settings
- [ ] **Audit log for auth events** — Track login/logout/password-reset in a dedicated `auth_events` table
- [ ] **CSRF on non-OAuth forms** — Login and registration forms have no CSRF protection (relies on SameSite cookies not being used)

---

## Key Files

| File | Purpose |
|------|---------|
| `server/lib/jwt.js` | `signJWT` / `verifyJWT` helpers (jose-based, HS256, claims pinned). New 2026-05-03 (AUTH-003) — replaces former `lib/jwt.ts` dev stub. |
| `server/middleware/auth.js` | `requireAuth`, `optionalAuth`, `verifyAppToken` (dual-verify dispatcher), `verifyLegacyHMAC` (transition path, deleted in Phase 1.5) |
| `server/api/auth/auth.js` | All auth routes (login, register, logout, OAuth, reset). `generateAuthToken` calls `signJWT`. |
| `server/lib/auth/password.js` | bcrypt hash/verify, password strength validation |
| `server/lib/auth/oauth/google-oauth.js` | Google OAuth utilities |
| `server/lib/auth/oauth/uber-oauth.js` | Uber OAuth + AES-256-GCM token encryption |
| `server/lib/auth/email.js` | SendGrid email service |
| `server/lib/auth/sms.js` | Twilio SMS service |
| `server/middleware/rate-limit.js` | Global API rate limiter |
| `client/src/contexts/auth-context.tsx` | Client auth state, login/logout, token storage |
| `client/src/constants/storageKeys.ts` | `STORAGE_KEYS`, `SESSION_KEYS` |
| `shared/schema.js` | `users`, `driver_profiles`, `auth_credentials`, `oauth_states` tables |
