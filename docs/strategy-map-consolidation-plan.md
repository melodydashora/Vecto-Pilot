# Strategy Map Consolidation Plan

**Author:** Claude Opus 4.7 (1M context)
**Date:** 2026-04-26 (initial), revised 2026-04-26 after MapResearch peer review
**Status:** AWAITING TEST APPROVAL (Rule 1) — no code changes yet
**Approver:** Melody
**Companion docs:** `docs/strategy-map-consolidation-findings.md` (raw inventory), `.claude/plans/MapResearch.md` (peer-review audit)

---

## 0. Corrections Applied (2026-04-26 revision)

This revision integrates 9 corrections from `MapResearch.md` peer review plus 1 new finding from my verification pass. **All corrections were verified against live code/DB before applying.**

| # | What changed | Source | Impact |
|---|--------------|--------|--------|
| C1 | `/staging-areas` endpoint contract: requires `snapshotId`, not `market` | MapResearch + verified `intelligence/index.js:1101` | Phase C calls fixed |
| C2 | `/intelligence/markets` returns counts only, NOT boundaries | MapResearch + verified `intelligence/index.js:228-242` | Phase E loses its data source — became a design fork |
| C3 | Filter param is `subtype`, not `zone_type` | MapResearch + verified `intelligence/index.js:117-120` | Phase D filter syntax fixed |
| C4 | Subtype whitelist is 5 values, not 7. `surge_trap`, `staging_spot`, `event_zone` are NOT accepted | MapResearch + verified `intelligence/index.js:94` | Phase D layer list narrowed |
| C5 | Bottom nav has 7 tabs (Strategy, Coach, Lounges & Bars, Briefing, Map, Translate, Concierge), not 5 | MapResearch + verified `BottomTabNavigation.tsx` | Test plan tab math fixed |
| C6 | Bars are excluded from `fitBounds` — real bug to fix during consolidation | MapResearch + verified `MapTab.tsx:318,321` | New Phase A.5 task |
| C7 | `escapeHtml` should apply to ALL InfoWindow content, not deferred to AI-zone descriptions | MapResearch + verified `MapTab.tsx:307,442,551` | Hoisted from Phase D into Phase A |
| C8 | `MarketBoundaryGrid` and `MarketDeadheadCalculator` are `false &&` dormant in `RideshareIntelTab.tsx:504,604` | MapResearch + verified | Added to taxonomy as open decision |
| C9 | TomTom incidents (`server/lib/traffic/tomtom.js`) are produced server-side and fed to the AI tactical planner but NEVER visualized on the map | MapResearch + confirmed grep | New Phase F |
| C10 | **NEW finding from verification:** `market_intelligence` and `zone_intelligence` are different tables. The API at `/api/intelligence/*` reads from `market_intelligence` (`intel_type`/`intel_subtype`). The `zone_intelligence` table I cited in my draft has its own schema with `zone_type` and is nearly empty (1 row in live dev DB) | My verification pass | Phase D data source fork |

Net effect: **plan is more rigorous, three new open design forks for Melody to settle (§4.6).**

---

## 1. Objectives

Collapse every Google-Maps-backed surface in the app into a **single, intelligent map** that lives in the Strategy tab (`StrategyPage.tsx` → `MapTab.tsx`). The consolidated map must:

1. Consume every existing geographic data source (zones, venues, events, bars, traffic, demand patterns, market boundaries).
2. Surface tactical intelligence visually: honey holes, dead zones, danger zones, staging spots, surge zones, market exit warnings.
3. Migrate to modern Google Maps APIs (`loading=async`, `AdvancedMarkerElement`, `mapId`) — clears two coach-inbox TODOs.
4. Eliminate duplicate Google Maps script loaders (currently 3 components each load their own — root cause of the TacticalStagingMap `removeChild` bug).
5. Delete dead/duplicate map code — but only after verified-safe enumeration.

The plan is phased so Melody can approve and verify each phase before the next ships.

---

## 2. Current State (Verified 2026-04-26)

### 2.1 Map components in the codebase

