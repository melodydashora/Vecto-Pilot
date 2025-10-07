# Vecto Pilot - Issues Tracking & Root Cause Analysis

**Last Updated:** 2025-10-07 06:15 CST  
**Status:** ✅ ALL SYSTEMS OPERATIONAL - Root Cause Documented

---

## 🎯 POST-MORTEM: "Request Aborted" Error Cascade (2025-10-07)

### Executive Summary

**Problem:** `BadRequestError: request aborted` errors flooding production logs, obscuring real issues  
**Duration:** Discovered during development session, immediately fixed  
**Root Cause:** Global JSON body parsing middleware + React Query's auto-cancel behavior  
**Impact:** No user-facing issues, but severe log noise preventing effective debugging  
**Resolution:** Per-route JSON parsing + dedicated client abort error gate

---

### Timeline of Events

**Initial State:**
- Application using global `express.json({ limit: "10mb" })` before all routes
- React wrapped in `<React.StrictMode>` causing intentional double-renders
- Health checks logging every 5 seconds creating noise

**Symptoms Observed:**
```
[eidolon] error: BadRequestError: request aborted
    at IncomingMessage.onAborted (/home/runner/workspace/node_modules/raw-body/index.js:245:10)
[eidolon] error: BadRequestError: request aborted (repeated 50+ times)
```

**First Attempt (Incorrect):**
- Removed React.StrictMode → Reduced errors but didn't eliminate them
- Added global error suppression → Masked symptoms without fixing root cause
- User correctly rejected this approach: "We never suppress errors, always find and fix root causes"

**Second Attempt (Correct):**
- Analyzed the actual error source: Express raw-body parser
- Identified the interaction: Global JSON parsing + client-side request cancellation
- Applied the proper fix from architecture guide provided by user

---

### Root Cause Analysis

#### Why The Errors Occurred

**1. Global JSON Body Parsing (Primary Cause)**

```javascript
// ❌ WRONG - Applied to ALL routes including health checks
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => res.json({ ok: true })); // Body parser tries to read!
```

**Problem:** Express's `body-parser` (via `express.json()`) tries to read the request body on **every single request**, even GET requests that don't have bodies.

**What Happens:**
1. Client makes request to `/api/blocks`
2. Express starts reading request body via `raw-body` module
3. Client cancels request (React Query unmount, user navigates away, etc.)
4. `raw-body` throws `BadRequestError: request aborted`
5. No error handler catches it → logs flood with errors

**2. React Query Auto-Cancel (Secondary Factor)**

```typescript
// React Query automatically cancels in-flight requests when:
useQuery({
  queryKey: ['/api/blocks', snapshotId],
  // Component unmounts → abort signal triggered
  // Query key changes → previous request cancelled
  // Manual refetch → old request aborted
});
```

This is **correct behavior** by React Query, not a bug. It prevents stale data and race conditions.

**3. React.StrictMode (Contributing Factor)**

StrictMode intentionally double-renders components in development to catch bugs. This meant:
- First render → make request
- Second render → cancel first request, make new request
- Result: Guaranteed abort error on first request

**The Compounding Effect:**

```
Global JSON Parser + React Query Cancel + StrictMode Double-Render
    = "request aborted" error on nearly every request
```

---

### Why This Violated Architecture Principles

#### Architecture Document Didn't Specify:

**1. Middleware Mounting Strategy**
- ✅ Document said: "Use Express.js with JSON parsing"
- ❌ Document didn't say: "Mount JSON parsing per-route, not globally"
- **Gap:** No guidance on **where** to mount body parsers

**2. Client Cancellation Handling**
- ✅ Document said: "Error handling with try-catch blocks"
- ❌ Document didn't say: "Client aborts are normal, not errors"
- **Gap:** No distinction between server errors vs client-initiated aborts

**3. Development vs Production Patterns**
- ✅ Document said: "Use React.StrictMode for development"
- ❌ Document didn't say: "StrictMode causes intentional request aborts"
- **Gap:** No warning about interaction between StrictMode + body parsing

---

### The Correct Pattern (Now Documented)

#### 1. Per-Route JSON Parsing

