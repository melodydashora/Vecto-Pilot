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

### Status: REVIEWED - 2026-01-14 Phase 3 Intelligence Hardening

**All changes documented in:** `docs/reviewed-queue/CHANGES.md`

#### Completed Tasks (2026-01-14)

| Task | Resolution | Status |
|------|------------|--------|
| Progressive Enrichment Migration | `migrations/20260114_progressive_enrichment.sql` applied | ✅ DONE |
| TomTom Module Refactoring | Moved to `server/lib/traffic/tomtom.js` | ✅ DONE |
| Context Loader Creation | `server/lib/briefing/context-loader.js` created | ✅ DONE |
| Briefer Model Implementation | `generateTrafficBriefing()` in `briefing.js` | ✅ DONE |
| Snake_case Fallback Removal | `co-pilot-context.tsx` updated | ✅ DONE |
| Time-Sensitive Event Badge | `enhanced-smart-blocks.js` updated | ✅ DONE |
| db:migrate Script | `package.json` updated | ✅ DONE |
| MapPage closedGoAnyway Filter | `MapPage.tsx` updated | ✅ DONE |
| Stale venue-linker.js Import | Removed from `briefing-service.js` | ✅ DONE |

---

### Status: REVIEWED - Comprehensive Architecture Audit (2026-01-10)

**Audit stored in:** `.serena/memories/comprehensive_audit_2026_01_10.md`
**See also:** `docs/DOC_DISCREPANCIES.md` (S-001 to S-005 + D-* items)

All items from 2026-01-10 have been consolidated to `docs/reviewed-queue/CHANGES.md`.

---

### P2 - MEDIUM PRIORITY (Adapter Bypasses) - Deferred

| File | Issue | Status |
|------|-------|--------|
| consolidator.js | Direct OpenAI/Gemini calls | DEFERRED |
| holiday-detector.js | Direct Gemini call | DEFERRED |
| sync-events.mjs | Direct OpenAI/Gemini calls | DEFERRED |
| research.js | Direct Gemini calls | DEFERRED |
| venue-events.js | Direct Gemini call | DEFERRED |
| assistant-proxy.ts | Direct OpenAI/Gemini calls | DEFERRED |

**Note:** These are adapter bypass issues - low priority since they work but don't follow the adapter pattern.

---

### P3 - LOW PRIORITY - Deferred

| Issue | Location | Status |
|-------|----------|--------|
| MULTI_STRATEGY_ENABLED silent no-op | strategy-generator-parallel.js:321 | DEFERRED |

---

## Completed Items History

The following items have been addressed and consolidated into `../reviewed-queue/CHANGES.md`:

| Date | Item | Resolution |
|------|------|------------|
| 2026-01-14 | Phase 3 Intelligence Hardening | Complete - documented in CHANGES.md |
| 2026-01-10 | Event Discovery Pipeline Hardening | Fixed - documented in CHANGES.md |
| 2026-01-10 | D-030 Transformation Layer Overhaul | Fixed - documented in CHANGES.md |
| 2026-01-10 | D-023 to D-029 Contract Normalization | Fixed - documented in CHANGES.md |
| 2026-01-10 | ETL Pipeline Refactoring | Complete - documented in CHANGES.md |
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

**Last Updated:** 2026-01-14 (Phase 3 Intelligence Hardening Complete)

## 2026-01-14 Analysis

**Generated:** 2026-01-14T18:01:31.561Z
**Branch:** main
**Last Commit:** aa364d05 Docs: Comprehensive documentation sync (2026-01-14)

### Uncommitted Changes (25)
| File | Status |
|------|--------|
| `lient/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `package.json` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/ai/providers/briefing.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/external/README.md` | Modified |
| `server/lib/external/index.js` | Modified |
| `server/lib/external/tomtom-traffic.js` | Deleted |
| `server/lib/venue/enhanced-smart-blocks.js` | Modified |
| `server/lib/venue/venue-address-resolver.js` | Modified |
| `server/lib/venue/venue-cache.js` | Modified |
| `server/lib/venue/venue-enrichment.js` | Modified |
| `server/lib/venue/venue-intelligence.js` | Modified |
| `shared/schema.js` | Modified |
| ... and 5 more | |

### Recent Commit Changes (33)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/README.md` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/EVENT_FRESHNESS_AND_TTL.md` | Modified |
| `docs/VENUELOGIC.md` | Added |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| ... and 13 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/co-pilot-context.tsx)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)

