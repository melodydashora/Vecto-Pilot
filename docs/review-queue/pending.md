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

## 2025-12-16 Session Summary

**Session Date:** 2025-12-16
**Branch:** main

### Changes Made This Session

#### Performance Optimizations (Issues #14, #15, #16)
- [x] Reduced animation interval 100ms → 250ms (useEnrichmentProgress.ts)
- [x] Parallelized DB queries in blocks-fast.js
- [x] Added phase completion after ensureSmartBlocksExist
- [x] Added phase auto-correction in content-blocks.js
- [x] Reduced Gemini retry delays (consolidator.js)

**Documentation:** Added to LESSONS_LEARNED.md

#### Event Flag Feature for SmartBlocks
- [x] Created event-matcher.js for address/name matching
- [x] Updated enhanced-smart-blocks.js to call event matcher
- [x] Updated blocks-fast.js to return hasEvent/eventBadge
- [x] Updated co-pilot.tsx to display event badges

**Documentation:** Self-documenting code, no external docs needed

#### Event Deduplication
- [x] Added semantic deduplication to sync-events.mjs
- [x] Pass existing events to GPT-5.2 prompt

**Documentation:** Added to LESSONS_LEARNED.md

#### Bug Fixes
- [x] Action validation schema (validation.js) - Added missing action types
- [x] STRATEGY_HAIKU env var - Added to mono-mode.env
- [x] Progress bar 63%→100% jump - Fixed expected durations

**Documentation:** Added to LESSONS_LEARNED.md

### Remaining Items (Low Priority)

#### Consider for Future
- [ ] `docs/architecture/event-discovery.md` - Could document event-matcher.js integration
- [ ] `mcp-server/README.md` - Update tool count if MCP tools changed

### Status: REVIEWED

All major changes from this session have been documented in LESSONS_LEARNED.md.

## 2025-12-16 Analysis

**Generated:** 2025-12-16T01:32:43.227Z
**Branch:** main
**Last Commit:** 15b2f4b Document session changes in LESSONS_LEARNED.md

### Uncommitted Changes (2)
| File | Status |
|------|--------|
| `ocs/review-queue/2025-12-15.md` | Modified |
| `docs/review-queue/2025-12-16.md` | Untracked |

### Recent Commit Changes (6)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `server/middleware/validation.js` | Modified |
| `server/scripts/sync-events.mjs` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useEnrichmentProgress.ts)

### Status: PENDING

---

## 2025-12-16 Analysis

**Generated:** 2025-12-16T01:36:56.962Z
**Branch:** main
**Last Commit:** 15b2f4b Document session changes in LESSONS_LEARNED.md

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `ocs/review-queue/2025-12-15.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/review-queue/2025-12-16.md` | Untracked |

### Recent Commit Changes (6)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `server/middleware/validation.js` | Modified |
| `server/scripts/sync-events.mjs` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useEnrichmentProgress.ts)

### Status: REVIEWED - Added to LESSONS_LEARNED.md

---

## 2025-12-16 Analysis

**Generated:** 2025-12-16T01:52:50.150Z
**Branch:** main
**Last Commit:** 0980953 Increase phase durations to prevent progress bar stalling

### Recent Commit Changes (7)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `docs/review-queue/2025-12-15.md` | Modified |
| `docs/review-queue/2025-12-16.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/jobs/change-analyzer-job.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useEnrichmentProgress.ts)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)

### Status: REVIEWED - Added to LESSONS_LEARNED.md

## 2025-12-16 Analysis

**Generated:** 2025-12-16T02:03:34.002Z
**Branch:** main
**Last Commit:** d4a8c3e Update Backend Files

### Uncommitted Changes (5)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `client/src/components/SmartBlocksStatus.tsx` | Modified |
| `client/src/hooks/useVenueLoadingMessages.ts` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/lib/venue/event-matcher.js` | Modified |

### Recent Commit Changes (7)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `docs/review-queue/2025-12-15.md` | Modified |
| `docs/review-queue/2025-12-16.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/jobs/change-analyzer-job.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/SmartBlocksStatus.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/event-matcher.js)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)

### Status: PENDING

---

## 2025-12-16 Analysis

**Generated:** 2025-12-16T02:11:52.207Z
**Branch:** main
**Last Commit:** d4a8c3e Update Backend Files

### Uncommitted Changes (7)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `client/src/components/SmartBlocksStatus.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/hooks/useVenueLoadingMessages.ts` | Modified |
| `docs/review-queue/2025-12-16.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/lib/venue/event-matcher.js` | Modified |

### Recent Commit Changes (7)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `docs/review-queue/2025-12-15.md` | Modified |
| `docs/review-queue/2025-12-16.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/jobs/change-analyzer-job.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/SmartBlocksStatus.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/event-matcher.js)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)

### Status: PENDING

---

## 2025-12-16 Analysis

**Generated:** 2025-12-16T02:19:00.146Z
**Branch:** main
**Last Commit:** d4a8c3e Update Backend Files

### Uncommitted Changes (9)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `client/src/components/SmartBlocksStatus.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/hooks/useVenueLoadingMessages.ts` | Modified |
| `docs/review-queue/2025-12-16.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `server/lib/venue/enhanced-smart-blocks.js` | Modified |
| `server/lib/venue/event-matcher.js` | Modified |

### Recent Commit Changes (7)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `docs/review-queue/2025-12-15.md` | Modified |
| `docs/review-queue/2025-12-16.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/jobs/change-analyzer-job.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/SmartBlocksStatus.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)

### Status: PENDING

---

## 2025-12-16 Analysis

**Generated:** 2025-12-16T02:29:53.416Z
**Branch:** main
**Last Commit:** d4a8c3e Update Backend Files

### Uncommitted Changes (10)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `client/src/components/SmartBlocksStatus.tsx` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/hooks/useVenueLoadingMessages.ts` | Modified |
| `docs/review-queue/2025-12-16.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `server/lib/venue/enhanced-smart-blocks.js` | Modified |
| `server/lib/venue/event-matcher.js` | Modified |

### Recent Commit Changes (7)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `docs/review-queue/2025-12-15.md` | Modified |
| `docs/review-queue/2025-12-16.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/jobs/change-analyzer-job.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/SmartBlocksStatus.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/change-analyzer-job.js)

### Status: PENDING

---

---