| File | LOC | Status | Consumers | Notes |
|------|-----|--------|-----------|-------|
| `client/src/components/MapTab.tsx` | 648 | **KEEPER** | Embedded in `StrategyPage` (commit `7262213f`); wrapped by `MapPage` | Has `lastEventKeyRef` dedup (2026-04-04 fix), traffic layer, 4 marker categories |
| `client/src/pages/co-pilot/MapPage.tsx` | 187 | **DUPLICATE WRAPPER** | Routed at `/co-pilot/map`; bottom nav (`BottomTabNavigation.tsx:73`) | Just wraps MapTab with GPS guard; identical data path to Strategy embed |
| `client/src/components/intel/TacticalStagingMap.tsx` | 778 | **DISABLED** | Imported in `RideshareIntelTab.tsx:54` but render commented (`L455`: "TODO: Fix Google Maps integration to prevent removeChild errors") | Has unique mission selector + staging/avoid zone rendering — capabilities to fold into MapTab |
| `client/src/components/concierge/ConciergeMap.tsx` | 278 | **ORPHANED** | Zero imports anywhere (verified) | Scaffolded in `c45996b8`, never wired into `PublicConciergePage`. Stale comment in `EventsExplorer.tsx:23,36` is the only trace |
| `client/src/components/concierge/EventsExplorer.tsx` | (n/a) | **ORPHANED** | Zero imports anywhere (verified) | Same scaffolding feature; never rendered |

### 2.2 Hooks/contexts touching `VITE_GOOGLE_MAPS_API_KEY`

| File | Use | Decision |
|------|-----|----------|
| `client/src/contexts/location-context-clean.tsx:112` | Google Geolocation API fallback when browser GPS denied | **DO NOT TOUCH** — not a map; a coords-fallback path |
| `client/src/pages/concierge/PublicConciergePage.tsx:116` | Reverse geocoding (lat/lng → city, state) string lookup | **DO NOT TOUCH** — passenger-facing string display, not a map |

### 2.3 Server-side surfaces (full inventory exists in this session's transcript)

**13 API endpoints, 13 DB tables, 4 geo libs, 6 external APIs.** Most power non-map features (briefing pipeline, strategist enrichment, AI Coach memory). Almost nothing on the server side gets touched by this consolidation — see §4 taxonomy.

---

## 3. Target State

A single `StrategyMap` (renamed from `MapTab`) inside Strategy that renders, as **togglable layers**:

| Layer | Source | Default visibility | Notes |
|-------|--------|-------------------|-------|
| Driver position | `useCoPilot().coords` | always on | unchanged |
| Strategy venues (SmartBlocks) | `useCoPilot().blocks` | on | unchanged |
| Premium bars ($$+) | `useCoPilot().barsData` (via `useBarsQuery`) | on | now participates in `fitBounds` (C6 fix) |
| Today's events | `useActiveEventsQuery(snapshotId)` | on | unchanged; scope is *intersection* of "active now" AND "today" — widening this is out of scope |
| Traffic overlay | `google.maps.TrafficLayer` | on | unchanged |
| **NEW — Honey holes** | `GET /api/intelligence/market/:slug?type=zone` then client-filter `subtype === 'honey_hole'` (C3) | on | `market_intelligence` rows |
| **NEW — Dead zones** | same fetch, `subtype === 'dead_zone'` | off (toggle) | |
| **NEW — Danger zones** | same fetch, `subtype === 'danger_zone'` | on | |
| **NEW — Safe corridors** | same fetch, `subtype === 'safe_corridor'` | off (toggle) | added — was missing from draft |
| **NEW — Caution zones** | same fetch, `subtype === 'caution_zone'` | off (toggle) | added — was missing from draft |
| **NEW — Staging spots** | `GET /api/intelligence/staging-areas?snapshotId=...` (C1) — reads `ranking_candidates.staging_lat/staging_lng` | on | Note: snapshot-scoped, so re-fetches when snapshot changes |
| **NEW — Demand patterns / surge zones** | `GET /api/intelligence/demand-patterns/:marketSlug` | off (toggle) | |
| **NEW — TomTom incidents** (Phase F, C9) | server-derived from `server/lib/traffic/tomtom.js` (already produced; needs new client endpoint OR surfaced via existing briefing pipeline) | off (toggle) | requires routing decision in Phase F |
| **Market boundary** | **OPEN FORK — see §4.6** | on (passive line) when source decided | C2: `/intelligence/markets` returns counts only; no boundaries source exists today |
| **Daypart arc** | computed from `daypart.js` + zone `time_constraints` JSONB (where present) | passive shading | applies to zones whose subtype rows carry `time_constraints` |

**Subtypes explicitly NOT in this consolidation** (per C4 — server whitelist `intelligence/index.js:94` does not accept them):
- `surge_trap` — would need server whitelist expansion
- `staging_spot` (as a zone subtype — distinct from the staging-areas endpoint above)
- `event_zone` — events are already a separate layer

If you want any of these, that's a server-side change and exits the "no server changes" goal.

Plus a **Code 6 — Market Exit Warning**: when an offer's destination falls outside the market boundary polygon, surface a red overlay (Coach inbox 2026-04-09 spec). **Blocked on §4.6 boundary-source decision.**

---

