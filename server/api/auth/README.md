# Auth API (`server/api/auth/`)

## Purpose

JWT token generation and authentication endpoints.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `auth.js` | `/api/auth/*` | JWT token generation |

## Endpoints

```
POST /api/auth/token    - Generate JWT token from device_id
GET  /api/auth/verify   - Verify existing token
```

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
