
# Vecto Pilot - Issues Tracking & Remediation

**Last Updated:** 2025-10-06  
**Status:** Active - Tracking 15 critical issues  
**Agent:** Human-assisted verification required

---

## 🚨 CRITICAL ISSUES (BLOCKING)

### ❌ ISSUE #1: Missing `crypto` Import in `server/routes/location.js`
**Severity:** CRITICAL  
**Status:** 🔴 UNRESOLVED  
**Impact:** Runtime failure when UUID generation is attempted

**Problem:**
- File uses UUID generation but has NO `crypto` import
- Will throw `ReferenceError: crypto is not defined` at runtime
- Blocks snapshot creation in location.js route

**Evidence:**
```javascript
// server/routes/location.js - Current imports (MISSING CRYPTO)
import { Router } from 'express';
import { latLngToCell } from 'h3-js';
import { db } from '../db/drizzle.js';
import { snapshots } from '../../shared/schema.js';
// ❌ NO CRYPTO IMPORT
```

**Remedy Steps:**
1. Add `import crypto from 'node:crypto';` at top of file
2. Verify UUID generation calls work (likely in snapshot creation)
3. Test POST /api/location/snapshot endpoint
4. Check logs for any `crypto is not defined` errors

**Verification Checklist:**
- [ ] Import added to server/routes/location.js
- [ ] No runtime errors in logs when creating snapshots
- [ ] Test snapshot creation via /api/location/snapshot
- [ ] Grep codebase for other missing crypto imports

---

### ❌ ISSUE #2: Missing `strategies` Table Import in `server/routes/location.js`
**Severity:** HIGH  
**Status:** 🔴 UNRESOLVED  
**Impact:** Poor code clarity, hidden dependencies

**Problem:**
- Line 443 calls `generateStrategyForSnapshot()` which needs strategies table
- Only imports `snapshots` from schema, not `strategies`
- Function uses the table internally but dependency is hidden

**Evidence:**
```javascript
// server/routes/location.js - Current import
import { snapshots } from '../../shared/schema.js';
// ❌ Should be: import { snapshots, strategies } from '../../shared/schema.js';

// Line 443 - Hidden dependency
generateStrategyForSnapshot(snapshotV1.snapshot_id).catch(err => {
  // Uses strategies table internally
});
```

**Remedy Steps:**
1. Update import to include `strategies` table
2. Review if any direct strategies table access is needed in this file
3. Check for similar hidden dependencies in other route files

**Verification Checklist:**
- [ ] Import updated to include strategies table
- [ ] No import-related errors in logs
- [ ] Code clarity improved (dependencies visible)
- [ ] Similar issues checked in snapshot.js and blocks.js

---

## ⚠️ HIGH PRIORITY ISSUES

### ⚠️ ISSUE #3: Express Import Inconsistency
**Severity:** MEDIUM  
**Status:** 🟡 STYLE DRIFT  
**Impact:** Code inconsistency, maintainability

**Problem:**
- `location.js` uses: `import { Router } from 'express';`
- `snapshot.js` uses: `import express from "express";` → `express.Router()`
- Inconsistent patterns across codebase

**Remedy Steps:**
1. Standardize on `{ Router }` pattern (cleaner, direct)
2. Update snapshot.js to match location.js style
3. Audit all route files for consistent import pattern

**Verification Checklist:**
- [ ] All route files use `import { Router } from 'express';`
- [ ] No functional regressions after standardization
- [ ] ESLint/Prettier rules updated to enforce pattern

---

### ⚠️ ISSUE #4: Validation Function Inconsistency
**Severity:** MEDIUM  
**Status:** 🟡 INCONSISTENT  
**Impact:** Code duplication, validation drift

**Problem:**
- `snapshot.js` uses `validateIncomingSnapshot()`
- `location.js` uses `validateSnapshotV1()`
- Both files validate snapshots but use different functions
- Potential validation logic drift between endpoints

**Evidence:**
```javascript
// server/routes/snapshot.js
const { ok, errors, warnings } = validateIncomingSnapshot(req.body ?? {});

// server/routes/location.js  
const v = validateSnapshotV1(snapshotV1);
```

**Remedy Steps:**
1. Review both validation functions in `server/util/validate-snapshot.js`
2. Determine if they should be unified or if difference is intentional
3. Document validation strategy differences if intentional
4. Consider creating a single validation function with format parameter

**Verification Checklist:**
- [ ] Validation logic documented and justified
- [ ] No validation gaps between endpoints
- [ ] Test coverage for both validation paths
- [ ] Consider unified validation function

---

## 📊 DATABASE & SCHEMA ISSUES