#### Medium Priority
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260110_drop_discovered_events_unused_cols.sql)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T18:22:17.475Z
**Branch:** main
**Last Commit:** b1daad97 Phase 3: Intelligence Hardening + Venue Filter Fixes

### Uncommitted Changes (6)
| File | Status |
|------|--------|
| `ocs/reviewed-queue/CHANGES.md` | Modified |
| `package.json` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/venue/venue-intelligence.js` | Modified |
| `migrations/20260114_create_places_cache.sql` | Untracked |

### Recent Commit Changes (50)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/EVENT_FRESHNESS_AND_TTL.md` | Modified |
| `docs/VENUELOGIC.md` | Added |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| ... and 30 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/MapTab.tsx)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260110_drop_discovered_events_unused_cols.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T18:38:47.294Z
**Branch:** main
**Last Commit:** 6be744a9 Fix: Critical hardening - Schema migration, UI filters, and API cost reduction

### Recent Commit Changes (50)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/EVENT_FRESHNESS_AND_TTL.md` | Modified |
| `docs/VENUELOGIC.md` | Added |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| ... and 30 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/MapTab.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260110_drop_discovered_events_unused_cols.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T18:44:48.568Z
**Branch:** main
**Last Commit:** cabcebd0 Fix: Progress bar no longer snaps to 100% prematurely

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `ocs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |

### Recent Commit Changes (50)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/VENUELOGIC.md` | Added |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| ... and 30 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/MapTab.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260110_drop_discovered_events_unused_cols.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T18:46:15.834Z
**Branch:** main
**Last Commit:** cabcebd0 Fix: Progress bar no longer snaps to 100% prematurely

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `ocs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |

### Recent Commit Changes (50)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/VENUELOGIC.md` | Added |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| ... and 30 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/MapTab.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260110_drop_discovered_events_unused_cols.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T18:56:23.517Z
**Branch:** main
**Last Commit:** 558b1dd0 Fix: S-007 Snapshot reuse was ignoring age - served 6-day-old data!

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `ocs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |

### Recent Commit Changes (45)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| ... and 25 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/MapTab.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T19:13:37.733Z
**Branch:** main
**Last Commit:** 558b1dd0 Fix: S-007 Snapshot reuse was ignoring age - served 6-day-old data!

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `ocs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |

### Recent Commit Changes (45)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| ... and 25 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/MapTab.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T19:31:57.550Z
**Branch:** main
**Last Commit:** 558b1dd0 Fix: S-007 Snapshot reuse was ignoring age - served 6-day-old data!

### Uncommitted Changes (7)
| File | Status |
|------|--------|
| `lient/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/scripts/sync-events.mjs` | Modified |

### Recent Commit Changes (45)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| ... and 25 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useStrategyPolling.ts)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T20:07:21.852Z
**Branch:** main
**Last Commit:** 558b1dd0 Fix: S-007 Snapshot reuse was ignoring age - served 6-day-old data!

### Uncommitted Changes (17)
| File | Status |
|------|--------|
| `lient/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `server/lib/venue/enhanced-smart-blocks.js` | Modified |
| `server/scripts/sync-events.mjs` | Modified |
| `server/validation/transformers.js` | Modified |

### Recent Commit Changes (45)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| ... and 25 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/co-pilot-context.tsx)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/content-blocks.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/enhanced-smart-blocks.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T20:38:36.456Z
**Branch:** main
**Last Commit:** 558b1dd0 Fix: S-007 Snapshot reuse was ignoring age - served 6-day-old data!

### Uncommitted Changes (24)
| File | Status |
|------|--------|
| `lient/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/briefing/dump-last-briefing.js` | Modified |
| `server/lib/location/validation-gates.js` | Modified |
| `server/lib/strategy/dump-last-strategy.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `server/lib/venue/enhanced-smart-blocks.js` | Modified |
| `server/scripts/sync-events.mjs` | Modified |
| ... and 4 more | |

### Recent Commit Changes (45)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| ... and 25 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/co-pilot-context.tsx)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/content-blocks.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/validation-gates.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/validation-gates.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T20:55:37.783Z
**Branch:** main
**Last Commit:** 558b1dd0 Fix: S-007 Snapshot reuse was ignoring age - served 6-day-old data!

