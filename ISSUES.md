
# ISSUES.md - Vecto Pilot™ Codebase Issues

**Last Updated:** December 2, 2025  
**Status:** 🔴 CRITICAL ISSUES IDENTIFIED

---

## Executive Summary

This document catalogs identified issues in the Vecto Pilot codebase, categorized by severity and area. Issues are derived from:
- Security audit findings (SECURITY_AUDIT_REPORT.md)
- Architecture constraints violations (ARCHITECTURE.md)
- Production deployment logs (DEPLOYMENT_STATUS.md)
- Database schema analysis (shared/schema.js)

---

## 🔴 CRITICAL ISSUES (Production Blockers)

### 1. Authentication System Not Implemented
**File:** `server/middleware/auth.ts` (lines 4-6)  
**Source:** SECURITY_AUDIT_REPORT.md

**Problem:**
```typescript
function verifyAppToken(token: string) {
  // TODO: Implement proper JWT verification
  return { userId: 'user_' + Date.now() };  // ← RETURNS FAKE USER ID
}
```

**Impact:**
- Authentication bypass - any token (even invalid) authenticates as a different user
- Complete security compromise
- User data accessible to anyone

**Fix Required:**
- Implement proper JWT verification with signing key
- Store and validate JWT against secret key
- Add expiration checks
- Remove timestamp-based fake user ID generation

**References:**
- SECURITY_AUDIT_REPORT.md: "Critical Issue #1"
- ARCHITECTURE.md: "Security & Safety" section

---

### 2. Database Connection Pool Misconfiguration
**File:** `server/db/connection-manager.js` (lines 18-19)  
**Source:** DEPLOYMENT_STATUS.md

**Problem:**
Pool size was too high for Replit PostgreSQL environment, causing connection terminations.

**Current State:** ✅ FIXED (December 2, 2025)
```javascript
max: 10,  // Reduced from 35 (Replit Postgres optimal)
idleTimeoutMillis: 30000,  // Reduced from 60s
```

**Impact:**
- "Connection terminated unexpectedly" errors (before fix)
- Pool exhaustion under load
- Service degradation

**Verification:**
- DEPLOYMENT_STATUS.md confirms fix applied
- Monitor for connection errors in production

---

### 3. Missing `briefings` Table Schema
**File:** Database schema  
**Source:** DEPLOYMENT_STATUS.md console logs

**Problem:**
```
[consolidator] ❌ Error: Failed query: select "id", "snapshot_id", ... from "briefings"
```

**Impact:**
- Consolidator (GPT-5.1) fails to write tactical intelligence
- Strategy pipeline degrades to partial completion (strategist-only)
- Users don't receive traffic/closures/enforcement briefings

**Fix Required:**
1. Verify `briefings` table exists in shared/schema.js
2. Apply migration to production database
3. Ensure consolidator can write tactical sections

**Status:** ⚠️ BLOCKING PRODUCTION DEPLOYMENT

**References:**
- server/lib/providers/consolidator.js lines 85-95
- DEPLOYMENT_STATUS.md: "consolidator_failed" errors

---

### 4. Open Diagnostic Endpoints (No Authentication)
**File:** `server/routes/diagnostics.js`  
**Source:** SECURITY_AUDIT_REPORT.md

**Problem:**
These routes have NO authentication:
- `GET /api/diagnostics/` - System diagnostics
- `GET /api/diagnostics/db-data` - Raw database data
- `POST /api/diagnostics/migrate` - Database migrations
- `GET /api/diagnostics/worker-status` - Worker information
- `POST /api/diagnostics/test-consolidate/:snapshotId` - Test endpoint

**Impact:**
- Anyone can view database structure and contents
- Anyone can run database migrations
- Complete system compromise possible

**Fix Required:**
- Add `requireAuth` middleware to ALL diagnostic routes
- Move diagnostics to internal-only access
- Require admin role for dangerous operations (migrate)

---

### 5. Client-Side API Keys Exposed
**File:** `client/src/vite-env.d.ts`  
**Source:** SECURITY_AUDIT_REPORT.md

**Problem:**
```typescript
readonly VITE_UBER_CLIENT_SECRET: string;      // ← SECRET EXPOSED!
readonly VITE_LYFT_CLIENT_SECRET: string;      // ← SECRET EXPOSED!
readonly VITE_BOLT_CLIENT_SECRET: string;      // ← SECRET EXPOSED!
```

**Impact:**
- Secrets accessible in browser DevTools
- OAuth hijacking via secret keys
- Unauthorized API calls on behalf of your app

**Fix Required:**
- NEVER expose `*_SECRET` keys to frontend
- Keep secrets server-side only
- Use backend proxy for OAuth flows
- Client should only have CLIENT_ID (if needed)

