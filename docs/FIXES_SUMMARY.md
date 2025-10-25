# Vecto Pilot™ - Critical Fixes Summary

**Date:** October 24, 2025  
**Status:** ✅ Fixed and Documented  
**Next Step:** Test deployment with fixes enabled

---

## 🔧 Issue #1: PostgreSQL Connection Pool - Client Disconnected Errors

### Problem
Three separate PostgreSQL connection pools with aggressive 30-second idle timeouts were causing random connection failures:
- Connections dropped during low-traffic periods
- Failed health checks
- Deployment instability
- "Client disconnected by pool" errors

### Root Cause
**30-second idle timeout** killed connections before cloud infrastructure timeouts:
- AWS NLB: 350s idle timeout
- AWS ALB: 60s idle timeout
- App was 30s - connections died prematurely

### Solution Implemented

**1. Created Shared Pool (`server/db/pool.js`)**
- **Idle timeout:** 120 seconds (safe for all cloud NATs)
- **TCP keepalive:** Enabled with 30s initial delay
- **Connection recycling:** 7500 queries per connection
- **Pool size:** 10 max, 2 min connections
- **Feature flagged:** `PG_USE_SHARED_POOL=true` for gradual rollout

**2. Consolidated Three Pools Into One**
- `server/db/client.js` → Uses shared pool
- `server/eidolon/memory/pg.js` → Uses shared pool
- `agent-server.js` → Uses shared pool

**3. Added Monitoring**
- Health endpoint: `/api/health/pool-stats`
- Real-time pool statistics
- Connection count tracking

**4. Created Test Suite**
- File: `server/tests/pool-idle-soak.js`
- 10-minute idle soak test
- 20-minute rolling load test
- Run: `PG_USE_SHARED_POOL=true node server/tests/pool-idle-soak.js`

### Files Modified
- ✅ NEW: `server/db/pool.js` - Shared pool module
- ✅ `server/db/client.js` - Uses shared pool with fallback
- ✅ `server/eidolon/memory/pg.js` - Uses shared pool (fixed import path)
- ✅ `agent-server.js` - Uses shared pool
- ✅ `server/routes/health.js` - Added `/pool-stats` endpoint
- ✅ `mono-mode.env` - Added pool configuration
- ✅ NEW: `server/tests/pool-idle-soak.js` - Validation test

### Configuration Added to `mono-mode.env`
```bash
# PostgreSQL Shared Pool Configuration (Feature Flag)
PG_USE_SHARED_POOL=true
PG_MAX=10
PG_MIN=2
PG_IDLE_TIMEOUT_MS=120000
PG_CONNECTION_TIMEOUT_MS=10000
PG_KEEPALIVE=true
PG_KEEPALIVE_DELAY_MS=30000
PG_MAX_USES=7500
```

---

## 🔧 Issue #2: UUID Type Mismatch - "invalid input syntax for type uuid: 'system'"

### Problem
Enhanced context middleware was passing string literals (`"system"`, `"sdk"`) where PostgreSQL expected UUID types:
- Error: `invalid input syntax for type uuid: "system"`
- Context enrichment silently failed (empty catch blocks)
- Missing user preferences and session state
- Poor debugging experience

### Root Cause
Database schema defines `user_id` as `UUID`, but code was passing:
```javascript
await memoryQuery({ userId: "system" });  // ❌ FAILS
await storeCrossThreadMemory('key', data, 'system', 7);  // ❌ FAILS
```

PostgreSQL rejects string literals for UUID columns.

### Solution Implemented

**1. Changed All String User IDs to `null`**
```javascript
// UUID columns accept NULL for system-level data
await memoryQuery({ userId: null });  // ✅ WORKS
await storeCrossThreadMemory('key', data, null, 7);  // ✅ WORKS
```

**2. Updated All Function Signatures**
Changed defaults from `userId = "system"` to `userId = null`:
- `performInternetSearch(query, userId = null)`
- `storeCrossThreadMemory(key, content, userId = null, ttlDays = 730)`
- `storeAgentMemory(key, content, userId = null, ttlDays = 730)`
- `getCrossThreadMemory(userId = null, limit = 50)`
- `getAgentMemory(userId = null, limit = 50)`

**3. Fixed All Middleware Calls**
Updated in `index.js` and `sdk-embed.js`:
```javascript
// Before ❌
await storeCrossThreadMemory('recentPaths', data, 'system', 7);
await storeAgentMemory('requestCount', curr, 'sdk', 7);

// After ✅
await storeCrossThreadMemory('recentPaths', data, null, 7);
await storeAgentMemory('requestCount', curr, null, 7);
```

