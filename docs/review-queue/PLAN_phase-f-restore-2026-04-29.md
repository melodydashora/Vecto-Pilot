# PLAN — Phase F Restore (TomTom Traffic Incidents Layer)

**Date:** 2026-04-29
**Author:** Claude Opus 4.7 (1M context)
**Status:** DRAFT — awaiting Melody approval
**Path:** A in Path C (restore now, then Phase G builds the better foundation)

---

## Objective

Restore the TomTom traffic incidents layer on `/co-pilot/strategy` map (red/orange triangle markers + "⚠️ Incidents · N" toggle chip + InfoWindow on click), regressed at 4 surfaces sometime after commit `65b1ad41`.

## Why this is Plan A, not Plan G

User-visible feature is missing today. Used daily by the driver. Small, mechanical, known-good restoration from a specific commit's content. Plan G (`discovered_traffic` cache) builds the better foundation but is a multi-day architecture change — bundling the two would delay restoration. Path C (this plan first, then G) restores visibility today and lets the foundation work proceed at its own cadence.

## Scope (4 surfaces from `65b1ad41`)

| Surface | Action |
|---|---|
| `server/lib/briefing/briefing-service.js` lines 2071-2082 | In `prioritizedIncidents.map(inc => ({...}))`, add two fields: `incidentLat: inc.incidentLat ?? null` and `incidentLon: inc.incidentLon ?? null`. The TomTom parser at `server/lib/traffic/tomtom.js:311-323` already extracts these from `inc.geometry.coordinates`; they were just being dropped at this response-shaping step. |
| `client/src/hooks/useTrafficIncidents.ts` (file does not exist) | Restore from `git show 65b1ad41:client/src/hooks/useTrafficIncidents.ts`. Selector hook reading `briefingData.traffic.incidents`, filters to incidents with coords, returns `PlottableTrafficIncident[]`. |
| `client/src/components/strategy/StrategyMap.tsx` | Restore: `MapIncident` type + `incidents` prop on the component + `MARKER_COLORS` for severity (high/medium/low) + triangle warning marker rendering with `makeIncidentContent` + InfoWindow on `gmp-click` showing category/road/severity/delay/distance/highway flag + layer-toggle chip "⚠️ Incidents · N". |
| `client/src/pages/co-pilot/StrategyPage.tsx` | Restore: `useTrafficIncidents()` hook call, pass result as `incidents` prop to `<StrategyMap />`. |

## Approach

1. Extract the precise diff from `git show 65b1ad41` for each surface
2. Re-apply manually (NOT cherry-pick — the surrounding code has shifted in some files since Phase F shipped, so a 3-way merge avoids conflicts)
3. Verify `node --check` clean on the modified server file
4. Verify `tsc --noEmit` clean on the modified client files
5. Verify the bundle still builds (`vite build`) and includes the expected fingerprints (`vecto:map-layers`, `makeIncidentContent`, `gmp-click`)

## Files affected (4)

- `server/lib/briefing/briefing-service.js` (~3 lines added)
- `client/src/hooks/useTrafficIncidents.ts` (new file, ~50 lines)
- `client/src/components/strategy/StrategyMap.tsx` (~150 lines added — `MapIncident` type, prop, marker logic, toggle, InfoWindow)
- `client/src/pages/co-pilot/StrategyPage.tsx` (~5 lines — hook call + prop)

## Test plan (Melody to verify after Play restart)

| # | Test | Expected |
|---|---|---|
| 1 | Hard-refresh `/co-pilot/strategy` | Map renders, no console errors |
| 2 | Look for layer-toggle chip top-right | "⚠️ Incidents" chip visible |
| 3 | Click toggle | Chip turns red, label becomes "⚠️ Incidents · N" where N matches visible markers |
| 4 | Triangle markers appear | Red (high) / amber (medium) / yellow (low) triangle glyphs at incident locations |
| 5 | Click a marker | InfoWindow shows category, road, severity, delay (min), distance, HWY flag |
| 6 | Toggle off | All triangle markers vanish; toggle returns to white |
| 7 | Toggle on again | Markers return |
| 8 | Reload page | Toggle state remembered (whatever was set before reload) |
| 9 | Briefing narrative still works | `briefings.traffic` text summary unchanged on Strategy page traffic card |

## Risks

- **Sed/merge collision** — the surrounding code in `briefing-service.js` and `StrategyMap.tsx` has shifted since Phase F shipped; manual re-apply (not cherry-pick) avoids this
- **Coord-stripping recurrence** — Plan G's `lat NOT NULL` constraint is the structural fix that makes this regression impossible at the cache layer; this plan only restores the prior coupling, doesn't prevent the regression class

## Forward-link to Plan G

This plan restores Phase F's coupling between briefing assembly and map rendering. Plan G (`discovered_traffic`) decouples them so a future briefing-layer regression cannot silently disable the map. Path C means Plan A lands as a fast restoration; Plan G lands as a separate, deliberate foundation change.
