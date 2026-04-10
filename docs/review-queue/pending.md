# Pending Documentation Review

Items flagged by the Change Analyzer for human-AI validation.

---

## 2026-04-09: Bot Blocker Fix — Replit Preview Pane Unreachable

**Updated by:** Claude Opus 4.6
**Date:** 2026-04-09
**Scope:** Bot blocker `/__repl*` path allowlist

### Problem

Replit preview pane showed "Hmm... We couldn't reach this app" despite the server running healthy on port 5000. Networking panel confirmed port 5000 → external port 80 mapping and correct PID.

### Root Cause

Replit's preview proxy probes `/__repl` and `/__replit` endpoints to determine app reachability. The bot blocker middleware (`server/middleware/bot-blocker.js`) was rejecting these probes because:
1. Line 111: `if (!userAgent) return true` — no User-Agent = treated as bot
2. No path allowlist for Replit's internal `/__repl*` endpoints

These probes returned `403 { "error": "Access denied", "message": "Automated access is not permitted" }`, so Replit's proxy concluded the app was unreachable.

### Timing Hypothesis

Melody confirmed both Helmet and the bot blocker have been in place for a long time, and the preview worked until ~2026-04-08. This suggests **Replit changed their reachability probe behavior** (possibly started checking `/__repl*` endpoints, or changed the User-Agent on probe requests). This is a platform-side change, not a regression in our code.

### Fix

Added `/__repl*` path allowlist in `bot-blocker.js` (line 140), following the same pattern as existing `/health` and `/api/hooks/` allowlists:

```javascript
// 2026-04-09: Allow Replit internal proxy probes (preview pane reachability checks)
if (path.startsWith('/__repl')) {
  return next();
}
```

### Files Changed

| File | Change |
|------|--------|
| `server/middleware/bot-blocker.js` | Added `/__repl*` path allowlist (line 140) |

### Verification

- [x] `curl http://localhost:5000/__repl` → 200 (was 403)
- [x] `curl http://localhost:5000/__replit` → 200 (was 403)
- [x] `curl http://localhost:5000/health` → 200 (unchanged)
- [x] Bot blocking still active for actual bots (no regression)
- [x] **Melody: Confirm preview pane loads after clicking Run** ✅ 2026-04-09

### Status: ✅ VERIFIED — Preview pane working

---

## 2026-04-09/10: Full Sprint — Config, Security, Prod Bugs, Docs, Concierge, Logout Race

**Updated by:** Claude Opus 4.6
**Date:** 2026-04-09 → 2026-04-10
**Scope:** 37+ items resolved across 6 commits

### Work Items (Priority Order)

#### Item 1: Policy JSON Consolidation (D-086, D-087, D-088) — Rule 9

**Problem:** 3 pairs of policy JSONs (`config/` vs `server/config/`) have drifted. Both paths are in active fallback chains. The `config/eidolon-policy.json` has a JSON syntax error that will crash on parse.

**Plan:**
1. Determine which copy is authoritative (likely `config/` — newer `web_fetch_20250910` type)
2. Fix the JSON syntax error in `config/eidolon-policy.json`
3. Delete the `server/config/` duplicates
4. Update all import paths in `config-manager.js`, `enhanced-context-base.js`, `policy-loader.js` to use single `config/` source
5. Update `server/config/README.md`

**Risk:** Low — policy files control agent tool permissions, not core app logic. Consolidation simplifies the fallback chain.

#### Item 2: Drizzle-ORM Security Upgrade (D-090) — GHSA-gpj5-g38j-94v9

**Problem:** SQL injection via improperly escaped identifiers in drizzle-orm@0.44.7.

**Plan:**
```bash
npm install drizzle-orm@0.45.2
npm install -D drizzle-kit@^0.31.10
```

**Verified low risk:**
- Zero `drizzle-zod` imports (no path refactoring needed)
- No dynamic `sql.identifier()` usage
- 1 static `.as()` usage in `feedback.js` (not user-input-driven)
- `serial` type in `shared/schema.js` may emit deprecation warning (cosmetic only)

#### Item 3: Dead Vite Config Cleanup (D-089)

**Problem:** `client/vite.config.ts` is dead code — self-documents "NOT used, see root vite.config.js"

**Plan:** Delete `client/vite.config.ts`. Root `vite.config.js` is authoritative (confirmed by build output + 2026-04-05 update date).

#### Item 4: Vite Security Patches (D-091)

**Problem:** 2 high vulns in vite@7.3.1 (dev-server only, not production)

**Plan:** `npm audit fix` — non-breaking patches available.

### Existing D-077 to D-080 (from full audit 2026-04-04)

