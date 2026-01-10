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

### Status: REVIEWED - Comprehensive Architecture Audit (2026-01-10)

**Audit stored in:** `.serena/memories/comprehensive_audit_2026_01_10.md`
**See also:** `docs/DOC_DISCREPANCIES.md` (S-001 to S-005 + D-* items)

#### Documentation Sync Completed (2026-01-10)

| Document | Update | Status |
|----------|--------|--------|
| `server/lib/location/README.md` | Added coords-key.js module documentation | DONE |
| `server/validation/README.md` | Added snake/camel tolerance section for toApiBlock() | DONE |
| `server/api/strategy/README.md` | Added blocks-fast vs content-blocks distinction + known issues | DONE |
| `server/lib/strategy/README.md` | Added strategy-utils.js status flow + phase documentation | DONE |
| `docs/DOC_DISCREPANCIES.md` | Added S-001 through S-005 strategy pipeline findings | DONE |

#### P0 - CRITICAL (AI Coach Broken - Wrong Column Names) ✅ FIXED per DOC_DISCREPANCIES.md

| ID | Issue | Location | Status |
|----|-------|----------|--------|
| D-005 | Coach claims `snapshots.id` | `server/api/coach/schema.js:23` | ✅ FIXED |
| D-006 | Coach claims `immediate_strategy` | `server/api/coach/schema.js:28` | ✅ FIXED |
| D-007 | Coach claims `traffic`, `weather` | `server/api/coach/schema.js:33` | ✅ FIXED |
| D-008 | Coach claims `opening_hours` | `server/api/coach/schema.js:43` | ✅ FIXED |

**Actual columns:** `snapshot_id`, `strategy_for_now`, `traffic_conditions`, `weather_current`, `weather_forecast`, `business_hours`

#### P0 - Documentation Lies ✅ FIXED 2026-01-10

| Issue | Location | Status |
|-------|----------|--------|
| Users table claimed location data | `README.md:150`, `database-schema.md:7` | ✅ FIXED |
| Comment says "users table" reads coords_cache | `snapshot.js:67-68` | ✅ FIXED |
| Endpoint docs non-existent /api/users/location | `location/README.md:44` | ✅ FIXED |
| coach-dal.js comment wrong | `coach-dal.js:82` | ✅ FIXED |

#### P1 - HIGH PRIORITY (Country Field Inconsistency) ✅ FIXED per DOC_DISCREPANCIES.md

| ID | Issue | Location | Status |
|----|-------|----------|--------|
| D-011 | `pickAddressParts()` uses `c.long_name` | `location.js:161` | ✅ FIXED (now uses c.short_name) |
| D-012 | Default 'USA' not ISO 'US' | `venue-utils.js:31`, `schema.js:262` | ✅ FIXED (now uses 'US') |
| D-009 | Deleted `venue_cache` in docs | `DATA_FLOW_MAP.json:454` | ✅ FIXED |
| D-010 | Deleted `nearby_venues` in docs | `DATA_FLOW_MAP.json:233` | ✅ FIXED |

#### P1 - Duplicate Functions ✅ CONSOLIDATED 2026-01-10

| Issue | Resolution | Status |
|-------|------------|--------|
| 4 duplicate coordsKey functions | Created canonical `server/lib/location/coords-key.js` | ✅ FIXED |
| 2 calculateIsOpen functions | Consolidated via `server/lib/venue/hours/` canonical module (D-014) | ✅ FIXED |

#### P2 - MEDIUM PRIORITY (Adapter Bypasses)

| File | Issue | Status |
|------|-------|--------|
| consolidator.js | Direct OpenAI/Gemini calls | PENDING |
| holiday-detector.js | Direct Gemini call | PENDING |
| sync-events.mjs | Direct OpenAI/Gemini calls | PENDING |
| research.js | Direct Gemini calls | PENDING |
| venue-events.js | Direct Gemini call | PENDING |
| assistant-proxy.ts | Direct OpenAI/Gemini calls | PENDING |

