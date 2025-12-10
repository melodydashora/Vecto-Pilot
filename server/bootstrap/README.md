# Bootstrap Module (`server/bootstrap/`)

## Purpose

Server initialization sequence. Called by `gateway-server.js` to set up middleware, routes, health endpoints, and workers.

## Files

| File | Purpose | Key Export |
|------|---------|------------|
| `middleware.js` | Configure Express middleware | `configureMiddleware()`, `configureErrorHandler()` |
| `routes.js` | Mount all API routes | `mountRoutes()`, `mountSSE()` |
| `health.js` | Health check endpoints | `configureHealthEndpoints()`, `mountHealthRouter()` |
| `workers.js` | Background worker control | `startStrategyWorker()`, `killAllChildren()` |
| `enqueue-initial.js` | Initial job queue setup | `enqueueInitialJobs()` |

## Startup Sequence

```javascript
// gateway-server.js calls in this order:

1. configureMiddleware(app)     // CORS, body parsing, security
2. configureHealthEndpoints(app) // /health, /ready (no auth)
3. mountRoutes(app)              // All API routes
4. mountSSE(app)                 // Server-sent events
5. configureErrorHandler(app)    // Global error handler
6. startStrategyWorker()         // Background worker (if mono mode)
```

## Usage

```javascript
import { configureMiddleware, configureErrorHandler } from './bootstrap/middleware.js';
import { mountRoutes, mountSSE } from './bootstrap/routes.js';
import { configureHealthEndpoints } from './bootstrap/health.js';
import { startStrategyWorker } from './bootstrap/workers.js';

const app = express();

configureMiddleware(app);
configureHealthEndpoints(app);
mountRoutes(app);
mountSSE(app);
configureErrorHandler(app);

app.listen(5000);
startStrategyWorker();
```

## Worker Modes

```javascript
// Controlled by DEPLOY_MODE env var
'mono'       // Default - web + worker in same process
'webservice' // Web only (no worker)
'worker'     // Worker only (no web routes)
```

## Health Endpoints

```
GET /           - Full diagnostics (LLM status, pool stats)
GET /health     - Health probe (200 OK or 502 degraded)
GET /ready      - Readiness probe (503 if not ready)
GET /pool-stats - PostgreSQL connection pool
GET /metrics    - Prometheus metrics
```

## Connections

- **Called by:** `gateway-server.js`
- **Mounts:** `../routes/*`, `../middleware/*`
- **Spawns:** `../jobs/triad-worker.js` (if mono mode)

## Import Paths

```javascript
// From gateway-server.js (project root)
import { configureMiddleware, configureErrorHandler } from './server/bootstrap/middleware.js';
import { mountRoutes, mountSSE } from './server/bootstrap/routes.js';
import { configureHealthEndpoints, mountHealthRouter } from './server/bootstrap/health.js';
import { startStrategyWorker, killAllChildren } from './server/bootstrap/workers.js';

// From server/bootstrap/ (internal refs)
import healthRouter from '../api/health/health.js';
import chatRouter from '../api/chat/chat.js';
```