These 4 critical discrepancies remain open. Not addressed this session but tracked in `DOC_DISCREPANCIES.md`.

### Commits
| Hash | Description |
|------|-------------|
| `2205a8bc` | Bot blocker, policy consolidation, env validation, catch-all route (7 items) |
| `89068791` | Critical prod bugs, security upgrades, UI fixes (10 items) |
| `e720298a` | Documentation drift + lint fixes (12 items) |
| `2a78c592` | Concierge security: XSS, token bypass, prompt injection, PII leak (4 items) |
| `22fb8285` | Full concierge audit (39 findings) documented |
| `dae1dc7b` | Logout race conditions: SSE, polling, in-flight POST (3 windows closed) |

### Items Resolved: 37+ total
- Production Bugs: D-095, D-096, D-097, D-098, A-001
- Security: D-090, D-091, D-094, X-1, CH-1, CH-2, CH-3, CH-4
- Config/Infra: D-086, D-087, D-088, D-089, bot blocker, .replit ports
- UI: Chat overflow, concierge overflow, snapshot ID, catch-all route
- Documentation: D-077 to D-085
- Lint: A-005, A-006, A-007, SmartBlocks log spam, unused import, dead eslint-disable
- Model: D-101 (translation → flash-lite)
- Race Conditions: Logout SSE cleanup, polling localStorage guard, waterfall AbortController
- Strategy Pipeline: Verified S-001 to S-006 all applied (trigger, locks, status, mapper, error msg)

### Status: ✅ ALL ITEMS EXECUTED AND VERIFIED

---

## 2026-03-29: Analyze-Offer Decision Logic Overhaul (Phase 1 + Phase 2 Alignment)

**Updated by:** Claude Opus 4.6
**Date:** 2026-03-29
**Scope:** Tier-aware decision rules, product type normalization, Phase 1/2 prompt rewrite

### Changes Made

1. **Product type normalization** (`server/lib/offers/parse-offer-text.js`)
   - `extractProductType()` now returns canonical cased names (was storing "Uberx", "uberx Exclusive", etc.)
   - New `classifyTier()` function: maps product types → `share` / `standard` / `premium`
   - Data-driven from 300+ DFW `offer_intelligence` records

2. **Three-tier decision system** (`server/api/hooks/analyze-offer.js`)
   - **Share** (Share, Lyft Shared): Auto-REJECT, skips AI call entirely (median $0.69, 0% accept)
   - **Standard** (UberX, Exclusive, Priority, Lyft): Floor $0.90, tight time limits (20/25/30/40 min)
   - **Premium** (Comfort, VIP, Black, XL): Floor $1.10, relaxed time limits (25/30/40/50 min)
   - Previously: 6/7 Comfort + 13/13 VIP wrongly rejected due to flat thresholds

3. **Phase 1 prompt → tier-specific prompts** (`PHASE1_PROMPTS` object)
   - Three separate prompts (share/standard/premium) selected at runtime via `classifyTier()`
   - Share short-circuits before AI call — zero latency, zero token cost
   - Premium prompt has higher floor ($1.10) and more generous time windows

4. **Phase 2 tier injection** — tier tag added to Phase 2 system prompt so deep analysis applies correct rules

5. **Deterministic fallback updated** — tier-aware branching in fallback logic mirrors AI prompts exactly

6. **Terse notification with tier tag** — premium notifications include ` prem` suffix: `"ACCEPT: $1.21 13.7mi prem"`

### Siri Shortcut Endpoint

```
POST https://69f9de93-7dc3-48aa-9050-4c395406d344-00-3uat6a5ciur3j.riker.replit.dev/api/hooks/analyze-offer
```

### Documentation Updated

| File | Change |
|------|--------|
| `server/api/hooks/README.md` | Three-tier decision rules: tier classification table + standard/premium rule tables |
| `server/lib/offers/parse-offer-text.js` | Canonical product types + `classifyTier()` export |

### Verification

- [x] Phase 1 prompts (standard/premium) match fallback logic tiers
- [x] Phase 2 rules include tier-aware rule sets + tier context injection
- [x] README decision tables match code (standard + premium)
- [x] Share short-circuit skips AI call and returns instantly
- [x] Product type normalization eliminates case fragmentation
- [x] `classifyTier()` covers all known product types from DB
- [x] `reasoning` → `reason` rename backward-compatible (`reason \|\| reasoning`)
- [x] Dev endpoint verified (204 OPTIONS)

### Status: ⏳ AWAITING TEST APPROVAL

---

## 2026-03-17: Branch Merges + Translation Feature Integration

