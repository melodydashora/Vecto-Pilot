# Strategy Map Consolidation — Raw Findings

**Author:** Claude Opus 4.7 (1M context)
**Date:** 2026-04-26
**Purpose:** Manual verification artifact. Companion to `strategy-map-consolidation-plan.md`.
**Method:** 4 parallel Explore agents + targeted Bash verifications + advisor cross-check.

> ⚠️ **SUPERSEDED FOR ENDPOINT CONTRACTS — read plan §0 first.**
> This findings doc was written before the MapResearch peer review caught contract bugs in the original plan. The **inventory tables (§A, §B, §D table list, §E patterns)** in this doc remain accurate. The **endpoint examples** (`?market=X` for staging, `/markets` for boundaries, `?zone_type=` for filters) are wrong and have been corrected in the revised plan §0 / §3 / §6. When the two docs disagree on API contracts, **trust the plan**.

---

## How to use this document

Each row in §A–§D is a discrete claim. Verify each claim independently before approving the plan. Verification commands are in §G.

Trust order if you find a discrepancy: **CODE > this doc > the plan**. Per Rule 12 contested-fact amendment, code wins.

---

## A. Map components in `client/`

| # | File | LOC | What it does | Currently rendered? | Verified by |
|---|------|-----|--------------|---------------------|-------------|
| A1 | `client/src/components/MapTab.tsx` | 648 | Google Map + traffic + driver/venue/bar/event markers + inline legend | YES — embedded in `StrategyPage.tsx` (commit `7262213f`); also wrapped by MapPage | Direct read of `StrategyPage.tsx` import + commit log |
| A2 | `client/src/pages/co-pilot/MapPage.tsx` | 187 | Wrapper around MapTab with GPS guard | YES — routed at `/co-pilot/map` | `routes.tsx:13,139` |
| A3 | `client/src/components/intel/TacticalStagingMap.tsx` | 778 | Mission selector + staging/avoid zones + AI tactical plan | NO — render commented in `RideshareIntelTab.tsx:455` (`TODO: Fix Google Maps integration to prevent removeChild errors`) | grep on `RideshareIntelTab.tsx` |
| A4 | `client/src/components/concierge/ConciergeMap.tsx` | 278 | Lightweight map for public passenger surface | NO — zero imports anywhere | `grep -rn "ConciergeMap"` shows only its own file + stale comments in `EventsExplorer.tsx` |
| A5 | `client/src/components/concierge/EventsExplorer.tsx` | (n/a) | Companion to ConciergeMap; was meant to feed it event coords | NO — zero `<EventsExplorer />` JSX usage anywhere | `grep -rn "EventsExplorer"` shows only its own definition |

**Cross-check:** `PublicConciergePage.tsx` only imports `DriverCard`, `AskConcierge`, `API_ROUTES` — no concierge map components. Verified by direct read of imports.

**Plan action mapping:**
- A1 → KEEP (rename to `StrategyMap.tsx`)
- A2 → DELETE (Phase B)
- A3 → DELETE after capabilities folded into A1 (Phase C)
- A4 → DELETE (Phase B)
- A5 → DELETE (Phase B)

---

## B. Files using `VITE_GOOGLE_MAPS_API_KEY`

| # | File | Line | Use | Plan action |
|---|------|------|-----|-------------|
| B1 | `client/src/vite-env.d.ts` | 11 | Type declaration | Keep (env contract) |
| B2 | `client/src/components/MapTab.tsx` | 159, 162 | Loads Maps JS API script | Refactor to use singleton loader (Phase A) |
| B3 | `client/src/components/concierge/ConciergeMap.tsx` | 104, 106 | Loads Maps JS API script | Deleted with A4 |
| B4 | `client/src/components/intel/TacticalStagingMap.tsx` | 203, 207 | Loads Maps JS API script | Deleted with A3 |
| B5 | `client/src/pages/concierge/PublicConciergePage.tsx` | 116 | Reverse geocoding REST call (NOT the JS API) | **DO NOT TOUCH** — it's a string lookup, not a map |
| B6 | `client/src/contexts/location-context-clean.tsx` | 112 | Google Geolocation API REST fallback when browser GPS denied | **DO NOT TOUCH** — separate REST endpoint, not the JS Maps API |

**Why B5/B6 stay:** they hit the REST APIs (`/maps/api/geocode/json`, `/geolocation/v1/geolocate`), not the JS bundle. They share the API key but don't share the loading pipeline. Removing them would break geolocation fallback and concierge city-state display.

---

## C. `mapId` adoption

**Current state:** Zero usages. All three maps use `new google.maps.Map(el, {center, zoom, ...})` directly with no `mapId`.

**Implication:** Migrating to `AdvancedMarkerElement` (Phase A) requires Melody to provision a `mapId` in Google Cloud Console. This is a manual step gating Phase A.4.

If you want to skip the `mapId` work for now, Phase A still has value (singleton loader + `loading=async`) — just leave Phase A.4 (`AdvancedMarkerElement` swap) for a follow-up.

---

## D. Server-side surfaces touched by maps

This is the section the advisor flagged most strongly: **most of these are NOT touched by the consolidation.** They power non-map features. Listed here so you can cross-verify.

