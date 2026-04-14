# Documentation Discrepancies Queue

**Status:** BLOCKING QUEUE
**Protocol:** Items here must be resolved within 24 hours
**Rule:** Trust CODE over DOCS when they contradict

> For resolved items and historical sections, see the [archive](reviewed-queue/DOC_DISCREPANCIES_ARCHIVE.md).

---

## How to Use This File

1. When you find docs that contradict code, add an entry below
2. Trust the CODE (not docs) until resolved
3. Fix the docs within 24 hours
4. Move the entry to the archive after fixing
5. Log the fix in `docs/reviewed-queue/CHANGES.md`

---

## Active Discrepancies

### PRODUCTION ENVIRONMENT (P0 — Broken Features)

| ID | Location | Issue | Resolution Needed | Status |
|----|----------|-------|-------------------|--------|
| D-092 | Replit Prod Secrets | `VECTO_AGENT_SECRET` not set — agent/system auth rejects ALL requests in production | Must be added as Replit Secret in the production deployment | PENDING |
| D-093 | Replit Prod Secrets | `TOKEN_ENCRYPTION_KEY` not set — Uber OAuth token encryption broken in production | Must be added as Replit Secret in the production deployment | PENDING |

### PRODUCTION RUNTIME (P0/P1 — Active Failures)

| ID | Location | Issue | Root Cause | Status |
|----|----------|-------|------------|--------|
| D-099 | Briefing pipeline | Event search `high_impact` timeout at 90s — returns empty | External API or query exceeds timeout; events silently dropped | PENDING |
| D-100 | `server/bootstrap/middleware.js` | Payload too large (3x consecutive 413s) | Client doesn't validate upload size pre-flight; user retries with no helpful error | PENDING |

### AI COACH (P1 — Remaining from 2026-03-18 Audit)

| ID | Location | Issue | Impact | Status |
|----|----------|-------|--------|--------|
| COACH-H7 | `server/api/chat/chat.js`, `model-registry.js` | No streaming fallback — Gemini outage kills the coach entirely | Coach completely unavailable during any Gemini outage | PENDING |
| COACH-H8 | `server/api/chat/chat.js:1325-1345` | Conversation message saves are fire-and-forget with try/catch that swallows errors | Silent memory loss — coach forgets conversations | PENDING |

### CONCIERGE — Security (P1)

| ID | Location | Issue | Status |
|----|----------|-------|--------|
| CH-5 | `server/lib/concierge/concierge-service.js` | findOrCreateVenue() can't persist Gemini-discovered venues — missing coordinates | PENDING |

### CONCIERGE — Medium (P2)

| ID | Location | Issue | Status |
|----|----------|-------|--------|
| CM-1 | `concierge-service.js` | Race condition in searchNearby() — duplicate Gemini calls for same location | PENDING |
| CM-2 | `concierge-service.js` | No spatial index on venue_catalog for lat/lng range queries | PENDING |
| CM-3 | `concierge.js` | No response.ok check on Google Weather API fetch | PENDING |
| CM-4 | `concierge.js` | No response.ok check on Google AQI API fetch | PENDING |
| CM-5 | `concierge.js` | Feedback endpoint allows unlimited submissions per token | PENDING |
| CM-6 | `concierge-service.js` | askConcierge() errors return generic message, no error logging | PENDING |
| CM-7 | `PublicConciergePage.tsx` | No error boundary — React crash shows blank screen | PENDING |
| CM-8 | `AskConcierge.tsx` | Chat history not persisted — refresh loses all messages | PENDING |
| CM-9 | `concierge-service.js` | buildConciergeSystemPrompt() has no max length check | PENDING |
| CM-10 | `concierge.js` | Weather and AQI fetched sequentially — could be parallelized | PENDING |
| CM-11 | `concierge-service.js` | Gemini venue search uses unbounded radius | PENDING |
| CM-12 | `ConciergeMap.tsx` | Google Maps script loaded without error handling | PENDING |
| CM-13 | `concierge.js` | getDriverPublicProfile called twice per protected request | PENDING |
| CM-14 | `concierge-service.js` | No timeout on Gemini explore/ask calls | PENDING |
| CM-15 | `PublicConciergePage.tsx` | Loading states don't show skeleton UI | PENDING |
| CM-16 | `concierge.js` | Share token generation has no collision check | PENDING |