```javascript
// ✅ CORRECT - Only parse JSON where needed
const parseJson = express.json({ limit: "1mb", strict: true });

// Health checks - NO body parsing
app.get("/health", (req, res) => res.json({ ok: true }));

// API routes that accept JSON - WITH body parsing
app.use("/api/blocks", parseJson, strictLimiter, blocksRoutes);
app.use("/api/location", parseJson, apiLimiter, locationRoutes);
app.use("/api/actions", parseJson, apiLimiter, actionsRoutes);
```

**Why This Works:**
- Health checks don't trigger body parser
- Only routes that **actually need JSON** pay the parsing cost
- Fewer opportunities for abort errors

#### 2. Client Abort Error Gate

```javascript
// ✅ CORRECT - Dedicated handler for client aborts
app.use((err, req, res, next) => {
  // Client closed connection mid-read (NORMAL React Query behavior)
  if (err?.type === "request.aborted" || err?.code === "ECONNRESET") {
    if (!res.headersSent) res.status(499).end(); // 499: client closed request
    return; // Don't log - this is expected
  }
  
  // Payload too large
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "payload too large" });
  }
  
  // Real errors - pass to error logger
  next(err);
});
```

**Why This Works:**
- Distinguishes between client-initiated aborts (normal) and server errors (problems)
- Uses HTTP 499 status code (non-standard but widely recognized)
- Prevents log noise while still catching real issues

#### 3. Health Check Logging Filter

```javascript
// ✅ CORRECT - Skip logging automated health checks
app.use((req, res, next) => {
  if (req.path !== "/health") {
    console.log("[trace]", req.method, req.originalUrl);
  }
  next();
});
```

**Why This Works:**
- Health checks run every 5 seconds (720 times/hour)
- These are automated, not user traffic
- Filtering them makes logs readable

#### 4. StrictMode Strategy

```typescript
// ✅ CORRECT - Remove StrictMode in production builds
const root = createRoot(container);

if (import.meta.env.DEV) {
  // Development: Keep StrictMode for debugging
  root.render(<React.StrictMode><App /></React.StrictMode>);
} else {
  // Production: Single render only
  root.render(<App />);
}
```

**Why This Works:**
- Development still gets StrictMode warnings
- Production avoids intentional double-renders and abort errors

---

### Lessons Learned & Prevention

#### 1. Architecture Documents Must Specify:

**❌ Too Vague:**
> "Use Express.js with JSON body parsing"

**✅ Specific Enough:**
> "Mount `express.json()` per-route using a shared `parseJson` middleware constant. Never mount globally to avoid parsing bodies on health checks and GET requests."

#### 2. Error Handling Patterns Must Distinguish:

**Client-Initiated (Normal):**
- Request aborted
- Connection reset
- Timeout (client-side)

**Server-Initiated (Problems):**
- Database errors
- API failures
- Validation errors

**Rule:** Client aborts get 499 status code and NO logging. Server errors get logged with stack traces.

#### 3. Development Patterns Must Be Documented:

**StrictMode:**
- Document that it causes intentional double-renders
- Document that it triggers request cancellations
- Provide guidance on when to disable (production builds)

**React Query:**
- Document that it auto-cancels on unmount
- Document that this is **correct behavior**
- Explain how to handle this on the backend

---

### Single Source of Truth: Middleware Mounting Rules

**RULE 1: Health Checks First**
```javascript
// Health checks BEFORE any body parsing
app.get("/health", (req, res) => res.json({ ok: true }));
```

**RULE 2: Per-Route Body Parsing**
```javascript
// Create shared parser constant
const parseJson = express.json({ limit: "1mb", strict: true });

// Mount ONLY on routes that accept JSON
app.use("/api/endpoint", parseJson, otherMiddleware, routes);
```

**RULE 3: Client Abort Error Gate**
```javascript
// AFTER all routes, BEFORE 404 handler
app.use((err, req, res, next) => {
  if (err?.type === "request.aborted" || err?.code === "ECONNRESET") {
    return res.status(499).end(); // Don't log
  }
  next(err); // Real errors continue to error logger
});
```

**RULE 4: 404 Handler Last**
```javascript
// Dead last - catches unmatched routes
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "route_not_found" });
});
```

---

### Testing Checklist for Future Changes

Before changing middleware mounting:

- [ ] Does this apply to ALL routes or specific routes?
- [ ] Will health checks be affected?
- [ ] How does this interact with client-side request cancellation?
- [ ] Is there a client abort error handler downstream?
- [ ] Are logs readable with this change?

Before adding global middleware:

- [ ] Can this be per-route instead?
- [ ] What happens when clients cancel requests mid-processing?
- [ ] Is this needed for GET requests?
- [ ] Does this affect health check latency?

---

### Files Changed (Permanent Fix)

**Gateway Server (`gateway-server.js`):**
```diff
- app.use(express.json({ limit: "10mb" })); // Global - WRONG
+ const parseJson = express.json({ limit: "1mb", strict: true });
+ app.use("/api/blocks", parseJson, blocksRoutes); // Per-route - CORRECT

+ // Client abort error gate
+ app.use((err, req, res, next) => {
+   if (err?.type === "request.aborted" || err?.code === "ECONNRESET") {
+     if (!res.headersSent) res.status(499).end();
+     return;
+   }
+   next(err);
+ });
```

**SDK Server (`index.js`):**
```diff
- app.use(express.json({ limit: "10mb" })); // Global - WRONG
+ const parseJson = express.json({ limit: "1mb", strict: true });
+ app.use("/api/blocks", parseJson, strictLimiter, blocksRoutes);

+ // Client abort error gate
+ app.use((err, req, res, next) => {
+   if (err?.type === "request.aborted" || err?.code === "ECONNRESET") {
+     if (!res.headersSent) res.status(499).end();
+     return;
+   }
+   next(err);
+ });
```

**Client (`client/src/main.tsx`):**
```diff
- import React from 'react'
  import { createRoot } from 'react-dom/client'
  
- root.render(
-   <React.StrictMode>
-     <App />
-   </React.StrictMode>
- );
+ root.render(<App />);
```

---

### Verification (2025-10-07 06:09 CST)

**✅ Zero "request aborted" errors in logs**
```bash
$ grep -i "request aborted" /tmp/logs/Eidolon_Main_*.log
# No results - errors eliminated
```

**✅ Clean logs showing only real traffic**
```
[trace] POST /api/location/snapshot
[trace] POST /api/blocks
[SDK] POST /api/blocks
🎯 [5f65da56...] BLOCKS REQUEST: lat=33.1285 lng=-96.8755
```

**✅ Client aborts handled gracefully**
```javascript
// React Query cancels request on unmount
// → Express returns 499 status code
// → No error logged
// → Clean separation of client vs server issues
```

---

## ✅ FINAL IDEMPOTENCY IMPROVEMENTS (2025-10-07 12:46 CST)

### Expert Feedback Applied

**Problem:** Idempotency infrastructure built but not optimally configured
- HTTP cache storing 5xx errors (replay failures on subsequent requests)
- Client using random keys instead of deterministic snapshot-based keys
- Missing stable idempotency for duplicate POST /api/blocks requests

**Solutions Applied:**

#### 1. Filter 5xx from HTTP Idempotency Cache
**Changed:** `server/middleware/idempotency.js`
```javascript
// ❌ OLD: Cached all responses including server errors
await db.insert(http_idem).values({ key, status: res.statusCode, body });

// ✅ NEW: Only cache good outcomes (2xx/202/400), not 5xx errors
const s = res.statusCode || 200;
if ((s >= 200 && s < 300) || s === 202 || s === 400) {
  await db.insert(http_idem).values({ key, status: s, body });
}
```

**Why:** If first attempt fails with 500, we don't want to replay that failure for the TTL. Cache only successful responses and deterministic errors (400).

#### 2. Deterministic Idempotency Keys
**Changed:** `client/src/pages/co-pilot.tsx`
```typescript
// ❌ OLD: No idempotency key (or random UUID that changes every request)

// ✅ NEW: Deterministic key per snapshot
const idemKey = lastSnapshotId ? `POST:/api/blocks:${lastSnapshotId}` : undefined;

await fetch('/api/blocks', {
  headers: {
    'x-idempotency-key': idemKey, // Stable per snapshot
  }
});
```

**Why:** Same snapshot ID = same idempotency key = HTTP cache hit. Collapses duplicate POST requests to single backend execution.

