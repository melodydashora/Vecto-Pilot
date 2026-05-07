# Still-Extant Issues from Audit Sweep — 2026-05-06

Consolidates verified findings from the 2026-05-06 audit verification sweep across the 22 audit files in `docs/architecture/audits/` and the 2 files in `.code_based_rules/.rules_do_not_change/`. Each finding was verified against current code on `main` by 5 parallel research agents. Resolved findings are listed at the bottom for context.

**Method:** ~74 raw audit findings → deduplicated → ~65 unique issues, grouped here by severity and theme. No fixes proposed; no doctrine codified.

---

## CRITICAL / HIGH SEVERITY

### Identity Foundation Cluster (dominant remaining failure mode)

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 1 | `driver_handles` table not created; analyze-offer.js still uses `device_id` as zero-auth identity | `server/api/hooks/analyze-offer.js:188-225` | RECON §B (Phase 1) |
| 2 | `getOfferHistory` reads `offer_intelligence` with no `WHERE user_id` clause — multi-user data cross-contaminates coach context | `server/lib/ai/rideshare-coach-dal.js:1249-1274` | RECON §A.2/A.4; FRISCO_LOCK §G |
| 3 | All `offer_intelligence` rows have `user_id IS NULL`; `device_id` has 3 encoding variants for one device | `offer_intelligence` rows | FRISCO_LOCK §G |

These three are coupled — Phase 1 of the recon was designed to unblock all three.

### Events Pipeline Integrity

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 4 | Hash computed BEFORE venue/address resolution — uses Gemini's raw address text, not Google Places `formattedAddress`; same real event with unstable Gemini text bypasses DB unique constraint | `server/lib/briefing/pipelines/events.js:611-680` | events_e2e_audit §6 |
| 5 | Path B multi-day predicate still wrong at 2 of 3 query sites (main route fixed, others not) | `server/api/briefing/briefing.js:439-440, 1045-1046` | CODEBASE_AUDIT §11 |
| 6 | Multi-showing same-day events collapse — hash excludes time, so 7pm and 9:30pm same-venue same-title shows merge into one row | `server/lib/events/pipeline/hashEvent.js:159-184` | events_e2e_audit P1-1 |
| 7 | Discovery prompt says today only; DB read window uses 7-day horizon — contracts disagree | `events.js:307-338` (prompt) vs `:568-576, :819-820` (DB) | events_e2e_audit P1-5 |

### Client PII Leak

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 8 | `console.log` emits full UUID `userId` on every GPS update | `client/src/contexts/location-context-clean.tsx:386` | RECON §D.2 |
| 9 | `console.error` emits full UUID `userId` in 401 error branch | `client/src/contexts/location-context-clean.tsx:514` | RECON §D.2 |

### Coach Observability Gap

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 10 | `coach_system_notes` HTTP-queryable but no client component renders it — Coach bug reports invisible to operators by default | server: `chat.js:1669` (GET); client: zero consumers | pass-f F-Rule 5 |
| 11 | No cron/health/alert surfaces `count(*) FROM coach_system_notes WHERE status='new'` — tracer row sat 18+ hours unsurfaced | architectural gap | pass-f Survivability finding 1 |

### Session / Auth UX

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 12 | `SESSION_HARD_LIMIT_MS = 2h`, `SESSION_SLIDING_WINDOW_MS = 60min`, no JWT refresh — 12-hour shifts force 5-6 re-logins | `server/middleware/auth.js:11-12` | FRISCO_LOCK §F |

### Market-Slug Naming Drift

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 13 | 4 distinct DFW slug conventions (`dfw` 301, `dallas-fort-worth-tx` 25, `dallas-fort-worth`, `Dallas-Fort Worth`); 403 venue_catalog rows NULL slug | `venue_catalog`, `zone_intelligence`, `market_intelligence`, `snapshots` | FRISCO_LOCK §A |

