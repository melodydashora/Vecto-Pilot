# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

## Note from Melody - repo owner
1. docs/review-queue has daily scripts ran that try to find repo changes (wether documented or not)
2. each md in the docs/review-queue will have changed files and folders and will be consolidated into the pending.md meaning this file gets large fast.
3. read all root file *.md and make sure they all match the current codebase
4. come back and move all dated yyyy-mm-dd.md to docs/reviewed-queue to validate the changes that were missed (historical md files need to be read in reverse order and changes (even one lie code changes) and add them to (and if not created) the CHANGES.md file in the docs/reviewed-queue folder making sure to know date of change from file name and because the changes snowball be cognizant of duplicated listed changes and summary to help us to not only keep up with documentation but gives us historical changes and to not make mistakes in reversion coding.)
5. after no yyyy-mm-dd.md files are left compare the CHANGES.md file with updates found further down in this file and verify all changes are now kept in the CHANGES.md and delete the changes listed in this document.
6. Follow the "How to Use This File" but make sure they are not kept here and instead appended to the CHANGES.md with dates and summarized changes - that file can and will get huge but we will not miss a single change and it will act as your memory. Nothing should be deleted from CHANGES.md with the exception of duplicated changes.
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

## Currently Pending

### Status: CLEAR

All pending items have been processed and moved to `docs/reviewed-queue/CHANGES.md`.

**Last Cleared:** 2026-01-09

### Deferred Items (Low Priority)

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/client-structure.md` | Minor component changes | DEFERRED |
| `docs/architecture/api-reference.md` | Briefing API changes (minor) | DEFERRED |
| `docs/preflight/database.md` | Could add dispatch primitives summary | DEFERRED |

---

## Completed Items History

The following items have been addressed and consolidated into `../reviewed-queue/CHANGES.md`:

| Date | Item | Resolution |
|------|------|------------|
| 2026-01-09 | P0/P1 Security Audit | Fixed auth bypass, ownership, fallbacks |
| 2026-01-09 | Schema Cleanup Phase 1 & 2 | Consolidated reads, stopped legacy writes |
| 2026-01-09 | 25-mile Filter Bug | Fixed property name mismatch |
| 2026-01-09 | Database Detox | Cleaned duplicates, fixed SSE consolidation |
| 2026-01-08 | Manual Refresh Race Condition | Fixed in code, documented in CHANGES.md |
| 2026-01-08 | Dispatch Primitives Schema | Added tables, documented in database-schema.md |
| 2026-01-07 | Agent Config Security Fix | Fixed in code, documented in CHANGES.md |
| 2026-01-07 | Timezone Fallback Removal | Fixed in code, documented in CHANGES.md |
| 2026-01-07 | Auth Loop Bug Fix | Fixed in code, documented in CHANGES.md |
| 2026-01-06 | Security Audit Remediation (P0/P1/P2) | Completed, documented in CHANGES.md |

## 2026-01-09 Analysis

**Generated:** 2026-01-09T15:54:51.203Z
**Branch:** main
**Last Commit:** cf3e0296 Refactor: Disambiguate Bars component names to prevent AI confusion

### Recent Commit Changes (27)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/README.md` | Modified |
| `client/src/components/BarsTable.tsx` | Renamed |
| `client/src/components/BarTab.tsx` | Renamed |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Modified |
| `client/src/pages/co-pilot/BarsPage.tsx` | Renamed |
| `client/src/pages/co-pilot/index.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/memory/RESUME_PROTOCOL_2026-01-09.md` | Added |
| `docs/plans/SCHEMA_CLEANUP_PLAN.md` | Added |
| `docs/review-queue/2026-01-08.md` | Deleted |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-08.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Renamed |
| ... and 7 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/intelligence/index.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsTable.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

### Status: PENDING

---

## 2026-01-09 Analysis

**Generated:** 2026-01-09T16:12:50.999Z
**Branch:** main
**Last Commit:** cf3e0296 Refactor: Disambiguate Bars component names to prevent AI confusion