### CONCIERGE — Low (P3)

| ID | Location | Issue | Status |
|----|----------|-------|--------|
| CL-1 | `PublicConciergePage.tsx` | No input sanitization on passenger question | PENDING |
| CL-2 | `AskConcierge.tsx` | Question input has no character limit in UI | PENDING |
| CL-3 | `concierge.js` | Feedback text field has no length limit | PENDING |
| CL-4 | `PublicConciergePage.tsx` | No offline detection for bad mobile connections | PENDING |
| CL-5 | `ConciergeMap.tsx` | Map markers don't cluster in dense areas | PENDING |
| CL-6 | `PublicConciergePage.tsx` | No dark mode support on public page | PENDING |
| CL-7 | `concierge-service.js` | Vehicle seatbelts field exposed without context | PENDING |
| CL-8 | `AskConcierge.tsx` | No typing indicator while waiting for Gemini | PENDING |
| CL-9 | `concierge.js` | Rate limiter messages not localized | PENDING |
| CL-10 | `PublicConciergePage.tsx` | Page title is generic — should show driver name | PENDING |
| CL-11 | `ConciergeMap.tsx` | No "recenter" button when passenger scrolls map | PENDING |
| CL-12 | `concierge-service.js` | searchNearby() hardcodes 5km radius | PENDING |

---

## Known Technical Debt

| ID | Area | Issue | Current State | Future Recommendation |
|----|------|-------|---------------|----------------------|
| ARCH-001 | Session Architecture | Users table used for sessions with `onDelete: 'restrict'` | Intentional — prevents data loss (2026-01-05) | Split into separate `sessions` table |
| ARCH-002 | Async Waterfall | `blocks-fast.js` runs strategy generation synchronously (~35-50s) | HTTP request holds connection open | Use 202 Accepted + poll/SSE |

---

## Deferred (By Design)

These items were reviewed and intentionally left open with documented rationale.

| ID | Location | Reason |
|----|----------|--------|
| D-052 | `coach_conversations` schema | Missing 8 columns — table already documented in D-037; low usage |
| D-053 | `driver_profiles` schema | Missing 10+ columns — low usage |
| D-054 | `auth_credentials` schema | Missing 5 security columns — low usage |
| D-060 | FK `onDelete` behaviors | Requires full schema audit pass |
| D-071 | SSE endpoints no auth | By design — EventSource API can't send auth headers |
| D-072 | Health endpoints no auth | By design — standard for monitoring |
| D-073 | Job metrics no auth | By design — standard for monitoring |
| D-074 | Platform endpoints no auth | By design — public reference data |
| D-075 | Vehicle endpoints no auth | By design — public NHTSA reference data |
| D-076 | Hooks endpoints no auth | By design — public for Siri Shortcuts |

---

## Open Hardening Items

### Phase 2: Adapter-Only AI Calls
- [ ] Add CI check: no direct SDK calls outside adapters

### Phase 4: Schema Defect Resolution
- [ ] Run full schema validation against shared/schema.js
- [ ] Audit all column naming for semantic accuracy
- [ ] Generate fresh schema documentation

---

## Adding New Discrepancies

```markdown
| D-XXX | `file:line` | [Brief issue description] | [What the code actually does] | PENDING |
```

After fixing:
1. Change status to RESOLVED
2. Move to [archive](reviewed-queue/DOC_DISCREPANCIES_ARCHIVE.md) with date
3. Log in `docs/reviewed-queue/CHANGES.md`