### D.1 API endpoints (all read-only from this consolidation's POV)

| Path | Plan touches it? |
|------|------------------|
| `GET /api/venues/nearby` | NO — already consumed via `useCoPilot` |
| `GET /api/venues/traffic` | NO — used by traffic layer (no client change) |
| `GET /api/venues/smart-blocks` | NO |
| `GET /api/venues/last-call` | NO |
| `GET /api/location/*` (geocode, timezone, weather, AQI, snapshot) | NO |
| `GET /api/intelligence/market/:slug` | **NEW READ — Phase D** (zone overlays) |
| `GET /api/intelligence/coach/:market` | NO — Coach context only |
| `GET /api/intelligence/staging-areas` | **NEW READ — Phase C** (staging spots) |
| `GET /api/intelligence/demand-patterns/:marketSlug` | **NEW READ — Phase D** (surge zones, optional toggle) |
| `GET /api/intelligence/markets` (for boundaries) | **NEW READ — Phase E** |
| `GET /api/briefing/events` | NO — already consumed via `useActiveEventsQuery` |
| `POST /api/strategy/tactical-plan` | NO — endpoint stays; just called from StrategyMap instead of TacticalStagingMap |

**Net:** zero new endpoints, zero changes to existing endpoints. Four endpoints get *new client-side consumers*.

### D.2 DB tables (all read-only from this consolidation's POV)

| Table | Plan touches it? |
|-------|------------------|
| `snapshots` | NO |
| `coords_cache` | NO |
| `venue_catalog` | NO |
| `ranking_candidates` | NO (read via `/api/intelligence/staging-areas`) |
| `discovered_events` | NO |
| `traffic_zones` | NO |
| `venue_events` | NO |
| `zone_intelligence` | NO write changes (read via `/api/intelligence/market/:slug` in Phase D) |
| `market_intelligence` | NO write changes (read via `/api/intelligence/markets` in Phase E) |
| `platform_data` | NO |
| `markets`, `market_cities` | NO |
| `driver_profiles` | NO |
| `intercepted_signals` | NO |

**Zero schema changes.** Zero migrations. Zero new tables.

### D.3 Server libs

`server/lib/location/`, `server/lib/venue/`, `server/lib/external/`, `server/lib/ai/rideshare-coach-dal.js` — **none touched.**

---

## E. Critical patterns to preserve

| # | Pattern | Where it lives now | Why it matters |
|---|---------|-------------------|---------------|
| E1 | `lastEventKeyRef` dedup | `MapTab.tsx:333-336` | 2026-04-04 fix for ~500ms marker thrash from parent re-renders. **Codified as a per-layer pattern** in the plan §5.2 |
| E2 | "Don't remove the script on cleanup" | `TacticalStagingMap.tsx:273` (correct) vs `MapTab.tsx:197-199` (wrong, removes script) | Root cause of the disabled TacticalStagingMap. Singleton loader (plan §5.1) makes this the canonical behavior |
| E3 | InfoWindow singleton (one open at a time) | `MapTab.tsx` `infoWindowRef` | Prevents stacking memory leaks |
| E4 | `useMemo` for `todayEvents` filter above early return | `MapTab.tsx:149` | 2026-04-09 fix for React hooks rule (memos must run before any conditional return) |
| E5 | HTML escape on AI-generated InfoWindow content | `ConciergeMap.tsx:12-19` (lost when A4 deleted) | XSS hardening from 2026-04-10. **Plan must port this `escapeHtml` helper into StrategyMap when adding AI-generated zone descriptions** |
| E6 | Render gating vs prop coercion | `claude_memory:178` (2026-04-26) | When `coords` is undefined, gate the render rather than fix types upward — applies to new layer-toggle props |

---

## F. Coach-inbox TODOs this consolidation addresses

| TODO | Coach inbox date | Phase |
|------|------------------|-------|
| Fix Google Maps deprecation: `loading=async`, `AdvancedMarkerElement` | 2026-04-10 | A |
| AI-Driven Intel Tab (Market Map): TacticalZones (Red=Avoid, Green=Honey Hole) | 2026-04-09 | C + D |
| Market Exit Warning (Code 6 / Waco Trap) | 2026-04-09 | E |

TODOs NOT addressed (out of scope by design):
- PredictHQ event integration
- Native Swift/Android wrapper
- Multimodal vision heatmap analysis
- Live context payload for chat

---

## G. Verification commands you can run