**Updated by:** Claude Opus 4.6
**Date:** 2026-03-17
**Scope:** 3 feature branches merged, translation feature hardened for production

### Branches Merged

1. **`claude/add-research-enhancements-RkG6B`** — New `docs/research/` folder (algorithm research + mobile subscription architecture)
2. **`claude/analyze-briefings-workflow-Ylu9Q`** — 2 doc-fix commits (location fallback correction, M-9 expanded to 3 endpoints)
3. **`claude/plan-translation-feature-arvDr`** — Real-time rider translation (FIFA World Cup, 15 languages, split-screen UI)

### Translation Integration Changes (Post-Merge Hardening)

| File | Change |
|------|--------|
| `client/src/components/co-pilot/BottomTabNavigation.tsx` | Added Translate tab (7th tab, Languages icon) |
| `server/api/translate/translation-prompt.js` | NEW — Shared prompt, languages, JSON parser (Rule 9 consolidation) |
| `server/api/translate/index.js` | Imports shared module, added `translationLimiter` (30 req/min) |
| `server/api/hooks/translate.js` | Imports shared module, added `translationLimiter` |
| `server/middleware/rate-limit.js` | Added `translationLimiter` export |
| `server/lib/external/tts-handler.js` | Language-to-voice mapping (alloy for European, nova for Asian tonal) |
| `ARCHITECTURE.md` | Added Research & Analysis section, translation changelog |

### Branches Closed (Stale)

- `claude/consolidate-repo-docs-doYAP` — 3 months old, content outdated, deleted from remote
- `claude/setup-ide-tools-itkSq` — 27 merge conflicts, massive scope creep, deleted from remote

### Flagged for Future Sessions

- **25 briefing code bugs** (5 critical, 8 high) documented in `docs/architecture/briefing-issues-findings.md` — needs separate implementation PR
- **Research P0 features** (acceptance rate tracking, multiple stops detection) — not yet implemented
- **6 Dependabot vulnerabilities** (5 high, 1 low) flagged by GitHub

### Status: COMPLETE

---

## 2026-02-26: Phases 3-5 — Briefing Simplification + Strategy Prompt Enhancement + Venue Enrichment

**Updated by:** Claude Opus 4.6
**Date:** 2026-02-26
**Scope:** Consolidator data optimization, strategy prompt intelligence, venue enrichment on discovery

### Changes Made

1. **Phase 3 - Simplify briefing data** (`consolidator.js`, `briefing-service.js`)
   - `optimizeWeatherForLLM()` returns `driverImpact` summary string instead of full JSON blob
   - `optimizeNewsForLLM()` reduced from 8 to 5 items, headline+impact only
   - `optimizeAirportForLLM()` generates `travelImpact` summary string
   - `formatNewsForPrompt()` new helper: formats news as `- [HIGH] headline` strings
   - Removed `optimizeTrafficForLLM()` (unused after simplification)
   - Bug fix: `snapshot.weather` changed to `briefing.weather` in tactical prompt
   - `generateWeatherDriverImpact()` added to `briefing-service.js` (deterministic, no LLM)

2. **Phase 4 - Enhanced strategy prompts** (`consolidator.js`)
   - STRATEGY_TACTICAL prompt: time-of-day intelligence, event END time surge, cluster logic, "head home" option
   - STRATEGY_DAILY prompt: same principles, organized as time-block strategy
   - System messages updated for experienced driver mindset

3. **Phase 5 - Venue enrichment on discovery** (`venue-cache.js`)
   - `enrichVenueFromPlaceId()` calls Google Places API `GET /v1/places/{placeId}` for phone, rating, hours, types, status
   - `maybeBackfillVenue()` triggers enrichment for existing venues missing phone/rating
   - `findOrCreateVenue()` triggers non-blocking enrichment after creating new event venues
   - Existing venue matches trigger backfill if missing phone/rating

### Documentation Updated

| File | Change |
|------|--------|
| `server/lib/briefing/README.md` | Added Weather Driver Impact section, updated briefing structure |
| `server/lib/ai/providers/README.md` | Updated consolidator docs, added data optimization helpers table, added prompt intelligence section |
| `server/lib/venue/README.md` | Added Venue Enrichment on Discovery section, updated files table and external APIs |
| `APICALL.md` | Added Google Places GET by placeId for venue enrichment |
| `docs/architecture/server-structure.md` | Updated consolidator.js description |

### Status: COMPLETE

---

## 2026-02-26: Model Registry Update — Gemini 3.1 Pro + Specialty Models

**Updated by:** Claude Opus 4.6
**Date:** 2026-02-26
**Scope:** All AI model references updated to latest versions

### Changes Made

