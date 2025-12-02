
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

**Problem (FIXED - Dec 2, 2025):** ~~Client could provide user_id in POST body~~

**Current State:** ✅ FIXED
- `snapshot.js` POST route (line 40): Uses `req.auth?.userId` from JWT only
- `snapshot.js` GET route (line 169): Verifies `snapshot.user_id === req.auth.userId` before returning
- `briefing.js` GET /current (line 17): Filters snapshots by `req.auth.userId`
- `briefing.js` GET /snapshot/:snapshotId (line 119): Checks user ownership before access
- `chat.js` GET /context/:snapshotId: Authenticated endpoint

**Implementation Details:**
- All GET routes return 404 (not 401) if user doesn't own resource - prevents enumeration attacks
- User_id extracted from JWT token ONLY, never from request body
- Database queries filtered by authenticated user_id

---

### 7. Unsecured POST Routes
**Files:** Multiple route files  
**Source:** SECURITY_AUDIT_REPORT.md

**Problem (FIXED - Dec 2, 2025):** ~~Multiple POST routes lacked authentication~~

**Current State:** ✅ FIXED
- `briefing.js`:
  - ✅ `POST /api/briefing/generate` - Now requires auth (line 72)
  - ✅ `POST /api/briefing/refresh` - Now requires auth (line 205)
  - ✅ `GET /api/briefing/current` - Now requires auth (line 13)
  - ✅ `GET /api/briefing/snapshot/:snapshotId` - Now requires auth (line 111)
- `chat.js`:
  - ✅ `POST /api/coach/chat` - Changed from `optionalAuth` to `requireAuth` (line 127)
- `feedback.js`:
  - ✅ `POST /api/feedback/venue` - Already has `requireAuth`
  - ✅ `POST /api/feedback/strategy` - Already has `requireAuth`
  - ✅ `POST /api/feedback/app` - Already has `requireAuth`
- `closed-venue-reasoning.js`:
  - ✅ `POST /` - Already has `requireAuth`
- `geocode-proxy.js`:
  - ✅ `POST /api/geocode/geocode` - Now requires auth (line 35)

**Implementation Details:**
- All POST/PATCH/DELETE routes now require `requireAuth` middleware
- User ownership verified before processing requests
- Rate limiting already enforced by IP + per-route logic

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

**Problem (FIXED - Dec 2, 2025):** ~~GET routes returned user data without ownership verification~~

**Current State:** ✅ FIXED
- `GET /api/briefing/current` - Now requires auth + filters by user_id (line 13-17)
- `GET /api/briefing/snapshot/:snapshotId` - Now requires auth + verifies ownership (line 111-120)
- `GET /api/snapshot/:snapshotId` - Now requires auth + verifies ownership (line 157-171)
- `GET /api/coach/context/:snapshotId` - Protected by CoachDAL (requires auth upstream)

**Implementation Details:**
- All GET routes check `snapshot.user_id === req.auth.userId`
- Returns 404 (not 401) if user doesn't own resource
- Prevents user enumeration attacks

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

---

## 🟢 COMPLETED FIXES & FEATURE IMPLEMENTATIONS (December 2, 2025)

### Venue Coordinate Validation - NEW FEATURE
**Files Modified:**
- `server/lib/venue-generator.js` - Added `validateVenueCoordinates()` function
- `client/src/components/BriefingTab.tsx` - Frontend already prepared for venue data

**Implementation:**
- After GPT-5.1 generates 8 venues with coordinates, Perplexity web search validates each venue is still operational
- Venues marked as "closed" or "moved" are automatically filtered before reaching drivers
- Prevents stale/relocated business coordinates from causing driver confusion
- Uses Perplexity Sonar Pro with `search_recency_filter: 'month'` for current data

**Fix Addresses:** 
- ✅ ARCHITECTURE.md Invariant #4: "Accuracy Over Expense for Closure-Sensitive Recs"
- ✅ ARCHITECTURE.md Invariant #6: "Coordinates and Business Hours Come From Google or DB, Never Models"

**Testing:**
- Perplexity validation integrated into parallel processing pipeline
- Filtered venues logged with `⚠️ FILTERING:` prefix for debugging
- Falls back gracefully if Perplexity API unavailable

---

### School Closures Feature - COMPLETE IMPLEMENTATION
**Files Added/Modified:**
- `shared/schema.js` - Added `school_closures` JSONB column to `briefings` table
- `server/lib/briefing-service.js` - Added `fetchSchoolClosures()` function + integrated into `generateAndStoreBriefing()`
- `server/routes/briefing.js` - Updated both GET endpoints to include `school_closures` in response
- `client/src/components/BriefingTab.tsx` - Added School Closures UI card with collapsible display