### Uncommitted Changes (28)
| File | Status |
|------|--------|
| `lient/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/briefing/dump-last-briefing.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `server/lib/location/validation-gates.js` | Modified |
| `server/lib/location/weather-traffic-validator.js` | Modified |
| ... and 8 more | |

### Recent Commit Changes (45)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| ... and 25 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/co-pilot-context.tsx)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/content-blocks.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T21:18:35.084Z
**Branch:** main
**Last Commit:** 558b1dd0 Fix: S-007 Snapshot reuse was ignoring age - served 6-day-old data!

### Uncommitted Changes (28)
| File | Status |
|------|--------|
| `lient/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/briefing/dump-last-briefing.js` | Modified |
| `server/lib/location/get-snapshot-context.js` | Modified |
| `server/lib/location/validation-gates.js` | Modified |
| `server/lib/location/weather-traffic-validator.js` | Modified |
| ... and 8 more | |

### Recent Commit Changes (45)
| File | Status |
|------|--------|
| `ARCHITECTURE.md` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/MapTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/pages/co-pilot/MapPage.tsx` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/strategy-framework.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-01-09.md` | Deleted |
| `docs/review-queue/2026-01-14.md` | Added |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-09.md` | Modified |
| `docs/review-queue/2026-01-10.md` | Renamed |
| ... and 25 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/co-pilot-context.tsx)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/content-blocks.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_create_places_cache.sql)
- [ ] Consider adding documentation - New file added (migrations/20260114_progressive_enrichment.sql)
- [ ] Consider adding documentation - New file added (server/lib/briefing/context-loader.js)
- [ ] Consider adding documentation - New file added (server/scripts/fix-venue-flags.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T22:20:57.408Z
**Branch:** main
**Last Commit:** 1e45e38a Fix: Consolidated validateSnapshotFields guard to prevent incomplete snapshots

### Recent Commit Changes (32)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useEnrichmentProgress.ts` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260114_lean_strategies_table.sql` | Added |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| ... and 12 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/content-blocks.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/RideshareIntelTab.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_lean_strategies_table.sql)
- [ ] Consider adding documentation - New file added (server/scripts/link-events.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T23:23:24.432Z
**Branch:** main
**Last Commit:** e16f4a01 Fix: Briefer Model consolidation - Single Gemini architecture

### Recent Commit Changes (33)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260114_lean_strategies_table.sql` | Added |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/README.md` | Modified |
| ... and 13 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/content-blocks.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/RideshareIntelTab.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_lean_strategies_table.sql)
- [ ] Consider adding documentation - New file added (server/scripts/link-events.js)

### Status: PENDING

---

## 2026-01-14 Analysis

**Generated:** 2026-01-14T23:26:18.355Z
**Branch:** main
**Last Commit:** e16f4a01 Fix: Briefer Model consolidation - Single Gemini architecture

### Uncommitted Changes (3)
| File | Status |
|------|--------|
| `ocs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |

### Recent Commit Changes (33)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `client/src/components/RideshareIntelTab.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/utils/co-pilot-helpers.ts` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260114_lean_strategies_table.sql` | Added |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/briefing.js` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/content-blocks.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/coach-dal.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/ai/providers/consolidator.js` | Modified |
| `server/lib/briefing/README.md` | Modified |
| ... and 13 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/content-blocks.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/coach-dal.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/get-snapshot-context.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/RideshareIntelTab.tsx)
- [ ] `docs/architecture/api-reference.md` - Briefing API changes (server/api/briefing/briefing.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260114_lean_strategies_table.sql)
- [ ] Consider adding documentation - New file added (server/scripts/link-events.js)

### Status: PENDING

---

## 2026-01-15 Analysis

**Generated:** 2026-01-15T00:32:16.029Z
**Branch:** main
**Last Commit:** a194ae18 Fix: Schema-code drift - event_date→event_start_date synchronization

### Recent Commit Changes (22)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/architecture/Briefing.md` | Modified |
| `docs/architecture/ai-coach.md` | Modified |
| `docs/architecture/event-discovery.md` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `scripts/db-detox.js` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/README.md` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/api/location/snapshot.js` | Modified |
| `server/api/strategy/strategy.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/README.md` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/briefing/dump-last-briefing.js` | Modified |
| ... and 2 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/coach/schema.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)

### Status: PENDING

---

## 2026-01-15 Analysis

**Generated:** 2026-01-15T01:01:25.160Z
**Branch:** main
**Last Commit:** e801493b Fix: Make migrations idempotent to prevent re-run errors

### Uncommitted Changes (5)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `docs/review-queue/2026-01-15.md` | Untracked |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/architecture/Briefing.md` | Modified |
| `docs/architecture/ai-coach.md` | Modified |
| `docs/architecture/event-discovery.md` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `migrations/20251214_discovered_events.sql` | Modified |
| `migrations/20260110_rename_event_columns.sql` | Modified |
| `scripts/db-detox.js` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/README.md` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/briefing/dump-last-briefing.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `shared/README.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/coach/schema.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