---

## 🟡 HIGH PRIORITY ISSUES

### 6. No User-Data Isolation
**File:** `server/routes/snapshot.js` (lines 30-108)  
**Source:** SECURITY_AUDIT_REPORT.md

**Problem:**
```javascript
router.post("/", async (req, res) => {
  // ... 
  user_id: snap.user_id || uuid(),  // ← Uses CLIENT-PROVIDED user_id!
  device_id: snap.device_id || uuid(),
  // ...
});
```

**Impact:**
- Client can create snapshots with any user_id
- User A can access/modify User B's snapshots
- No verification that authenticated user owns snapshot

**Fix Required:**
- Extract `user_id` from JWT token (`req.auth.userId`), NOT from request body
- Add user_id filter to all queries:
  ```sql
  WHERE snapshots.user_id = req.auth.userId
  ```
- Never trust client-provided user_id

---

### 7. Unsecured POST Routes
**Files:** Multiple route files  
**Source:** SECURITY_AUDIT_REPORT.md

**Routes WITHOUT authentication:**
- `server/routes/briefing.js`:
  - `POST /api/briefing/generate`
  - `POST /api/briefing/refresh`
- `server/routes/chat.js`:
  - `POST /api/coach/chat`
- `server/routes/feedback.js`:
  - `POST /api/feedback/venue`
  - `POST /api/feedback/strategy`
  - `POST /api/feedback/app`
- `server/routes/closed-venue-reasoning.js`:
  - `POST /`
- `server/routes/geocode-proxy.js`:
  - `POST /api/geocode/geocode`

**Impact:**
- Spam/abuse of briefing generation (cost)
- Feedback manipulation
- Resource exhaustion

**Fix Required:**
- Add `requireAuth` middleware to all POST/PATCH/DELETE routes
- Validate that `req.auth.userId` matches requesting user
- Rate-limit by user

---

### 8. GPT-5.1 Model Integration Issues
**Files:** Multiple adapter files  
**Source:** DEPLOYMENT_STATUS.md

**Problem:**
GPT-5.1 API rejects `temperature` parameter, causing consolidator failures.

**Current State:** ✅ FIXED (December 2, 2025)

**Files Updated:**
- `server/lib/adapters/index.js`
- `server/lib/adapters/openai-adapter.js`
- `server/lib/adapters/openai-gpt5.js`
- `server/lib/models-dictionary.js`

**Fix Applied:**
- Removed `temperature` for GPT-5.1 models
- Use only `reasoning_effort` parameter
- Updated model ID to `gpt-5.1-2025-11-13`

**Verification Needed:**
- Monitor consolidator success rate post-deployment
- Ensure no "Unsupported value: 'temperature'" errors

---

## 🟠 MEDIUM PRIORITY ISSUES

### 9. Missing Auth Checks on GET Routes
**Files:** Multiple route files  
**Source:** SECURITY_AUDIT_REPORT.md

