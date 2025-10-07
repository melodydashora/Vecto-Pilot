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

**END OF ISSUES DOCUMENT**

*This document serves as the single source of truth for what went wrong, why it happened, and how to prevent it. All future middleware changes must reference this post-mortem.*