#### 3. Health Check Logging Already Optimized
**Verified:** Gateway already skips /health from logs (line 202-205 in gateway-server.js)
```javascript
app.use((req, res, next) => {
  if (req.path !== "/health") {
    console.log("[trace]", req.method, req.originalUrl);
  }
  next();
});
```

**Result:** Health checks (every 5s) don't pollute logs ✅

---

### Remaining Integration (Optional)

**Status:** Infrastructure complete, inline execution still active

**To Fully Integrate Idempotency:**
1. Start worker: `node server/jobs/triad-worker.js` in separate process
2. Switch POST /api/blocks to use `server/routes/blocks-idempotent.js` (enqueue pattern)
3. Client already uses deterministic keys ✅
4. Monitor for single "BLOCKS REQUEST" per snapshot_id

**Current State:**
- ✅ Deterministic idempotency keys in client
- ✅ HTTP cache only stores good responses (not 5xx)
- ✅ Health checks filtered from logs
- ✅ Client abort errors handled gracefully (499 status)
- ❌ Worker not started (optional - inline execution works)
- ❌ Enqueue route not active (optional - inline execution works)

---

## 🚨 PREVIOUS CRITICAL ISSUES (ALL RESOLVED)

### ✅ ISSUE #1: Missing `crypto` Import in `server/routes/location.js`
**Status:** ✅ FIXED & VERIFIED ✅  
**Date:** 2025-10-06

### ✅ ISSUE #2: Missing `strategies` Table Import in `server/routes/location.js`
**Status:** ✅ FIXED & VERIFIED ✅  
**Date:** 2025-10-06

### ✅ ISSUE #3: Express Import Inconsistency
**Status:** ✅ FIXED & VERIFIED ✅  
**Date:** 2025-10-06

### ✅ ISSUE #8: Gateway Proxy Token Injection
**Status:** ✅ FIXED & VERIFIED ✅  
**Date:** 2025-10-06

### ✅ ISSUE #9: Air Quality Response Scope Error
**Status:** ✅ FIXED & VERIFIED ✅  
**Date:** 2025-10-07

### ✅ ISSUE #10: Request Aborted Error Cascade
**Status:** ✅ FIXED & VERIFIED ✅  
**Date:** 2025-10-07

---

## 📋 ARCHITECTURE COMPLIANCE CHECKLIST

Use this before making middleware changes:

### Middleware Mounting
- [ ] Is body parsing mounted per-route, not globally?
- [ ] Are health checks exempt from body parsing?
- [ ] Is there a client abort error gate?
- [ ] Are logs filtered to exclude health checks?

### Error Handling
- [ ] Client aborts return 499 status code?
- [ ] Client aborts are NOT logged as errors?
- [ ] Server errors are properly logged with stack traces?
- [ ] Error middleware is AFTER routes, BEFORE 404 handler?

### React Patterns
- [ ] StrictMode only in development builds?
- [ ] React Query cancellations handled on backend?
- [ ] No error suppression without root cause fix?

### Testing
- [ ] Logs are readable with change?
- [ ] No "request aborted" errors appear?
- [ ] Health checks remain fast (<10ms)?
- [ ] Real errors still surface properly?

---

---

## 🔍 NEWLY DISCOVERED ISSUES (2025-10-07)

### ⚠️ ISSUE #11: Perplexity Model Name Outdated
**Status:** 🔴 NEEDS FIX  
**Date:** 2025-10-07  
**Location:** `server/lib/perplexity-research.js:7`

**Problem:**
- Using deprecated model name `sonar-pro`
- Should use current 2025 model names from Perplexity docs

**Fix Required:**
```javascript
// Current (WRONG):
this.model = 'sonar-pro';

// Should be (verify latest from https://docs.perplexity.ai/guides/model-cards):
this.model = 'llama-3.1-sonar-small-128k-online';
```

---

### ⚠️ ISSUE #12: Internet Access Test Endpoint Missing Timeout
**Status:** 🟡 MINOR  
**Date:** 2025-10-07  
**Location:** `server/routes/health.js:43`

**Problem:**
- Internet connectivity test has `timeout: 5000` in fetch options
- Node's native fetch doesn't support timeout option (throws error)
- Should use AbortController pattern

