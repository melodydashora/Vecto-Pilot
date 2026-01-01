# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

---

## How to Use This File

1. Review each flagged item below
2. Check if the referenced doc needs updating
3. Update the doc if needed
4. Change status from `PENDING` to `REVIEWED`
5. Delete completed items to keep this file lean

## Status Legend

| Status | Meaning |
|--------|---------|
| `PENDING` | Needs review |
| `REVIEWED` | Reviewed, doc updated |
| `DEFERRED` | Will review later |

---

## Recent Updates (2026-01-01 - Zone Intelligence)

### Summary
Implemented **Zone Intelligence** feature - crowd-sourced market-specific learning from driver conversations.

### Changes Made

**Database (`shared/schema.js`):**
- Added `market_slug` column to `coach_conversations` table
- Created new `zone_intelligence` table with 6 indexes for cross-driver learning

**Server (`server/api/chat/chat.js`):**
- Added `[ZONE_INTEL: {...}]` action parsing
- Fixed `snapshotHistoryInfo is not defined` scope bug (variable moved to outer scope)
- Added zone intelligence context to AI Coach prompts
- Added `market_slug` to conversation persistence

**Data Layer (`server/lib/ai/coach-dal.js`):**
- Added `generateMarketSlug()` method
- Added `saveZoneIntelligence()` with cross-driver learning algorithm
- Added `getZoneIntelligence()` for querying zone data
- Added `getZoneIntelligenceSummary()` for AI prompts

### Documentation Updated
- ✅ `docs/architecture/database-schema.md` - Added zone_intelligence table
- ✅ `docs/architecture/api-reference.md` - Added AI Coach action parsing docs
- ✅ `LESSONS_LEARNED.md` - Added scope fix lesson

---

## Consolidated Review Queue (2026-01-01)

> This file was consolidated from 28 duplicate analysis entries (Dec 30 - Jan 1).
> The change analyzer script now excludes `.md` files to prevent recursive additions.

### High Priority

| Doc | Reason | Source Files | Status |
|-----|--------|--------------|--------|
| `docs/architecture/auth-system.md` | Authentication system changes | `server/api/auth/auth.js` | REVIEWED (already up to date) |
| `docs/architecture/api-reference.md` | Multiple API endpoint changes | `server/api/auth/auth.js`, `server/api/location/*.js`, `server/api/briefing/briefing.js` | REVIEWED (2026-01-01) |
| `docs/architecture/database-schema.md` | Schema table changes | `shared/schema.js` | REVIEWED (2026-01-01) |
| `docs/preflight/database.md` | Schema changes affect preflight | `shared/schema.js` | REVIEWED (no changes needed) |
| `docs/preflight/ai-models.md` | AI model/adapter changes | `server/lib/ai/coach-dal.js`, `server/lib/ai/providers/consolidator.js` | REVIEWED (no changes needed) |
| `docs/architecture/ai-pipeline.md` | AI pipeline changes | `server/lib/ai/coach-dal.js`, `server/lib/ai/providers/consolidator.js` | REVIEWED (no changes needed) |
| `docs/architecture/strategy-framework.md` | Strategy API changes | `server/api/strategy/blocks-fast.js` | REVIEWED (no changes needed) |

### Medium Priority

| Doc | Reason | Source Files | Status |
|-----|--------|--------------|--------|
| `docs/architecture/client-structure.md` | Component and context changes | `client/src/components/CoachChat.tsx`, `client/src/contexts/*.tsx` | DEFERRED (minor changes) |

### Low Priority

| Item | Reason | Status |
|------|--------|--------|
| `server/scripts/seed-countries.js` | New file - consider documenting | DEFERRED |

---

## Recently Completed (2025-12-30)

### Documentation Updates
- `docs/architecture/auth-system.md` - Documented two auth modes (Anonymous + Registered), noted /api/auth/token disabled in prod
- `docs/architecture/database-schema.md` - Updated strategies, briefings, ranking_candidates, feedback tables; added auth tables

### Code Fixes
- `client/src/contexts/location-context-clean.tsx` - Removed broken /api/auth/token call (was returning 403 in prod)
- `server/lib/ai/providers/consolidator.js` - Added 60s AbortController timeout to GPT-5.2 and Gemini calls

