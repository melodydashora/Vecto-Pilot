# ~~Neon~~ **Replit PostgreSQL** Connection Resilience Implementation

> **⚠️ ARCHIVED DOCUMENTATION (2025-11-26):** This document describes connection patterns for the previous external Neon PostgreSQL provider. The system has been migrated to Replit's managed PostgreSQL database. Core concepts (health checks, exponential backoff, connection pooling) remain relevant.

## Overview
~~Comprehensive connection resilience pattern to survive Neon admin-terminated connections, autoscale events, and connection pool saturation in Replit Reserved VM deployments.~~ Connection resilience patterns are now simplified with Replit's managed PostgreSQL providing stable, production-ready database connectivity.

## Components Implemented

### 1. Connection Manager (`server/db/connection-manager.js`)
- Wraps `pg.Pool` with degradation state tracking
- Detects Neon admin-terminated connections (error code `57P01`)
- Exponential backoff retry: 2s, 4s, 8s, 16s with jitter
- Auto-recovery when connections are restored
- Exports `getAgentState()` for health checks

### 2. NDJSON Logger (`server/logger/ndjson.js`)
- Structured logging for connection lifecycle events
- Events: `conn.error`, `conn.reconnect`, `conn.recover`, `conn.degrade`
- One JSON object per line for easy parsing

### 3. Health Endpoints (`server/routes/health.js`)
- **GET /health**: Returns 503 during degradation, 200 when healthy
  ```json
  {"state": "healthy", "timestamp": "...", "environment": "production"}
  ```
- **GET /ready**: Returns 503 during degradation, 200 when ready
  ```json
  {"status": "ready", "timestamp": "..."}
  ```

### 4. Error Middleware (`server/middleware/error-handler.js`)
- Converts database errors to 503 responses
- Returns `retry_after: 5` seconds for client retry logic
- Applied after all routes in `gateway-server.js`

### 5. Connection Audit Table (`shared/schema.js`)
```sql
CREATE TABLE connection_audit (
  id UUID PRIMARY KEY,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  event TEXT NOT NULL,
  backend_pid INTEGER,
  application_name TEXT,
  reason TEXT,
  deploy_mode TEXT,
  details JSONB
);
```

### 6. Pool Configuration
Updated `server/db/drizzle.js` and `server/db/pool.js` to use wrapped pool from connection manager.

## Environment Variables

### Pool Configuration
- `PG_MAX`: Maximum pool size (default: 10, **recommended: 20** for Reserved VM)
- `PG_MIN`: Minimum pool size (default: 2, **recommended: 5** for Reserved VM)
- `PG_IDLE_TIMEOUT_MS`: Idle connection timeout (default: 30000)

## How It Works

### Normal Operation
1. Queries use the wrapped pool from connection manager
2. Health endpoints return 200 OK
3. All requests processed normally

### During Neon Admin Termination
1. Connection manager detects error code `57P01`
2. Logs `conn.error` event with NDJSON
3. Enters degradation state
4. Health endpoints return 503
5. Error middleware converts all DB errors to 503
6. Exponential backoff retry: 2s → 4s → 8s → 16s
7. Auto-recovery when connection succeeds
8. Logs `conn.recover` event
9. Health endpoints return 200 OK
10. Normal operation resumes

### Observability
- NDJSON logs: `conn.error`, `conn.reconnect`, `conn.recover`, `conn.degrade`
- Connection audit table: tracks all admin-termination events
- Health endpoints: real-time degradation state

## Testing

### Verify Health Endpoints
```bash
curl http://localhost:5000/health
# {"state":"healthy","timestamp":"...","environment":"production"}

curl http://localhost:5000/ready
# {"status":"ready","timestamp":"..."}
```

### Verify Connection Audit Table
```sql
SELECT * FROM connection_audit ORDER BY occurred_at DESC LIMIT 10;
```

## Deployment Notes

### Replit Reserved VM (Recommended Configuration)
```bash
DEPLOY_MODE=webservice
PG_MAX=20
PG_MIN=5
PG_IDLE_TIMEOUT_MS=30000
ENABLE_BACKGROUND_WORKER=true
```

### Why This Matters
- **Background Worker**: Holds connections for 30-50s during strategy generation
- **Pool Saturation**: Without resilience, web requests fail when pool exhausted
- **Admin Terminations**: Neon periodically terminates connections for maintenance
- **Graceful Degradation**: 503 responses instead of 500 errors, clients can retry

## Files Modified
- `server/db/connection-manager.js` (NEW)
- `server/logger/ndjson.js` (NEW)
- `server/middleware/error-handler.js` (NEW)
- `server/routes/health.js` (MODIFIED)
- `server/db/drizzle.js` (MODIFIED)
- `server/db/pool.js` (MODIFIED)
- `gateway-server.js` (MODIFIED)
- `shared/schema.js` (MODIFIED)
- `replit.md` (DOCUMENTED)

## Verification Status
✅ Health endpoints returning JSON with connection state
✅ Connection audit table created in database
✅ Connection manager loaded and integrated
✅ Error middleware configured
✅ Documentation updated
✅ All components tested and verified