### Status: PENDING

---

## 2026-01-15 Analysis

**Generated:** 2026-01-15T01:24:54.693Z
**Branch:** main
**Last Commit:** e801493b Fix: Make migrations idempotent to prevent re-run errors

### Uncommitted Changes (30)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `client/src/components/BarsMainTab.tsx` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/DonationTab.tsx` | Modified |
| `client/src/components/FeedbackModal.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/intel/TacticalStagingMap.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/hooks/usePlatformData.ts` | Modified |
| `client/src/hooks/useStrategy.ts` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/hooks/useTTS.ts` | Modified |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Modified |
| ... and 10 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/architecture/Briefing.md` | Modified |
| `docs/architecture/ai-coach.md` | Modified |
| `docs/architecture/event-discovery.md` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `migrations/20251214_discovered_events.sql` | Modified |
| `migrations/20260110_rename_event_columns.sql` | Modified |
| `scripts/db-detox.js` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/README.md` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/briefing/dump-last-briefing.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `shared/README.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsMainTab.tsx)

### Status: PENDING

---

## 2026-01-15 Analysis

**Generated:** 2026-01-15T01:31:39.163Z
**Branch:** main
**Last Commit:** e801493b Fix: Make migrations idempotent to prevent re-run errors

### Uncommitted Changes (36)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `client/src/components/BarsMainTab.tsx` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/DonationTab.tsx` | Modified |
| `client/src/components/FeedbackModal.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/intel/TacticalStagingMap.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/hooks/usePlatformData.ts` | Modified |
| `client/src/hooks/useStrategy.ts` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| `client/src/hooks/useTTS.ts` | Modified |
| `client/src/pages/auth/ForgotPasswordPage.tsx` | Modified |
| ... and 16 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `docs/DOC_DISCREPANCIES.md` | Modified |
| `docs/architecture/Briefing.md` | Modified |
| `docs/architecture/ai-coach.md` | Modified |
| `docs/architecture/event-discovery.md` | Modified |
| `docs/review-queue/2026-01-14.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/CHANGES.md` | Modified |
| `migrations/20251214_discovered_events.sql` | Modified |
| `migrations/20260110_rename_event_columns.sql` | Modified |
| `scripts/db-detox.js` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/api/briefing/README.md` | Modified |
| `server/api/coach/schema.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/briefing/dump-last-briefing.js` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `shared/README.md` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/geocode.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/geocode.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsMainTab.tsx)

### Status: PENDING

---

## 2026-01-15 Analysis

**Generated:** 2026-01-15T01:50:36.124Z
**Branch:** main
**Last Commit:** 08b85e5d Fix: Comprehensive audit fixes - API centralization, dead code removal, model upgrade

### Uncommitted Changes (2)
| File | Status |
|------|--------|
| `ESSONS_LEARNED.md` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |

### Recent Commit Changes (52)
| File | Status |
|------|--------|
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/BarsMainTab.tsx` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/DonationTab.tsx` | Modified |
| `client/src/components/FeedbackModal.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/intel/TacticalStagingMap.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/features/strategy/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/hooks/usePlatformData.ts` | Modified |
| `client/src/hooks/useStrategy.ts` | Modified |
| ... and 32 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/coach/schema.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/geocode.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/geocode.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Hook changes (client/src/hooks/useStrategyPolling.ts)

### Status: PENDING

---

## 2026-01-15 Analysis

**Generated:** 2026-01-15T02:11:56.920Z
**Branch:** main
**Last Commit:** 3e0a1115 Published your App

### Recent Commit Changes (40)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/BarsMainTab.tsx` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/DonationTab.tsx` | Modified |
| `client/src/components/FeedbackModal.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/intel/TacticalStagingMap.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/features/strategy/README.md` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/hooks/useBarsQuery.ts` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/hooks/usePlatformData.ts` | Modified |
| `client/src/hooks/useStrategy.ts` | Modified |
| `client/src/hooks/useStrategyPolling.ts` | Modified |
| ... and 20 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/api-reference.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/geocode.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/geocode.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsMainTab.tsx)

### Status: PENDING

---

---