### Audited (No Changes Needed)
- `docs/preflight/location.md` - Code follows NO FALLBACKS pattern
- `docs/preflight/database.md` - Still accurate
- `server/lib/ai/coach-dal.js` - Well-designed, correct schema usage
- `server/lib/location/get-snapshot-context.js` - Follows NO FALLBACKS pattern

## 2026-01-01 Analysis

**Generated:** 2026-01-01T20:29:16.477Z
**Branch:** main
**Last Commit:** 562c0ce Published your App

### Uncommitted Changes (13)
| File | Status |
|------|--------|
| `LAUDE.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/jobs/change-analyzer-job.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/external/tomtom-traffic.js` | Modified |
| `todo.md` | Modified |
| `docs/review-queue/2026-01-01.md` | Untracked |

### Recent Commit Changes (42)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/auth/AuthRedirect.tsx` | Added |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Modified |
| `client/src/pages/auth/ResetPasswordPage.tsx` | Modified |
| `client/src/pages/auth/SignInPage.tsx` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `client/src/pages/auth/TermsPage.tsx` | Modified |
| `client/src/pages/co-pilot/README.md` | Modified |
| `client/src/pages/co-pilot/SettingsPage.tsx` | Added |
| `client/src/pages/co-pilot/index.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `client/src/types/auth.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| ... and 22 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/providers/consolidator.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/providers/consolidator.js)
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useBriefingQueries.ts)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)
- [ ] Consider adding documentation - New file added (server/scripts/seed-countries.js)

### Status: PENDING

---

## 2026-01-01 Analysis

**Generated:** 2026-01-01T21:23:35.605Z
**Branch:** main
**Last Commit:** ff38de9 Assistant checkpoint: Updated 4 documentation files to match current repo state

### Recent Commit Changes (53)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `UI_FILE_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/auth/AuthRedirect.tsx` | Added |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Modified |
| `client/src/pages/auth/ResetPasswordPage.tsx` | Modified |
| `client/src/pages/auth/SignInPage.tsx` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `client/src/pages/auth/TermsPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/README.md` | Modified |
| ... and 33 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)
- [ ] Consider adding documentation - New file added (server/scripts/seed-countries.js)

### Status: PENDING

---

## 2026-01-01 Analysis

**Generated:** 2026-01-01T21:25:54.594Z
**Branch:** main
**Last Commit:** ff38de9 Assistant checkpoint: Updated 4 documentation files to match current repo state

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `riefing-last-row.txt` | Modified |
| `docs/review-queue/2026-01-01.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (53)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `UI_FILE_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/auth/AuthRedirect.tsx` | Added |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Modified |
| `client/src/pages/auth/ResetPasswordPage.tsx` | Modified |
| `client/src/pages/auth/SignInPage.tsx` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `client/src/pages/auth/TermsPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/README.md` | Modified |
| ... and 33 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)
- [ ] Consider adding documentation - New file added (server/scripts/seed-countries.js)

### Status: PENDING

---

## 2026-01-01 Analysis

**Generated:** 2026-01-01T21:37:15.279Z
**Branch:** main
**Last Commit:** ff38de9 Assistant checkpoint: Updated 4 documentation files to match current repo state

### Uncommitted Changes (7)
| File | Status |
|------|--------|
| `riefing-last-row.txt` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/review-queue/2026-01-01.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/chat/chat.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `shared/schema.js` | Modified |

### Recent Commit Changes (53)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `UI_FILE_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/auth/AuthRedirect.tsx` | Added |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Modified |
| `client/src/pages/auth/ResetPasswordPage.tsx` | Modified |
| `client/src/pages/auth/SignInPage.tsx` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `client/src/pages/auth/TermsPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/README.md` | Modified |
| ... and 33 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/chat/chat.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)
- [ ] Consider adding documentation - New file added (server/scripts/seed-countries.js)

### Status: PENDING

---

## 2026-01-01 Analysis

**Generated:** 2026-01-01T21:43:05.518Z
**Branch:** main
**Last Commit:** 041b363 Assistant checkpoint

### Uncommitted Changes (4)
| File | Status |
|------|--------|
| `PICALL.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (31)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `UI_FILE_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/SettingsPage.tsx` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/auth-system.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/review-queue/2025-12-31.md` | Modified |
| `docs/review-queue/2026-01-01.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/chat/chat.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| ... and 11 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useBriefingQueries.ts)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)

### Status: PENDING

---

---