### Data Seed Coverage (Operational, not Code)

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 14 | Content-layer tables overwhelmingly TX-only — `venue_catalog` (720 TX, 11 NULL, 2 FL, 1 MA, 1 NV); `discovered_events` (71 TX, only state) | DB content | FRISCO_LOCK §A |

---

## MEDIUM SEVERITY

### Map Consolidation Residuals

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 15 | `MapPage.tsx` (184 lines) still on disk despite Phase B "removed" comment | `client/src/pages/co-pilot/MapPage.tsx` | MapResearch MR-1 |
| 16 | `MapTab.tsx` retains unsafe patterns (direct `removeChild` script lifecycle, unescaped HTML in `setContent`, `fitBounds` excludes bar markers) | `client/src/components/MapTab.tsx:140-141, 230-249, 256-266` | MapResearch MR-2 |
| 17 | `TacticalStagingMap.tsx` still on disk after Phase C "deletion"; reintroduces unsafe `document.head.appendChild(script)` | `client/src/components/intel/TacticalStagingMap.tsx:211` | MapResearch MR-3 |
| 18 | Zone taxonomy mismatch: MAP.md doc lists 8 zone_types, intelligence API whitelist accepts only 5 — clients using doc will hit 400s | `server/api/intelligence/index.js:94` vs `docs/architecture/MAP.md:123,138-143` | MapResearch MR-5 |

### Pipeline / Phase Emission

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 19 | `updatePhase('complete')` has 4 writers — duplicate SSE phase emits | `blocks-fast.js:272, 1039, 1060`; `content-blocks.js:210` | CODEBASE_AUDIT §10.1 |
| 20 | `updatePhase('venues')` emitted at orchestrator AND worker — double emit | `blocks-fast.js:949` + `enhanced-smart-blocks.js:413` | duplicate-functions-fix-plan B.1 |
| 21 | Path B sorts events by `event_start_date` not impact; LIMIT 20 may drop high-impact events; no planner-grade orphan gate | `briefing.js:907, 444, 1050` | CODEBASE_AUDIT §13.5 |

### Coach DAL Coverage Gaps

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 22 | Coach DAL doesn't import 11 operator-relevant tables (`driver_goals, driver_tasks, safe_zones, staging_saturation, traffic_zones, travel_disruptions, venue_events, llm_venue_suggestions, concierge_feedback, app_feedback, market_intel`) | `rideshare-coach-dal.js` | RECON §A.6 |
| 23 | `getOfferHistory` projects 17 of 52 columns; 35 columns (route, position, temporal, provenance, sequence, raw text) never reach the coach prompt | `rideshare-coach-dal.js:1252-1271` | RECON §A.3.b |
| 24 | 12 of 13 purpose-built `offer_intelligence` indexes idle — only `idx_oi_created_at` queried; analytical helpers not implemented | offer_intelligence indexes | RECON §A.3.a |
| 25 | `user_override` written by analyze-offer code but never fed back into rule tuning or prompts | pipeline-wide | RECON §A.3 / OFFER_ANALYZER §16 |

### Events Cache / Timeout Hygiene

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 26 | `withTimeout` creates AbortController and calls `.abort()` on timeout, but `signal` never passed to `callModel` — Gemini call keeps running while timeout returns to caller | `events.js:63-82, 372` | events_e2e_audit P1-4 |
| 27 | `filterInvalidEvents` calls full `validateEventsHard` instead of gating via `needsReadTimeValidation(schemaVersion)` (which exists for this purpose) | `events.js:274-288`; used at `briefing.js:1228` | events_e2e_audit P1-3 |
| 28 | No per-market cross-snapshot events cache; two drivers same market each pay 45s discovery latency | `events.js`; no `market_events_cache` table | FRISCO_LOCK §E |
| 29 | `useActiveEventsQuery` polls every 60s without phase-based scoping | `client/src/hooks/useBriefingQueries.ts:454-458` | CODEBASE_AUDIT §10.3 |