### ⚠️ ISSUE #5: Potential Schema Drift - `user_id` UUID Validation
**Severity:** MEDIUM  
**Status:** 🟡 NEEDS REVIEW  
**Impact:** Data integrity, null handling

**Problem:**
- `snapshot.js` validates `user_id` with UUID regex before insert
- `location.js` does NOT validate `user_id` format
- Inconsistent null/UUID handling across snapshot endpoints

**Evidence:**
```javascript
// server/routes/snapshot.js - HAS VALIDATION
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (userId && !uuidRegex.test(userId)) {
  userId = null;
}

// server/routes/location.js - NO VALIDATION
user_id: snapshotV1.user_id || null,
```

**Remedy Steps:**
1. Extract UUID validation to shared utility function
2. Apply consistent validation in both snapshot endpoints
3. Add database constraint to enforce UUID format
4. Review all user_id usage across codebase

**Verification Checklist:**
- [ ] Shared UUID validation utility created
- [ ] Both endpoints use same validation
- [ ] Database constraint added (if missing)
- [ ] Test invalid UUID handling

---

### ⚠️ ISSUE #6: Missing Database Indexes
**Severity:** HIGH  
**Status:** 🔴 PERFORMANCE RISK  
**Impact:** Query performance degradation at scale

**Problem:**
- Frequent queries on `snapshot_id`, `user_id`, `created_at`
- No evidence of indexes in schema or migration files
- High-frequency read paths will slow down with data growth

**Evidence from codebase:**
```javascript
// Frequent query patterns without indexes
.where(eq(snapshots.snapshot_id, snapshotId))
.where(eq(strategies.snapshot_id, snapshot_id))
.where(eq(rankings.snapshot_id, snapshotId))
```

**Remedy Steps:**
1. Review `shared/schema.js` for existing index definitions
2. Add indexes on frequently queried columns:
   - `snapshots.snapshot_id` (primary key, auto-indexed)
   - `snapshots.user_id`
   - `snapshots.created_at`
   - `strategies.snapshot_id` (unique constraint exists)
   - `strategies.status`
   - `rankings.snapshot_id`
3. Create migration file with index additions
4. Monitor query performance before/after

**Verification Checklist:**
- [ ] Index audit completed
- [ ] Migration created with necessary indexes
- [ ] Indexes applied to database
- [ ] Query performance measured and improved

---

### ⚠️ ISSUE #7: No Foreign Key Cascade Behavior Defined
**Severity:** MEDIUM  
**Status:** 🟡 DATA INTEGRITY  
**Impact:** Orphaned records, manual cleanup required

**Problem:**
- `strategies.snapshot_id` references `snapshots.snapshot_id`
- No cascade delete behavior defined
- Deleting snapshots may leave orphaned strategy records

**Evidence:**
```javascript
// shared/schema.js
snapshot_id: uuid("snapshot_id").notNull().unique().references(() => snapshots.snapshot_id),
// ❌ No cascade behavior specified
```

**Remedy Steps:**
1. Review all foreign key relationships in schema.js
2. Define cascade behavior (CASCADE or RESTRICT) for each relationship
3. Create migration to add cascade constraints
4. Document data lifecycle and cleanup policies

**Verification Checklist:**
- [ ] All FK relationships reviewed
- [ ] Cascade behavior defined and documented
- [ ] Migration created and tested
- [ ] Data cleanup policies documented

---

## 🔧 FUNCTIONAL & LOGIC ISSUES

### ⚠️ ISSUE #8: Race Condition in Strategy Generation
**Severity:** HIGH  
**Status:** 🔴 CONCURRENCY BUG  
**Impact:** Duplicate strategy generation, wasted API calls

**Problem:**
- `snapshot.js` creates pending strategy row immediately (good)
- `location.js` calls `generateStrategyForSnapshot()` in background
- `blocks.js` checks for existing strategy but may race with background generation
- No distributed locking mechanism

**Evidence:**
```javascript
// snapshot.js - Creates pending row
await db.insert(strategies).values({
  status: 'pending',
  attempt: 1,
}).onConflictDoNothing();

// blocks.js - May race with above
const [existing] = await db.select().from(strategies)
  .where(eq(strategies.snapshot_id, snapshotId));
if (!existing) {
  // ❌ Race condition: snapshot.js may have just created row
}
```

**Remedy Steps:**
1. Add distributed lock using Postgres advisory locks
2. Use `onConflictDoUpdate` instead of `onConflictDoNothing`
3. Add retry logic with exponential backoff
4. Monitor for duplicate generation in logs