#### P3 - LOW PRIORITY

| Issue | Location | Status |
|-------|----------|--------|
| MULTI_STRATEGY_ENABLED silent no-op | strategy-generator-parallel.js:321 | PENDING |

**Last Updated:** 2026-01-10 (Comprehensive Audit)

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

## 2026-01-10 Analysis - ETL Pipeline Refactoring

**Generated:** 2026-01-10T00:45:29.740Z
**Branch:** main
**Last Commit:** a60e3216 Feat: ETL Pipeline refactoring with canonical modules and 7-point audit

### Documentation Updates Completed (2026-01-10)

The following documentation was updated to reflect the ETL Pipeline refactoring:

| Document | Update |
|----------|--------|
| `ARCHITECTURE.md` | Added server/lib/events/ folder, tests/events/ folder, Recent Changes section |
| `server/lib/README.md` | Added events/ subfolder to domain overview, import patterns |
| `server/README.md` | Added lib/events/ to folder structure |
| `CLAUDE.md` | Added EVENTS workflow to logging conventions, folder map, import patterns |
| `docs/architecture/ai-pipeline.md` | Added Event ETL Pipeline section with phases and modules |
| `tests/README.md` | Already updated with events/ folder |

### Previously Created Documentation

The following documentation was created as part of the ETL refactoring commit:

- [x] `docs/architecture/etl-pipeline-refactoring-2026-01-09.md` - Full verification matrix
- [x] `server/lib/events/pipeline/README.md` - Pipeline module documentation
- [x] `tests/events/README.md` - Test documentation

### Remaining Items (Deferred)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (BarsDataGrid.tsx)
- [ ] `docs/preflight/location.md` - Location/GPS changes (getSnapshotTimeContext.js is internal utility)

### Status: REVIEWED

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T01:02:47.712Z
**Branch:** main
**Last Commit:** a60e3216 Feat: ETL Pipeline refactoring with canonical modules and 7-point audit

### Uncommitted Changes (14)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/README.md` | Modified |
| `server/lib/README.md` | Modified |
| `.serena/memories/architectural_fixes_roadmap_2026_01_10.md` | Untracked |
| `.serena/memories/decision_model_agnostic_naming_2026_01_10.md` | Untracked |
| `.serena/memories/etl_deep_analysis_2026_01_10.md` | Untracked |
| `.serena/memories/etl_refactoring_session_2026_01_10.md` | Untracked |

### Recent Commit Changes (29)
| File | Status |
|------|--------|
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
| `docs/architecture/etl-pipeline-refactoring-2026-01-09.md` | Added |
| `docs/review-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `scripts/db-detox.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/events/pipeline/README.md` | Added |
| `server/lib/events/pipeline/hashEvent.js` | Added |
| `server/lib/events/pipeline/normalizeEvent.js` | Added |
| ... and 9 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/providers/consolidator.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/providers/consolidator.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/getSnapshotTimeContext.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/getSnapshotTimeContext.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsDataGrid.tsx)

#### Low Priority
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/hashEvent.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/normalizeEvent.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/types.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/validateEvent.js)
- [ ] Consider adding documentation - New file added (tests/events/pipeline.test.js)

### Status: PENDING

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T01:53:00.442Z
**Branch:** main
**Last Commit:** 75785eae Docs: Update documentation for ETL pipeline and validation rules

### Uncommitted Changes (43)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `README.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/EventsComponent.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/DATABASE_SCHEMA.md` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `scripts/generate-schema-docs.js` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/location/README.md` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/jobs/event-sync-job.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| ... and 23 more | |

