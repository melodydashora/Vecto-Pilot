# Middleware Module (`server/middleware/`)

## Purpose

Express middleware for authentication, validation, rate limiting, and request processing.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `auth.js` | JWT authentication | `requireAuth()` |
| `validation.js` | Zod schema validation | `validate(schema)` |
| `rate-limit.js` | Request throttling | `generalLimiter`, `expensiveLimiter`, `chatLimiter` |
| `bot-blocker.js` | Block web crawlers | `apiOnlyBotBlocker`, `botBlocker` |
| `error-handler.js` | Global error handling | `errorHandler` |
| `timeout.js` | Request timeout | `timeout(ms)` |
| `correlation-id.js` | Request tracking | `correlationId` |
| `metrics.js` | Request metrics | `metricsMiddleware` |
| `idempotency.js` | Duplicate prevention | `idempotency(keyFn)` |
| `learning-capture.js` | Feedback capture | `learningCapture` |
| `require-snapshot-ownership.js` | Ownership validation | `requireSnapshotOwnership` |
| `validate.js` | Legacy validation | (use `validation.js` instead) |

## Usage

### Authentication
```javascript
import { requireAuth } from './auth.js';
import { requireSnapshotOwnership } from './require-snapshot-ownership.js';

// Require valid JWT for all protected routes
router.get('/protected', requireAuth, handler);

// For snapshot-based routes: verify auth + snapshot ownership
router.get('/data/:snapshotId', requireAuth, requireSnapshotOwnership, handler);
// → req.auth.userId from JWT
// → req.snapshot from ownership check
```

**Note:** `optionalAuth` exists for legacy support but is no longer used.
All routes now require authentication (GPS gating enforces sign-in).

### Validation
```javascript
import { validate } from './validation.js';
import { z } from 'zod';

const schema = z.object({
  snapshotId: z.string().uuid()
});

router.post('/endpoint', validate(schema), handler);
```

### Rate Limiting
```javascript
import { expensiveLimiter, chatLimiter, generalLimiter } from './rate-limit.js';

// 5 req/min - expensive operations
router.post('/blocks-fast', expensiveLimiter, handler);

// 3 req/min - chat
router.post('/chat', chatLimiter, handler);

// 30 req/min - general
router.get('/data', generalLimiter, handler);
```

### Bot Blocking
```javascript
import { apiOnlyBotBlocker } from './bot-blocker.js';

// Block bots on API routes only
app.use('/api', apiOnlyBotBlocker);
```

## Rate Limit Tiers

| Tier | Limit | Routes |
|------|-------|--------|
| `expensiveLimiter` | 5/min | `/api/blocks-fast`, `/api/briefing/generate` |
| `chatLimiter` | 3/min | `/api/chat` |
| `generalLimiter` | 30/min | All other `/api/*` |

## Bot Patterns Blocked

60+ user-agent patterns including:
- Search engines: Googlebot, Bingbot, DuckDuckBot
- Social: FacebookExternalHit, TwitterBot, LinkedInBot
- SEO tools: AhrefsBot, SemrushBot
- AI crawlers: GPTBot, anthropic-ai, PerplexityBot
- Scanners: nmap, nikto, sqlmap

## Connections

- **Used by:** All routes via `../bootstrap/middleware.js`
- **Configured in:** `../bootstrap/middleware.js`

## Import Paths

From `server/api/*/` routes, use `../../middleware/`:

```javascript
import { requireAuth } from '../../middleware/auth.js';
import { expensiveEndpointLimiter } from '../../middleware/rate-limit.js';
import { validateBody } from '../../middleware/validate.js';
import { validate, schemas } from '../../middleware/validation.js';
import { requireSnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
```

## Middleware Chain Order

```
1. correlationId          - Add request ID
2. metricsMiddleware      - Start timing
3. botBlocker             - Block crawlers
4. rateLimiter            - Throttle requests
5. auth                   - Verify JWT
6. validation             - Validate body
7. [route handler]
8. errorHandler           - Catch errors
```
