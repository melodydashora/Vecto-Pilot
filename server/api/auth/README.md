> **Last Updated:** 2026-04-14

# Auth API (`server/api/auth/`)

Authentication endpoints: registration, login/logout, password reset, OAuth, profile management.

For the canonical auth architecture doc (session model, token format, security gaps), see [docs/architecture/AUTH.md](../../../docs/architecture/AUTH.md).

## Files

| File | Route | Purpose |
|------|-------|---------|
| `auth.js` | `/api/auth/*` | All authentication endpoints |
| `uber.js` | `/api/auth/uber/*` | Uber OAuth and webhook integration |

## Key Endpoints

```
POST /api/auth/register          — Create new driver account
POST /api/auth/login             — Authenticate (returns HMAC auth token)
POST /api/auth/logout            — End session
GET  /api/auth/google            — Google OAuth consent flow
POST /api/auth/google/exchange   — Exchange Google auth code for app token
GET  /api/auth/uber              — Uber OAuth flow
POST /api/auth/forgot-password   — Request password reset
POST /api/auth/reset-password    — Reset password with token
GET  /api/auth/me                — Current user profile
PUT  /api/auth/profile           — Update profile
```

## Token Format

Custom HMAC-SHA256: `userId.signature` (NOT standard JWT). See AUTH.md for security implications and migration plan.