### Uncommitted Changes (2)
| File | Status |
|------|--------|
| `ocs/review-queue/pending.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Untracked |

### Recent Commit Changes (27)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/README.md` | Modified |
| `client/src/components/BarsTable.tsx` | Renamed |
| `client/src/components/BarTab.tsx` | Renamed |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Modified |
| `client/src/pages/co-pilot/BarsPage.tsx` | Renamed |
| `client/src/pages/co-pilot/index.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/memory/RESUME_PROTOCOL_2026-01-09.md` | Added |
| `docs/plans/SCHEMA_CLEANUP_PLAN.md` | Added |
| `docs/review-queue/2026-01-08.md` | Deleted |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-08.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Renamed |
| ... and 7 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/intelligence/index.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsTable.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

### Status: PENDING

---

## 2026-01-09 Analysis

**Generated:** 2026-01-09T17:05:30.952Z
**Branch:** main
**Last Commit:** 4013740e Feat: Implement Service Account pattern for AI Agent authentication

### Recent Commit Changes (15)
| File | Status |
|------|--------|
| `client/src/README.md` | Modified |
| `client/src/components/BarsTable.tsx` | Renamed |
| `client/src/components/BarTab.tsx` | Renamed |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Modified |
| `client/src/pages/co-pilot/BarsPage.tsx` | Renamed |
| `client/src/pages/co-pilot/index.tsx` | Modified |
| `client/src/routes.tsx` | Modified |
| `docs/review-queue/2026-01-09.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/api/strategy/blocks-fast.js` | Modified |
| `server/middleware/auth.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsTable.tsx)

### Status: PENDING

---

## 2026-01-09 Analysis

**Generated:** 2026-01-09T17:42:40.628Z
**Branch:** main
**Last Commit:** be2f761d Fix: Schema consistency - standardize to camelCase property names

### Recent Commit Changes (14)
| File | Status |
|------|--------|
| `client/src/README.md` | Modified |
| `client/src/components/BarsDataGrid.tsx` | Modified |
| `client/src/components/_future/MarketIntelligenceBlocks.tsx` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/review-queue/2026-01-09.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/api/strategy/blocks-fast.js` | Modified |
| `server/middleware/auth.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsDataGrid.tsx)

### Status: PENDING

---

## 2026-01-09 Analysis

**Generated:** 2026-01-09T17:46:39.945Z
**Branch:** main
**Last Commit:** be2f761d Fix: Schema consistency - standardize to camelCase property names

### Uncommitted Changes (2)
| File | Status |
|------|--------|
| `ocs/review-queue/2026-01-09.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (14)
| File | Status |
|------|--------|
| `client/src/README.md` | Modified |
| `client/src/components/BarsDataGrid.tsx` | Modified |
| `client/src/components/_future/MarketIntelligenceBlocks.tsx` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/review-queue/2026-01-09.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/api/strategy/blocks-fast.js` | Modified |
| `server/middleware/auth.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsDataGrid.tsx)

### Status: PENDING

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T00:39:28.089Z
**Branch:** main
**Last Commit:** b13da7df Docs: Regenerate DATA_FLOW_MAP.json with latest codebase state

### Uncommitted Changes (15)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `docs/review-queue/2026-01-09.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `scripts/db-detox.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/logger/workflow.js` | Modified |
| `server/scripts/sync-events.mjs` | Modified |
| `tests/README.md` | Modified |
| `.serena/memories/decision_model_agnostic_naming_2026_01_10.md` | Untracked |
| `.serena/memories/etl_deep_analysis_2026_01_10.md` | Untracked |
| `docs/architecture/etl-pipeline-refactoring-2026-01-09.md` | Untracked |
| `server/lib/events/` | Untracked |
| `server/lib/location/getSnapshotTimeContext.js` | Untracked |
| `tests/events/` | Untracked |

### Recent Commit Changes (14)
| File | Status |
|------|--------|
| `client/src/README.md` | Modified |
| `client/src/components/BarsDataGrid.tsx` | Modified |
| `client/src/components/_future/MarketIntelligenceBlocks.tsx` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/DATA_FLOW_MAP.json` | Modified |
| `docs/review-queue/2026-01-09.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `server/middleware/auth.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/providers/consolidator.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/providers/consolidator.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/getSnapshotTimeContext.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/getSnapshotTimeContext.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsDataGrid.tsx)

### Status: PENDING

---

---