### Recent Commit Changes (31)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `client/src/components/BarsDataGrid.tsx` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/_future/MarketIntelligenceBlocks.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/DATA_FLOW_MAP.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/etl-pipeline-refactoring-2026-01-09.md` | Added |
| `docs/review-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `scripts/db-detox.js` | Modified |
| `server/README.md` | Modified |
| `server/lib/README.md` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| ... and 11 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/getSnapshotTimeContext.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/event-matcher.js)

#### Low Priority
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/event-sync-job.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/hashEvent.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/normalizeEvent.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/types.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/validateEvent.js)
- [ ] Consider adding documentation - New file added (tests/events/pipeline.test.js)

### Status: PENDING

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T02:30:24.259Z
**Branch:** main
**Last Commit:** bcd82ab8 Audit: Comprehensive architecture audit + hardening protocol

### Uncommitted Changes (1)
| File | Status |
|------|--------|
| `LAUDE.md` | Modified |

### Recent Commit Changes (61)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.serena/memories/architectural_fixes_roadmap_2026_01_10.md` | Added |
| `.serena/memories/comprehensive_audit_2026_01_10.md` | Added |
| `.serena/memories/decision_model_agnostic_naming_2026_01_10.md` | Added |
| `.serena/memories/etl-deep-analysis-file-audit-2026-01-10.md` | Added |
| `.serena/memories/etl_deep_analysis_2026_01_10.md` | Added |
| `.serena/memories/etl_refactoring_session_2026_01_10.md` | Added |
| `.serena/memories/refactor-audit-2026-01-10.md` | Added |
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `README.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/EventsComponent.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/DATABASE_SCHEMA.md` | Modified |
| `docs/DATA_FLOW_MAP.json` | Modified |
| ... and 41 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/getSnapshotTimeContext.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/getSnapshotTimeContext.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/migrations/2026-01-10-rename-event-fields.sql)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/migrations/2026-01-10-rename-event-fields.sql)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/check-standards.js)
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/event-sync-job.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/hashEvent.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/normalizeEvent.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/types.js)
- [ ] Consider adding documentation - New file added (server/lib/events/pipeline/validateEvent.js)
- [ ] Consider adding documentation - New file added (tests/events/pipeline.test.js)

### Status: PENDING

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T03:50:43.456Z
**Branch:** main
**Last Commit:** 9fbd22ba Fix: D-014 Gap Fixes + D-018 + D-004 (Country Code ISO)

### Recent Commit Changes (70)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.serena/memories/architectural_fixes_roadmap_2026_01_10.md` | Added |
| `.serena/memories/comprehensive_audit_2026_01_10.md` | Added |
| `.serena/memories/decision_model_agnostic_naming_2026_01_10.md` | Added |
| `.serena/memories/etl-deep-analysis-file-audit-2026-01-10.md` | Added |
| `.serena/memories/etl_deep_analysis_2026_01_10.md` | Added |
| `.serena/memories/etl_refactoring_session_2026_01_10.md` | Added |
| `.serena/memories/hardening-4-phase-plan-2026-01-10.md` | Added |
| `.serena/memories/refactor-audit-2026-01-10.md` | Added |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `README.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/EventsComponent.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| ... and 50 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/migrations/2026-01-10-rename-event-fields.sql)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/migrations/2026-01-10-rename-event-fields.sql)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/event-matcher.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/check-standards.js)
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/event-sync-job.js)

### Status: PENDING

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T04:32:29.022Z
**Branch:** main
**Last Commit:** 9fbd22ba Fix: D-014 Gap Fixes + D-018 + D-004 (Country Code ISO)

### Uncommitted Changes (7)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `server/api/location/location.js` | Modified |
| `.serena/memories/d014_d018_audit_verification_2026_01_10.md` | Untracked |

### Recent Commit Changes (70)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.serena/memories/architectural_fixes_roadmap_2026_01_10.md` | Added |
| `.serena/memories/comprehensive_audit_2026_01_10.md` | Added |
| `.serena/memories/decision_model_agnostic_naming_2026_01_10.md` | Added |
| `.serena/memories/etl-deep-analysis-file-audit-2026-01-10.md` | Added |
| `.serena/memories/etl_deep_analysis_2026_01_10.md` | Added |
| `.serena/memories/etl_refactoring_session_2026_01_10.md` | Added |
| `.serena/memories/hardening-4-phase-plan-2026-01-10.md` | Added |
| `.serena/memories/refactor-audit-2026-01-10.md` | Added |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `README.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/EventsComponent.tsx` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| ... and 50 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/migrations/2026-01-10-rename-event-fields.sql)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/migrations/2026-01-10-rename-event-fields.sql)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/event-matcher.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/check-standards.js)
- [ ] docs/architecture/server-structure.md - Background job changes (server/jobs/event-sync-job.js)

