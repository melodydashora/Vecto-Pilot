# Vecto-Pilot Codebase Analysis Report
## Comprehensive Audit - January 2026

---

## Executive Summary

This document provides a comprehensive analysis of the Vecto-Pilot repository, identifying discrepancies between documentation and actual code implementation, duplications, orphaned files, and areas requiring attention.

**Analysis Date:** January 4, 2026  
**Analyzed By:** Claude Opus 4.5  
**Repository:** Vecto-Pilot (Replit)

---

## 🚨 CRITICAL: Documentation vs Code Discrepancies

### 1. Event Validator Model Mismatch

**Issue:** Documentation claims Gemini 2.5 Pro is used for event validation, but actual code uses Claude Opus 4.5.

**Evidence:**
- `models-dictionary.js`: References `triad_validator` pointing to Gemini 2.5 Pro
- - `docs/architecture/ai-pipeline.md` line 205: Shows `STRATEGY_VALIDATOR=gemini-2.5-pro`
  - - **Actual Runtime Code:** `model-registry.js` uses `EVENT_VALIDATOR` defaulting to Claude Opus 4.5
    - - **Actual Implementation:** `event-schedule-validator.js` uses Claude Opus 4.5
    - **Legacy Files Still Present:**
    - - `gemini-2.5-pro.js` - An older adapter file (dated Dec 27) still exists
    - **Recommendation:** Update all documentation to reflect Claude Opus 4.5 as the current event validator OR synchronize code with documentation.
  - ---

  ### 2. Environment Variable Naming Inconsistency

  **Issue:** Both old and new environment variable names exist in documentation:
  - OLD: `STRATEGY_VALIDATOR`
  - - NEW: `STRATEGY_EVENT_VALIDATOR`
  - **Impact:** Developers may configure the wrong variable leading to unexpected behavior.
- **Recommendation:** Deprecate old variable name and update all references.
---

## 📁 File Structure Issues

### 1. _future Folders (Placeholder/Incomplete Features)

Multiple `_future` folders exist containing incomplete or planned features:

| Location | Contents | Status |
|----------|----------|--------|
| `client/src/_future/` | Unknown | Needs review |
| `client/src/components/_future/` | Unknown | Needs review |

**Recommendation:** Review and either implement, document as planned, or remove.

---

### 2. Duplicate Function Definitions

**Potential Duplicates Identified:**

| Function/Concept | Locations | Issue |
|------------------|-----------|-------|
| `makeCoordsKey()` | `server/routes/location.js` | Coordinate key generation |
| Deadhead Calculator | `DeadheadCalculator.tsx`, `MarketDeadheadCalculator.tsx` | Two similar components |

**Recommendation:** Audit for true duplicates and consolidate.

---

## 🔌 API Routes Analysis

### Registered Routes (from `server/bootstrap/routes.js`):

