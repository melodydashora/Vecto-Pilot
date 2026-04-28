# Vecto Pilot Codebase Audit — 2026-04-27

> **Branch:** `audit/codebase-2026-04-27` off `main` at `d39d570f` (Merge: `chore/remove-daily-strategy` — Daily 8-12hr strategy removed end-to-end).
> **Scope:** Working/broken state, naming conventions, duplications. Static analysis only — runtime behavior not verified.
> **Initial snapshot:** 2026-04-27 ~17:00 UTC.
> **Re-sweep:** 2026-04-27 ~22:30 UTC — see **Section 9** for what changed in the intervening hours (16 new commits, including a CLEAR_CONSOLE_WORKFLOW log-system overhaul, a hedged-router extraction, a new diagnostics endpoint family, a coach TTS unblock fix, and a `setPersistentStrategy` runtime-bug fix that surfaced from improved error logging).
> **Snapshot now covers:** `main` (`d39d570f`) **plus the post-audit working state of `coach-pass2-phase-b`** through commit `8eb18081`. Original sections describe state at initial snapshot; Section 9 marks where they've been superseded.

## Executive summary

Five top findings, ordered by impact:

1. **Documentation drift around daily-strategy removal is the dominant issue.** The `chore/remove-daily-strategy` merge (`d39d570f`) cleanly removed `STRATEGY_DAILY`, `generateDailyStrategy()`, and the `consolidated_strategy` write path from code, but **at least seven canonical docs still reference these as if live**: `docs/AI_ROLE_MAP.md`, `docs/architecture/LLM-REQUESTS.md`, `docs/architecture/AI_MODEL_ADAPTERS.md`, `docs/architecture/briefing-transformation-path.md`, `docs/architecture/DB_SCHEMA.md`, `docs/EVENTS.md`, `docs/AUDIT_SYNTHESIS_2026-04.md`. A reader following these docs would fail to understand the live pipeline. (Section 4.1)

2. **`docs/api-routes-registry.md` (Last Updated: 2025-12-14) is ~5 months stale.** It documents a "TRIAD Pipeline" with three phases including "Daily + Immediate Consolidator" — but daily was removed in April. It also misses six newer routes (memory, translate, hooks, tactical-plan, coach updates, realtime). (Section 4.2)

3. **`server/lib/strategy/` is dead-code archaeology.** Of the 11 files in that directory, **only two are reachable from live code paths** (`tactical-planner.js`, `status-constants.js`, plus the small `strategy-utils.js`). The rest — `strategy-generator.js`, `strategy-generator-parallel.js`, `providers.js`, `assert-safe.js`, `planner-gpt5.js`, `strategyPrompt.js`, `index.js` — have zero importers. Live strategy logic is in `server/lib/ai/providers/consolidator.js`. (Section 6.1)

