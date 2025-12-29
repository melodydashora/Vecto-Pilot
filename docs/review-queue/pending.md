# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

---

## How to Use This File

1. Review each flagged item below
2. Check if the referenced doc needs updating
3. Update the doc if needed
4. Change status from `PENDING` to `REVIEWED`
5. Optionally move to `resolved.md`

## Status Legend

| Status | Meaning |
|--------|---------|
| `PENDING` | Needs review |
| `REVIEWED` | Reviewed, doc updated |
| `REVIEWED - No change` | Reviewed, no update needed |
| `DEFERRED` | Will review later |

---

## 2025-12-28 Session: Map Features

**Session Date:** 2025-12-28
**Branch:** main
**Status:** REVIEWED

### Changes Implemented

- [x] Bar markers on map (green=open, red=closing soon)
- [x] Multi-day event support (date range filtering)
- [x] SmartBlocks two-pass filtering (Grade A/B, spacing preferred)
- [x] Package lockfile regenerated

### Documentation Updated

- [x] `docs/memory/sessions/2025-12-28-map-features.md` - Full session notes
- [x] `client/src/components/README.md` - MapTab bar markers docs
- [x] `docs/review-queue/2025-12-28.md` - Clean analysis

### Pending Action (User)

Database migration fix required:
```sql
-- Run in Supabase SQL Editor (Dev database)
DROP INDEX IF EXISTS idx_events_dedupe;
CREATE UNIQUE INDEX idx_events_dedupe ON events_facts USING btree (
  COALESCE(venue_place_id, ''::text),
  lower(event_title),
  start_time,
  end_time
);
```

---

## 2025-12-27 Session: Router Refactor

**Session Date:** 2025-12-27
**Branch:** copilot/improve-slow-code-efficiency
**Status:** REVIEWED

### Major Refactor: React Router Implementation

Refactored the monolithic co-pilot.tsx (1700+ lines) into a router-based architecture.

#### Files Created
- [x] `client/src/routes.tsx` - React Router configuration
- [x] `client/src/layouts/CoPilotLayout.tsx` - Shared layout with conditional GlobalHeader
- [x] `client/src/contexts/co-pilot-context.tsx` - Centralized state for all pages
- [x] `client/src/pages/co-pilot/StrategyPage.tsx` - Main strategy page
- [x] `client/src/pages/co-pilot/BarsPage.tsx` - Venue listings
- [x] `client/src/pages/co-pilot/BriefingPage.tsx` - Weather, traffic, news
- [x] `client/src/pages/co-pilot/MapPage.tsx` - Interactive map
- [x] `client/src/pages/co-pilot/IntelPage.tsx` - Rideshare intel
- [x] `client/src/pages/co-pilot/AboutPage.tsx` - About/donation (no header)

#### Route Structure
```
/                         → Redirects to /co-pilot/strategy
/co-pilot                 → Redirects to /co-pilot/strategy
/co-pilot/strategy        → StrategyPage (AI + blocks + coach)
/co-pilot/bars            → BarsPage (venue listings)
/co-pilot/briefing        → BriefingPage (weather, traffic, news)
/co-pilot/map             → MapPage (interactive map)
/co-pilot/intel           → IntelPage (rideshare intel)
/co-pilot/about           → AboutPage (no GlobalHeader)
```

---

## High Priority Items (Deferred)

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/database-schema.md` | Schema changes | DEFERRED |
| `docs/preflight/database.md` | Schema changes | DEFERRED |
| `docs/architecture/client-structure.md` | Router refactor | DEFERRED |

## 2025-12-28 Analysis

**Generated:** 2025-12-28T03:04:53.219Z
**Branch:** main
**Last Commit:** 09c20d8 fix: Allow briefing queries as soon as snapshot exists

### Recent Commit Changes (3)
| File | Status |
|------|--------|
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `package-lock.json` | Modified |

### Documentation Review Needed

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T03:08:40.021Z
**Branch:** main
**Last Commit:** 09c20d8 fix: Allow briefing queries as soon as snapshot exists

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `lient/src/hooks/useBriefingQueries.ts` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (3)
| File | Status |
|------|--------|
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `package-lock.json` | Modified |

### Documentation Review Needed

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T03:09:21.271Z
**Branch:** main
**Last Commit:** 09c20d8 fix: Allow briefing queries as soon as snapshot exists

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `lient/src/hooks/useBriefingQueries.ts` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (3)
| File | Status |
|------|--------|
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `package-lock.json` | Modified |

### Documentation Review Needed

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T03:10:14.795Z
**Branch:** main
**Last Commit:** 4a857af fix: Add smart retry logic for briefing data placeholders

### Uncommitted Changes (2)
| File | Status |
|------|--------|
| `ocs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (3)
| File | Status |
|------|--------|
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `package-lock.json` | Added |