**Health & Diagnostics:**
- `/api/diagnostics` → `./server/api/health/diagnostics.js`
- - `/api/diagnostic` → `./server/api/health/diagnostic-identity.js`
  - - `/api/health` → `./server/api/health/health.js`
    - - `/api/ml-health` → `./server/api/health/ml-health.js`
      - - `/api/job-metrics` → `./server/api/health/job-metrics.js`
      - **Chat & Voice:**
      - - `/api/chat` → `./server/api/chat/chat.js` (AI Strategy Coach)
        - - `/api/tts` → `./server/api/chat/tts.js`
          - - `/api/realtime` → `./server/api/chat/realtime.js` (OpenAI Realtime voice)
          - **Authentication:**
          - - `/api/auth` → `./server/api/auth/auth.js`
          - **Location:**
          - - `/api/location` → `./server/api/location/location.js`
            - - `/api/snapshot` → `./server/api/location/snapshot.js`
            - **Strategy:**
            - - `/api/blocks-fast` → `./server/api/strategy/blocks-fast.js`
              - - `/api/blocks` → `./server/api/strategy/content-blocks.js`
                - - `/api/strategy` → `./server/api/strategy/strategy.js`
                  - - `/api/strategy/tactical-plan` → `./server/api/strategy/tactical-plan.js`
                  - **Feedback:**
                  - - `/api/feedback` → `./server/api/feedback/feedback.js`
                    - - `/api/actions` → `./server/api/feedback/actions.js`
                    - **Research:**
                    - - `/api/research` → `./server/api/research/research.js`
                    - **SSE/Events:**
                    - - `/events` → `./server/api/briefing/events.js`
                    - ---

                    ## 📚 Documentation Audit

                    ### README.md Files Status

                    The documentation claims **95+ README files** across folders. Key areas to verify:

                    | Folder | README Status | Notes |
                    |--------|---------------|-------|
                    | `/` | ✅ Present | Main README |
                    | `/server/` | ✅ Present | |
                    | `/server/lib/` | Needs verification | |
                    | `/server/api/` | Needs verification | |
                    | `/client/` | ✅ Present | |
                    | `/client/src/` | ✅ Present | |
                    | `/docs/` | ✅ Present | |
                    | `/shared/` | ✅ Present | |

                    ---

                    ## 🤖 AI Pipeline Analysis

                    ### Documented Pipeline (TRIAD Waterfall):

                    According to documentation, the pipeline runs in 4 phases (~35-50s):

                    1. **Phase 1 (Parallel):** Strategist + Briefer + Holiday Checker
                    2. 2. **Phase 2 (Parallel):** Daily Consolidator + Immediate Strategy
                       3. 3. **Phase 3:** Venue Planner + Enrichment
                          4. 4. **Phase 4:** Event Validator
                          5. ### Models Documented vs Actual:
                       4. | Component | Documented Model | Actual Model | Status |
                       5. |-----------|------------------|--------------|--------|
                       6. | Strategist | Claude Opus 4.5 | Claude Opus 4.5 | ✅ Match |
                       7. | Briefer | Gemini 3.0 Pro | Needs verification | ⚠️ |
                       8. | Holiday Checker | Perplexity | Needs verification | ⚠️ |
                       9. | Consolidator | Gemini | Needs verification | ⚠️ |
                       10. | Immediate Strategy | GPT-5.2 | Needs verification | ⚠️ |
                       11. | Event Validator | Gemini 2.5 Pro | Claude Opus 4.5 | ❌ MISMATCH |
                    3. ---
                  - ## 🗄️ Database Schema Observations
                - ### Tables Identified in `shared/schema.js`:
              - 1. **users** - Core user data with GPS coordinates
                2. 2. **snapshots** - Point-in-time context snapshots
                   3. 3. **strategies** - AI strategy outputs
                      4. 4. **briefings** - Comprehensive briefing data
                         5. 5. **rankings** - Venue recommendation sessions
                            6. 6. **ranking_candidates** - Individual venue entries
                               7. 7. **coords_cache** - Coordinate resolution cache
                               8. ### Potential Issues:
                            7. - Legacy fields marked for removal (Phase 7) still present in schema
                               - - `local_news`, `news_briefing`, `extras`, `trigger_reason`, `device` noted as removed Dec 2025
                                 - - `trigger_reason` moved to strategies table
                                 - ---

                                 ## 🔧 Server Architecture

                                 ### Folder Structure (server/lib/):

                                 | Folder | Purpose | Documentation |
                                 |--------|---------|---------------|
                                 | `ai/` | AI adapters and providers | ⚠️ Contains legacy files |
                                 | `auth/` | Authentication services | |
                                 | `briefing/` | Briefing generation | |
                                 | `strategy/` | Strategy pipeline | |
                                 | `venue/` | Venue intelligence | |
                                 | `location/` | Location services | |
                                 | `external/` | Third-party API integrations | |
                                 | `infrastructure/` | Job queue, logging | |
                                 | `change-analyzer/` | File change tracking | |
                                 | `subagents/` | AI sub-tasks | |
                                 | `notifications/` | Email alerts | |

                                 ---

                                 ## ⚠️ Potential Dead Code / Orphaned Files

                                 ### Files to Review:

                                 1. `gemini-2.5-pro.js` - Legacy adapter (Dec 27)
                                 2. 2. `models-dictionary.js` - Contains outdated `triad_validator` reference
                                    3. 3. `_future/` folders - Incomplete features
                                       4. 4. Any files in `/attached_assets/` - May be unused
                                       5. ---
                                    4. ## 📋 Action Items
                                 3. ### High Priority:
                               - - [ ] **Sync Event Validator Documentation** - Update all docs to reflect Claude Opus 4.5
                                 - [ ] - [ ] **Clean up env variable naming** - Standardize on `STRATEGY_EVENT_VALIDATOR`
                                 - [ ] - [ ] **Remove or archive legacy adapter files** - `gemini-2.5-pro.js`
                                 - [ ] - [ ] **Update `models-dictionary.js`** - Remove outdated `triad_validator` entry
                               - ### Medium Priority:
                            8. - [ ] **Audit _future folders** - Document or remove
                               - [ ] - [ ] **Verify all 95+ README files** - Ensure accuracy
                               - [ ] - [ ] **Check for duplicate calculator components**
                            9. ### Low Priority:
                         6. - [ ] **Review attached_assets/** - Clean unused files
                            - [ ] - [ ] **Consolidate duplicate utility functions**
                         7. ---
                      5. ## 📊 Summary Statistics
                   4. | Metric | Count |
                   5. |--------|-------|
                   6. | API Route Groups | 10+ |
                   7. | Database Tables | 7+ |
                   8. | Documentation Files | 95+ (claimed) |
                   9. | Legacy/Orphaned Files | 3+ identified |
                   10. | Documentation Mismatches | 2 critical |
                3. ---
              - ## Conclusion
            - The Vecto-Pilot codebase is well-structured with comprehensive documentation. However, the primary issue is **documentation drift** where the actual code implementation has evolved (specifically the Event Validator) but documentation hasn't been updated to reflect these changes.
          - The codebase shows signs of active development with some legacy artifacts remaining. A focused cleanup effort addressing the action items above would significantly improve codebase maintainability.
        - ---

        *Report generated by Claude Opus 4.5 - January 4, 2026*