**Verification Checklist:**
- [ ] Locking mechanism implemented
- [ ] Conflict handling improved
- [ ] Load test with concurrent requests
- [ ] No duplicate generations in logs

---

### ⚠️ ISSUE #9: Error Handling Inconsistency
**Severity:** MEDIUM  
**Status:** 🟡 ERROR HANDLING  
**Impact:** Poor error messages, debugging difficulty

**Problem:**
- Different error response formats across endpoints
- Inconsistent HTTP status codes for similar errors
- Missing error correlation IDs in some endpoints

**Evidence:**
```javascript
// snapshot.js - Has correlation ID
return res.status(400).json({ 
  ok: false, 
  error: "refresh_required",
  fields_missing: errors,
  req_id: reqId 
});

// location.js - NO correlation ID
return res.status(500).json({ 
  error: 'snapshot-failed', 
  message: err.message 
});
```

**Remedy Steps:**
1. Create standard error response format utility
2. Add correlation IDs to all error responses
3. Standardize HTTP status codes for error types
4. Document error response contract

**Verification Checklist:**
- [ ] Error response utility created
- [ ] All endpoints use standard format
- [ ] Correlation IDs added
- [ ] Error handling tests added

---

### ⚠️ ISSUE #10: Missing Request Validation Middleware
**Severity:** MEDIUM  
**Status:** 🟡 SECURITY/VALIDATION  
**Impact:** Invalid data reaching business logic

**Problem:**
- Manual validation in each route handler
- Inconsistent validation patterns
- No centralized validation schema
- Missing rate limiting on expensive endpoints

**Remedy Steps:**
1. Create validation middleware using Zod schemas
2. Define request schemas for each endpoint
3. Add rate limiting middleware for expensive operations
4. Move validation out of route handlers

**Verification Checklist:**
- [ ] Validation middleware implemented
- [ ] Zod schemas defined for all endpoints
- [ ] Rate limiting added
- [ ] Route handlers simplified

---

## 🔄 ARCHITECTURE & DESIGN ISSUES

### ⚠️ ISSUE #11: Fire-and-Forget Pattern Without Monitoring
**Severity:** MEDIUM  
**Status:** 🟡 OBSERVABILITY  
**Impact:** Silent failures in background tasks

**Problem:**
- `queueMicrotask()` used for background strategy generation
- No tracking of background task success/failure
- No dead letter queue or retry mechanism for failed tasks

**Evidence:**
```javascript
// snapshot.js
queueMicrotask(() => {
  generateStrategyForSnapshot(snapshot_id).catch(err => {
    console.warn(`[triad] enqueue.failed`, { snapshot_id, err: String(err) });
  });
});
// ❌ No metrics, no alerting, no retry
```

**Remedy Steps:**
1. Implement job queue (BullMQ, pg-boss, or similar)
2. Add metrics for background task success/failure rates
3. Implement retry logic with exponential backoff
4. Add dead letter queue for permanently failed tasks

**Verification Checklist:**
- [ ] Job queue implemented
- [ ] Metrics added for background tasks
- [ ] Retry logic implemented
- [ ] Dead letter queue configured

---

### ⚠️ ISSUE #12: No Circuit Breaker for External APIs
**Severity:** HIGH  
**Status:** 🔴 RESILIENCE  
**Impact:** Cascading failures from API outages

**Problem:**
- Direct calls to Google Maps, OpenWeather, Google AQ APIs
- No circuit breaker pattern
- No fallback behavior when APIs are down
- No timeout configuration visible

**Evidence:**
```javascript
// location.js - No circuit breaker
const response = await fetch(url.toString());
const data = await response.json();
// ❌ No timeout, no circuit breaker, no fallback
```

**Remedy Steps:**
1. Implement circuit breaker pattern (using opossum or similar)
2. Add configurable timeouts for all external API calls
3. Define fallback behavior for each API
4. Add metrics for API success/failure rates

**Verification Checklist:**
- [ ] Circuit breaker library added
- [ ] All external API calls wrapped
- [ ] Fallback behavior defined
- [ ] Metrics and alerting configured

---

### ⚠️ ISSUE #13: Memory Leak Risk in Event Listeners
**Severity:** MEDIUM  
**Status:** 🟡 MEMORY MANAGEMENT  
**Impact:** Potential memory leaks in long-running process

**Problem:**
- Event listeners registered in location-context-clean.tsx
- No evidence of cleanup in unmount
- Multiple component mounts may accumulate listeners

**Evidence from webview logs:**
```javascript
["🔌 Setting up event listeners for location updates..."]
["✅ Event listeners registered successfully"]
// ❌ No corresponding cleanup log on unmount
```