```bash
# G1. Confirm ConciergeMap is truly unused
grep -rn "ConciergeMap" /home/runner/workspace/client --include="*.tsx" --include="*.ts"
# Expected: only the file itself + stale comments in EventsExplorer.tsx (lines 23, 36)

# G2. Confirm EventsExplorer is truly unused
grep -rn "<EventsExplorer\|import.*EventsExplorer" /home/runner/workspace/client --include="*.tsx" --include="*.ts"
# Expected: zero hits (no JSX, no imports)

# G3. Confirm bottom-nav still has the Map tab
grep -n "Map\|/co-pilot/map" /home/runner/workspace/client/src/components/co-pilot/BottomTabNavigation.tsx
# Expected: line ~73 references /co-pilot/map

# G4. Confirm MapPage exists at the expected route
grep -n "MapPage\|/co-pilot/map" /home/runner/workspace/client/src/routes.tsx
# Expected: import on line ~13, route on line ~139

# G5. Confirm TacticalStagingMap render is disabled
grep -n "TacticalStagingMap\|removeChild" /home/runner/workspace/client/src/components/RideshareIntelTab.tsx
# Expected: import on line 54, "TODO: Fix Google Maps integration" comment near line 455

# G6. Confirm zone_intelligence has live data we can render
psql "$DATABASE_URL" -c "SELECT zone_type, COUNT(*) FROM zone_intelligence WHERE is_active = true GROUP BY zone_type ORDER BY 2 DESC;"
# Expected: rows for honey_hole, dead_zone, danger_zone, etc.

# G7. Confirm market_intelligence has boundary data for current markets
psql "$DATABASE_URL" -c "SELECT market_slug, jsonb_array_length(boundaries) AS boundary_pts FROM market_intelligence WHERE boundaries IS NOT NULL LIMIT 5;"
# Expected: market_slug rows with non-null boundaries

# G8. Confirm ranking_candidates has staging coords
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM ranking_candidates WHERE staging_lat IS NOT NULL AND staging_lng IS NOT NULL;"
# Expected: > 0

# G9. Confirm no other map components I missed
grep -rn "new google.maps.Map\|<GoogleMap\|useApiLoader\|useLoadScript\|APIProvider" /home/runner/workspace/client --include="*.tsx" --include="*.ts"
# Expected: only MapTab.tsx, ConciergeMap.tsx, TacticalStagingMap.tsx

# G10. Confirm location-context-clean uses REST geolocation (not JS Maps)
grep -A5 "VITE_GOOGLE_MAPS_API_KEY" /home/runner/workspace/client/src/contexts/location-context-clean.tsx
# Expected: fetch to https://www.googleapis.com/geolocation/v1/geolocate?key=...
```

---

## H. Things I want you to specifically double-check

1. **Bottom-nav decision (Phase B step 9).** The plan removes the "Map" tab entirely on the assumption that drivers will reach the map via the embedded Strategy view. If you want to keep the standalone full-screen map but route it to the same StrategyMap component, that's a one-line change to the plan — flag it.

2. **`mapId` provisioning (Phase A.4).** This is a Google Cloud Console action. If you don't want to do that step now, we can defer the `AdvancedMarkerElement` migration (still get the singleton loader + `loading=async` benefits in Phase A).

3. **TacticalStagingMap capabilities (Phase C).** I'm folding mission selector + staging/avoid zones into StrategyMap. If you'd rather kill those capabilities entirely (because nobody's used them while the component was disabled), Phase C shrinks to "delete TacticalStagingMap and its disabled render block, no fold-in." Flag preference.

4. **Zone confidence threshold (Phase D).** `zone_intelligence.confidence_score` defaults to 50. The plan currently fetches all `is_active = true` zones. If you want a min-confidence filter before rendering, specify the cutoff (e.g., 60 = "trustworthy enough to show drivers").

5. **Code 6 trigger semantics (Phase E).** The plan currently fires the warning when a *displayed SmartBlock* falls outside the market polygon. If you want it to fire on *active offers* coming in via Trip Radar OCR, that's a Phase F (different surface, different consumer).

---

## I. Open questions I couldn't resolve from code alone

- Is there a specific Google Cloud project where the `mapId` should be provisioned? (Probably the same project as the existing API key, but I'd want you to confirm.)
- Is there a UX preference for the layer-toggle UI? Floating chips top-right? Slide-out drawer? Bottom sheet on mobile?
- Should the Code 6 warning be persistent (until dismissed) or transient (toast that auto-dismisses)?
- Does `traffic_zones` data overlap with the `TrafficLayer` overlay enough that we should drop the table-driven layer? Current plan keeps both.

These are decisions for you, not blockers for the plan structure.

---

## J. What's NOT in the plan but might need to be

Things I considered and excluded — flag if you want any added:

- **Marker clustering** for non-zone layers — current marker count (~30 max) doesn't justify it. Could add later.
- **Heatmap layer** for surge intensity — the plan defers this until layer toggles are proven.
- **Persistence of map zoom/pan across snapshots** — currently `fitBounds` re-centers every render. Could persist to localStorage if you find that annoying.
- **Mobile-specific gestures** (pinch-zoom, two-finger rotate) — Google Maps handles these natively; no custom work.
- **Dark mode** — Google Maps `mapId` supports dark style if you provision one in Cloud Console. Could be a Phase F.
- **Offline tiles** — out of scope; would require Mapbox or similar.

---

## K. Status

- [x] Inventory complete (4 parallel agents + verification)
- [x] Advisor consulted; corrections applied
- [x] Plan drafted: `docs/strategy-map-consolidation-plan.md`
- [x] Findings documented: this file
- [ ] **HOLDING for Melody's manual review** ← current state
- [ ] Plan approved → Phase A implementation
- [ ] Per-phase test approval cycles per Rule 1