**4. Added Proper Error Logging**
Replaced all empty `catch {}` with descriptive warnings:
```javascript
// Before ❌
try {
  const prefs = await memoryQuery(...);
} catch {}  // Silent failure

// After ✅
try {
  const prefs = await memoryQuery(...);
} catch (err) {
  console.warn('[Enhanced Context] Failed to load user preferences:', err.message);
}
```

### Files Modified
- ✅ `server/agent/enhanced-context.js` - All userId params + error logging
- ✅ `index.js` - Middleware calls  
- ✅ `sdk-embed.js` - Middleware calls

### Impact
- ✅ Context enrichment now works correctly
- ✅ Database queries succeed with NULL user IDs
- ✅ Clear error messages for debugging
- ✅ No more UUID validation errors

---

## 📊 Testing & Validation

### Startup Test (Passed ✅)
```bash
cd /home/runner/workspace
export $(grep -v '^#' mono-mode.env | xargs)
node gateway-server.js
```

**Expected Output:**
```
[pool] ✅ Shared pool initialized: {
  max: 10,
  min: 2,
  idleTimeoutMs: 120000,
  keepAlive: true,
  keepAliveDelayMs: 30000,
  maxUses: 7500
}
[mono] ✓ SDK mounted at /api
[agent embed] Mounting Agent at /agent, WS at /agent/ws
[mono] ✓ Agent mounted at /agent, WS at /agent/ws
[db] ✅ Database connection established
```

### Pool Stats Endpoint Test
```bash
curl http://localhost:5174/api/health/pool-stats
```

**Expected Response:**
```json
{
  "ok": true,
  "timestamp": "2025-10-24T23:05:10.617Z",
  "pool": {
    "enabled": true,
    "totalCount": 3,
    "idleCount": 2,
    "waitingCount": 0,
    "maxSize": 10,
    "config": {
      "max": 10,
      "idleTimeoutMs": 120000,
      "keepAlive": true,
      "keepAliveDelayMs": 30000
    }
  }
}
```

### Pool Soak Test
```bash
PG_USE_SHARED_POOL=true node server/tests/pool-idle-soak.js
```

Tests:
- 10-minute idle period without queries
- 20-minute rolling load with heartbeat queries every 30s
- Pool statistics tracking
- Connection survival validation

---

## 🚀 Deployment Checklist

### Before Deployment
- [x] Shared pool module created
- [x] All pool instantiations updated
- [x] Import paths corrected
- [x] Feature flag added to env
- [x] Health monitoring endpoint added
- [x] UUID type issues fixed
- [x] Error logging added
- [x] Tests created
- [x] Documentation updated

### To Enable in Production
1. Ensure `mono-mode.env` includes pool configuration
2. Set `PG_USE_SHARED_POOL=true`
3. Verify `DATABASE_URL` is set
4. Monitor `/api/health/pool-stats` endpoint
5. Watch for `[Enhanced Context]` warnings in logs

### Monitoring
- **Pool stats:** `GET /api/health/pool-stats`
- **General health:** `GET /api/health`
- **Database status:** Check `[db]` and `[pool]` log prefixes
- **Context errors:** Watch for `[Enhanced Context]` warnings

---

## 📝 Key Learnings

### Connection Pool Best Practices
1. **Idle timeout must exceed infrastructure timeouts** - Use 120s minimum for cloud deployments
2. **TCP keepalive is mandatory** - Prevents silent connection drops
3. **Connection recycling prevents leaks** - Set maxUses to avoid zombie sockets
4. **Feature flags enable safe rollouts** - Test in production incrementally

### Database Type Safety
1. **Never pass strings where UUIDs expected** - Use `null` for system-level data
2. **Empty catch blocks hide critical bugs** - Always log errors with context
3. **Database constraints are enforced** - Type mismatches fail at runtime
4. **NULL is valid for nullable UUID columns** - Use for non-user-specific data

### Error Handling
1. **Log errors with descriptive prefixes** - `[Enhanced Context]`, `[pool]`, etc.
2. **Include error.message in logs** - Critical for debugging
3. **Use try-catch for all database operations** - Prevent crashes
4. **Monitor for warning patterns** - Indicates systemic issues

---

## 🔗 Related Documentation

- **Full Issue Analysis:** See `ISSUES.md` (Issues #40 and #41)
- **Pool Configuration:** `server/db/pool.js`
- **Test Suite:** `server/tests/pool-idle-soak.js`
- **Environment Config:** `mono-mode.env`
- **Health Endpoint:** `server/routes/health.js`

---

## ✅ Status

**Both Issues Resolved:**
- ✅ PostgreSQL connection pool properly configured
- ✅ UUID type mismatches fixed
- ✅ Error logging added
- ✅ Health monitoring enabled
- ✅ Test suite created
- ✅ Documentation complete

**Ready for Production Testing**
