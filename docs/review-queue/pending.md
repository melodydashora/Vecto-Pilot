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

## Currently Pending

### High Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/database-schema.md` | New tables: `us_market_cities`, `market_intel` | PENDING |
| `docs/preflight/database.md` | New tables need documentation | PENDING |

### Medium Priority

| Doc | Reason | Status |
|-----|--------|--------|
| `docs/architecture/api-reference.md` | New endpoints: `/for-location`, `/markets-dropdown`, `/add-market` | PENDING |

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

**Generated:** 2026-01-05T16:21:05.038Z
**Branch:** main
**Last Commit:** 431a554 Fix missing @google/generative-ai: migrate remaining files to @google/genai

### Uncommitted Changes (32)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `SAVE-IMPORTANT.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/BarsTable.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/README.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-05-summary.md` | Added |
| `docs/reviewed-queue/README.md` | Added |
| `docs/reviewed-queue/RULES_FROM_COMPLETED_WORK.md` | Added |
| `drizzle/meta/README.md` | Deleted |
| `server/api/auth/README.md` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/intelligence/README.md` | Modified |
| ... and 12 more | |

### Recent Commit Changes (10)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/health/diagnostics.js` | Modified |
| `server/lib/ai/adapters/gemini-adapter.js` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `vite.config.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsTable.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-address-resolver.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (server/scripts/seed-market-cities.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T17:01:23.389Z
**Branch:** main
**Last Commit:** 41b55cd Fix: Mount /api/intelligence routes for signup dropdown

### Uncommitted Changes (4)
| File | Status |
|------|--------|
| `ocs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/lib/location/address-validation.js` | Untracked |

### Recent Commit Changes (38)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `SAVE-IMPORTANT.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/BarsTable.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/README.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-05-summary.md` | Added |
| `docs/reviewed-queue/README.md` | Added |
| `docs/reviewed-queue/RULES_FROM_COMPLETED_WORK.md` | Added |
| `drizzle/meta/README.md` | Deleted |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/README.md` | Modified |
| ... and 18 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsTable.tsx)

#### Low Priority
- [ ] Consider adding documentation - New file added (server/scripts/seed-market-cities.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T18:05:37.628Z
**Branch:** main
**Last Commit:** 41b55cd Fix: Mount /api/intelligence routes for signup dropdown

### Uncommitted Changes (11)
| File | Status |
|------|--------|
| `replit` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/adapters/openai-adapter.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `docs/review-queue/IN_PROGRESS_WORKSTREAM.md` | Untracked |
| `server/lib/location/address-validation.js` | Untracked |

### Recent Commit Changes (38)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `SAVE-IMPORTANT.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/BarsTable.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/README.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-05-summary.md` | Added |
| `docs/reviewed-queue/README.md` | Added |
| `docs/reviewed-queue/RULES_FROM_COMPLETED_WORK.md` | Added |
| `drizzle/meta/README.md` | Deleted |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/README.md` | Modified |
| ... and 18 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsTable.tsx)

#### Low Priority
- [ ] Consider adding documentation - New file added (server/scripts/seed-market-cities.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T18:24:03.125Z
**Branch:** main
**Last Commit:** 41b55cd Fix: Mount /api/intelligence routes for signup dropdown

### Uncommitted Changes (13)
| File | Status |
|------|--------|
| `replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/adapters/openai-adapter.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `docs/review-queue/IN_PROGRESS_WORKSTREAM.md` | Untracked |
| `scripts/test-news-fetch.js` | Untracked |
| `server/lib/location/address-validation.js` | Untracked |

### Recent Commit Changes (38)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `SAVE-IMPORTANT.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/BarsTable.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/README.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-05-summary.md` | Added |
| `docs/reviewed-queue/README.md` | Added |
| `docs/reviewed-queue/RULES_FROM_COMPLETED_WORK.md` | Added |
| `drizzle/meta/README.md` | Deleted |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/README.md` | Modified |
| ... and 18 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BarsTable.tsx)

#### Low Priority
- [ ] Consider adding documentation - New file added (server/scripts/seed-market-cities.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T19:49:20.998Z
**Branch:** main
**Last Commit:** 41b55cd Fix: Mount /api/intelligence routes for signup dropdown

### Uncommitted Changes (19)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/adapters/openai-adapter.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/venue/venue-cache.js` | Modified |
| `server/lib/venue/venue-enrichment.js` | Modified |
| `server/lib/venue/venue-intelligence.js` | Modified |
| `docs/review-queue/IN_PROGRESS_WORKSTREAM.md` | Untracked |
| `scripts/test-news-fetch.js` | Untracked |
| `server/lib/location/address-validation.js` | Untracked |

### Recent Commit Changes (38)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `SAVE-IMPORTANT.md` | Modified |
| `briefing-last-row.txt` | Modified |
| `client/src/components/BarsTable.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/README.md` | Modified |
| `client/src/hooks/useMarketIntelligence.ts` | Modified |
| `client/src/pages/auth/SignUpPage.tsx` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/README.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `docs/reviewed-queue/2026-01-05-summary.md` | Added |
| `docs/reviewed-queue/README.md` | Added |
| `docs/reviewed-queue/RULES_FROM_COMPLETED_WORK.md` | Added |
| `drizzle/meta/README.md` | Deleted |
| `package-lock.json` | Modified |
| `package.json` | Modified |
| `server/api/auth/README.md` | Modified |
| ... and 18 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/blocks-fast.js)
- [ ] `docs/architecture/database-schema.md` - Database schema changes (shared/schema.js)
- [ ] `docs/preflight/database.md` - Database schema changes (shared/schema.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-cache.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (server/scripts/seed-market-cities.js)

### Status: PENDING

---

## 2026-01-05 Analysis

**Generated:** 2026-01-05T20:08:56.149Z
**Branch:** main
**Last Commit:** e8e614b Update documentation and review queue

### Uncommitted Changes (6)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.replit` | Modified |
| `briefing-last-row.txt` | Modified |
| `server/lib/strategy/strategy-utils.js` | Modified |
| `docs/review-queue/IN_PROGRESS_WORKSTREAM.md` | Untracked |
| `scripts/test-news-fetch.js` | Untracked |

### Recent Commit Changes (15)
| File | Status |
|------|--------|
| `LESSONS_LEARNED.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `docs/review-queue/2026-01-05.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `server/api/auth/auth.js` | Modified |
| `server/api/location/location.js` | Modified |
| `server/bootstrap/routes.js` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/adapters/openai-adapter.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/location/address-validation.js` | Added |
| `server/lib/venue/venue-cache.js` | Modified |
| `server/lib/venue/venue-enrichment.js` | Modified |
| `server/lib/venue/venue-intelligence.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/ai-pipeline.md` - Strategy pipeline changes (server/lib/strategy/strategy-utils.js)
- [ ] `docs/architecture/auth-system.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/architecture/api-reference.md` - Authentication changes (server/api/auth/auth.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/address-validation.js)
- [ ] `docs/architecture/constraints.md` - Location/GPS changes (server/lib/location/address-validation.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)

### Status: PENDING

---

---