### Feedback Surface Asymmetry

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 30 | `POST /api/actions` is POST-only — no `router.get`; operators can't retrieve action data via HTTP | `server/api/feedback/actions.js:33` | pass-f F-1.5 |
| 31 | Legacy `/api/chat/notes` POST/GET/DELETE handlers still live, duplicating canonical `/api/coach/notes` | `chat.js:708, 745, 760` | pass-f F-1.6 |
| 32 | `[COACH_MEMO]` action tag still appends to `docs/coach-inbox.md` via `fs.appendFile` — not DB-persisted, not queryable | `chat.js:6, 488-511` | pass-f F-Rule 4 |
| 33 | Strategy feedback has no GET summary endpoint; doesn't trigger `indexFeedback()` / `captureLearning()` | `feedback.js` | pass-f F-Rule 2 |
| 34 | `/agent/memory/*` POST routes for `/preference, /session, /project` have no GET counterparts | `agent-server.js:550, 564, 578, 626, 640` | pass-f survivability §Q4 |

### Process / Topology

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 35 | Autoscaled instances don't pre-issue `LISTEN` at boot — first-subscriber race window per instance lifetime (mitigated by F2 handshake) | `server/db/db-client.js:295-303` | NEON_AUTOSCALE §4.3 W1 |
| 36 | No catch-up SQL after dispatcher LISTEN reconnect — only re-issues `LISTEN <chan>`. (Audit: F2 handshake makes F3 redundant; left as belt-and-suspenders option) | `db-client.js:250-285` | NOTIFY_LOSS G2 |
| 37 | No startup guard against pooler URL on LISTEN client — future migration to pooled Neon would silently break LISTEN/NOTIFY | `server/db/` | NEON_AUTOSCALE §3 / §8 QN-A4 |

### Page / UX

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 38 | `/co-pilot/preferences` route does not exist; `client/src/_future/user-settings/` stubs not wired; no `PreferencesPage.tsx` | `client/src/pages/co-pilot/`, `routes.tsx` | RECON §C |

### Schema Drift in Live API

| # | Issue | Location | Source |
|---|-------|----------|--------|
| 39 | `sample_query` exposed to LLM uses `WHERE platform = 'uber'` with no `user_id` predicate — if any analytical helper follows this template, multi-user contamination propagates into LLM-suggested SQL | `server/api/rideshare-coach/schema.js:82` | RECON §A.4 |

---

## LOW SEVERITY (doc drift, dead code, cosmetic)

### Doc Drift