1. **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) — set as default for all 20+ Gemini-primary roles
2. **AI Coach** — explicitly upgraded to Gemini 3.1 Pro with updated purpose string
3. **`.env.example`** — updated from stale `claude-opus-4-5-20251101` → `claude-opus-4-6` (6 refs) and `gemini-3-pro-preview` → `gemini-3.1-pro-preview` (2 refs)
4. **New specialty models documented** (not yet assigned to roles):
   - `gemini-2.5-flash-native-audio-latest` — Realtime Voice Coach (future)
   - `gemini-3-pro-image-preview` — Vision/screenshot analysis (future)
5. **OFFER_ANALYZER** — added comments noting 3.1 Pro and image-preview as vision alternatives
6. **MODEL_QUIRKS** — added `gemini-3.1-pro` entry for thinking level constraints
7. **Legacy ref verification** — zero `gemini-1.5-pro`, `gemini-3-pro-preview`, or `claude-opus-4-5` refs in `server/api/` routes

### Files Modified

| File | Change |
|------|--------|
| `server/lib/ai/model-registry.js` | Header, AI_COACH, OFFER_ANALYZER, DOCS_GENERATOR, quirks |
| `.env.example` | All model IDs updated to current |
| ~~`MODEL.md`~~ | DELETED 2026-02-26 — content merged into `docs/preflight/ai-models.md` |
| `docs/preflight/ai-models.md` | Specialty models section |

### Status: COMPLETE — Verify `.env.local` (gitignored) has matching values

---

## 2026-02-17: All Items Reviewed

**Reviewed by:** Claude Opus 4.6
**Date:** 2026-02-17
**Scope:** Feb 7–17 daily logs (12 files, ~2,300 items across multiple server restarts)

### What Was Done

1. **Verified all 10 flagged doc files** — zero AI preambles, correct markdown structure
2. **Fixed 6 corrupted doc files** — stripped AI preambles injected by the Docs Agent
3. **Reverted 1 data-loss corruption** — `api-reference.md` had endpoint rows deleted by Docs Agent
4. **Hardened the Docs Agent pipeline** to prevent future corruption:
   - Added `PROTECTED_FILES` set (CLAUDE.md, ARCHITECTURE.md, GEMINI.md, etc.)
   - Enforced `allowed_paths` from `docs-policy.json` (was defined but never checked)
   - Added content size validation (rejects >50% shrinkage)
   - Added AI preamble detection (9 regex patterns)
   - Added structural integrity checks (table/header preservation)
5. **Identified root cause of CLAUDE.md truncation** — Docs Agent mapped `gateway-server.js` changes to CLAUDE.md and overwrote it with AI commentary. Fixed by removing from mapping + adding to protected files.
6. **Moved all Feb 7–17 daily logs to `../reviewed-queue/`**

### Status: REVIEWED

## 2026-02-17 Analysis

**Generated:** 2026-02-17T19:20:00.130Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (77)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| `docs/review-queue/2026-02-10.md` | Deleted |
| `docs/review-queue/2026-02-11.md` | Deleted |
| `docs/review-queue/2026-02-12.md` | Deleted |
| `docs/review-queue/2026-02-13.md` | Deleted |
| `docs/review-queue/2026-02-14.md` | Deleted |
| `docs/review-queue/2026-02-15-findings.md` | Deleted |
| `docs/review-queue/2026-02-15.md` | Deleted |
| `docs/review-queue/2026-02-16.md` | Deleted |
| `docs/review-queue/2026-02-17.md` | Deleted |
| `docs/review-queue/FIX_PLAN_2026-02-01.md` | Deleted |
| ... and 57 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/db-client.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/db-client.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-17 Analysis