**Remedy Steps:**
1. Add cleanup function to remove event listeners on unmount
2. Use useEffect cleanup return function
3. Verify no duplicate listeners with React DevTools
4. Add listener count tracking in dev mode

**Verification Checklist:**
- [ ] Cleanup function added
- [ ] useEffect returns cleanup
- [ ] No duplicate listeners verified
- [ ] Memory profiling shows no leaks

---

## 📝 DOCUMENTATION & TESTING ISSUES

### ⚠️ ISSUE #14: Missing Integration Tests for Triad Pipeline
**Severity:** HIGH  
**Status:** 🔴 TEST COVERAGE  
**Impact:** Risk of regressions in core feature

**Problem:**
- Triad pipeline is core feature (Claude → GPT-5 → Gemini)
- Only infrastructure tests exist (phase-c-infrastructure.js)
- No end-to-end tests for full pipeline
- No tests for error paths or retry logic

**Remedy Steps:**
1. Create test suite for triad pipeline
2. Add tests for each stage (strategist, planner, enricher)
3. Test error handling and retry logic
4. Add integration test for full /api/blocks flow

**Verification Checklist:**
- [ ] Test suite created
- [ ] Happy path tested end-to-end
- [ ] Error paths tested
- [ ] Retry logic tested
- [ ] Test coverage > 80% for triad code

---

### ⚠️ ISSUE #15: Undocumented Environment Variables
**Severity:** MEDIUM  
**Status:** 🟡 DOCUMENTATION  
**Impact:** Deployment issues, configuration errors

**Problem:**
- `.env.example` exists but may be incomplete
- Environment variables used in code not documented
- No validation of required env vars on startup

**Remedy Steps:**
1. Audit all `process.env.*` usage across codebase
2. Update `.env.example` with all variables
3. Add startup validation for required env vars
4. Document default values and fallback behavior

**Verification Checklist:**
- [ ] All env vars documented in .env.example
- [ ] Startup validation added
- [ ] Deployment docs updated
- [ ] No undocumented env vars in codebase

---

## 📋 FIX TRACKING TEMPLATE

Use this template when fixing issues:

```markdown
### Fix Applied: [ISSUE #X]
**Date:** YYYY-MM-DD
**Applied By:** [Name/Agent]
**Files Changed:**
- path/to/file1.js
- path/to/file2.js

**Changes Made:**
1. [Specific change 1]
2. [Specific change 2]

**Verification:**
- [ ] Manual test passed
- [ ] Automated test passed
- [ ] Logs reviewed - no errors
- [ ] Peer review completed

**Evidence:**
[Paste relevant logs, test output, or screenshots]

**Status:** ✅ VERIFIED / ⚠️ PARTIAL / ❌ FAILED
```

---

## 🎯 PRIORITY FIX ORDER

**Immediate (Today):**
1. ISSUE #1 - Missing crypto import (CRITICAL - blocks functionality)
2. ISSUE #2 - Missing strategies import (HIGH - hidden dependency)

**Short Term (This Week):**
3. ISSUE #6 - Database indexes (performance)
4. ISSUE #8 - Race condition in strategy generation
5. ISSUE #12 - Circuit breakers for APIs

**Medium Term (Next Sprint):**
6. ISSUE #7 - FK cascade behavior
7. ISSUE #9 - Error handling standardization
8. ISSUE #10 - Request validation middleware
9. ISSUE #11 - Background task monitoring

**Long Term (Ongoing):**
10. ISSUE #3 - Import style consistency
11. ISSUE #4 - Validation function unification
12. ISSUE #5 - User ID validation
13. ISSUE #13 - Memory leak prevention
14. ISSUE #14 - Integration test coverage
15. ISSUE #15 - Environment variable documentation

---

## 🔍 VERIFICATION PROTOCOL

For each fix, follow this protocol:

1. **Pre-Fix Verification:**
   - Reproduce the issue
   - Document current behavior
   - Identify affected code paths

2. **Apply Fix:**
   - Make code changes
   - Update tests
   - Update documentation

3. **Post-Fix Verification:**
   - Run automated tests
   - Manual testing of affected features
   - Check logs for errors
   - Monitor metrics (if applicable)

4. **Sign-Off:**
   - Human review required (no agent-only fixes)
   - Update this document with fix status
   - Close associated GitHub issue (if applicable)

---

**Last Human Verification:** Never (Document just created)  
**Next Review Date:** 2025-10-07  
**Issues Resolved:** 0/15  
**Issues In Progress:** 0/15  
**Issues Blocked:** 0/15
