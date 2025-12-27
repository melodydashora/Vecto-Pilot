# Auth API (`server/api/auth/`)

## Purpose

JWT token generation and authentication endpoints.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `auth.js` | `/api/auth/*` | JWT token generation |

## Endpoints

```
POST /api/auth/token    - Generate JWT token from user_id (DEV ONLY)
GET  /api/auth/verify   - Verify existing token
```

## Security: Production Restrictions

**`POST /api/auth/token` is DISABLED in production.**

This endpoint allows arbitrary token generation for any `user_id`, which could enable impersonation attacks. It returns `403 Forbidden` in production environments.

| Environment | Behavior |
|-------------|----------|
| Development | Returns signed token for testing |
| Production | Returns 403 with `token_minting_disabled` error |

Production detection uses: `NODE_ENV === 'production'` OR `REPLIT_DEPLOYMENT === '1'`

**TODO:** When user authentication is implemented, replace this endpoint with a proper OAuth/login flow.

## Connections

- **Uses:** `../../lib/auth.js` for bearer token validation
- **Called by:** Client on app startup, LocationContext

## Import Paths

```javascript
// Database
import { db } from '../../db/drizzle.js';
import { users } from '../../../shared/schema.js';

// Auth (note: ../../lib/ not ../lib/)
import { generateToken, verifyToken } from '../../lib/auth.js';

// Middleware
import { validate } from '../../middleware/validation.js';
```