**Generated:** 2026-02-17T19:54:06.536Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (80)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| `docs/review-queue/2026-02-10.md` | Deleted |
| `docs/review-queue/2026-02-11.md` | Deleted |
| `docs/review-queue/2026-02-12.md` | Deleted |
| `docs/review-queue/2026-02-13.md` | Deleted |
| `docs/review-queue/2026-02-14.md` | Deleted |
| `docs/review-queue/2026-02-15-findings.md` | Deleted |
| `docs/review-queue/2026-02-15.md` | Deleted |
| `docs/review-queue/2026-02-16.md` | Deleted |
| ... and 60 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/client-structure.md` - Context provider changes (client/src/contexts/auth-context.tsx)
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/db-client.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/db-client.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-17 Analysis

**Generated:** 2026-02-17T20:47:13.372Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (85)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| `docs/review-queue/2026-02-10.md` | Deleted |
| `docs/review-queue/2026-02-11.md` | Deleted |
| `docs/review-queue/2026-02-12.md` | Deleted |
| ... and 65 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/db-client.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/db-client.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-17 Analysis

**Generated:** 2026-02-17T21:03:04.812Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (87)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| `docs/review-queue/2026-02-10.md` | Deleted |
| `docs/review-queue/2026-02-11.md` | Deleted |
| `docs/review-queue/2026-02-12.md` | Deleted |
| ... and 67 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/db-client.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/db-client.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-17 Analysis

**Generated:** 2026-02-17T22:05:09.370Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (89)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| `docs/review-queue/2026-02-10.md` | Deleted |
| `docs/review-queue/2026-02-11.md` | Deleted |
| `docs/review-queue/2026-02-12.md` | Deleted |
| ... and 69 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-17 Analysis

**Generated:** 2026-02-17T22:31:02.541Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (89)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| `docs/review-queue/2026-02-10.md` | Deleted |
| `docs/review-queue/2026-02-11.md` | Deleted |
| `docs/review-queue/2026-02-12.md` | Deleted |
| ... and 69 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-18 Analysis

**Generated:** 2026-02-18T15:36:12.040Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (92)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| ... and 72 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-18 Analysis

**Generated:** 2026-02-18T20:49:21.169Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (94)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-07.md` | Deleted |
| `docs/review-queue/2026-02-08.md` | Deleted |
| `docs/review-queue/2026-02-09.md` | Deleted |
| ... and 74 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/GlobalHeader.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-18 Analysis

**Generated:** 2026-02-18T21:14:40.167Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (101)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| ... and 81 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-19 Analysis

**Generated:** 2026-02-19T00:45:23.188Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (103)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| ... and 83 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-19 Analysis

**Generated:** 2026-02-19T12:54:33.934Z
**Branch:** main
**Last Commit:** e55d0ff0 fix(docs-agent): Broaden validator to catch all AI commentary patterns

### Uncommitted Changes (105)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| ... and 85 more | |

### Recent Commit Changes (19)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/database-schema.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-17.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `migrations/20260217_drop_briefing_ready_trigger.sql` | Added |
| `server/db/db-client.js` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/index.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/change-analyzer/file-doc-mapping.js` | Modified |
| `server/lib/docs-agent/orchestrator.js` | Modified |
| `server/lib/docs-agent/validator.js` | Modified |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)

### Status: PENDING

---

## 2026-02-19 Analysis

**Generated:** 2026-02-19T14:40:02.631Z
**Branch:** main
**Last Commit:** a40d46f2 Published your App

### Uncommitted Changes (6)
| File | Status |
|------|--------|
| `YSTEM_MAP.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-19.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `snapshot.txt` | Modified |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/index.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/index.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-19 Analysis

**Generated:** 2026-02-19T19:32:18.096Z
**Branch:** main
**Last Commit:** 76f325c4 Published your App

### Uncommitted Changes (1)
| File | Status |
|------|--------|
| `napshot.txt` | Modified |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/validate-env.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-25 Analysis

**Generated:** 2026-02-25T22:18:52.804Z
**Branch:** main
**Last Commit:** 76f325c4 Published your App

### Uncommitted Changes (18)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `CLAUDE.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `docs/architecture/README.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/review-queue/2026-02-19.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `gateway-server.js` | Modified |
| `package.json` | Modified |
| `scripts/start-replit.js` | Modified |
| `server/config/validate-env.js` | Modified |
| `server/config/validate-strategy-env.js` | Deleted |
| `server/scripts/db-doctor.js` | Deleted |
| `snapshot.txt` | Modified |
| `start-mono.sh` | Deleted |
| `docs/architecture/database-environments.md` | Untracked |
| `docs/plans/CLEANUP_LEGACY_ENV_2026-02-25.md` | Untracked |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/validate-env.js)
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-25 Analysis

**Generated:** 2026-02-25T22:37:48.516Z
**Branch:** main
**Last Commit:** 76f325c4 Published your App

### Uncommitted Changes (28)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `docs/architecture/README.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/review-queue/2026-02-19.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `gateway-server.js` | Modified |
| `package.json` | Modified |
| `scripts/README.md` | Modified |
| `scripts/start-replit.js` | Modified |
| `server/config/README.md` | Modified |
| `server/config/load-env.js` | Modified |
| `server/config/validate-env.js` | Modified |
| `server/config/validate-strategy-env.js` | Deleted |
| ... and 8 more | |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/location/location.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/load-env.js)
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-25 Analysis

**Generated:** 2026-02-25T23:15:17.996Z
**Branch:** main
**Last Commit:** 76f325c4 Published your App