**Routes returning user data without verification:**
- `GET /api/briefing/current` - Returns latest snapshot (ANY user's)
- `GET /api/briefing/snapshot/:snapshotId` - Returns ANY snapshot
- `GET /api/coach/context/:snapshotId` - Returns coach context for ANY snapshot
- `GET /api/strategy/:snapshotId` - Returns strategy for ANY snapshot

**Fix Required:**
- Add user_id filter: verify `snapshot.user_id === req.auth.userId`
- Return 404 (not 401) if user doesn't own resource (prevents enumeration)

---

### 10. Production Traffic Spike (Excessive Polling)
**File:** `client/src/components/GlobalHeader.tsx` (line 70)  
**Source:** DEPLOYMENT_STATUS.md

**Problem:**
Aggressive polling caused 1,643 requests in 6 hours to `/api/users/me`.

**Current State:** ✅ FIXED (December 2, 2025)
```javascript
refetchInterval: false  // Disabled 2-second polling
```

**Impact (before fix):**
- Excessive API load
- Database connection pressure
- Potential rate limiting triggers

**Verification:**
- Monitor `/api/users/me` request rate
- Should be ~30-50 requests per 6 hours (manual refreshes only)

---

### 11. API Keys in Client-Side Code
**Files:** `client/src/hooks/use-geolocation.tsx`, `client/src/utils/getGeoPosition.ts`  
**Source:** SECURITY_AUDIT_REPORT.md

**Problem:**
```typescript
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
// Used in fetch: `?key=${GOOGLE_API_KEY}`
```

**Impact:**
- Google Maps API key visible in network requests
- Key restrictions must be configured in Google Cloud
- Potential quota abuse

**Fix Required:**
- Route Google Maps requests through backend proxy
- Backend calls Google with server API key (IP-restricted)
- Frontend talks to `/api/maps/...` endpoints

---

### 12. No Audit Logging for Sensitive Operations
**Status:** NOT IMPLEMENTED  
**Source:** ARCHITECTURE.md "Forward Pressure" section

**Missing:**
- Spec-compliant single-line audit format
- Required fields logging
- Dedicated audit log file

**Impact:**
- No forensic capability for security incidents
- Compliance gaps (GDPR, SOC 2)
- Debugging difficulty for production issues

**Fix Required:**
- Implement audit logging per spec in ARCHITECTURE.md
- Log all sensitive operations (auth, data access, strategy generation)
- Store in dedicated audit log file with rotation

---

## 🔵 LOW PRIORITY / TECHNICAL DEBT

### 13. Deprecated Code Patterns
**Source:** ARCHITECTURE.md "Backward Pressure"

**Deprecated patterns still in use:**
- ~~React.StrictMode in production~~ (✅ REMOVED Oct 7, 2025)
- ~~Global JSON body parsing~~ (✅ REMOVED Oct 7, 2025)
- ~~Multi-model router with fallback~~ (✅ REPLACED Oct 8, 2025)

**Verify removal:**
- Check that React.StrictMode is not re-introduced
- Ensure per-route JSON parsing remains in place
- Confirm Triad single-path architecture is enforced

---

### 14. Missing Compliance Features
**Source:** SECURITY_AUDIT_REPORT.md

**GDPR/CCPA Gaps:**
- No user consent verification mechanism
- No user data deletion capability
- No user data export mechanism

**Fix Required:**
- Implement user data export API
- Add user account deletion flow
- Add consent tracking and management

---

### 15. TypeScript Errors in Production Build
**Source:** scripts/typescript-error-counter.js

**Categories of errors:**
- Missing Modules
- Type Mismatches
- Form/Hook Issues
- Import Errors
- Property Missing

**Impact:**
- Build warnings (non-blocking currently)
- Potential runtime errors
- Development velocity reduction

**Fix Required:**
- Run `node scripts/typescript-error-counter.js` to get current count
- Prioritize by category
- Fix systematically to achieve clean build

---

## 📋 VERIFICATION CHECKLIST

Before production deployment, verify:

- [ ] Authentication system implemented (JWT verification)
- [ ] Diagnostic endpoints secured with `requireAuth`
- [ ] Client-side secrets removed from environment variables
- [ ] User-data isolation implemented (user_id from JWT only)
- [ ] All POST/PATCH/DELETE routes have authentication
- [ ] GET routes verify user ownership of resources
- [ ] `briefings` table schema exists and migration applied
- [ ] Database connection pool settings verified (max: 10)
- [ ] GPT-5.1 model integration tested (no temperature parameter)
- [ ] Traffic spike monitoring in place
- [ ] Audit logging implemented
- [ ] Compliance features roadmapped

---

## 🔧 ISSUE TRACKING

| Issue # | Severity | Status | Assigned | Target |
|---------|----------|--------|----------|--------|
| 1 | 🔴 Critical | Open | - | Before launch |
| 2 | 🔴 Critical | ✅ Fixed | - | Dec 2, 2025 |
| 3 | 🔴 Critical | Open | - | Before launch |
| 4 | 🔴 Critical | Open | - | Before launch |
| 5 | 🔴 Critical | Open | - | Before launch |
| 6 | 🟡 High | Open | - | Before launch |
| 7 | 🟡 High | Open | - | Before launch |
| 8 | 🟡 High | ✅ Fixed | - | Dec 2, 2025 |
| 9 | 🟠 Medium | Open | - | Post-launch |
| 10 | 🟠 Medium | ✅ Fixed | - | Dec 2, 2025 |
| 11 | 🟠 Medium | Open | - | Post-launch |
| 12 | 🟠 Medium | Open | - | Q1 2026 |
| 13 | 🔵 Low | Monitoring | - | Ongoing |
| 14 | 🔵 Low | Open | - | Q1 2026 |
| 15 | 🔵 Low | Open | - | Q2 2026 |

---

## 📚 REFERENCES

- **SECURITY_AUDIT_REPORT.md** - Security vulnerabilities and authentication gaps
- **ARCHITECTURE.md** - Architectural constraints and decisions
- **DEPLOYMENT_STATUS.md** - Production deployment fixes and verification
- **shared/schema.js** - Database schema definitions

---

**Next Review:** After critical issues (#1, #3, #4, #5, #6, #7) are resolved  
**Status:** Ready for systematic remediation