| # | Issue | Location |
|---|-------|----------|
| 40 | `connection-manager.js:3, 13` inline comments still claim Helium (don't distinguish dev vs prod) | `server/db/connection-manager.js` |
| 41 | `drizzle.config.js:3-5` says "No external databases (Neon, Vercel, Railway, etc.) are used" — false; prod is Neon | `drizzle.config.js` |
| 42 | `migrations/004_jwt_helpers.sql:1-3` references "Neon populates request.jwt.claims"; `scripts/make-jwks.mjs:6, 47` references "Neon Console" | `migrations/`, `scripts/` |
| 43 | `VENUES.md:81-82` schema still lists `lat, lng: number` despite 2026-04-16 redesign removing coords from LLM output | `docs/architecture/VENUES.md` |
| 44 | `DB_SCHEMA.md:96` still lists `consolidated_strategy` as "unused" — not formally marked legacy/removed | `docs/architecture/DB_SCHEMA.md` |
| 45 | `openai-adapter.js:5` header refers to deprecated `BRIEFING_NEWS_GPT` role (dual-news cleanup 2026-01-14) | `server/lib/ai/adapters/openai-adapter.js` |
| 46 | `MAP.md` describes pre-consolidation 3-component architecture; not updated for single-`StrategyMap` reality | `docs/architecture/MAP.md` |
| 47 | `EVENT_FRESHNESS_AND_TTL.md`, `BRIEFING_AND_EVENTS_ISSUES.md` not marked SUPERSEDED by `EVENTS.md` | `docs/` |
| 48 | `pass-e-coach-memory-observability.md:58` cites `coach_notes table` — actual table is `user_intel_notes` | audit doc |
| 49 | `StrategyPage.tsx:118-122` comment says "currently 2 consumers (this page + MapPage)" — MapPage was deleted Phase B | `client/src/pages/co-pilot/StrategyPage.tsx` |

### Frisco Residuals

| # | Issue | Location |
|---|-------|----------|
| 50 | `diagnostics.js:673` uses `const { city = 'Frisco', state = 'TX' } = req.query;` (auth-gated diagnostics) | `server/api/health/diagnostics.js` |
| 51 | `LandingPage.tsx:498, 539, 540, 582, 662` hardcodes "Frisco, TX" / "Sidecar Social Frisco" / "6770 Winning Dr, Frisco" demo strings | `client/src/pages/landing/LandingPage.tsx` |

### Dead Code

| # | Issue | Location |
|---|-------|----------|
| 52 | `assistant-proxy.ts` (4948 bytes) has zero importers; not launched in `.replit` or `package.json` | `server/gateway/assistant-proxy.ts` |
| 53 | `strategy-triggers.js` still present after sibling files deleted — importer count not verified | `server/lib/strategy/strategy-triggers.js` |
| 54 | `MarketBoundaryGrid` and `MarketDeadheadCalculator` rendered inside `false && ...` guards | `client/src/components/RideshareIntelTab.tsx:416, 516` |
| 55 | `normalizeTimeForHash` defined but unused — zero callers | `server/lib/events/pipeline/hashEvent.js:124-147` |
| 56 | `intercepted_signals` table still resident in DB; zero readers/writers | DB |
| 57 | `bin/vecto-runner` referenced in CLAUDE.md and `REPLIT_WORKFLOW_CONTROL.md` but file does not exist | repo root |

### App.MD-Tracked Items

| # | Issue | Location |
|---|-------|----------|
| 58 | `permissions` JSONB column in `snapshots`; rule says permissions should live in a "workflow table" with last-generated-time — no such table exists | `shared/schema.js:69` |
| 59 | Logs say `Places API` but code uses Google Places API (New); rule says label should be `Place (NEW) API` | `venue-enrichment.js:417, 454, 505, 512, 518` |

### Misc Low-Severity

| # | Issue | Location |
|---|-------|----------|
| 60 | 7-route inline `filterFreshEvents` idiom not consolidated (audit §6.3 explicitly classifies as intentional idiom duplication — informational) | `briefing.js` 8 inline call sites |
| 61 | `app_feedback` lane lacks rate limiting (other routes have 10/min); no action-table logging; no async enrichment | `feedback.js:344-355` |
| 62 | No `GET /api/feedback/app` or `/api/feedback/app/summary` — symmetric with venue read pattern missing | `feedback.js` |
| 63 | 6 memory-like tables (`agent_changes, agent_memory, assistant_memory, claude_memory, cross_thread_memory, eidolon_memory`); only 2 reachable via documented HTTP lanes | schema-level |
| 64 | `location-context-clean.tsx:867` uses `user.userId.slice(0, 8)` — borderline; recommend normalizing to `'set' \| 'anonymous'` | client |
| 65 | `/api/briefing/events` recompute-on-each-request — partial overlap with #29 (frontend phase scoping is preferred fix) | `briefing.js` events route |

---

## NEEDS-INVESTIGATION

| # | Issue | Why blocked |
|---|-------|-------------|
| 66 | `validateEvent()` timezone-safety; `event-matcher.js` per-key telemetry counts | Audit listed as "needs direct verification"; not pinpointed in this sweep |
| 67 | App.MD #1: Google/Apple/third-party sign-in completion status | Requires auth.js inspection + provider config audit |
| 68 | App.MD #4: `strategies` table structure correctness | Cascade verified at schema.js:87, but rule wording ambiguous re: "right structure" |
| 69 | App.MD #7: TomTom incidents no longer showing on map | Suggests UI regression; can't verify without running app |
| 70 | App.MD #11/#12: LLM prompts include real-location examples; console logs include literal coords vs "why" framing | Requires exhaustive prompt-string review |
| 71 | `root_server_scripts_audit (1).md` — file in git status as untracked but not on disk per agent verification | File state confused; needs re-check |

---

## RESOLVED (omitted from action list, noted for context)

- **GA1, GA2** (Frisco hardcodes in PHASE2_SYSTEM_PROMPT, tactical-planner.js examples) — fixed 2026-04-18
- **Part C 202-trap** (FRISCO_LOCK Part C) — all 4 endpoints now return 200 + `_coverageEmpty: true`
- **G1, G3, G4, G5, G6** (NOTIFY_LOSS) — F1 client `_coverageEmpty` honoring, F2 SSE handshake, browser-native EventSource auto-reconnect, triad-worker migrated
- **events_e2e_audit P0-1, P0-2, P0-3, P1-2** — multi-day validation, overnight rollover, multi-day hash, lat/lng coercion all fixed 2026-05-05
- **Pass C, Pass D, journey.md** — fully resolved or pure doctrine
- **verification-2026-04-16-hallucination-fixes.md** — entirely PASS
- **6 of 7 daily-strategy doc lag refs** — only DB_SCHEMA.md remains
- **6 of 7 dead strategy files deleted** — only `strategy-triggers.js` remains
- **Doctrine drift in CLAUDE.md / DATABASE_ENVIRONMENTS.md / .env.local.example** — corrected
- **`filter-for-planner.js` legacy fallback** — DELETED, throws on contract violation
- **`server/lib/briefing/briefing-service.js`** — refactored into `pipelines/`
- **Routes.tsx and BottomTabNavigation.tsx Map-tab cleanup; ConciergeMap.tsx + EventsExplorer.tsx deleted; new `StrategyMap.tsx` with escapeHtml + layer-aware fitBounds + singleton Google Maps loader** — landed

---

## Source Audits Surveyed

Verified by 5 parallel research agents on 2026-05-06:

1. `CODEBASE_AUDIT_2026-04-27.md` (87KB)
2. `HANDOFF_2026-04-24.md`
3. `duplicate-functions-fix-plan-2026-04-28.md`
4. `verification-2026-04-16-hallucination-fixes.md`
5. `events_current_baseline.md` (no findings — baseline doc)
6. `events_e2e_audit.md`
7. `llm_calls_audit.md`, `llm_calls_audit_base.md` (no findings — catalogs)
8. `FRISCO_LOCK_DIAGNOSIS_2026-04-18.md`
9. `GEOGRAPHIC_ANCHOR_AUDIT_2026-04-18.md`
10. `RECON_2026-04-17_HANDLES_LOCALITY.md`
11. `NEON_AUTOSCALE_TOPOLOGY_2026-04-18.md`
12. `NOTIFY_LOSS_RECON_2026-04-18.md`
13. `REPLIT_WORKFLOW_CONTROL.md` (reference doc — no findings)
14. `MapResearch.md`
15. `pass-c-api-surface-map.md` (closed by DECISIONS.md #16)
16. `pass-d-client-field-survivability.md` (closed by commit 6b321afb)
17. `pass-e-coach-memory-observability.md` (superseded by Pass F)
18. `pass-f-issue-logging-observability.md`
19. `pass-f-issue-logging-survivability.md`
20. `.code_based_rules/.rules_do_not_change/app.MD`
21. `.code_based_rules/.rules_do_not_change/journey.md` (doctrine — no findings)

Skipped: `deep-research-report.md` (verified yesterday); `README.md` (audit index); `root_server_scripts_audit (1).md` (untracked, not on disk per verification).

---

This file is research output, not direction. Melody triages.