**Fix Required:**
```javascript
// Add AbortController for timeout
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const response = await fetch('https://api.perplexity.ai/chat/completions', {
  method: 'POST',
  signal: controller.signal,
  headers: { /* ... */ }
});

clearTimeout(timeoutId);
```

---

### ⚠️ ISSUE #13: Blocks Route Missing Error Handling for Invalid Snapshot ID
**Status:** 🟡 MINOR  
**Date:** 2025-10-07  
**Location:** `server/routes/blocks.js:93-107`

**Problem:**
- Snapshot validation checks missing fields but doesn't handle malformed UUID gracefully
- Could throw unhandled error if snapshot_id is invalid UUID format

**Current Code:**
```javascript
const [snap] = await db
  .select()
  .from(snapshots)
  .where(eq(snapshots.snapshot_id, snapshotId))
  .limit(1);
```

**Fix Required:**
Add try-catch around database query to handle malformed UUIDs.

---

### ⚠️ ISSUE #14: Missing Idempotency Key Validation
**Status:** 🟡 MINOR  
**Date:** 2025-10-07  
**Location:** `server/middleware/idempotency.js`

**Problem:**
- Idempotency middleware doesn't validate key format
- Could accept malformed keys leading to cache pollution
- Should enforce max length and character whitelist

**Fix Required:**
```javascript
// Add validation at start of middleware
if (key && (key.length > 256 || !/^[a-zA-Z0-9:_-]+$/.test(key))) {
  console.warn('[idempotency] Invalid key format, skipping cache');
  return next();
}
```

---

### ⚠️ ISSUE #15: Co-Pilot Page Has Unused State Variables
**Status:** 🟢 CLEANUP  
**Date:** 2025-10-07  
**Location:** `client/src/pages/co-pilot.tsx:34-38`

**Problem:**
- `showOffPeak`, `testMode`, `selectedModel`, `modelParameter` are declared but never used
- Dead code from testing/development phase

**Fix Required:**
Remove unused state variables or implement their intended functionality.

---

### ⚠️ ISSUE #16: Memory Compactor Missing Startup Logging (Already Fixed)
**Status:** ✅ FIXED  
**Date:** 2025-10-07  
**Location:** `server/eidolon/memory/compactor.js`

**Already Applied:** Startup confirmation logging added in previous changes.

---

### ⚠️ ISSUE #17: Strategy Generator Missing Proper Error Classification
**Status:** 🟡 MINOR  
**Date:** 2025-10-07  
**Location:** `server/lib/strategy-generator.js` (referenced but file not in context)

**Problem:**
- Strategy generation errors should be classified (API_ERROR, TIMEOUT, VALIDATION_ERROR)
- Current implementation may not distinguish between retryable and non-retryable errors

**Fix Required:**
Implement error classification similar to triad orchestrator pattern.

---

### ⚠️ ISSUE #18: Missing Index on ranking_candidates.ranking_id
**Status:** 🟡 PERFORMANCE  
**Date:** 2025-10-07  
**Location:** Database schema

**Problem:**
- Foreign key `ranking_candidates.ranking_id → rankings.ranking_id` has no index
- Could cause slow queries when fetching candidates for a ranking

**Fix Required:**
```sql
CREATE INDEX IF NOT EXISTS idx_ranking_candidates_ranking_id 
ON ranking_candidates(ranking_id);
```

---

### ⚠️ ISSUE #19: Google Places API Error Handling Incomplete
**Status:** 🟡 MINOR  
**Date:** 2025-10-07  
**Location:** `server/lib/places-hours.js` (referenced in blocks.js)

**Problem:**
- Catches errors but may not handle specific Google API error codes (OVER_QUERY_LIMIT, REQUEST_DENIED)
- Should implement exponential backoff for rate limits

---

### ⚠️ ISSUE #20: Test Blocks Route Query Parameter Validation Missing
**Status:** 🟡 SECURITY  
**Date:** 2025-10-07  
**Location:** `server/routes/test-blocks.js` (referenced in tools/testing)

**Problem:**
- llmModel and llmParam from query string not validated
- Could accept arbitrary model names or parameters
- Should whitelist allowed values

---

**END OF ISSUES DOCUMENT**

*This document serves as the single source of truth for what went wrong, why it happened, and how to prevent it. All future middleware changes must reference this post-mortem.*