### Uncommitted Changes (37)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `docs/architecture/README.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/review-queue/2026-02-19.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `gateway-server.js` | Modified |
| `mono-mode.env.example` | Deleted |
| `package.json` | Modified |
| `scripts/README.md` | Modified |
| `scripts/start-replit.js` | Modified |
| `server/api/health/diagnostics.js` | Modified |
| ... and 17 more | |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/health/diagnostics.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/env-registry.js)
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-25 Analysis

**Generated:** 2026-02-25T23:30:31.178Z
**Branch:** main
**Last Commit:** 76f325c4 Published your App

### Uncommitted Changes (38)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `docs/architecture/README.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/review-queue/2026-02-19.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `gateway-server.js` | Modified |
| `mono-mode.env.example` | Deleted |
| `package.json` | Modified |
| `scripts/README.md` | Modified |
| `scripts/start-replit.js` | Modified |
| ... and 18 more | |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/health/diagnostics.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/env-registry.js)
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-25 Analysis

**Generated:** 2026-02-25T23:45:11.703Z
**Branch:** main
**Last Commit:** 76f325c4 Published your App

### Uncommitted Changes (38)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `CLAUDE.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `docs/architecture/README.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| `docs/architecture/client-structure.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/architecture/server-structure.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/review-queue/2026-02-19.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `gateway-server.js` | Modified |
| `mono-mode.env.example` | Deleted |
| `package.json` | Modified |
| `scripts/README.md` | Modified |
| `scripts/start-replit.js` | Modified |
| ... and 18 more | |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/health/diagnostics.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/ai-models.md` - AI model/adapter changes (server/lib/ai/model-registry.js)
- [ ] `docs/architecture/ai-pipeline.md` - AI model/adapter changes (server/lib/ai/model-registry.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/location.md` - Venue logic changes (server/lib/venue/venue-intelligence.js)

#### Low Priority
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/env-registry.js)
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-26 Analysis

**Generated:** 2026-02-26T01:11:02.092Z
**Branch:** main
**Last Commit:** 76f325c4 Published your App

### Uncommitted Changes (67)
| File | Status |
|------|--------|
| `claude/settings.local.json` | Modified |
| `.env.example` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `APICALL.md` | Modified |
| `CLAUDE.md` | Modified |
| `GEMINI.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `MODEL.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `client/src/components/concierge/ConciergeMap.tsx` | Modified |
| `client/src/components/concierge/EventsExplorer.tsx` | Modified |
| `config/agent-policy.json` | Modified |
| `config/assistant-policy.json` | Modified |
| `config/eidolon-policy.json` | Modified |
| `docs/ai-tools/eidolon.md` | Modified |
| `docs/architecture/README.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 47 more | |

### Recent Commit Changes (102)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| `client/src/components/briefing/WeatherCard.tsx` | Modified |
| `client/src/constants/apiRoutes.ts` | Modified |
| `client/src/contexts/auth-context.tsx` | Modified |
| `client/src/contexts/co-pilot-context.tsx` | Modified |
| `client/src/contexts/location-context-clean.tsx` | Modified |
| `client/src/hooks/useBriefingQueries.ts` | Modified |
| `client/src/pages/auth/google/Callback.tsx` | Modified |
| `client/src/pages/co-pilot/BriefingPage.tsx` | Modified |
| `config/docs-policy.json` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/api-reference.md` | Modified |
| ... and 82 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/chat/chat.js)
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/holiday-detector.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy pipeline changes (server/lib/strategy/strategy-generator-parallel.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/concierge/ConciergeMap.tsx)
- [ ] `docs/ai-tools/eidolon.md` - Eidolon SDK changes (server/eidolon/config.ts)
- [ ] `server/eidolon/README.md` - Eidolon SDK changes (server/eidolon/config.ts)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)

#### Low Priority
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/agent-policy.json)
- [ ] Consider adding documentation - New file added (migrations/20260217_drop_briefing_ready_trigger.sql)
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-26 Analysis

**Generated:** 2026-02-26T02:52:31.696Z
**Branch:** main
**Last Commit:** 40452771 Published your App