## 4. Scope Taxonomy (per advisor §3)

This is the load-bearing section. **Approval of this plan = approval of this taxonomy.**

### 4.1 DELETE

| Item | Reason | Side effects to mitigate |
|------|--------|------------------------|
| `client/src/pages/co-pilot/MapPage.tsx` | Pure wrapper; logic identical to Strategy embed | Remove route in `routes.tsx:13,139`; remove `Map` tab from `BottomTabNavigation.tsx:73`; verify no deeplinks |
| `client/src/components/concierge/ConciergeMap.tsx` | Zero imports (verified) | Delete companion `EventsExplorer.tsx` (also orphaned) |
| `client/src/components/concierge/EventsExplorer.tsx` | Zero imports (verified) | None |

### 4.2 RENAME + ENHANCE (the keeper)

| Item | Action | Rationale |
|------|--------|-----------|
| `client/src/components/MapTab.tsx` → `client/src/components/strategy/StrategyMap.tsx` | Rename for clarity. Update import in `StrategyPage.tsx` in the same atomic commit. Move into `client/src/components/strategy/` to colocate with its only consumer. | The "Tab" suffix is misleading — there is no tab. The component is *the* map and it lives inside Strategy. Filenames carry architectural intent: `StrategyMap.tsx` reads correctly to the next engineer who opens the directory; `MapTab.tsx` will keep prompting "what tab?" until someone wastes time finding out. Import-path churn is one search-and-replace; misleading names rot for years. |

### 4.3 FOLD INTO StrategyMap (capabilities only, not files)

| Source | Capability to extract | New layer |
|--------|----------------------|-----------|
| `TacticalStagingMap.tsx` | Mission selector (events + airports); staging/avoid zone rendering; tactical-plan API call | "Mission" mode toggle on StrategyMap; staging/avoid as zone-layer types |
| `TacticalStagingMap.tsx` | The "no script removal on cleanup" pattern | Becomes the canonical pattern in the singleton loader (§5.1) |

**After folding, `TacticalStagingMap.tsx` is deleted** AND the disabled render block in `RideshareIntelTab.tsx:455-465` is removed (since Intel tab moved to hamburger per commit `e8dfc3bd`, and Market Intel becomes a hub-page anyway).

### 4.4 DO NOT TOUCH (server-side and adjacent client)

- All 13 server API endpoints (`/api/location/*`, `/api/venues/*`, `/api/intelligence/*`, `/api/briefing/*`, `/api/strategy/*`)
- All 13 geographic DB tables (`snapshots`, `coords_cache`, `venue_catalog`, `ranking_candidates`, `discovered_events`, `traffic_zones`, `venue_events`, `zone_intelligence`, `market_intelligence`, `platform_data`, `markets`, `market_cities`, `driver_profiles`, `intercepted_signals`)
- All `server/lib/location/`, `server/lib/venue/`, `server/lib/external/` libs
- `location-context-clean.tsx` (geolocation fallback — not a map)
- `PublicConciergePage.tsx` (reverse geocoding string lookup — not a map)
- `co-pilot-helpers.ts` (`haversineDistance`, `openGoogleMaps`, etc. — utility functions reused beyond maps)

### 4.5 CONSUME AS NEW LAYERS (no server changes — verified contracts)

These endpoints already exist; StrategyMap calls them as new layers:

- `GET /api/intelligence/market/:slug?type=zone` then client-side filter by `subtype` — `market_intelligence` rows (NOT `zone_intelligence` — see §4.6 fork #2)
- `GET /api/intelligence/staging-areas?snapshotId=...` — `ranking_candidates` staging spots (snapshot-scoped, per `apiRoutes.ts:113`)
- `GET /api/intelligence/demand-patterns/:marketSlug` — surge/demand patterns

**Removed from this section** (these contracts don't work):
- ~~`GET /api/intelligence/markets` for boundaries~~ — returns counts only (verified `intelligence/index.js:228-242`). See fork #1.
- ~~`?zone_type=` filter~~ — actual param is `?subtype=` (verified `intelligence/index.js:120`).
- ~~`?market=` for staging~~ — actual param is `?snapshotId=` (verified `intelligence/index.js:1101`).

### 4.6 OPEN DESIGN FORKS (decisions Melody must make before relevant phases ship)

| # | Fork | Options | Recommendation | Phase blocked |
|---|------|---------|---------------|---------------|
| 1 | **Market boundary source** — no API exists today | (a) Add `boundaries` JSONB column + endpoint to `market_intelligence` (server change); (b) hardcode polygons per market in client config (`client/src/config/marketBoundaries.ts`); (c) reuse existing `platform_data.coord_boundary` (already JSONB, polygon shape unknown) | (c) is "no-server-change" friendly IF `coord_boundary` is GeoJSON-shaped. (b) is fast and good enough for DFW + 1–2 markets. Avoid (a) unless you want to commit to a server change. | E (Market Exit Warning / Code 6) |
| 2 | **`zone_intelligence` vs `market_intelligence` table fate** | (a) Deprecate `zone_intelligence` (1 row in dev DB, never plumbed); route everything through `market_intelligence`; (b) Plumb `zone_intelligence` into the API (server change); (c) Migrate the 1 existing row to `market_intelligence` then drop `zone_intelligence` table | (a) is the lowest-risk choice and matches what the API already does. (c) is cleanest long-term but requires a migration. | D (zone layers) |
| 3 | **Dormant Intel components** — `MarketBoundaryGrid` + `MarketDeadheadCalculator` (currently `false &&` gated in `RideshareIntelTab.tsx:504,604`) | (a) Fold both into StrategyMap as new visualization modes; (b) Revive on the Market Intel hub page (separate from map); (c) Delete both | If `MarketBoundaryGrid` already knows how to render market boundaries, it could be the source for fork #1. Worth reading both files before deciding — I'll do that as a quick deep-dive if you pick this option. | E indirectly (if (a)); none directly |
| 4 | **TomTom incidents routing** — server has data | (a) Consume incidents from existing briefing payload (**VERIFIED FREE** — `briefing-service.js:567` already returns `incidents`/`closures`/`highwayIncidents`/`congestionLevel`/`highDemandZones`; `briefing.js:261,323,477,564,710` already includes `traffic: briefing.traffic_conditions` in `res.json()` responses; client just doesn't consume the field today); (b) New `GET /api/traffic/incidents?lat=&lng=` endpoint; (c) Re-use existing briefing-traffic SSE | **(a) — confirmed zero server change**. Just add a client-side selector for `briefing.traffic.incidents` in `useBriefingQueries.ts`. | F (TomTom incidents layer) |

**Recommended defaults if you don't want to decide each individually:** Fork 1 = (b), Fork 2 = (a), Fork 3 = (c), Fork 4 = (a). All four converge on "no server changes." Just say "use defaults" and I'll spec to those.

---

## 5. Architecture

### 5.1 Singleton Google Maps loader (root-cause fix for `removeChild` bug)

**Problem:** Today MapTab, ConciergeMap, and TacticalStagingMap each inject their own `<script>` tag. MapTab's cleanup calls `document.head.removeChild(script)` (line 197-199), which yanks the shared API out from under any other map mounted simultaneously. This is the recorded `removeChild` error in TacticalStagingMap.

**Fix:** new module `client/src/lib/maps/google-maps-loader.ts` that:
- Loads the script ONCE per page lifecycle
- Includes `&loading=async` (clears coach-inbox TODO)
- Returns a `Promise<typeof google>` shared across consumers
- Never removes the script tag (matches TacticalStagingMap's correct comment)
- Validates `VITE_GOOGLE_MAPS_API_KEY` at module init; surfaces a typed error on missing

All map consumers `import { loadGoogleMaps } from '@/lib/maps/google-maps-loader'` and `await` it inside `useEffect`.

### 5.2 Layer pattern with `lastXKeyRef` dedup (per-layer; advisor §4)

The 2026-04-04 fix (`lastEventKeyRef`) prevents parent re-renders from thrashing event markers every ~500ms. **Codified as a pattern**: every new layer gets its own `lastXKeyRef`. Skeleton:

```ts
const lastZoneKeyRef = useRef<string>('');
useEffect(() => {
  if (!mapReady || !mapInstanceRef.current) return;
  const zoneKey = zones.map(z => `${z.id}|${z.lat}|${z.lng}|${z.radius_miles}`).join(';');
  if (zoneKey === lastZoneKeyRef.current) return;
  lastZoneKeyRef.current = zoneKey;
  // clear + re-add zone overlays
}, [mapReady, zones]);
```

Without this, demand-pattern + zone re-fetches will re-render every ~30s (SSE updates) and grind the map.

### 5.3 `AdvancedMarkerElement` + `mapId` (per advisor §5)

- Adopt `google.maps.marker.AdvancedMarkerElement` (replaces deprecated `google.maps.Marker`)
- Provision a `mapId` in Google Cloud Console (Melody — manual step, document in plan)
- Move marker styling to Cloud Console map style (removes ~150 lines of inline marker CSS / icon URL strings)
- Custom marker content via DOM (`document.createElement('div')`) — better React-isolation than image URLs, allows hover effects

### 5.4 Layer-toggle UI

A small floating control top-right of the map: chips for Events / Bars / Honey holes / Dead zones / Danger zones / Surge / Mission mode. State lives in `useState` on StrategyMap, persisted to `localStorage` (key `vecto:map-layers`) so driver preferences survive sessions.

### 5.5 Code 6 — Market Exit Warning

Pulls market polygon from `market_intelligence.boundaries`. When a SmartBlock or active offer destination falls outside the polygon (`google.maps.geometry.poly.containsLocation` — requires `&libraries=geometry` in loader), render a red zone overlay + an info banner. This is the Coach inbox 2026-04-09 "Waco Trap" spec.

---

## 6. Phases

Each phase is small enough to approve, test, and ship independently.

### Phase A — Foundations: singleton loader, deprecation cleanup, security, layer-aware bounds
*(touches MapTab only; no new layers; no behavior change beyond hardening)*
1. Create `client/src/lib/maps/google-maps-loader.ts` — singleton script loader
2. Refactor MapTab.tsx to use it (no other functional change)
3. Add `&loading=async`, `&libraries=maps,marker,geometry` to script URL
4. Replace all `google.maps.Marker` → `AdvancedMarkerElement` in MapTab (Melody must provision `mapId` first; can defer if not ready)
5. **NEW (C7):** Extract `escapeHtml()` helper to `client/src/lib/maps/escape-html.ts` and apply to ALL `setContent()` calls in MapTab (lines 307, 442, 551). Pattern lifted from `ConciergeMap.tsx:12-19` before that file is deleted in Phase B.
6. **NEW (C6):** Refactor `fitBounds` calculation to be layer-aware — extend bounds for ALL enabled marker layers (driver + venues + bars + events), not just the venues+events subset that exists today (`MapTab.tsx:318,321`).

**Test:** Strategy embed renders identically; no console deprecation warnings; no `removeChild` errors when navigating between Strategy and any other route; map auto-zoom now includes bars in the visible viewport.

### Phase B — Delete orphans (references-first ordering to avoid transient broken imports)
7. **Detach references** to `MapPage`: remove `import MapPage from '@/pages/co-pilot/MapPage'` (`routes.tsx:13`) AND remove the `path: 'map' / element: <MapPage />` route entry (`routes.tsx:139`)
8. **Detach reference** to Map tab: remove the Map tab object in `BottomTabNavigation.tsx` (lines ~73-79). **Pre-shipping nav becomes 6 tabs** (Strategy / Coach / Lounges & Bars / Briefing / Translate / Concierge). Melody — confirm desired UX.
9. Now safe: delete `MapPage.tsx` (no remaining importers)
10. Delete `ConciergeMap.tsx` (escapeHtml helper preserved in Phase A.5)
11. Delete `EventsExplorer.tsx`
12. Rename `MapTab.tsx` → `client/src/components/strategy/StrategyMap.tsx` AND update the import in `StrategyPage.tsx` in the same commit (rename + import-fix is atomic)

**Test:** All routes still resolve; no broken imports at any commit (verify by running `tsc --noEmit` after each step); bottom nav shows 6 tabs (down from 7); Strategy still shows the map.

### Phase C — Fold TacticalStagingMap capabilities into StrategyMap (references-first ordering)
13. Extract mission-selector + staging/avoid zone rendering from `TacticalStagingMap.tsx`
14. Add as new layer types in StrategyMap with `lastMissionKeyRef` / `lastStagingKeyRef` dedup
15. **(C1 fix)** Wire staging fetch to `/api/intelligence/staging-areas?snapshotId=${snapshotId}` via `apiRoutes.INTELLIGENCE.STAGING_AREAS(snapshotId)`. Use the existing client constant — do not hardcode the URL.
16. Wire AI Tactical Plan button to existing `/api/strategy/tactical-plan` (unchanged contract)
17. **Detach references** in `RideshareIntelTab.tsx`: remove the disabled render block (lines 455-465) AND the `import TacticalStagingMap from "@/components/intel/TacticalStagingMap"` line (54). Same commit.
18. Now safe: delete `TacticalStagingMap.tsx` and `client/src/types/tactical-map.ts` (types relocated into StrategyMap or a new layer-types module per fork #3 decision).

**Test:** Mission selector dropdown works; selecting an event-mission renders staging zones (green) and avoid zones (red) sourced via `snapshotId`; AI Tactical Plan button still hits its endpoint and renders results; verify staging layer re-fetches when snapshot changes (snapshot-scoped endpoint); `tsc --noEmit` clean after step 17 and again after step 18.

### Phase D — New zone layers (consume existing endpoints)
19. **(C10 — FORK 2)** Decide `zone_intelligence` vs `market_intelligence` table fate. Defaulting to `market_intelligence` (the table the API already serves).
20. Add zone fetcher hook `useMarketZones(marketSlug)` — calls `GET /api/intelligence/market/:slug?type=zone` and returns rows grouped by `subtype`. Uses `apiRoutes.INTELLIGENCE.MARKET(slug)` (`apiRoutes.ts:108`) with the `?type=zone` query appended.
21. **(C3 + C4 fix)** Render only the 5 server-supported subtypes:
    - `honey_hole` — green circles sized by `radius_miles`
    - `dead_zone` — gray hatch
    - `danger_zone` — red
    - `safe_corridor` — blue line / soft fill
    - `caution_zone` — yellow
22. Apply daypart filter from `time_constraints` JSONB on rows where present — only show zones active at current daypart (`daypart.js`).
23. Render layer-toggle UI (floating chips top-right, persisted to `localStorage` key `vecto:map-layers`).
24. Per-layer `lastZoneKeyRef[subtype]` dedup (one ref per subtype; codifies the 2026-04-04 pattern).

**Test:** Zones from `market_intelligence` table appear on map; toggling each chip shows/hides correctly; time-constrained zones only render in the matching daypart window; layer toggles persist across page reloads.

### Phase E — Market boundary + Code 6 warning  *(BLOCKED on §4.6 fork #1)*
*Until fork #1 is decided, this phase doesn't have a data source. Possible paths:*

- **If fork #1 = (a) server change:** Add migration to `market_intelligence` adding `boundaries JSONB`; new `GET /api/intelligence/market/:slug/boundary` endpoint; client hook fetches and renders.
- **If fork #1 = (b) hardcoded client config:** Create `client/src/config/marketBoundaries.ts` with `{ [marketSlug]: GeoJSON.Polygon }`. Seed DFW first; expand as needed.
- **If fork #1 = (c) reuse `platform_data.coord_boundary`:** First read 2-3 sample rows of `coord_boundary` to verify GeoJSON shape; then expose via existing `/api/platform/markets/:market` endpoint (already exists).

25. Fetch boundary for current driver market via the chosen path.
26. Render as muted blue line overlay (uses `&libraries=geometry` already loaded in Phase A).
27. When any active SmartBlock destination falls outside polygon, render red "MARKET EXIT — NO RIDES BACK" warning banner above the map.
28. (Future / out of scope for this consolidation) Hook into Trip Radar offer flow for live offer warnings.

**Test:** Market polygon renders for current driver market; if a synthetic test SmartBlock outside the polygon is injected (`{lat:31.5, lng:-97.1}` for Waco), warning surfaces.

### Phase F — TomTom incidents layer  *(NEW per C9; FORK #4 dependency)*
*Server already produces TomTom incidents (`server/lib/traffic/tomtom.js`); they currently flow into the AI tactical planner as `trafficContext` but never reach the map.*

29. **(FORK 4 decision)** Pick incident routing: (a) include in briefing payload, (b) new endpoint, (c) existing SSE.
30. Add `useTrafficIncidents(snapshotId)` hook per chosen routing.
31. Render incidents as red-bordered icon markers on map (warning triangle for accidents; cone for road closures; clock for jams).
32. `lastIncidentKeyRef` dedup (per pattern from Phase A).
33. Layer-toggle chip "Incidents" — default OFF (high marker count noise risk; let drivers opt in).
34. InfoWindow content (sanitized via `escapeHtml` from Phase A): incident type, severity, ETA-to-clear if available, distance from driver.

**Test:** Inject a fake TomTom incident at known coords; verify marker renders; toggle off and verify markers vanish; toggle on and verify they return without re-fetch (state preserved across toggles within a single map mount).

---

## 7. Test Plan

| Test | Phase | Method | Expected |
|------|-------|--------|----------|
| Singleton loader serves multiple consumers | A | Unit test on `loadGoogleMaps()`: call 3× concurrently, assert one script tag in DOM | Single tag, single Promise resolved 3× |
| No deprecation warnings | A | Open Chrome DevTools console on `/co-pilot/strategy` | Zero warnings about `Marker` or `loading=async` |
| `escapeHtml` blocks XSS | A | Inject venue with `name = "<img src=x onerror=alert(1)>"` into local state; open InfoWindow | Renders escaped, no alert fires |
| `fitBounds` includes bars | A | Place a bar marker outside the venue/event envelope (synthetic data), reload | Map auto-zooms to include the bar |
| Bottom nav shows 6 tabs (down from 7) post-delete (C5 fix) | B | Visual inspection | Tabs: Strategy / Coach / Lounges & Bars / Briefing / Translate / Concierge. No "Map" tab. |
| All routes still resolve | B | Hit `/co-pilot`, `/co-pilot/strategy`, `/co-pilot/coach`, `/co-pilot/briefing`, `/co-pilot/bars`, `/co-pilot/translate`, `/co-pilot/concierge`, `/co-pilot/intel` (still hamburger) | 200 OK each |
| Mission selector renders staging zones | C | Open Strategy → toggle Mission mode → pick a Cowboys game mission | Green staging markers + red avoid markers within ~1km of venue |
| Staging endpoint snapshot-scoped (C1 fix) | C | Watch network tab; snapshot rotation should re-fetch | Each snapshot change triggers a new `GET /api/intelligence/staging-areas?snapshotId=...` |
| Tactical plan still works | C | Click "AI Tactical Plan" button | POST `/api/strategy/tactical-plan` succeeds; result renders |
| Honey holes appear (C3+C4 fix) | D | Toggle Honey Holes chip; verify against:<br>`psql "$DATABASE_URL" -c "SELECT id, intel_subtype, lat, lng FROM market_intelligence WHERE intel_type='zone' AND intel_subtype='honey_hole' AND market_slug='dallas-fort-worth' AND is_active=true LIMIT 5;"` | Map markers match DB rows |
| Subtype filter is server-side `subtype=` not `zone_type=` (C3 fix) | D | Watch network tab during chip toggle | Request URL shows `?type=zone` (server-filtered) and client filters by `subtype` from response |
| Unsupported subtypes are absent from UI (C4 fix) | D | Inspect chip set | No `surge_trap`, `staging_spot`, `event_zone` chips |
| Time-constrained zones honor daypart | D | Set system time to 1pm local; verify any zone with `time_constraints.after_hour=22` is hidden | Hidden at 1pm, visible at 22:00 |
| Layer-toggle persistence | D | Toggle Dead Zones on, reload page | Dead Zones chip remembered as on |
| Market boundary visible | E | Open Strategy in Dallas market (after fork #1 decided) | Faint blue line traces DFW market polygon |
| Code 6 warning fires | E | Inject test SmartBlock with `lat=31.5, lng=-97.1` (Waco coords) | Red banner: "MARKET EXIT — NO RIDES BACK" |
| TomTom incidents render | F | Open Strategy after a known incident is in the briefing payload | Incident marker visible at incident lat/lng |
| Incidents toggle off cleanly | F | Toggle "Incidents" chip off | All incident markers removed; no orphaned DOM |

**No code merges until all tests above PASS and Melody confirms test approval (Rule 1).**

---

## 8. Risks + Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Removing `MapPage.tsx` breaks deeplink in Siri Shortcut or external partner | UX broken | Pre-delete grep confirmed only bottom-nav references it; verify with Melody |
| `AdvancedMarkerElement` requires `mapId` from Cloud Console | Can't migrate without manual Melody step | Phase A blocks on Melody provisioning `mapId`; document the steps in Phase A approval doc |
| Zone density explodes marker count (100+ per market) | Map performance degrades | Implement marker clustering for zone-type layers (Google's `MarkerClusterer` works with `AdvancedMarkerElement`) — bake into Phase D |
| Singleton loader conflicts with `location-context-clean` Geolocation API call | Geolocation fallback broken | Geolocation API uses a separate REST endpoint, not the JS Maps API — no conflict, but verify in Phase A test |
| `lastXKeyRef` dedup misses an edge case (e.g., array-order changes without content change) | Markers thrash | Sort the key composition before joining (`zones.sort((a,b) => a.id.localeCompare(b.id)).map(...)`) |
| Folding TacticalStagingMap inherits its own removeChild bug | Same crash, different file | Phase C implementation MUST use the singleton loader from Phase A — that's the root-cause fix |

---

## 9. Out of Scope (explicit non-goals)

- Server-side changes (no new endpoints, no schema changes)
- Adding PredictHQ / new external geo APIs (Coach inbox 2026-04-09 — separate project)
- Mobile native shell / WebSocket persistence (Coach inbox — separate)
- Heatmap rendering (deferred until layer toggle UI is proven)
- Marker clustering for non-zone layers (current density doesn't justify it)

---

## 10. Approval Checklist (Melody)

Before any code change ships, please confirm:

**Scope:**
- [ ] Scope taxonomy in §4 is correct (Delete / Don't touch / Consume / Fold)
- [ ] Removing the bottom-nav "Map" tab is desired UX (Phase B step 11) — net result is **6 tabs** down from 7

**Open design forks (§4.6) — pick one option for each, OR say "use defaults":**
- [ ] Fork #1 — market boundary source: (a) server change · (b) hardcoded client config · (c) reuse `platform_data.coord_boundary` · default = (b)
- [ ] Fork #2 — `zone_intelligence` vs `market_intelligence` table fate: (a) deprecate zone_intelligence · (b) plumb it · (c) migrate then drop · default = (a)
- [ ] Fork #3 — `MarketBoundaryGrid` + `MarketDeadheadCalculator` dormant components: (a) fold into StrategyMap · (b) revive on Intel hub · (c) delete · default = (c)
- [ ] Fork #4 — TomTom incidents routing: (a) briefing payload · (b) new endpoint · (c) existing SSE · default = (a)

**Operational:**
- [ ] You'll provision a Cloud Console `mapId` for Phase A.4 (or accept deferring `AdvancedMarkerElement` migration to a later phase)
- [ ] Phase ordering A→B→C→D→E→F is acceptable (each merges independently; E and F can ship in parallel after D)
- [ ] Test plan in §7 is acceptable as the verification gate

**Branch strategy** (per your "create the branches" instruction):
- [ ] One branch per phase: `feat/strategy-map-phase-a`, `feat/strategy-map-phase-b`, etc.
- [ ] Each branch opens its own PR after its tests pass
- [ ] Phase B blocks Phase C/D/E/F (since rename + delete must precede new layer work on the renamed component)
- [ ] Phase E blocked on fork #1 decision; Phase F blocked on fork #4 decision

After approval, each phase will be implemented on its own branch, with the test commands in §7 run and outputs pasted to `docs/review-queue/pending.md` per Rule 2.

---

## Appendix — Files Touched by Phase

**Phase A** (singleton loader + deprecation):
- NEW `client/src/lib/maps/google-maps-loader.ts`
- MODIFY `client/src/components/MapTab.tsx`

**Phase B** (delete + rename):
- DELETE `client/src/components/concierge/ConciergeMap.tsx`
- DELETE `client/src/components/concierge/EventsExplorer.tsx`
- DELETE `client/src/pages/co-pilot/MapPage.tsx`
- MODIFY `client/src/routes.tsx`
- MODIFY `client/src/components/co-pilot/BottomTabNavigation.tsx`
- RENAME `client/src/components/MapTab.tsx` → `client/src/components/strategy/StrategyMap.tsx`
- MODIFY `client/src/pages/co-pilot/StrategyPage.tsx` (import path)

**Phase C** (fold TacticalStagingMap):
- MODIFY `client/src/components/strategy/StrategyMap.tsx` (add mission + staging layers)
- DELETE `client/src/components/intel/TacticalStagingMap.tsx`
- MODIFY `client/src/components/RideshareIntelTab.tsx` (remove disabled block)
- DELETE `client/src/types/tactical-map.ts` (move types into StrategyMap)
- MODIFY `client/src/pages/co-pilot/StrategyPage.tsx` (pass mission-mode state)

**Phase D** (zone layers):
- NEW `client/src/hooks/useZoneIntelligence.ts`
- MODIFY `client/src/components/strategy/StrategyMap.tsx` (add zone layers + toggle UI)

**Phase E** (market boundary — shape depends on fork #1):
- NEW `client/src/hooks/useMarketBoundary.ts`
- IF fork #1 = (a): NEW migration `migrations/YYYYMMDD_market_boundaries.sql`; NEW `server/api/intelligence/boundaries.js` route
- IF fork #1 = (b): NEW `client/src/config/marketBoundaries.ts`
- IF fork #1 = (c): no new files; reuse `/api/platform/markets/:market`
- MODIFY `client/src/components/strategy/StrategyMap.tsx` (add boundary + Code 6 warning)

**Phase F** (TomTom incidents — shape depends on fork #4):
- NEW `client/src/hooks/useTrafficIncidents.ts`
- IF fork #4 = (a): MODIFY briefing payload shape (server) + briefing query hook
- IF fork #4 = (b): NEW `server/api/traffic/incidents.js` route
- IF fork #4 = (c): MODIFY existing briefing SSE consumer
- MODIFY `client/src/components/strategy/StrategyMap.tsx` (add incidents layer)

**Total file delta** (with all defaults):
- Created: 6 (`google-maps-loader.ts`, `escape-html.ts`, `useMarketZones.ts`, `useMarketBoundary.ts`, `useTrafficIncidents.ts`, `marketBoundaries.ts`)
- Deleted: 5 (3 components in B, 1 in C, 1 type file)
- Modified: ~7 (StrategyPage, BottomTabNavigation, routes.tsx, RideshareIntelTab, StrategyMap across phases, briefing query hook, plan/findings docs)
- Renamed: 1 (MapTab.tsx → StrategyMap.tsx)