4. **The "immediate strategy" concept has four naming surfaces** (the user's call-out is justified). Same logical thing, four spellings: function `runImmediateStrategy` / `generateImmediateStrategy`, parameter `immediateStrategy`, DB column `strategy_for_now`, comments call it "immediate 1-hour tactical." This is the dominant naming-conflict pattern in the codebase. (Section 5.1)

5. **AI registry vs callsites is otherwise clean.** All 26 roles in `MODEL_ROLES` are reachable from at least one live caller. Naming-lag exists but is contained in dead code (`fetchNewsWithClaudeWebSearch`, `fetchEventsWithClaudeWebSearch`, `_fetchEventsWithGemini3ProPreviewLegacy` — all uncalled, retained for emergency rollback). (Sections 2 and 5.6)

**Update findings added 2026-04-27 evening (Section 9):**

6. **A CLEAR_CONSOLE_WORKFLOW spec landed in 8 commits today.** Workflow logger now drives a numbered-stage convention (`[TRIAD 1/4]`, `[VENUES 2/4]`, etc.); `server/lib/ai/router/` was extracted from `adapters/index.js`; new `/api/logs/*` mobile diagnostics endpoint family (file-tee + auth-gated tail/stream/viewer). My initial recommendation to decommission "TRIAD" branding (§5.2) is now **in tension with the new logging convention** — see §11.4 for the revised recommendation.

7. **New dead-code candidate: `server/types/driving-plan.ts`** (166 lines, 15 types/interfaces, **zero importers** anywhere in `server/` or `client/`). Unimplemented "shift planning" feature scaffolding. Not breaking anything but worth flagging now before it accretes more.

8. **Improved error-boundary logging immediately surfaced one real client-side runtime bug** (`setPersistentStrategy` references in `co-pilot-context.tsx` after the state setter was deleted). Pattern: this is the type of dead-code residue my audit's static analysis can find, but only if it lives at the file-import level, not at the variable-reference level inside a file. Two more commits today (`fa23e3af`, `e3c66a7a`) demonstrate this exact diagnosis pipeline working in real time.

The codebase itself is in good shape; **the docs lag is what bites a new reader (or an LLM agent) the hardest**.

---

## Methodology, scope, and caveats

**Method.** Four parallel SSH-driven exploration agents read the live filesystem; cross-checks were run by hand against `model-registry.js`, `blocks-fast.js`, `consolidator.js`, route-mount file, and the canonical docs in `docs/architecture/`.

**Scope.** Backbone files for production: route mounts, briefing pipeline, strategy pipeline, venue/Smart Blocks pipeline, AI adapter + registry, top-level entry points, key client routing.

**Out of scope (not audited deeply):**
- Authentication middleware internals
- Hooks / Siri integration internals
- Concierge module beyond role wiring
- Translate / TTS / realtime token internals
- Most client-side hooks (only routing + page→API mapping was sampled)
- Database migrations history
- Build, CI, deploy configuration

**Caveats:**
- This is a **static read of source code**. "Working" = "the call graph is intact and the registry resolves cleanly," not "verified at runtime." A function whose call graph is intact can still fail in production for reasons (auth, env, network, etc.) outside this audit's scope.
- "Dead code" claims rest on **import-graph analysis**: a file with zero importers is dead unless launched as a subprocess (root-level `.js` files are checked separately).
- Line numbers cited are from the live filesystem on `coach-pass2-phase-b` (which is `main + 5 coach commits` that don't touch the audited domains; line numbers should match `main` for those domains).

**Existing audit corpus referenced (and what this doc supersedes vs. complements):**

| Existing doc | Status | This audit's relationship |
|---|---|---|
| `LEXICON.md` (819 lines) | Terminology glossary | Complements — this audit doesn't redefine terms; it identifies surface-form proliferation for the same concept |
| `SYSTEM_MAP.md` (last updated 2026-02-19, 549 lines) | Component diagrams | Stale on the post-daily-removal pipeline. This audit supplies the corrected blocks-fast flow |
| `APICALL.md` (514 lines) | External API call catalog (Google, OpenAI, Anthropic) | Complements — different scope (external APIs vs internal codebase audit) |
| `docs/api-routes-registry.md` (Last Updated: 2025-12-14, 212 lines) | Internal API endpoint list | **Substantially stale** (Section 4.2). This audit lists drift; the registry needs a refresh PR |
| `docs/AI_ROLE_MAP.md` (Last reviewed: 2026-04-25) | AI role ownership map | **Pre-dates** the daily-removal merge by 1 day. Several of its claims are now stale (Section 4.4) |
| `docs/MISMATCHED.md` (228 lines) | Entry-point analysis | Complements — narrower scope, focused on which top-level `.js` files are entry points |
| `docs/DEAD_CODE_ANALYSIS.md` | Dead code inventory | **Should be re-run** after the daily-removal merge. The new dead code in `server/lib/strategy/` should be added |
| `docs/architecture/audits/` | Multiple dated audits (FRISCO_LOCK, GEOGRAPHIC_ANCHOR, NEON_AUTOSCALE, NOTIFY_LOSS_RECON) | Different scopes — those are incident/architecture reports. This audit complements them |

---

## 1. Live production path: the `blocks-fast` pipeline

The header comment in `server/api/strategy/blocks-fast.js:1-32` documents the **post-daily-removal pipeline**, and the imports + call graph match. This is the canonical live path.

```
POST /api/blocks-fast
  ↓
[advisory lock per snapshotId]  pg_advisory_xact_lock — server/api/strategy/blocks-fast.js
  ↓
ensureStrategyRow()              server/lib/strategy/strategy-utils.js
  ↓
runBriefing(snapshotId)          server/lib/ai/providers/briefing.js → wraps
  ↓ generateAndStoreBriefing()    server/lib/briefing/briefing-service.js (entry around L2700)
       parallel via Promise.allSettled:
        ├─ fetchWeatherConditions()    BRIEFING_WEATHER     →  briefings.weather_conditions
        ├─ fetchTrafficConditions()    BRIEFING_TRAFFIC     →  briefings.traffic_conditions
        ├─ fetchEventsForBriefing()    BRIEFING_EVENTS_DISCOVERY →  discovered_events (insert) + briefings.events
        ├─ fetchAirportConditions()    BRIEFING_AIRPORT     →  briefings.airport_conditions
        ├─ fetchRideshareNews()        BRIEFING_NEWS        →  briefings.news
        ├─ fetchSchoolClosures()       BRIEFING_SCHOOLS     →  briefings.school_closures
        └─ writeSectionAndNotify()     progressive partial writes + pg_notify
  ↓
runImmediateStrategy(snapshotId, {snapshot, briefingRow})
  ↓ generateImmediateStrategy()   server/lib/ai/providers/consolidator.js:157
       └─ callModel('STRATEGY_TACTICAL', { system, user })  →  Anthropic Claude Opus 4.6
  ↓
                                   →  strategies.strategy_for_now (write); status='ok'
  ↓
generateEnhancedSmartBlocks({snapshotId, immediateStrategy, briefing, snapshot})
  └ server/lib/venue/enhanced-smart-blocks.js
       ├─ generateTacticalPlan()      server/lib/strategy/tactical-planner.js:72
       │     └─ callModel('VENUE_SCORER', ...)  →  OpenAI gpt-5.5-2026-04-23
       ├─ enrichVenues()               server/lib/venue/venue-enrichment.js:49 (Google Places, Routes)
       ├─ event matching               server/lib/venue/event-matcher.js
       ├─ verifyVenueEventsBatch()     server/lib/venue/venue-event-verifier.js (VENUE_EVENT_VERIFIER)
       └─ promoteToVenueCatalog()      enhanced-smart-blocks.js:268 → venue_catalog
  ↓
                                   →  rankings (insert), ranking_candidates (insert)
                                   →  pg_notify('blocks_ready', {snapshot_id})
  ↓
Response: { strategy_for_now, blocks }
```

**Key file:line anchors:**

| Step | File | Line |
|---|---|---|
| Route mount | `server/bootstrap/routes.js` | (mount call) |
| POST handler | `server/api/strategy/blocks-fast.js` | top of file |
| `runBriefing` import | `blocks-fast.js` | 46 |
| `runImmediateStrategy` import | `blocks-fast.js` | 47 |
| `generateEnhancedSmartBlocks` import | `blocks-fast.js` | 48 |
| `generateImmediateStrategy` definition | `consolidator.js` | 157 |
| `runImmediateStrategy` (export wrapper) | `consolidator.js` | (later in file; thin wrapper around `generateImmediateStrategy`) |
| `generateTacticalPlan` | `tactical-planner.js` | 72 |
| VENUE_SCORER call | `tactical-planner.js` | ~368 |

**There is no longer a `generateDailyStrategy` in the codebase.** The daily-removal merge (`d39d570f`) removed it. Docs that reference it (Section 4.1) are stale.

---

## 2. AI registry — live state and callers

The registry at `server/lib/ai/model-registry.js` is **the source of truth**. Every role passes through `getRoleConfig(role)` in `adapters/index.js`, which throws if the role is undefined — so phantom roles would crash at runtime, not silently work.

**26 roles defined in `MODEL_ROLES`** (post-daily-removal count). All 26 have ≥1 live caller. **Zero orphans, zero phantoms.**

| Role | Provider / Model | Callers (file:line) | Streaming? |
|---|---|---|---|
| `BRIEFING_WEATHER` | Google / gemini-3.1-pro-preview | briefing-service.js:1593 | No |
| `BRIEFING_TRAFFIC` | Google / gemini-3.1-pro-preview | briefing-service.js:509, 2093 | No |
| `BRIEFING_NEWS` | Google / gemini-3.1-pro-preview | briefing-service.js:2364 | No |
| `BRIEFING_EVENTS_DISCOVERY` | Google / gemini-3.1-pro-preview | briefing-service.js:1030, 1216 | No |
| `BRIEFING_SCHOOLS` | Google / gemini-3.1-pro-preview | briefing-service.js:1861 | No |
| `BRIEFING_AIRPORT` | Google / gemini-3.1-pro-preview | briefing-service.js:2234 | No |
| `BRIEFING_HOLIDAY` | Google / gemini-3.1-pro-preview | location/holiday-detector.js:427 | No |
| `BRIEFING_FALLBACK` | Google / gemini-3.1-pro-preview | briefing-service.js:353, 618; consolidator.js (fallback) | No |
| `STRATEGY_CORE` | Anthropic / claude-opus-4-6 | **assistant-proxy.ts:33 (DEAD — no importers, see §6.4)** | No |
| `STRATEGY_CONTEXT` | Google / gemini-3.1-pro-preview | tactical-plan.js:172 | No |
| `STRATEGY_TACTICAL` | Anthropic / claude-opus-4-6 | **consolidator.js:157 (LIVE)**; planner-gpt5.js:54 (DEAD); assistant-proxy.ts:42 (DEAD) | No |
| `VENUE_SCORER` | OpenAI / gpt-5.5-2026-04-23 | tactical-planner.js:368, 473 (retry) | No |
| `VENUE_FILTER` | Anthropic / claude-haiku-4-5 | venue-intelligence.js:276 | No |
| `VENUE_TRAFFIC` | Google / gemini-3.1-pro-preview | venue-intelligence.js:758 | No |
| `VENUE_EVENT_VERIFIER` | Google / gemini-3.1-pro-preview | venue-event-verifier.js:43 | No |
| `AI_COACH` | Google / gemini-3.1-pro-preview | chat.js:1245 | **Yes** (callModelStream) |
| `CONCIERGE_SEARCH` | Google / gemini-3.1-pro-preview | concierge-service.js:549 | No |
| `CONCIERGE_CHAT` | Google / gemini-3.1-pro-preview | concierge-service.js:844; concierge.js:366 | **Yes** (variant) |
| `UTIL_RESEARCH` | Google / gemini-3.1-pro-preview | research.js:25, 62 | No |
| `UTIL_WEATHER_VALIDATOR` | Google / gemini-3.1-pro-preview | weather-traffic-validator.js:35 | No |
| `UTIL_TRAFFIC_VALIDATOR` | Google / gemini-3.1-pro-preview | weather-traffic-validator.js:101 | No |
| `UTIL_MARKET_PARSER` | OpenAI / gpt-5.5-2026-04-23 | parse-market-research.js:188 | No |
| `UTIL_TRANSLATION` | Google / gemini-3.1-flash-lite-preview | translate/index.js:50; hooks/translate.js:61 | No |
| `OFFER_ANALYZER` | Google / gemini-3-flash-preview | analyze-offer.js:301 | No |
| `OFFER_ANALYZER_DEEP` | Google / gemini-3.1-pro-preview | analyze-offer.js:510 | No |
| `DOCS_GENERATOR` | Google / gemini-3.1-pro-preview | docs-agent/generator.js:51 | No |

**Important caveats baked into the registry:**

1. `requiresStreaming` flag enforced for `AI_COACH` (`adapters/index.js:263`) — non-Gemini override is rejected at runtime.
2. `LEGACY_ROLE_MAP` aliases old names: `'strategist' → STRATEGY_CORE`, `'haiku' → VENUE_FILTER`, etc. These are deliberate.
3. Cross-provider fallback via `getFallbackConfig(primaryProvider)`: Google primary → OpenAI fallback (gpt-5.5); Anthropic/OpenAI primary → Gemini Flash fallback. `FALLBACK_ENABLED_ROLES` excludes vision-only roles.
4. **The daily-removal merge was clean here**: there is no orphan `STRATEGY_DAILY` row in the registry. The drift is entirely in docs.

---

## 3. What's working — verified clean

Three pipelines are in good shape from a static-analysis standpoint:

### 3.1 Briefing pipeline

`server/lib/briefing/briefing-service.js` is the canonical orchestrator. Function names, AI roles, and DB writes line up cleanly. Refresh helpers (`refreshEventsInBriefing`, `refreshTrafficInBriefing`, `refreshNewsInBriefing`) are all defined and reachable from `getOrGenerateBriefing`'s policy layer. Freshness rules (`isDailyBriefingStale`, `isEventsStale`, `isTrafficStale`, `areEventsEmpty`) match the documentation in `docs/architecture/BRIEFING.md` and `docs/EVENT_FRESHNESS_AND_TTL.md`.

### 3.2 Venue / Smart Blocks pipeline

Clean ownership: `enhanced-smart-blocks.js` orchestrates → `tactical-planner.js` calls VENUE_SCORER → `venue-enrichment.js` Google enrichment → `event-matcher.js` joins to `discovered_events` → `venue-event-verifier.js` calls VENUE_EVENT_VERIFIER → `promoteToVenueCatalog` upserts to `venue_catalog`. No orphan venue functions. The 2026-04-16 redesign that moved coordinate resolution post-LLM is complete (`tactical-planner.js:29-30`); only `docs/architecture/VENUES.md` Section 2 still shows lat/lng in the LLM response schema (Section 4.3).

### 3.3 Cross-layer event ownership

`discovered_events` is **owned by briefing** (writer: `fetchEventsForBriefing`) and **read by venue** (`fetchTodayDiscoveredEventsWithVenue` in `enhanced-smart-blocks.js:169`). Venue annotates with distance and bucket (NEAR ≤15mi / FAR >15mi) but does not write back. Verification flows post-VENUE_SCORER through `verifyVenueEventsBatch`. **No duplication**; ownership is clean.

### 3.4 File / folder / API / hook naming conventions — consistent

Surveyed across `server/lib/`, `server/api/`, `client/src/components/`, `client/src/hooks/`, and route paths: **no violations found.**

| Surface | Convention | Examples |
|---|---|---|
| `server/lib/*` files | kebab-case | `briefing-service.js`, `enhanced-smart-blocks.js`, `venue-address-resolver.js` |
| `server/api/*` route dirs | kebab-case | `rideshare-coach/`, `briefing/`, `strategy/` |
| `client/src/components/*` | PascalCase | `RideshareCoach.tsx`, `BriefingTab.tsx` |
| `client/src/hooks/*` | camelCase, `use*` prefix | `useBriefingQueries.ts`, `useStrategyPolling.ts` |
| API endpoint paths | kebab-case | `/api/blocks-fast`, `/api/strategy/tactical-plan`, `/api/realtime/token` |
| AI role names | UPPER_SNAKE | `BRIEFING_NEWS`, `STRATEGY_TACTICAL`, `VENUE_SCORER` |

`server/lib/venue/` is **singular**; no `server/lib/venues/` directory exists. (`APICALL.md` references the plural form — that's a doc typo, not a duplication.) The route path `/api/venues/*` is plural — that's deliberate (route names a collection; library names a service domain).

---

## 4. What's stale or doc-drift

### 4.1 Daily-strategy removal — docs lag (HIGHEST IMPACT)

The cleanup PR (`d39d570f`, merged before 2026-04-26) removed `STRATEGY_DAILY` and `consolidated_strategy` writes from code. **Seven docs still reference these as if live.** A reader/agent following these docs will look for code that doesn't exist.

| Doc | Line | What it says | Reality |
|---|---|---|---|
| `docs/AI_ROLE_MAP.md` | 33 | `STRATEGY_DAILY` at `consolidator.js:323 → generateDailyStrategy() → strategies.daily_strategy` | Function and column don't exist |
| `docs/AI_ROLE_MAP.md` | 117 | `STRATEGY_DAILY` provider/fallback row | Role not defined in registry |
| `docs/architecture/LLM-REQUESTS.md` | 104, 227 | Lists `STRATEGY_DAILY` → claude-opus-4-6 | Role not defined |
| `docs/architecture/AI_MODEL_ADAPTERS.md` | 159 | Strategy roles include STRATEGY_DAILY | Role not defined |
| `docs/architecture/briefing-transformation-path.md` | 110, 138 | STRATEGY_DAILY data flow | Role not defined |
| `docs/architecture/DB_SCHEMA.md` | 96 | `consolidated_strategy text — 8-12hr daily` | Column either dropped or unused |
| `docs/EVENTS.md` | 777 | "STRATEGY_TACTICAL / STRATEGY_DAILY prompt" | Daily prompt no longer exists |
| `docs/AUDIT_SYNTHESIS_2026-04.md` | 31 | "Produces strategy_for_now ... and consolidated_strategy" | Half stale |
| `docs/melswork/needs-updating/architecture/urgent/MISMATCHED.md` | 333 | Already flags `consolidated_strategy` as DEPRECATED | Correct in spirit but path is `/needs-updating/` for a reason |

**Recommendation:** A single "remove daily strategy from docs" PR. Search-and-strike the rows. Drop the `consolidated_strategy` column from `DB_SCHEMA.md` if it's been dropped from the table, or label it as "removed/legacy" if still in the schema.

### 4.2 `docs/api-routes-registry.md` ~5 months stale

Last updated 2025-12-14. Drift summary:

| Drift | Evidence |
|---|---|
| Names the path "TRIAD pipeline" | Lines 15, 53, 57, 63 |
| "TRIAD Pipeline Flow" diagram includes "Phase 2: Daily + Immediate Consolidator" | Daily was removed (Section 4.1) |
| Missing route: `POST /api/strategy/tactical-plan` | Added 2026-02-12 |
| Missing route: `/api/memory/*` | Added 2026-04-14 |
| Missing route: `/api/translate` | Added 2026-03-16 |
| Missing route: `/api/hooks/*` (offer analyzer, translate hook) | Added gradually through 2026 |
| Missing: `/api/realtime/token` | Added 2026-04-23 (gpt-realtime split) |
| Coach path: registry says `/api/coach`; actual mount is `/api/chat` and `/api/rideshare-coach/*` | Drift |

**Recommendation:** regenerate from `server/bootstrap/routes.js` plus `server/api/*` directory listings. This file is one of the higher-leverage doc fixes — it's the primary "what endpoints exist" reference.

### 4.3 `docs/architecture/VENUES.md` Section 2 — schema drift

Section 2 ("VENUE_SCORER Response Schema") lines 41-66 still document `lat` / `lng` fields in the LLM output schema. The 2026-04-16 redesign (P0-6) removed coordinates from the LLM output and resolves them post-LLM via Google Places — see `tactical-planner.js:29-30` comments and `VenueRecommendationSchema` at `tactical-planner.js:47`. The `SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` doc in `server/lib/venue/` documents the redesign correctly; only `VENUES.md` Section 2 is stale.

**Recommendation:** delete the lat/lng rows from the documented response schema and add a one-line note: "Coordinates resolved post-LLM via Google Places Text Search; the LLM emits venue names only."

### 4.4 `docs/AI_ROLE_MAP.md` references dead-code line numbers

The doc lists three callsite anchors that point to **dead code** (file with zero importers, see Section 6):

| Doc claim (line 30-33) | Reality |
|---|---|
| `STRATEGY_TACTICAL` at `consolidator.js:268 + planner-gpt5.js:54` | `consolidator.js:268` is approximately right (live) but **`planner-gpt5.js:54` is dead** — `planner-gpt5.js` has zero importers. The actual live function is `generateImmediateStrategy` at `consolidator.js:157`. |
| `STRATEGY_CORE` at `assistant-proxy.ts:33` | **`assistant-proxy.ts` has zero importers**. The file defines its own Express app on a separate port; whether that process is currently launched needs runtime verification. |
| `STRATEGY_DAILY` at `consolidator.js:323 → generateDailyStrategy()` | Function does not exist in `consolidator.js` post-removal. |
| `STRATEGY_CONTEXT` at `tactical-plan.js:172 → generateTacticalPlan()` | Live, verified. |

**Recommendation:** when the daily-removal doc PR runs, also update the file:line anchors. Consider adding a CI check that file:line references in `AI_ROLE_MAP.md` resolve to actual definitions — line drift is the recurring failure mode here.

### 4.5 Stale comments in adapter / registry

- `server/lib/ai/adapters/openai-adapter.js:5` header comment says "Used by `BRIEFING_NEWS_GPT` role" — that role was deprecated in the 2026-01-14 dual-news cleanup; the registry comment at line 64 says "Original: BRIEFING_NEWS_GPT used GPT-5.2... [now deprecated]." Adapter comment doesn't match.
- `server/lib/briefing/briefing-service.js:1165` defines `_fetchEventsWithGemini3ProPreviewLegacy` — kept intentionally for emergency rollback (Section 6.2). Worth a header comment confirming the policy ("kept as emergency fallback; if removing, document the migration first").

---

## 5. Naming conventions — the user's specific concern

This section addresses the user's example: `ImmediateStrategy` vs `Strategy_for_now`. There is no class called `ImmediateStrategy` in the codebase, but the **immediate-strategy concept does have four spellings**, which is the real point.

### 5.1 The "immediate strategy" concept — four surface forms

The same logical thing — "the AI-generated 1-hour tactical plan persisted and shown on the Strategy page" — appears as:

| Form | Kind | Location |
|---|---|---|
| `runImmediateStrategy` | exported function (entry wrapper) | `server/lib/ai/providers/consolidator.js` (export) |
| `generateImmediateStrategy` | core implementation | `consolidator.js:157` |
| `immediateStrategy` | function parameter | `enhanced-smart-blocks.js:96`, `blocks-fast.js` (passed through) |
| `strategy_for_now` | DB column (text) | `shared/schema.js:80` (`strategies` table) |

Plus:
- API response field is `strategy_for_now` (mirrors the column directly) — `strategy.js:104`
- Comments call it "immediate 1-hour tactical" or "tactical strategy"
- The AI role is `STRATEGY_TACTICAL` — yet another label
- Status helpers in `server/lib/strategy/strategy-utils.js` and `status-constants.js` use `isStrategyReady`, `isStrategyComplete`, `STRATEGY_STATUS` (dropping the "immediate" qualifier entirely)

**This is not broken** — it's the natural consequence of having a snake_case DB layer, a camelCase JS code layer, an UPPER_SNAKE registry, and a "logical concept" that nobody named consistently. But it **is what makes the codebase hard to read**, especially for an LLM agent or new contributor trying to grep for "the thing called X."

**Recommendation: pick one canonical concept name and document the boundary mappings in `LEXICON.md`.** Suggested table to add to `LEXICON.md`:

```
Concept "Immediate Tactical Strategy" (60-90 min driver advice):
  - DB column:       strategies.strategy_for_now (text)
  - AI role:         STRATEGY_TACTICAL
  - Provider fn:     generateImmediateStrategy()    [consolidator.js]
  - Public fn:       runImmediateStrategy()         [consolidator.js export]
  - Wire param name: immediateStrategy
  - API field:       strategy_for_now (mirrors column)
```

Same exercise for the briefing concept (much cleaner — see 5.3) and for venue/Smart Blocks (also clean — see 5.4).

### 5.2 "TRIAD" vs "blocks-fast" vs "strategy pipeline" branding

> **NOTE (re-sweep):** see §9.4 for an important update. The CLEAR_CONSOLE_WORKFLOW commits this evening **doubled down on TRIAD branding** in the workflow logger. The recommendation in this section is rebalanced there.

The same pipeline has three brandings active in the codebase right now:

| Surface | Branding |
|---|---|
| Code header (`blocks-fast.js:3`) | "FAST TACTICAL PATH - Strategy + Venue Generation API" |
| DB connection `application_name` | `triad-listener` |
| Background worker entry | `strategy-generator.js — Triad Worker Entry Point` |
| Job table | `triad_jobs` |
| Logging label | `triadLog.phase(...)` |
| `docs/api-routes-registry.md` | "TRIAD Pipeline" |
| Most other docs | "blocks-fast pipeline" or "strategy pipeline" |

"TRIAD" originally meant three roles (BRIEFING + STRATEGY + VENUE), but post-daily-removal it's no longer a *separate* triad — phases 1-3 run synchronously inside `blocks-fast.js`; only the SmartBlocks/venue async tail uses NOTIFY/worker. **The "TRIAD" branding is half-decommissioned.**

**Recommendation:** decide and stick with one label. Either:
- Keep "TRIAD" as the historical brand for the database/worker/log surface, but **stop using it in user-facing docs** like `api-routes-registry.md` (use "blocks-fast pipeline" instead).
- Or do a full rename pass — `triad_jobs` → `block_generation_jobs`, `triadLog` → `pipelineLog`, etc.

Either is fine. The current half-state is confusing for readers.

### 5.3 Briefing concept — clean

DB columns, function names, and AI roles align cleanly: `briefings.news` ↔ `fetchRideshareNews` ↔ `BRIEFING_NEWS`. The pattern holds for events, traffic, weather, airport, school_closures (all snake_case in DB, camelCase/Pascal in code, UPPER_SNAKE in registry). No surface-form proliferation.

### 5.4 Smart Blocks / venue / ranking concept — clean

"Smart Blocks" is the **product brand** (the user-facing name for ranked venue recommendations). Implementation uses `rankings` (parent record) and `ranking_candidates` (per-venue rows) tables, with `venue_catalog` as the canonical venue store. Function `generateEnhancedSmartBlocks` in `enhanced-smart-blocks.js`. This is fine — the naming is intentional (brand vs. implementation) and consistent.

### 5.5 Hook naming patterns — consistent

All hooks under `client/src/hooks/` follow the `use*` prefix, camelCase convention. No mixing of `useFooQuery` vs `useFooData` patterns within the same domain. Fine.

The full hook inventory and their consumers / data sources is in **Section 5A — Client Hook & Page → API Map** below; this section addresses the *naming convention* of hooks specifically.

### 5A. Client hook & page → API map

The user explicitly asked for hook coverage. Here it is, with the same "live / dead / drift" lens applied to the client.

**Provider stack** (`client/src/App.tsx:25-40`):

```
ErrorBoundary
  → QueryClientProvider (TanStack Query, staleTime 5min, gcTime 30min, retry 1)
    → AuthProvider                     [@/contexts/auth-context]
      → LocationProvider               [@/contexts/location-context-clean]
        → CoPilotProvider              [@/contexts/co-pilot-context]
          (wraps RouterProvider so it persists across route changes)
          → RouterProvider             [@/routes]
```

**Authenticated routes** (under `/co-pilot/*`, gated by `ProtectedRoute`):

| Route | Page file | What it shows |
|---|---|---|
| `/co-pilot/strategy` (default) | `StrategyPage.tsx` | Strategy + embedded MapTab + SmartBlocks (post-2026-04-26 Phase B; Map merged into Strategy) |
| `/co-pilot/coach` | `CoachPage.tsx` | Rideshare Coach (relocated 2026-04-25 Phase A Pass 1, was previously embedded in StrategyPage) |
| `/co-pilot/briefing` | `BriefingPage.tsx` | Weather, traffic, events, news, airport, school closures |
| `/co-pilot/bars` (or similar) | `VenueManagerPage.tsx` | Renamed from `BarsPage` 2026-01-09 — venue intelligence (lounges, bars, late-night) |
| `/co-pilot/intel` | `IntelPage.tsx` | Market intelligence |
| `/co-pilot/concierge` | `ConciergePage.tsx` | Driver-facing concierge surface |
| `/co-pilot/translation` | `TranslationPage.tsx` | UTIL_TRANSLATION endpoint |
| `/co-pilot/settings` | `SettingsPage.tsx` | User settings |
| `/co-pilot/schedule` | `SchedulePage.tsx` | Weekly availability (added 2026-04-05) |
| `/co-pilot/about`, `/donate`, `/help` | `AboutPage.tsx`, `DonatePage.tsx`, `HelpPage.tsx` | Static / hamburger-menu pages |

**Removed routes** (recent), per `routes.tsx` comments:
- `/co-pilot/map` — removed 2026-04-26 Phase B; map now embedded in `StrategyPage`. Bottom-nav Map tab also removed in `BottomTabNavigation.tsx`.

**Public / auth routes:** `/policy`, `/auth/sign-in`, `/auth/sign-up`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/uber/callback`, `/auth/google/callback`, `/c/:token` (public concierge QR), `/demo` (landing).

**Hook → API surface:**

| Hook | Consumes | Notes |
|---|---|---|
| `useStrategy.ts` | `/api/strategy/:snapshotId` (status), `/api/blocks-fast` (trigger / poll) | Strategy page primary data hook |
| `useStrategyPolling.ts` | `/api/strategy/:snapshotId`, `/api/strategy/events` (SSE) | TRIAD/blocks-fast progress UI |
| `useStrategyLoadingMessages.ts` | None — pure UI string rotation | Loading-state copy |
| `useBriefingQueries.ts` | `/api/briefing/snapshot/:snapshotId` (aggregate), historical `/api/snapshot/:snapshotId` | TanStack Query hook for briefing sections |
| `useBarsQuery.ts` | `/api/venues/*` (bars / lounges intelligence) | Venue Manager page |
| `useMarketIntelligence.ts` | `/api/intelligence/for-location` (current), `/api/intelligence/lookup` (legacy, present in code) | Intel page; doc drift candidate (two endpoint generations live in same hook) |
| `usePlatformData.ts` | `/api/platform/*` | Platform reference data (Uber/Lyft/etc.) |
| `useMemory.ts` | `/api/memory/*` | Coach memory / conversation logging |
| `useChatPersistence.ts` | `localStorage` only (no API) — chat thread persistence | Coach client-side persistence |
| `useEnrichmentProgress.ts` | SSE — venue enrichment progress (likely `/api/venues/enrichment-progress` or similar) | Smart Blocks loading UX |
| `useVenueLoadingMessages.ts` | None — pure UI string rotation | Loading-state copy |
| `useTTS.ts` | `POST /api/tts` (OpenAI TTS-1-HD) + browser `speechSynthesis` fallback | Coach voice playback |
| `useSpeechRecognition.ts` | Browser Web Speech API only — no server | Coach mic input |
| `useToast.ts` | None | Toast UI primitive |
| `useMobile.tsx` | None | Viewport detection |
| `coach/useCoachChat.ts` | `POST /api/chat/send` (SSE) | Coach chat orchestration (post-2026-04-26 extraction, see coach-pass2-phase-b branch) |
| `coach/useCoachAudioState.ts` | None — wraps `useTTS` + `useSpeechRecognition` + localStorage | Coach audio aggregator |
| `coach/useStreamingReadAloud.ts` | None — chunks deltas to `useTTS` | Coach streaming TTS (flag-gated) |

**Page → API rough map** (which hooks each top-level page invokes):

| Page | Hooks invoked | Net API surface |
|---|---|---|
| `StrategyPage.tsx` | `useStrategy`, `useStrategyPolling`, `useStrategyLoadingMessages`, `useEnrichmentProgress`, plus the embedded MapTab's hooks | `/api/blocks-fast`, `/api/strategy/*`, `/api/venues/*` |
| `CoachPage.tsx` | `coach/useCoachChat`, `coach/useCoachAudioState`, `coach/useStreamingReadAloud`, `useTTS`, `useSpeechRecognition`, `useChatPersistence`, `useMemory` | `/api/chat/send` (SSE), `/api/tts`, `/api/memory/*` |
| `BriefingPage.tsx` | `useBriefingQueries` | `/api/briefing/snapshot/:snapshotId` |
| `VenueManagerPage.tsx` | `useBarsQuery` | `/api/venues/*` |
| `IntelPage.tsx` | `useMarketIntelligence`, `usePlatformData` | `/api/intelligence/for-location`, `/api/platform/*` |
| `ConciergePage.tsx` | (concierge-specific hooks; not enumerated in this audit) | `/api/concierge/*` |
| `TranslationPage.tsx` | (translation-specific) | `/api/translate` |
| `SchedulePage.tsx`, `Settings`, `Help`, `About`, `Donate`, `Policy` | Mostly static or local-only state | Minimal API surface |

**Findings on the client side:**

1. **No hook duplication.** No two hooks fetch the same endpoint. `useStrategy` and `useStrategyPolling` are intentionally split (data vs polling progress).
2. **One hook with mixed-generation endpoints.** `useMarketIntelligence.ts` references both `/api/intelligence/for-location` (current, 2026-01-05) and `/api/intelligence/lookup` (legacy). Lines 60, 95, 440, 452, 598, 607 mix references. Likely safe (legacy left as fallback) but worth a separate verify-and-prune sweep.
3. **One client-side route removal that may need doc cleanup.** The `/co-pilot/map` route was deleted 2026-04-26. Search docs for any "/co-pilot/map" references; `routes.tsx:13-14` already calls this out. `SYSTEM_MAP.md` (last updated 2026-02-19) probably still mentions it.
4. **Coach hooks are recent and well-organized** under `client/src/hooks/coach/`. The single-folder pattern (`coach/use*`) is a good convention; no other domain has its own subfolder yet (briefing, strategy, venue hooks are all flat in `hooks/`).

**What this audit did NOT verify on the client:**

- Concierge, Translate, Schedule, Settings hooks: not enumerated. Deferred to a follow-up client-side audit if desired.
- Whether `useMarketIntelligence`'s legacy `/api/intelligence/lookup` reference is reachable or just a comment.
- Whether `useEnrichmentProgress`'s SSE endpoint name matches the server-side mount.
- Provider context internals (`AuthProvider`, `LocationProvider`, `CoPilotProvider`) — only their position in the stack was confirmed.

**Recommendation:** the client side is in materially better shape than the docs suggest. The dominant client-side cleanup is the `useMarketIntelligence` legacy-endpoint sweep and a `SYSTEM_MAP.md` refresh that drops the removed `/co-pilot/map` route.

### 5.6 Naming-lag in dead code (low priority)

Functions whose names suggest a specific provider or model that no longer matches the registry:

| Function | Implied provider | Actual registry | Status |
|---|---|---|---|
| `fetchNewsWithClaudeWebSearch` (briefing-service.js:582) | Claude | BRIEFING_FALLBACK = Gemini | Dead — never called |
| `fetchEventsWithClaudeWebSearch` (briefing-service.js:322) | Claude | BRIEFING_EVENTS_DISCOVERY = Gemini | Dead — never called |
| `fetchEventsWithGemini3ProPreview` (briefing-service.js:1055) | Gemini 3 Pro Preview | gemini-3.1-pro-preview ✓ matches | **Live** — name is accurate |
| `_fetchEventsWithGemini3ProPreviewLegacy` (briefing-service.js:1165) | Gemini 3 Pro Preview | n/a | Dead — kept for emergency rollback |
| `runPlannerGPT5` (planner-gpt5.js:40) | GPT-5 | calls STRATEGY_TACTICAL = Claude Opus | Dead file |

**The naming-lag concern from the user's reference docs is real but contained: every name-vs-registry mismatch is in dead code.** Live code names match (or are model-agnostic, like `runImmediateStrategy`).

**Recommendation:** delete the dead helpers in a single cleanup PR (Section 9). Keep `_fetchEventsWithGemini3ProPreviewLegacy` if rollback safety is wanted, but document the policy.

---

## 6. Duplications and dead code

### 6.1 `server/lib/strategy/` — mostly dead

Live in this directory:
- `tactical-planner.js` — VENUE_SCORER call, used by `enhanced-smart-blocks.js`. **Live.**
- `status-constants.js` — exports `STRATEGY_STATUS`, `isStrategyReady`, `isStrategyComplete`. Used by `blocks-fast.js`. **Live.**
- `strategy-utils.js` — `ensureStrategyRow`, `updatePhase`, `isStrategyReady`. Used by `blocks-fast.js`. **Live.**

**Dead in this directory** (zero importers):
- `index.js` — empty re-export shim (verify; if re-exports point to dead files, equally dead)
- `strategy-generator.js` — defines `generateStrategyForSnapshot` → routes to `generateMultiStrategy`. No importers.
- `strategy-generator-parallel.js` — stub, comment says "Stubs kept so that snapshot.js→" but `snapshot.js` doesn't import it.
- `providers.js` — defines `triad: generateStrategyForSnapshot` provider registry. No importers.
- `assert-safe.js` — validates `['triad', 'consolidated']`. No importers.
- `planner-gpt5.js` — defines `runPlannerGPT5`, calls STRATEGY_TACTICAL. No importers. (Replaced by `consolidator.js`.)
- `strategyPrompt.js` — prompt builder. Importer status: needs verification.
- `strategy-triggers.js` — needs verification.
- `dump-last-strategy.js` — debug script (likely standalone use, not "dead" in import sense).

**Recommendation:** in a single cleanup PR, delete the verified-dead files. This will:
1. Make the directory smaller and easier to scan.
2. Remove the false-positive STRATEGY_TACTICAL caller at `planner-gpt5.js:54`.
3. Fix line 30 of `AI_ROLE_MAP.md` (which still points to `planner-gpt5.js:54`).

Mark each deletion in the commit message: "delete dead-code residue from daily-removal merge."

### 6.2 Briefing dead helpers

In `briefing-service.js`:
- `fetchNewsWithClaudeWebSearch` (line 582) — never called. The current news path is `fetchRideshareNews` → `callModel('BRIEFING_NEWS')` with `BRIEFING_FALLBACK` as the registry-managed fallback.
- `fetchEventsWithClaudeWebSearch` (line 322) — never called. The current events path is `fetchEventsWithGemini3ProPreview`.
- `consolidateNewsItems` (line 2505) — never called. `fetchRideshareNews` does its own dedup/filter inline.
- `_fetchEventsWithGemini3ProPreviewLegacy` (line 1165) — never called. Comment-flagged as "kept for emergency rollback."

**Recommendation:** delete the three first, keep the legacy emergency-fallback unless policy says otherwise.

### 6.3 No real functional duplication on the live path

After dead-code subtraction, **there is no second place where "immediate strategy is generated" or "blocks-fast pipeline runs."** The live path is single-sourced. This is the most important positive finding.

### 6.4 Standalone-process files at server level

| File | Status | Notes |
|---|---|---|
| `gateway-server.js` | Live entry | Main port 5000 |
| `index.js` | Live entry | Health probes, port 3102 (SDK_PORT/EIDOLON_PORT) — runs even when SDK is "embedded" because health probe lives here |
| `agent-server.js` | Live entry | Agent (Atlas) on AGENT_PORT (43717) |
| `strategy-generator.js` (root) | Live worker | `Triad Worker Entry Point — LISTEN-only`. Spawn lifecycle delegated to `gateway-server.js` based on `ENABLE_BACKGROUND_WORKER`. Calls `startConsolidationListener()` from `server/jobs/triad-worker.js`. |
| `sdk-embed.js` | Library | Imported by gateway, not a separate process. Called "Fallback route catch-all" but actually a delegated route module. |
| `assistant-proxy.ts` (`server/gateway/assistant-proxy.ts`) | **Unclear** | Defines its own Express app, registers strategist/planner/validator pipeline. **No importers found.** Either an unmounted standalone subprocess, dead code, or invoked via a build/script step not detected by the import-graph search. Needs runtime verification before deciding. |

**Recommendation:** verify whether `assistant-proxy.ts` is launched (search `package.json` scripts, `Procfile`, replit deployment config). If it's not launched, mark it dead. If it is launched, document **how** in `MISMATCHED.md` so future readers don't think it's dead.

---

## 7. TRIAD pipeline — reality check

What "TRIAD" means today:

- **Conceptually:** three AI roles — BRIEFING_*, STRATEGY_TACTICAL, VENUE_SCORER. The original "triad" framing.
- **Operationally:** **synchronous in `blocks-fast.js` for phases 1-3** (briefing, strategy, then venue plan generation). Phase 4 (Google enrichment / venue catalog promotion) runs sequentially in the same request, with `pg_notify('blocks_ready', ...)` at the end. The `triad-worker.js` listens for that NOTIFY and is the **only background-async piece** in the pipeline today.
- **Removed since 2026-02-25:** the dual-spawn bug where both `start-replit.js` and `gateway-server.js` independently spawned `strategy-generator.js`. Lifecycle now centralized in `gateway-server.js` reading `ENABLE_BACKGROUND_WORKER`.
- **Removed in `d39d570f`:** the "daily" leg of the triad. There was once a separate daily-strategy generation path; it has been removed end-to-end.

**The phrase "TRIAD pipeline" in `api-routes-registry.md` and elsewhere predates these changes** and now describes a system that doesn't quite exist. Either rename the docs or rename the database/worker artifacts (Section 5.2).

---

## 8. Recommended actions, prioritized

### High priority (~1 small PR each)

1. **Doc cleanup PR — daily-strategy removal sweep.** Search-and-strike STRATEGY_DAILY / generateDailyStrategy / consolidated_strategy across the seven docs in §4.1. Drop the column from `DB_SCHEMA.md` if dropped from schema; otherwise mark as legacy/removed.

2. **`api-routes-registry.md` regeneration PR.** Re-derive from `server/bootstrap/routes.js` + `server/api/*`. Drop "TRIAD" branding in user-facing route docs. Add the six missing routes.

3. **Dead-code deletion PR for `server/lib/strategy/`.** Delete `strategy-generator.js`, `strategy-generator-parallel.js`, `providers.js`, `assert-safe.js`, `planner-gpt5.js`. Keep `tactical-planner.js`, `status-constants.js`, `strategy-utils.js`, `index.js` (after verification). Update `AI_ROLE_MAP.md` line 30 to drop the `planner-gpt5.js:54` reference.

4. **Briefing dead-helper deletion PR.** Delete `fetchNewsWithClaudeWebSearch`, `fetchEventsWithClaudeWebSearch`, `consolidateNewsItems` from `briefing-service.js`. Decide explicit policy on `_fetchEventsWithGemini3ProPreviewLegacy` (keep with header comment, or delete).

### Medium priority

5. **Verify `assistant-proxy.ts` runtime status.** If launched as a subprocess somewhere, document in `MISMATCHED.md`. If not, delete the file. Update `AI_ROLE_MAP.md` line 32 (the `STRATEGY_CORE` claim) to match.

6. **Add a `LEXICON.md` "concept-to-surface map" section** for the immediate-strategy concept (Section 5.1). Same drill for any other concepts where the four-form spread occurs (none found in this audit, but worth a section).

7. **`VENUES.md` Section 2 schema fix** — drop lat/lng from the documented LLM response, add the post-LLM coordinate-resolution note.

### Low priority

8. **Adapter comment refresh** — `openai-adapter.js:5` BRIEFING_NEWS_GPT comment.

9. **Decide TRIAD branding policy** (Section 5.2) — full decommission vs keep-as-internal-name. Either way, document the decision.

10. **CI guardrail (optional)** — script that checks file:line references in `AI_ROLE_MAP.md` resolve to existing definitions. Catches the line-drift failure mode that produced §4.4.

---

---

## 9. Updates since initial audit (re-sweep — same day, +5 hours)

This section was added on a re-sweep at ~22:30 UTC, 2026-04-27. Sixteen commits landed on `coach-pass2-phase-b` between the initial audit (`4ee36cc8` at ~17:00) and the re-sweep. Two of the sixteen are this audit's own refinements; the remaining fourteen are real product/infra work.

### 9.1 Commits since `4e9a3380` (timeline)

```
8eb18081  fix(logs): revert sed-clobbered JS destructuring patterns from Commit 8
e3c66a7a  fix(copilot): remove setPersistentStrategy dead-code refs (was throwing ReferenceError)
0072816c  Published your App
aaa466f6  feat(diagnostics): mobile log viewer — file-tee + auth-gated tail/stream + HTML page
129ef243  chore(logs): mass-migrate orphan tags to main categories + strip emojis        ┐
50879fc7  chore(logs): migrate boot/config/phase orphan logs and collapse phase duplicates │
590ceab2  chore(logs): UPPERCASE labels + hierarchical brackets + raw emoji migration     │ CLEAR_CONSOLE_WORKFLOW
415165d8  chore(logs): refine bracket format per "one word in [Example]" spec             │ spec — 8 commits
714831f1  chore(logs): gate frontend diagnostics behind debug flags                       │ totaling a workflow-
122dc99e  Published your App                                                              │ logger overhaul
126e4d73  chore(logs): migrate noisy backend emitters to workflow logger                  │
124651c9  chore(logs): enforce numbered waterfall phases                                  │
ee9f095d  chore(logs): add workflow levels and component filters                          ┘
fa23e3af  fix(error-boundary): log error shape and non-enumerable props (was empty {})
4e9a3380  docs(audit): expand client hook+page→API map, fix role count                    ← initial audit refinement
4ee36cc8  docs(audit): comprehensive codebase audit 2026-04-27                            ← initial audit
```

The remaining changes group into five logical buckets:

### 9.2 New: `server/lib/ai/router/` directory (clean extraction, not duplication)

The hedged-router logic that previously lived inline in `server/lib/ai/adapters/index.js` was extracted into its own module:

| File | LOC | Role |
|---|---|---|
| `server/lib/ai/router/index.js` | 88 | Public surface |
| `server/lib/ai/router/hedged-router.js` | 317 | Core router (was inline in adapters/index.js) |
| `server/lib/ai/router/concurrency-gate.js` | 157 | Concurrency limiting |
| `server/lib/ai/router/error-classifier.js` | 134 | Retry/fallback classification |

`adapters/index.js` (now 288 lines) imports `HedgedRouter from "../router/hedged-router.js"`. **Clean refactor; not a duplication.** Original Section 2 ("AI registry — live state") still describes the dispatch flow correctly, but now references the new module.

**Where this updates the original audit:**
- §2 — Add note that hedged-router lives in its own directory now.
- §6 ("Duplications") — No new duplication; the extraction is the kind of cleanup the audit recommended elsewhere.

### 9.3 New endpoint family: `/api/logs/*` — mobile log viewer

Mounted via `server/bootstrap/routes.js:54` → `server/api/health/logs.js`. Four endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/logs?last=N` | JSON log lines, requires Bearer auth header |
| GET | `/api/logs/raw?last=N` | Plain text, curl-friendly, requires Bearer |
| GET | `/api/logs/stream?token=X` | SSE live tail, token via query (EventSource limitation) |
| GET | `/api/logs/viewer` | Mobile-optimized HTML page; uses localStorage `vectopilot_auth_token` |

Backed by `server/logger/file-tee.js`, which patches `console.log/info/warn/error/debug` to also append to `logs/server-current.log`. Auto-rotates at 10MB → `logs/server-prev.log`. ~20MB total disk cap. Defensive (never throws from patched console methods).

**No client React app callers** — the HTML viewer at `/api/logs/viewer` is the only consumer. This is a **driver-mobile diagnostic tool**, not a product feature.

**Where this updates the original audit:**
- §4.2 — `api-routes-registry.md` is now stale by **one more endpoint family**. The list of missing routes grows.
- Add to "live route mount catalog" when that registry is regenerated.

### 9.4 CLEAR_CONSOLE_WORKFLOW spec — workflow logger overhaul

Eight commits (listed in §9.1) implementing a "clear-console" specification on the workflow logger. The expanded `server/logger/workflow.js` now defines a **numbered-stage convention with hierarchical bracketing**:

```
[LOCATION 1/3]  GPS coordinates received
[LOCATION 2/3]  Geocoding/cache lookup
[LOCATION 3/3]  Weather + air quality fetched
[SNAPSHOT 1/2]  Creating snapshot record
[SNAPSHOT 2/2]  Enrichment (airport, holiday)
[TRIAD 1/4 - STRATEGY_CORE]      Core strategic analysis
[TRIAD 2/4 - STRATEGY_CONTEXT]   Events/traffic/news gathering
[TRIAD 3/4 - STRATEGY_TACTICAL]  Immediate strategy synthesis
[TRIAD 4/4 - SmartBlocks]        Venue planning + enrichment
[VENUES 1/4]  VENUE_SCORER role
[VENUES 2/4]  Google Routes API (distances)
[VENUES 3/4]  Google Places API (hours/status)
[VENUES 4/4]  DB store
[BRIEFING 1/3] Traffic analysis
[BRIEFING 2/3] Events discovery
[BRIEFING 3/3] Event validation
[EVENTS 1/5 - Extract|Providers]
[EVENTS 2/5 - Transform|Normalize]
[EVENTS 3/5 - Transform|Geocode]
[EVENTS 4/5 - Load|Store]
[EVENTS 5/5 - Assemble|Briefing]
```

Plus: env-driven level filter (`LOG_LEVEL=debug`), component quiet/verbose lists (`LOG_VERBOSE_COMPONENTS=AI`), structured JSON output to stderr, `withContext()` correlation binding, and a first-class `debug()` method on every logger. The existing positional API (`phase/done/error/warn/start/complete/info/api/ai/db`) is unchanged — every method now gates through `shouldEmit()`.

**Frontend gating** added in `client/src/constants/featureFlags.ts` — four new debug flags:
- `DEBUG_MAP_ENABLED` (`VITE_DEBUG_MAP`)
- `DEBUG_VENUES_ENABLED` (`VITE_DEBUG_VENUES`)
- `DEBUG_SSE_ENABLED` (`VITE_DEBUG_SSE`)
- `DEBUG_BLOCKS_ENABLED` (`VITE_DEBUG_BLOCKS`)

Default false. Set in `.env.local` and rebuild to enable.

One commit (`8eb18081`) **reverts a sed-driven mass migration that clobbered JS destructuring**. Mass-rename via sed broke patterns like `const { foo } = bar` because the regex was too aggressive. Worth noting as a pattern to watch when chaining `chore(logs):` mass refactors.

**This materially updates Section 5.2 (TRIAD branding):**

My initial recommendation was to "decide and stick with one label" and *consider* decommissioning TRIAD. **The CLEAR_CONSOLE_WORKFLOW spec doubled down on TRIAD as the workflow-stage label.** The phrase `[TRIAD 1/4 - STRATEGY_CORE]` is now baked into operational logging that engineers will see every request. Decommissioning it would mean re-renaming all those log lines.

**Revised recommendation:** TRIAD is now the canonical *internal* brand for the four-stage waterfall (Core → Context → Tactical → SmartBlocks). The original three-role meaning ("triad" = three) is **historical**; the new meaning is "the four-phase workflow." Update `api-routes-registry.md` to match (drop the "Daily + Immediate Consolidator" phase 2 description; replace with the 4-phase TRIAD). Drop only the *user-facing* TRIAD phrasing in docs that describe what the *route does*; keep TRIAD in operational logs.

### 9.5 Coach pipeline progress

Two commits affect the coach plan I documented in `coach-plan.md` and `coach-session-2026-04-27.md`:

- `eb9a3c1c` — `fix(coach-tts): unblock sentence-chunked streaming end-to-end`. Four fixes:
  1. Helmet CSP: added `media-src 'self' data: blob:` (was blocking `data:`/`blob:` audio URLs, falling back to browser speechSynthesis silently).
  2. `useTTS.speak()`: Promise now resolves on `audio.onended` (was play-start) — streaming drain worker now serializes chunks instead of stopping mid-playback.
  3. Vite `envDir`: project root (was `client/`, where no `.env` files lived). `VITE_COACH_STREAMING_TTS=true` was being silently dropped at build before this fix.
  4. (Fourth fix in commit body — read commit message for full detail.)

  This **does NOT change the coach plan progress**: still 5 of 8 steps done. `COACH_STREAMING_TTS_ENABLED` defaults to `false` in `client/src/constants/featureFlags.ts:23`. Step 6 (the flag flip) is still pending. The fix unblocks Step 6's UAT — when the user does flip the flag, streaming TTS now actually works end-to-end on the happy path.

- `fa23e3af` — `fix(error-boundary): log error shape and non-enumerable props`. ErrorBoundary previously logged `{}` on caught errors because the spread operator skips non-enumerable properties (which is most of `Error`). Fix logs `type`, `ctor`, `message`, `stack` explicitly.

**Where this updates the original audit:**
- §2 (AI roles) — unchanged.
- The coach side artifacts (`coach-plan.md`, `coach-session-2026-04-27.md` in `C:\Users\Melody\AppData\Local\Temp\`) **remain accurate**; the streaming-TTS Smoke Test A I flagged is now resolved (the path was broken in 4 places, all fixed in `eb9a3c1c`).

### 9.6 Real runtime bug surfaced via better logging — `setPersistentStrategy`

`e3c66a7a` removed three call sites in `client/src/contexts/co-pilot-context.tsx` that called `setPersistentStrategy(null)` — but the `persistentStrategy` `useState` had been deleted in a prior refactor without removing the setter calls. Three locations: line ~152 (auth-lost cleanup), ~229 (manual refresh), ~424 (snapshot changed). Every time auth was lost or snapshot changed, the page threw `ReferenceError: setPersistentStrategy is not defined`. The error was hiding behind ErrorBoundary's empty-`{}` log; the `fa23e3af` ErrorBoundary fix made it visible; this commit fixed it.

**Pattern this exposes — relevant to future audits:** import-graph dead-code analysis (the kind this audit performs in §6.1) finds **whole files** that are dead. It does NOT find **dead variable references** inside an otherwise-live file. The static-analysis approach has a known floor: any audit recommending "delete file X" is high-confidence; any audit recommending "delete variable Y inside live file X" needs runtime verification or AST-aware tooling.

**Recommendation:** add a short note to `LESSONS_LEARNED.md` or `MISMATCHED.md` capturing the diagnosis chain (state setter deleted → callsites left → caught by improved error logging). It's a textbook case worth preserving. If `LESSONS_LEARNED.md` already has a 2026-04-27 entry on this, this audit duplicates rather than supplements; verify before adding.

### 9.7 New dead code: `server/types/driving-plan.ts`

Created today. 166 lines. Defines 4 types and 11 interfaces:

```ts
PlanStatus, LocationCategory, SurgeSensitivity, RiskLevel
Coordinates, StagingLocation, PlanBlock, DrivingPlan,
PlanGenerationRequest, PlanGenerationResponse, PlanUpdateRequest,
TrafficConditions, WeatherConditions, RealTimeContext, PlanAdjustment
```

**Zero importers across `server/` and `client/`.** Verified via:
```
rg -n "from .*driving-plan|require.*driving-plan|import.*DrivingPlan|import.*PlanGeneration"
```

The only references inside the file are self-references (`plan?: DrivingPlan` referring to its own definition). This is **scaffolding for an unimplemented "shift planning" feature** — comment in file says "AI-powered shift planning system. All data is variable-based with zero hardcoded values."

**Adds to §6 (Dead Code Candidates).** Worth deciding:
- (a) leave as design seed — fine, but date-stamp the file with intent ("// 2026-04-27: scaffolding for planned `/api/strategy/plan/*` endpoints; no current consumers")
- (b) move under `server/types/_planned/driving-plan.ts` to clearly signal "not wired" status
- (c) delete and re-create when implementation begins

My recommendation: **(a) — add an intent comment**. Cheapest, prevents future-me audit from flagging it again.

### 9.8 What did NOT change

- AI registry: still 26 roles, all live, zero orphans/phantoms (re-counted).
- `server/lib/strategy/` dead code: all 6 dead files still present (`strategy-generator.js`, `providers.js`, `assert-safe.js`, `planner-gpt5.js`, `strategy-generator-parallel.js`, `strategyPrompt.js`). All file mtimes touched today (likely log-statement migrations) but **import-graph status unchanged** — still zero importers. §6.1 recommendation stands.
- Briefing dead helpers: `fetchNewsWithClaudeWebSearch`, `fetchEventsWithClaudeWebSearch`, `consolidateNewsItems` still present and uncalled. §6.2 recommendation stands.
- `docs/api-routes-registry.md` still says "Last Updated: 2025-12-14." No doc fixes have started. §4.2 recommendation stands and **gets bigger** (now also missing `/api/logs/*`).
- Daily-strategy doc lag: still present in all seven docs cataloged in §4.1.
- `assistant-proxy.ts` runtime status: still unverified.
- `COACH_STREAMING_TTS_ENABLED`: still defaults `false`. Step 6 of the coach plan is still pending despite the TTS unblock fix in `eb9a3c1c`.

### 9.9 Re-sweep recommended actions delta

Add to §8 ("Recommended actions"):

**High priority (new):**
- Add an intent comment to `server/types/driving-plan.ts` (or move to `_planned/` subfolder).
- Re-do `api-routes-registry.md` regeneration to ALSO include `/api/logs/*` (4 new endpoints).

**Medium priority (new):**
- Document the CLEAR_CONSOLE_WORKFLOW spec somewhere persistent. The 8 commits are the only record; if a future engineer doesn't read every commit message, they'll be confused by the `[TRIAD 1/4]` log format and the new debug-flag scheme. A short `docs/architecture/LOGGING.md` (or update to existing) covering the conventions would help.
- Capture the `setPersistentStrategy` diagnosis pipeline as a `LESSONS_LEARNED.md` entry if not already there. Pattern: "deleted state → orphan setter → invisible until ErrorBoundary improved → traceable now."

**Low priority (revised):**
- §5.2 TRIAD-decommission recommendation **revised** to "decommission only in user-facing route docs, keep in operational logging." The CLEAR_CONSOLE_WORKFLOW spec made TRIAD operational again.

---

Canonical docs:
- `docs/architecture/README.md`, `BRIEFING.md`, `LLM-REQUESTS.md`, `VENUES.md`, `MAP.md`, `AI_MODEL_ADAPTERS.md`, `briefing-transformation-path.md`, `DB_SCHEMA.md`, `EVENT_FRESHNESS_AND_TTL.md`, `SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md` (in `server/lib/venue/`)
- `docs/AI_ROLE_MAP.md`, `docs/EVENTS.md`, `docs/api-routes-registry.md`
- `LEXICON.md`, `SYSTEM_MAP.md`, `APICALL.md` (root)
- Existing audit corpus: `docs/AUDIT_LEDGER.md`, `docs/MISMATCHED.md`, `docs/DOC_DISCREPANCIES.md`, `docs/DEAD_CODE_ANALYSIS.md`, `docs/AUDIT_SYNTHESIS_2026-04.md`

Server backbone:
- `server/bootstrap/routes.js`
- `server/api/strategy/blocks-fast.js`, `content-blocks.js`, `strategy.js`, `tactical-plan.js`, `strategy-events.js`
- `server/lib/briefing/briefing-service.js`, `server/lib/briefing/index.js`
- `server/lib/ai/providers/briefing.js`, `server/lib/ai/providers/consolidator.js`
- `server/lib/ai/adapters/index.js`, plus `anthropic-adapter.js`, `gemini-adapter.js`, `openai-adapter.js`, `vertex-adapter.js` (sampled)
- `server/lib/ai/model-registry.js`
- `server/lib/strategy/*` (all 11 files surveyed for import status)
- `server/lib/venue/enhanced-smart-blocks.js`, `tactical-planner.js` (in `server/lib/strategy/`), `venue-enrichment.js`, `venue-intelligence.js`, `venue-event-verifier.js`, `venue-cache.js`, `event-matcher.js`
- `server/api/briefing/*`, `server/api/venue/*`
- `server/gateway/assistant-proxy.ts`
- Top-level: `gateway-server.js`, `index.js`, `agent-server.js`, `strategy-generator.js`, `sdk-embed.js`
- `scripts/start-replit.js` (subprocess lifecycle context)

Schema and shared:
- `shared/schema.js` (strategies, briefings, rankings, ranking_candidates, venue_catalog, discovered_events, triad_jobs)

**Added during re-sweep (2026-04-27 evening):**
- `server/lib/ai/router/index.js`, `hedged-router.js`, `concurrency-gate.js`, `error-classifier.js`
- `server/api/health/logs.js` + `server/logger/file-tee.js` + `server/logger/workflow.js` (re-read for CLEAR_CONSOLE_WORKFLOW spec)
- `client/src/constants/featureFlags.ts` (re-read; expanded with debug flags)
- `server/types/driving-plan.ts` (new file)
- `server/bootstrap/routes.js` lines 53-54 (logs mount)
- Commits inspected: `aaa466f6`, `eb9a3c1c`, `e3c66a7a`, `fa23e3af`, plus the 8-commit CLEAR_CONSOLE_WORKFLOW series

---

## Appendix B — what this audit did NOT verify (be honest)

- **Runtime behavior.** "Live" = "call graph intact + registry resolves." Not verified by running tests or live traffic.
- **`assistant-proxy.ts` launch path.** Couldn't determine via static import-graph alone whether it runs as a subprocess.
- **Client-side hooks: Strategy, Coach, Briefing, Venue Manager, Intel pages were mapped (Section 5A).** Concierge, Translation, Schedule, Settings, Help/About/Donate hooks were NOT enumerated — narrow follow-up sweep recommended if needed.
- **Hook *internals* (TanStack Query keys, retry policies, cache invalidation) were not audited; only their consumed endpoints were captured.**
- **Database state.** Whether the `strategies.consolidated_strategy` column has been dropped from the live DB (or just stopped being written) needs DB inspection.
- **CI / build pipeline.** Not audited.
- **Test coverage.** Not surveyed.
- **Authentication, rate-limiting, CSP.** Out of scope.
- **The hooks / Siri / offer-analyzer pipelines.** AI roles confirmed; deeper internals not audited.

---

*End of audit. For questions or corrections, edit this doc and submit a PR; the audit is meant to live alongside `docs/architecture/audits/` and be revised as code changes.*