### Uncommitted Changes (6)
| File | Status |
|------|--------|
| `erver/lib/ai/adapters/README.md` | Modified |
| `server/lib/ai/adapters/gemini-adapter.js` | Modified |
| `server/lib/briefing/README.md` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/concierge/concierge-service.js` | Modified |
| `snapshot.txt` | Modified |

### Recent Commit Changes (163)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.env.example` | Modified |
| `mono-mode.env.example` | Renamed |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `APICALL.md` | Modified |
| `CLAUDE.md` | Modified |
| `FEATURESANDNOTES.md` | Deleted |
| `GEMINI.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `MODEL.md` | Deleted |
| `README.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `agent-server.js` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| ... and 143 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/chat/chat.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/holiday-detector.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/ai-tools/eidolon.md` - Eidolon SDK changes (server/eidolon/config.ts)
- [ ] `server/eidolon/README.md` - Eidolon SDK changes (server/eidolon/config.ts)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/agent-policy.json)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-26 Analysis

**Generated:** 2026-02-26T03:01:36.093Z
**Branch:** main
**Last Commit:** 40452771 Published your App

### Uncommitted Changes (16)
| File | Status |
|------|--------|
| `ocs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-26.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/eidolon/README.md` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/README.md` | Modified |
| `server/lib/ai/adapters/gemini-adapter.js` | Modified |
| `server/lib/briefing/README.md` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/concierge/concierge-service.js` | Modified |
| `snapshot.txt` | Modified |

### Recent Commit Changes (163)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.env.example` | Modified |
| `mono-mode.env.example` | Renamed |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `APICALL.md` | Modified |
| `CLAUDE.md` | Modified |
| `FEATURESANDNOTES.md` | Deleted |
| `GEMINI.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `MODEL.md` | Deleted |
| `README.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `agent-server.js` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| ... and 143 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/chat/chat.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/holiday-detector.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/ai-tools/eidolon.md` - Eidolon SDK changes (server/eidolon/config.ts)
- [ ] `server/eidolon/README.md` - Eidolon SDK changes (server/eidolon/config.ts)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/agent-policy.json)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-02-26 Analysis

**Generated:** 2026-02-26T03:25:37.144Z
**Branch:** main
**Last Commit:** 40452771 Published your App

### Uncommitted Changes (18)
| File | Status |
|------|--------|
| `ocs/ai-tools/eidolon.md` | Modified |
| `docs/architecture/ai-pipeline.md` | Modified |
| `docs/architecture/constraints.md` | Modified |
| `docs/preflight/ai-models.md` | Modified |
| `docs/preflight/database.md` | Modified |
| `docs/preflight/location.md` | Modified |
| `docs/review-queue/2026-02-26.md` | Modified |
| `docs/review-queue/pending.md` | Modified |
| `sent-to-strategist.txt` | Modified |
| `server/eidolon/README.md` | Modified |
| `server/lib/ai/README.md` | Modified |
| `server/lib/ai/adapters/README.md` | Modified |
| `server/lib/ai/adapters/gemini-adapter.js` | Modified |
| `server/lib/ai/model-registry.js` | Modified |
| `server/lib/briefing/README.md` | Modified |
| `server/lib/briefing/briefing-service.js` | Modified |
| `server/lib/concierge/concierge-service.js` | Modified |
| `snapshot.txt` | Modified |

### Recent Commit Changes (163)
| File | Status |
|------|--------|
| `.claude/settings.local.json` | Modified |
| `.env.example` | Modified |
| `mono-mode.env.example` | Renamed |
| `.gitignore` | Modified |
| `.replit` | Modified |
| `APICALL.md` | Modified |
| `CLAUDE.md` | Modified |
| `FEATURESANDNOTES.md` | Deleted |
| `GEMINI.md` | Modified |
| `LESSONS_LEARNED.md` | Modified |
| `LEXICON.md` | Modified |
| `MODEL.md` | Deleted |
| `README.md` | Modified |
| `SYSTEM_MAP.md` | Modified |
| `WORKFLOW_FILE_LISTING.md` | Modified |
| `agent-ai-config.js` | Deleted |
| `agent-server.js` | Modified |
| `client/src/components/BriefingTab.tsx` | Modified |
| `client/src/components/GlobalHeader.tsx` | Modified |
| `client/src/components/briefing/SchoolClosuresCard.tsx` | Modified |
| ... and 143 more | |

### Documentation Review Needed

#### High Priority
- [ ] `docs/preflight/ai-models.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/ai-pipeline.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `server/lib/ai/README.md` - Model adapter changes (server/lib/ai/adapters/gemini-adapter.js)
- [ ] `docs/architecture/server-structure.md` - Main server changes (gateway-server.js)
- [ ] `docs/architecture/api-reference.md` - API endpoint changes (server/api/chat/chat.js)
- [ ] `docs/architecture/strategy-framework.md` - Strategy API changes (server/api/strategy/strategy-events.js)
- [ ] `docs/preflight/location.md` - Location/GPS changes (server/lib/location/holiday-detector.js)

