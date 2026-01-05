# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

---

## How to Use This File

1. Review each flagged item below
2. Check if the referenced doc needs updating
3. Update the doc if needed
4. Change status from `PENDING` to `REVIEWED`
5. Extract rules to `../reviewed-queue/RULES_FROM_COMPLETED_WORK.md`
6. Delete completed items from this file

## Status Legend

| Status | Meaning |
|--------|---------|
| `PENDING` | Needs review |
| `REVIEWED` | Done - extract rules, then delete |
| `DEFERRED` | Will review later |

---

## 2026-01-05 Codebase Audit Findings

**Health Score: 92/100 (Excellent)**

### Security Issues

| Issue | Severity | Status |
|-------|----------|--------|
| JWT_SECRET fallback mismatch (auth.js vs location.js) | HIGH | FIXED |
| `qs` npm package vulnerability | HIGH | FIXED |
| `esbuild` vulnerabilities (via drizzle-kit) | MODERATE | FIXED (npm override) |
| `resolveVenueAddressString` deprecated (no callers) | LOW | REMOVED |

### Confirmed Working

- Venue Consolidation (venue_catalog unified)
- Highlander Session Model (one session per user)
- PostgreSQL Advisory Locks (horizontal scaling ready)
- Gemini 3 adapter upgraded (@google/genai SDK)
- Timezone-aware event filtering
- BarsTable trusts server's isOpen calculation
- Event deduplication (similar name/address/time grouping)

---

## Currently Pending

### High Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/database-schema.md` | New tables: `us_market_cities`, `market_intel` | PENDING |
| `docs/preflight/database.md` | New tables need documentation | PENDING |
| `docs/architecture/auth-system.md` | Auth changes (CASCADE fix, JWT consistency) | PENDING |

### Medium Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/api-reference.md` | New endpoints: `/for-location`, `/markets-dropdown`, `/add-market` | PENDING |
| `docs/preflight/location.md` | Venue enrichment changes (500m radius, district tagging) | PENDING |

### Low Priority (Deferred)

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/client-structure.md` | Minor component changes | DEFERRED |
| `docs/architecture/server-structure.md` | Background job changes | DEFERRED |

---

## Recently Completed (Move to reviewed-queue)

> **Note:** Items below are complete. Extract rules to `../reviewed-queue/RULES_FROM_COMPLETED_WORK.md` then delete.

*No items pending cleanup.*

## 2026-01-05 Analysis

**Generated:** 2026-01-05T22:40:59.834Z
**Branch:** main
**Last Commit:** 95bd2b6 Cleanup: Fix all npm vulnerabilities and remove dead code

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `riefing-last-row.txt` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |

### Recent Commit Changes (13)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `scripts/test-event-dedup.js` | Added |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/venue/venue-address-resolver.js` | Modified |
| `server/lib/venue/venue-enrichment.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)

#### Medium Priority
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-address-resolver.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/test-event-dedup.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T23:10:45.886Z
**Branch:** main
**Last Commit:** a8ad8ea Fix: Haiku model 404 and events endpoint deduplication

### Uncommitted Changes (4)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `briefing-last-row.txt` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (20)
| File | Status |
|------|--------|
| `client/src/components/CoachChat.tsx` | Modified |
| `docs/architecture/ai-coach.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `scripts/test-event-dedup.js` | Added |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/chat/chat.js` | Modified |
| `server/api/coach/index.js` | Added |
| `server/api/coach/notes.js` | Added |
| `server/api/coach/schema.js` | Added |
| `server/api/coach/validate.js` | Added |
| `server/api/location/location.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/venue/venue-address-resolver.js` | Modified |
| `tests/coach-schema.test.js` | Added |
| `tests/coach-validation.test.js` | Added |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-address-resolver.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/test-event-dedup.js)
- [ ] Consider adding documentation - New file added (tests/coach-schema.test.js)
- [ ] Consider adding documentation - New file added (tests/coach-validation.test.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T23:24:29.041Z
**Branch:** main
**Last Commit:** a8ad8ea Fix: Haiku model 404 and events endpoint deduplication

### Uncommitted Changes (5)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.replit` | Modified |
| `briefing-last-row.txt` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (20)
| File | Status |
|------|--------|
| `client/src/components/CoachChat.tsx` | Modified |
| `docs/architecture/ai-coach.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `scripts/test-event-dedup.js` | Added |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/chat/chat.js` | Modified |
| `server/api/coach/index.js` | Added |
| `server/api/coach/notes.js` | Added |
| `server/api/coach/schema.js` | Added |
| `server/api/coach/validate.js` | Added |
| `server/api/location/location.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/venue/venue-address-resolver.js` | Modified |
| `tests/coach-schema.test.js` | Added |
| `tests/coach-validation.test.js` | Added |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-address-resolver.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/test-event-dedup.js)
- [ ] Consider adding documentation - New file added (tests/coach-schema.test.js)
- [ ] Consider adding documentation - New file added (tests/coach-validation.test.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T23:34:38.069Z
**Branch:** main
**Last Commit:** 8706d13 CRITICAL: Fix destructive cascade deletes + add SECURITY.md

### Uncommitted Changes (4)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `briefing-last-row.txt` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (22)
| File | Status |
|------|--------|
| `.replit` | Modified |
| `SECURITY.md` | Added |
| `client/src/components/CoachChat.tsx` | Modified |
| `docs/architecture/ai-coach.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `scripts/test-event-dedup.js` | Added |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/chat/chat.js` | Modified |
| `server/api/coach/index.js` | Added |
| `server/api/coach/notes.js` | Added |
| `server/api/coach/schema.js` | Added |
| `server/api/coach/validate.js` | Added |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/venue/venue-address-resolver.js` | Modified |
| `shared/schema.js` | Modified |
| ... and 2 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-address-resolver.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/test-event-dedup.js)
- [ ] Consider adding documentation - New file added (tests/coach-schema.test.js)
- [ ] Consider adding documentation - New file added (tests/coach-validation.test.js)

### Status: PENDING

---

---