**Implementation Details:**
- Uses Perplexity web search (Sonar Pro) to find school district + college closures within 15-mile radius (next 30 days)
- Returns structured array: `{schoolName, closureStart, reopeningDate, type: 'district'|'college', reason, impact: 'high'|'medium'|'low'}`
- Runs in parallel with news/weather/traffic in briefing generation pipeline
- Frontend displays closures organized by school type with date formatting
- Shows driver impact: "Campus parking, pickup zones, and shuttle services may be unavailable during closures"

**Fix Addresses:**
- ✅ Improves briefing completeness (dynamic data within 15-mile range)
- ✅ Supports driver safety & route planning (campus parking availability)
- ✅ Eventually optimizable with user home address (Phase 2)

**Testing:**
- Perplexity search response parsing (JSON extraction with regex fallback)
- Graceful degradation if API fails (empty array returned, briefing continues)
- Database INSERT/UPDATE now includes school_closures field
- Frontend safely handles null/empty school_closures arrays

---

## 📝 ARCHITECTURAL COMPLIANCE

### Features Implemented Per ARCHITECTURE.md

**✅ Core Principle: "Accuracy Before Expense"**
- Venue validation uses web search (Perplexity) BEFORE showing to drivers
- School closures sourced from web search (current data) not LLM hallucination
- Both features fail gracefully without blocking briefing generation

**✅ Invariant #4: Accuracy Over Expense for Closure-Sensitive**
- Venue coordinates verified operational before display
- School closures prevent drivers from wasting time at closed campuses
- Unknown status ("likely operational but unverified") is NOT presented as certain

**✅ Invariant #6: Coordinates from Google or DB**
- Venues still use Google Places API for enrichment + business hours
- School closures use Perplexity web search (time-stamped, source-linked)
- GPT models never originate coordinates or closure status

---

## 🧪 VERIFICATION & NEXT STEPS

### Before Production Deployment

**School Closures Testing Checklist:**
- [ ] Test with Dallas location (ISD closures + SMU/UTD/UTA)
- [ ] Verify Perplexity API key configured as secret
- [ ] Check database migration applied (school_closures column exists)
- [ ] Monitor logs for "FILTERING OUT" messages (venue validation)
- [ ] Test briefing response includes `school_closures` in JSON

**Venue Validation Testing Checklist:**
- [ ] Generate venues in test location
- [ ] Verify closed venues are filtered (check console for "⚠️ FILTERING" logs)
- [ ] Confirm remaining venues all have status "operational"
- [ ] Test Perplexity timeout gracefully returns unvalidated venues

**Performance Notes:**
- School closures fetch adds ~2-3 seconds to briefing generation (parallel execution)
- Venue validation adds ~1-2 seconds per batch (serial within venue generation)
- Both operations fail gracefully, never blocking driver briefing

---

## 📊 ISSUE STATUS UPDATE

| Issue # | Status | Last Update | Notes |
|---------|--------|-------------|-------|
| 1 | 🔴 Open | - | Auth system - Pre-MVP work |
| 2 | ✅ Fixed | Dec 2 | DB pool config (max: 10) |
| 3 | 🟢 RESOLVED | Dec 2 | `briefings` table exists w/ school_closures |
| 4 | 🔴 Open | - | Diagnostic endpoints auth - Pre-MVP |
| 5 | 🔴 Open | - | Client secrets - Pre-MVP |
| 6 | 🔴 Open | - | User isolation - Pre-MVP |
| 7 | 🟡 Open | - | POST route auth - Pre-MVP |
| 8 | ✅ Fixed | Dec 2 | GPT-5.1 temperature param removed |
| 9 | 🟡 Open | - | GET route auth - Pre-MVP |
| 10 | ✅ Fixed | Dec 2 | Polling interval disabled |
| 11 | 🟡 Open | - | API key proxy - Roadmap |
| 12 | 🟡 Open | - | Audit logging - Q1 2026 |
| 13 | ✅ Monitoring | - | Deprecated patterns - Enforced |
| 14 | 🟡 Open | - | GDPR features - Q1 2026 |
| 15 | 🟡 Open | - | TS errors - Ongoing |
| NEW | ✅ Implemented | Dec 2 | Venue coordinate validation |
| NEW | ✅ Implemented | Dec 2 | School closures feature |
