> **Last Verified:** 2026-01-06

# Health API (`server/api/health/`)

## Purpose

Health checks, diagnostics, and system monitoring.

## Files

| File | Route | Purpose |
|------|-------|---------|
| `health.js` | `/`, `/health`, `/ready` | Health probes |
| `diagnostics.js` | `/api/diagnostics/*` | Debug endpoints |
| `diagnostics-strategy.js` | `/api/diagnostic/*` | Strategy debugging |
| `diagnostic-identity.js` | `/api/diagnostic/identity` | Identity debugging |
| `job-metrics.js` | `/api/job-metrics` | Background job stats |
| `ml-health.js` | `/api/ml/*` | ML model health |
| `unified-capabilities.js` | `/capabilities` | AI capabilities |

## Endpoints

### Health Probes
```
GET /             - Basic health check
GET /health       - Detailed health with DB/API status
GET /ready        - Kubernetes readiness probe
GET /pool-stats   - Database pool statistics
GET /metrics      - Prometheus metrics
```

### Diagnostics
```
GET /api/diagnostics/db           - Database connectivity
GET /api/diagnostics/strategy     - Strategy pipeline test
GET /api/diagnostic/identity      - User identity debug
```

### Job Metrics
```
GET /api/job-metrics              - Background job statistics
```

### ML Health
```
GET /api/ml/models                - Available models
GET /api/ml/status                - Model health status
```

## Connections

- **Uses:** `../../db/drizzle.js` for database access (diagnostics.js, ml-health.js)
- **Uses:** `../../../shared/schema.js` for database schema
- **Uses:** `../../lib/ai/llm-router-v2.js` for model status (LLM diagnostics)
- **Uses:** `../../db/pool.js` for database pool statistics
- **Uses:** `../../db/connection-manager.js` for agent state
- **Uses:** `../../lib/strategy/strategies/index.js` for provider registry
- **Uses:** `../../logger/ndjson.js` for structured logging
- **Called by:** Kubernetes probes, monitoring systems

## Import Path Notes

**Critical:** Files in `server/api/*/` must use correct relative paths:

| Target | Path from `server/api/*/` |
|--------|---------------------------|
| `server/lib/` | `../../lib/` |
| `server/db/` | `../../db/` |
| `server/middleware/` | `../../middleware/` |
| `server/util/` | `../../util/` |
| `server/validation/` | `../../validation/` |
| `server/logger/` | `../../logger/` |
| `shared/` (project root) | `../../../shared/` |
| Project root files | `../../../` |

Common mistakes:
- Using `../../shared/` resolves to `server/shared/` instead of project root `shared/`
- Using `./utils/` from subfolders resolves to `server/api/subfolder/utils/` instead of `server/api/utils/` → use `../utils/`

**Note:** Dynamic imports (`await import('...')`) require the same path corrections as static imports.