### Status: PENDING

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T06:36:19.569Z
**Branch:** main
**Last Commit:** d487a47e CRITICAL: Root cause fix for venue pipeline data quality issues

### Uncommitted Changes (12)
| File | Status |
|------|--------|
| `erver/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/blocks-fast.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/lib/location/README.md` | Modified |
| `server/lib/venue/venue-enrichment.js` | Modified |
| `server/lib/venue/venue-utils.js` | Modified |
| `server/validation/transformers.js` | Modified |
| `.serena/memories/strategy-pipeline-audit-2026-01-10.md` | Untracked |
| `docs/plans/CONSOLIDATED_CLEANUP_2026-01-10.md` | Untracked |
| `migrations/20260110_fix_strategy_now_notify.sql` | Untracked |
| `server/lib/location/coords-key.js` | Untracked |

### Recent Commit Changes (40)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.serena/memories/d014_d018_audit_verification_2026_01_10.md` | Added |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `docs/AUDIT_LEDGER.md` | Added |
| `docs/DATABASE_SCHEMA.md` | Modified |
| `docs/DATA_FLOW_MAP.json` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/architecture/authentication.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `scripts/create-all-tables.sql` | Modified |
| `scripts/venue-data-cleanup.js` | Added |
| `server/api/README.md` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| ... and 20 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/snapshot.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/coords-key.js)

#### Medium Priority
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-enrichment.js)
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useBarsQuery.ts)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/migrations/2026-01-10-d013-places-cache-rename.sql)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/migrations/2026-01-10-d013-places-cache-rename.sql)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/venue-data-cleanup.js)

### Status: PENDING

---

## 2026-01-10 Analysis

**Generated:** 2026-01-10T06:45:27.753Z
**Branch:** main
**Last Commit:** d487a47e CRITICAL: Root cause fix for venue pipeline data quality issues

### Uncommitted Changes (19)
| File | Status |
|------|--------|
| `ocs/DOC_DISCREPANCIES.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/README.md` | Modified |
| `server/api/strategy/blocks-fast.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/lib/location/README.md` | Modified |
| `server/lib/strategy/README.md` | Modified |
| `server/lib/venue/venue-enrichment.js` | Modified |
| `server/lib/venue/venue-utils.js` | Modified |
| `server/validation/README.md` | Modified |
| `server/validation/transformers.js` | Modified |
| `.serena/memories/strategy-pipeline-audit-2026-01-10.md` | Untracked |
| `docs/plans/CONSOLIDATED_CLEANUP_2026-01-10.md` | Untracked |
| `migrations/20260110_fix_strategy_now_notify.sql` | Untracked |
| `server/lib/location/coords-key.js` | Untracked |

### Recent Commit Changes (40)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.serena/memories/d014_d018_audit_verification_2026_01_10.md` | Added |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `docs/AUDIT_LEDGER.md` | Added |
| `docs/DATABASE_SCHEMA.md` | Modified |
| `docs/DATA_FLOW_MAP.json` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/architecture/authentication.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `scripts/create-all-tables.sql` | Modified |
| `scripts/venue-data-cleanup.js` | Added |
| `server/api/README.md` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| ... and 20 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/coords-key.js)

#### Medium Priority
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-enrichment.js)
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useBarsQuery.ts)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/migrations/2026-01-10-d013-places-cache-rename.sql)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/migrations/2026-01-10-d013-places-cache-rename.sql)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/venue-data-cleanup.js)

### Status: PENDING

---

---