### Documentation Review Needed

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)

#### Low Priority
- [ ] Consider adding documentation - New file added (package-lock.json)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T03:14:09.544Z
**Branch:** main
**Last Commit:** fb3683f fix: Add retry count limit to prevent infinite polling

### Uncommitted Changes (2)
| File | Status |
|------|--------|
| `ocs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (2)
| File | Status |
|------|--------|
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |

### Documentation Review Needed

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T15:09:24.318Z
**Branch:** main
**Last Commit:** 5c2f35a Assistant checkpoint

### Uncommitted Changes (4)
| File | Status |
|------|--------|
| `lient/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Untracked |

### Recent Commit Changes (24)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `MODEL.md` | Modified |
| `PRODISSUES.md` | Added |
| `docs/ai-tools/README.md` | Modified |
| `docs/ai-tools/mcp.md` | Deleted |
| `docs/preflight/ai-models.md` | Modified |
| `server/api/README.md` | Modified |
| `server/api/mcp/README.md` | Deleted |
| `server/api/mcp/mcp.js` | Deleted |
| `server/bootstrap/middleware.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/eidolon/README.md` | Modified |
| `server/eidolon/config.ts` | Modified |
| `server/eidolon/index.ts` | Modified |
| `server/eidolon/tools/README.md` | Modified |
| `server/eidolon/tools/mcp-diagnostics.js` | Deleted |
| `server/lib/README.md` | Modified |
| `server/lib/ai/README.md` | Modified |
| ... and 4 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/README.md)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/README.md)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/README.md)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/README.md)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)

#### Medium Priority
- [ ] `docs/ai-tools/eidolon.md` - Eidolon SDK changes (server/eidolon/README.md)
- [ ] `server/eidolon/README.md` - Eidolon SDK changes (server/eidolon/README.md)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T15:15:00.970Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/README.md)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T15:44:47.630Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (7)
| File | Status |
|------|--------|
| `ocs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `migrations/20251228_drop_snapshot_user_device.sql` | Untracked |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/README.md)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T17:52:53.523Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (22)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| `client/src/contexts/auth-context.tsx` | Untracked |
| `client/src/pages/auth/` | Untracked |
| `client/src/types/auth.ts` | Untracked |
| `migrations/20251228_auth_system_tables.sql` | Untracked |
| `migrations/20251228_drop_snapshot_user_device.sql` | Untracked |
| ... and 2 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/auth/)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T18:48:27.159Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (24)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| `client/src/contexts/auth-context.tsx` | Untracked |
| `client/src/pages/auth/` | Untracked |
| `client/src/types/auth.ts` | Untracked |
| `docs/architecture/authentication.md` | Untracked |
| `migrations/20251228_auth_system_tables.sql` | Untracked |
| ... and 4 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/auth/)

### Status: PENDING

---

## 2025-12-28 Analysis

**Generated:** 2025-12-28T22:00:18.457Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (24)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| `client/src/contexts/auth-context.tsx` | Untracked |
| `client/src/pages/auth/` | Untracked |
| `client/src/types/auth.ts` | Untracked |
| `docs/architecture/authentication.md` | Untracked |
| `migrations/20251228_auth_system_tables.sql` | Untracked |
| ... and 4 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/auth/)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T00:35:54.375Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (35)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `index.js` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| ... and 15 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T00:37:47.150Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (36)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `index.js` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| ... and 16 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T00:39:07.664Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (36)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `index.js` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| ... and 16 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T00:45:08.367Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (36)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `index.js` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| ... and 16 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T00:48:12.366Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (36)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `index.js` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `shared/schema.js` | Modified |
| `client/src/components/auth/` | Untracked |
| ... and 16 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T04:56:19.292Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (40)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `index.js` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/platform/index.js` | Modified |
| ... and 20 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T21:53:20.936Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (58)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `PRODISSUES.md` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/README.md` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/README.md` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/README.md` | Modified |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `index.js` | Modified |
| ... and 38 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/README.md)
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/tactical-planner.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/tactical-planner.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

## 2025-12-29 Analysis

**Generated:** 2025-12-29T22:03:50.705Z
**Branch:** main
**Last Commit:** b9fc00f Assistant checkpoint

### Uncommitted Changes (62)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `PRODISSUES.md` | Modified |
| `client/src/App.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/README.md` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/README.md` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/README.md` | Modified |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| ... and 42 more | |

### Recent Commit Changes (8)
| File | Status |
|------|--------|
| `PRODISSUES.md` | Added |
| `client/src/components/README.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/pages/co-pilot/README.md` | Added |
| `docs/architecture/README.md` | Modified |
| `docs/review-queue/2025-12-28.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/README.md)
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/tactical-planner.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)

### Status: PENDING

---

---
