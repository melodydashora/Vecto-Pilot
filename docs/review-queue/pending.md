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

### 🚨 CRITICAL - Security Audit Remediation

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/plans/AUDIT_REMEDIATION_PLAN.md` | **P0 Security fixes** - Agent auth, NO FALLBACKS violations | AWAITING APPROVAL |

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

## 2026-01-06 Analysis

**Generated:** 2026-01-06T19:40:35.354Z
**Branch:** main
**Last Commit:** c674d60 Fix Critical A: Add social login route stubs + improve error handling

### Recent Commit Changes (151)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `README.md` | Modified |
| `SECURITY.md` | Added |
| `briefing-last-row.txt` | Modified |
| `client/README.md` | Modified |
| `client/public/README.md` | Modified |
| `client/src/README.md` | Modified |
| `client/src/_future/README.md` | Modified |
| `client/src/_future/engine/README.md` | Modified |
| `client/src/_future/user-settings/README.md` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/README.md` | Modified |
| `client/src/components/_future/README.md` | Modified |
| `client/src/components/auth/AuthRedirect.tsx` | Modified |
| `client/src/components/auth/ProtectedRoute.tsx` | Modified |
| `client/src/components/auth/README.md` | Modified |
| `client/src/components/co-pilot/README.md` | Modified |
| ... and 131 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)
- [ ] `docs/ai-tools/agent.md` - Workspace agent changes (server/agent/embed.js)
- [ ] `server/agent/README.md` - Workspace agent changes (server/agent/embed.js)

### Status: PENDING

---

## 2026-01-06 Analysis

**Generated:** 2026-01-06T19:53:08.207Z
**Branch:** main
**Last Commit:** 7de9085 Fix: Remove searchParams from useEffect deps to prevent infinite re-renders

### Recent Commit Changes (149)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `README.md` | Modified |
| `SECURITY.md` | Added |
| `briefing-last-row.txt` | Modified |
| `client/README.md` | Modified |
| `client/public/README.md` | Modified |
| `client/src/README.md` | Modified |
| `client/src/_future/README.md` | Modified |
| `client/src/_future/engine/README.md` | Modified |
| `client/src/_future/user-settings/README.md` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/README.md` | Modified |
| `client/src/components/_future/README.md` | Modified |
| `client/src/components/auth/AuthRedirect.tsx` | Modified |
| `client/src/components/auth/ProtectedRoute.tsx` | Modified |
| `client/src/components/auth/README.md` | Modified |
| `client/src/components/co-pilot/README.md` | Modified |
| ... and 129 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/CoachChat.tsx)
- [ ] `docs/ai-tools/agent.md` - Workspace agent changes (server/agent/embed.js)
- [ ] `server/agent/README.md` - Workspace agent changes (server/agent/embed.js)

### Status: PENDING

---

## 2026-01-06 Analysis

**Generated:** 2026-01-06T21:41:54.408Z
**Branch:** main
**Last Commit:** 7de9085 Fix: Remove searchParams from useEffect deps to prevent infinite re-renders

### Uncommitted Changes (6)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `client/src/contexts/README.md` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `docs/review-queue/2026-01-06.md` | Modified |
| `docs/review-queue/pending.md` | Modified |

### Recent Commit Changes (149)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `README.md` | Modified |
| `SECURITY.md` | Added |
| `briefing-last-row.txt` | Modified |
| `client/README.md` | Modified |
| `client/public/README.md` | Modified |
| `client/src/README.md` | Modified |
| `client/src/_future/README.md` | Modified |
| `client/src/_future/engine/README.md` | Modified |
| `client/src/_future/user-settings/README.md` | Modified |
| `client/src/components/CoachChat.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/README.md` | Modified |
| `client/src/components/_future/README.md` | Modified |
| `client/src/components/auth/AuthRedirect.tsx` | Modified |
| `client/src/components/auth/ProtectedRoute.tsx` | Modified |
| `client/src/components/auth/README.md` | Modified |
| `client/src/components/co-pilot/README.md` | Modified |
| ... and 129 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/co-pilot-context.tsx)
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/ai-tools/agent.md` - Workspace agent changes (server/agent/embed.js)
- [ ] `server/agent/README.md` - Workspace agent changes (server/agent/embed.js)

### Status: PENDING

---

---