#### Medium Priority
- [ ] `docs/architecture/client-structure.md` - Component changes (client/src/components/BriefingTab.tsx)
- [ ] `docs/architecture/database-schema.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/preflight/database.md` - Database connection changes (server/db/connection-manager.js)
- [ ] `docs/ai-tools/eidolon.md` - Eidolon SDK changes (server/eidolon/config.ts)
- [ ] `server/eidolon/README.md` - Eidolon SDK changes (server/eidolon/config.ts)

#### Low Priority
- [ ] Consider adding documentation - New file added (scripts/test-snapshot-workflow.js)
- [ ] docs/architecture/constraints.md - Configuration changes (server/config/agent-policy.json)
- [ ] Consider adding documentation - New file added (snapshot.txt)

### Status: PENDING

---

## 2026-04-04: Full Repository Audit (5-Agent Parallel Analysis)

**Updated by:** Claude Opus 4.6
**Date:** 2026-04-04
**Scope:** Server, Client, Schema, Documentation, Code Quality — comprehensive sweep

### Summary

Full audit conducted with 5 parallel exploration agents covering:
- Server architecture (228 files, ~57K LOC)
- Client architecture (62+ components, 23 pages, ~32K LOC)
- Database schema (55 tables, 27 migrations)
- Bug/issue detection across entire codebase
- Documentation accuracy review

### Key Findings

| Severity | Count | Top Issue |
|----------|-------|-----------|
| CRITICAL | 5 | Briefing runtime bugs (C-1 to C-5) — barrel export mismatches, missing imports, wrong params |
| HIGH | 15 | Unprotected JSON.parse (15+ locations), silent promise rejections, no AI call timeouts |
| MEDIUM | 12 | Dead code (9 functions), 4 ESLint violations, stale ARCHITECTURE.md, debug flags |
| LOW | 5 | TODO cleanup, naming consistency |

### Full Report

See `docs/architecture/full-audit-2026-04-04.md` for complete findings with file paths and line numbers.

### Prior Unfixed Items Confirmed Still Open

1. **Offer tier overhaul** — AWAITING TEST APPROVAL since 2026-03-29
2. **25 briefing bugs** — DOCUMENTED since 2026-03-09, UNFIXED
3. **Research P0 features** — NOT IMPLEMENTED
4. **Dependabot vulnerabilities** — FLAGGED

### Status: DOCUMENTED — AWAITING PRIORITIZED IMPLEMENTATION

---

## 2026-04-04: Frontend "undefined is not iterable" Crash Fix

**Updated by:** Claude Opus 4.6
**Date:** 2026-04-04
**Scope:** Client-side crash when API returns `success: false` or null array fields

### Root Cause

`onAfterProcessingUnexpectedShift` in call stack = React Scheduler internal. Crash happens during re-render when state update delivers null where array expected. Two code paths triggered it:

1. **API response `{ success: false, news: null }`** — queryFn returned raw response, null flowed to components that iterated it
2. **Strategy completion → blocks/venue loading** — `filterHighValueSpacedBlocks()` received null during transition

### Fixes Applied (3 layers, defense-in-depth)

**Layer 1: Utility functions** (`client/src/utils/co-pilot-helpers.ts`)
- `filterValidEvents()` — added `Array.isArray()` guard before `for...of` loop
- `filterHighValueSpacedBlocks()` — same guard, returns `[]` on null/undefined input

**Layer 2: API boundary** (`client/src/hooks/useBriefingQueries.ts`)
- All 7 queryFns now check `data?.success === false` before returning
- Replaces raw response with safe defaults (`{ news: null }`, `{ events: [] }`, etc.)

**Layer 3: Context** (`client/src/contexts/co-pilot-context.tsx`)
- `briefingData.events` and `briefingData.marketEvents` now use `Array.isArray()` — always arrays, never null
- `schoolClosures` same treatment

### Status: ⏳ AWAITING TEST APPROVAL

---

## 2026-04-04: MapTab/EventFilter Infinite Loop Fix (~500ms re-renders)

**Updated by:** Claude Opus 4.6
**Date:** 2026-04-04
**Scope:** Map tab re-processing event markers every ~500ms even when data unchanged

### Root Cause

Every parent re-render created a new `mapEvents` array via inline `.map()` at MapPage:157. New reference cascaded through MapTab's `useMemo → useEffect → marker clear/re-add` cycle, repeating every ~500ms.

### Fixes Applied

1. **MapPage.tsx** — Wrapped `venues` and `mapEvents` in `useMemo` with `[blocks]` and `[activeEventsData?.events]` deps
2. **MapTab.tsx** — Added `lastEventKeyRef` dedup check; skips marker rebuild if event data unchanged
3. **co-pilot-helpers.ts** — Removed per-event console.logs from hot-path filter functions

### Status: ⏳ AWAITING TEST APPROVAL

---
