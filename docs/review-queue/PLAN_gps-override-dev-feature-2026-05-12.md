# PLAN: GPS Manual Override (Dev-Only Test Feature)

**Date:** 2026-05-12
**Author:** Claude (Opus 4.7) + Melody
**Status:** RETIRED 2026-05-12 — feature lived for the duration of a single test session; all `// 2026-05-12 OVERRIDE-FEATURE:` markers were stripped per §5 (Removal Checklist). Auto-GPS is back on.
**Scope:** Client-only. No server changes. Temporary feature — see "Removal Checklist" at the end of this doc.
**Why this exists:** Dev testing has been using uniform Frisco/DFW coordinates, which masks bugs that only manifest with other cities, timezones, or country-specific code paths (school search terms, metric/imperial units, IANA-zone date math). This feature lets Melody push arbitrary lat/lng through the **exact same** enrichment pipeline that live GPS uses, exercising every downstream consumer (snapshot creation, briefing waterfall, strategy, venues) with non-uniform inputs.

---

## 1. Objective

Add two text input fields (`lat:`, `lng:`) plus an `OK` button to `GlobalHeader.tsx`. While these inputs are visible, the auto-GPS detection effect is paused and the FAIL HARD location-resolution timer is suppressed. On `OK` click, the entered coords are normalized to 6-decimal precision and routed through `enrichLocation(lat, lng, 10, true)` — the same function the live GPS path calls — so the rest of the application (snapshot, briefing, strategy, venues) sees the override coords identically to a real geolocation result.

**Non-goals:**
- No quick-preset buttons. No modal/popover. No localStorage persistence.
- No server-side changes. Coords ride the existing `/api/context/snapshot` path.
- No "clear and re-enter" runtime toggle (refresh the page to test different coords).
- No env-gated toggle. Always-on while the feature exists. Removed wholesale when done.

---

## 2. Findings about pre-existing infrastructure

The `LocationContext` already has a half-built override API. The **read** side is wired everywhere; the **set** side has no UI and the snapshot-creation path doesn't actually respect it.

| Surface | Status | Reference |
|---|---|---|
| Context type `overrideCoords` | ✓ exposed | `location-context-clean.tsx:158` |
| Context type `setOverrideCoords` | ✓ exposed | `location-context-clean.tsx:166` |
| State + setter | ✓ wired | `location-context-clean.tsx:195` |
| Header display reads override | ✓ | `GlobalHeader.tsx:125, 133, 137` |
| co-pilot-context reads override | ✓ | `co-pilot-context.tsx:169-170` |
| **External setter UI** | **✗ MISSING** | nothing calls `setOverrideCoords(...)` with a value; only internal `setOverrideCoords(null)` calls (at `location-context-clean.tsx:245` and `:708`) which **clear** the override |
| **Snapshot-creation respects override** | **✗ MISSING** | `refreshGPS` calls `getGeoPosition()` unconditionally (`:747`) and passes those live coords to `enrichLocation` (`:754`). Override coords never reach the server. |
| **Auto-GPS effect skipped when override is set** | **✗ MISSING** | The initial GPS fetch effect (`:807-869`) always runs regardless of override. |
| **FAIL HARD timer gated on override** | **✗ MISSING** | `GlobalHeader.tsx:195-222` starts a 30-second `setCriticalError` timer the moment the component mounts. With auto-GPS paused, this would fire and block the UI before the user finishes typing coords. |

These four gaps are what this plan fills.

---

## 3. Approach

Four discrete changes, all in two files. Every addition is bracketed with a `// 2026-05-12 OVERRIDE-FEATURE:` marker comment so removal is a `grep`-able operation.

### Change 1 — Pause auto-GPS effect in `location-context-clean.tsx`

Add new state `isWaitingForManualCoords` (default `true`). Gate the initial GPS effect on `!isWaitingForManualCoords`.

### Change 2 — Add `submitManualCoords` callback in `location-context-clean.tsx`

New context callback. Sets `overrideCoords`, sets `currentCoords`, flips `isWaitingForManualCoords` to `false`, then calls `enrichLocation(lat, lng, 10, true)` — the same enrichment path used by the live GPS flow. Coords are normalized via `parseFloat(value.toFixed(6))` to match `makeCoordsKey()` precision invariant.

### Change 3 — Manual entry UI + FAIL HARD pause in `GlobalHeader.tsx`

When `isWaitingForManualCoords && !isLocationResolved`:
- Render two `<input type="number">` fields plus an `OK` button instead of the normal location/weather widgets.
- Suppress the 30-second FAIL HARD timer (line 195-222 useEffect).

When `!isWaitingForManualCoords`: header renders normally (live-GPS path UI). After OK is clicked, the user sees the resolved address/weather/time exactly as if GPS had succeeded.

### Change 4 — Auto-resolve `isWaitingForManualCoords` if session restore succeeds

If session restore (`location-context-clean.tsx:277-358`) populates location from cached sessionStorage data, set `isWaitingForManualCoords = false` so the inputs hide and FAIL HARD resumes normal behavior. Without this, a cached resume would leave the user typing coords into a header that should already be resolved.

---

## 4. Files Affected — with exact insert / modify points

### File A — `client/src/contexts/location-context-clean.tsx`

| Change | Approx. line in current file | Action |
|---|---|---|
| Add `isWaitingForManualCoords` + `submitManualCoords` to `LocationContextType` interface | after line **169** (`locationError?` field) | INSERT |
| Add `isWaitingForManualCoords` state | after line **195** (`overrideCoords` state) | INSERT |
| In session-restore effect, set `isWaitingForManualCoords = false` if restore succeeds | inside the success branch around line **298-309** | INSERT |
| In auth-loss cleanup, reset `isWaitingForManualCoords` to `true` | after line **245** (existing `setOverrideCoords(null)`) | INSERT |
| Add `submitManualCoords` `useCallback` definition | after `enrichLocation` ends (~line **702**), before `refreshGPS` (~line **706**) | INSERT |
| Add early return in auto-GPS effect | at the top of effect body around line **808** (after `authLoading` check) | INSERT |
| Add `isWaitingForManualCoords` + `submitManualCoords` to context value object | inside the `useMemo` value around line **919-942** | INSERT |

### File B — `client/src/components/GlobalHeader.tsx`

| Change | Approx. line in current file | Action |
|---|---|---|
| Add `isWaitingForManualCoords?` + `submitManualCoords?` to `ExtendedLocationContext` type | after line **50** (`setOverrideCoords?` field) | INSERT |
| Read `isWaitingForManualCoords` + `submitManualCoords` from `loc` at top of component | after line **83** | INSERT |
| Add local state for the two input field values + a submitting flag | after the existing state declarations (~line **97**) | INSERT |
| Gate the FAIL HARD timer effect | at the top of the useEffect body around line **195** | INSERT |
| Conditional render: manual entry UI when `isWaitingForManualCoords && !isLocationResolved`; normal header otherwise | inside the existing return block — placement depends on JSX structure (TBD during implementation) | INSERT |

---

## 5. Removal Checklist

When the feature is no longer needed, delete every line carrying the `// 2026-05-12 OVERRIDE-FEATURE:` marker. Mechanical steps:

```bash
# 1. Find every line with the marker
grep -rn "2026-05-12 OVERRIDE-FEATURE" client/src/

# 2. Each match is either:
#    - An entire useState/useCallback block (delete the block)
#    - A type field (delete the field)
#    - A guard `if (isWaitingForManualCoords) return;` (delete the line)
#    - A JSX conditional render (delete the conditional, keep the unconditional branch)

# 3. After deletion, verify nothing references the removed names:
grep -rn "isWaitingForManualCoords\|submitManualCoords" client/src/
# expected: zero matches

# 4. Verify build:
npm run typecheck && npm run lint
```

**Files to inspect during removal:**
- `client/src/contexts/location-context-clean.tsx` — remove ~7 marker blocks (state, callback, gate, type, value entries, restore branch flip, auth-loss reset)
- `client/src/components/GlobalHeader.tsx` — remove ~5 marker blocks (type fields, hook reads, input state, FAIL HARD gate, conditional JSX)

**Pre-existing infrastructure to leave alone:**
- `overrideCoords` + `setOverrideCoords` on `LocationContextType` — pre-existed this feature; other code (header display, co-pilot-context) still reads it.
- The `setOverrideCoords(null)` calls at lines 245 and 708 — pre-existing cleanup logic.

---

## 6. Test Cases

Each test pushes a different lat/lng through the manual entry and verifies the entire downstream pipeline. We're testing for bugs that uniform Frisco coords would have hidden.

| # | Input | Lat | Lng | What we're testing |
|---|---|---|---|---|
| 1 | **Chicago Loop** | `41.878100` | `-87.629800` | Mid-tier metro, `America/Chicago` TZ (same as DFW — control case); seed-markets.js has `chicago` registered |
| 2 | **NYC Times Square** | `40.758000` | `-73.985500` | Different state (NY), `America/New_York` TZ — exercises news/events/traffic pipelines with non-Chicago/Texas market |
| 3 | **SF Financial District** | `37.794800` | `-122.395200` | Pacific TZ (`America/Los_Angeles`) — exercises 3-hour TZ offset edge cases in news/traffic/events `date` computation |
| 4 | **Honolulu** | `21.302700` | `-157.857100` | `Pacific/Honolulu` TZ — 10-hour UTC offset, exercises the AHEAD-timezone date-boundary bug class flagged at `events.js:865-867` comment ("AHEAD-timezone drivers saw their own stored events stripped on every read during the 9-14h UTC window") |
| 5 | **London** | `51.507400` | `-0.127800` | `country: 'United Kingdom'` — exercises schools pipeline's `getSchoolSearchTerms('UK')` branch (returns "Local Education Authority" instead of "ISD"); also weather metric vs imperial display |
| 6 | **Invalid range** | `91.000000` | `-87.629800` | Out-of-range lat — `OK` button should be disabled or input rejected with inline error; FAIL HARD should NOT fire while inputs are still showing |
| 7 | **Empty fields** | (empty) | (empty) | App stays in waiting state indefinitely without FAIL HARD modal appearing — confirms timer suppression works |
| 8 | **Page refresh after OK** | (any prior) | (any prior) | Inputs reappear on reload (no persistence by design); enter new coords to test next city |

### Acceptance criteria

For each successful test (1-5):
- ✓ `[Briefing]` — briefing row written to DB with the manual snapshot's `snapshot_id`
- ✓ `[Weather]` — temp/conditions returned in the correct unit system (°C for London, °F for US cities)
- ✓ `[Rideshare News]` — items returned for the appropriate market (or graceful `reason` if Gemini returns nothing)
- ✓ `[Traffic]` — congestion + incidents from TomTom (if API key configured) or Gemini fallback, scoped to the entered coords
- ✓ `[Events]` — events from `discovered_events` matching the entered state (after pipeline insert during the test)
- ✓ `[School Closures]` — closures for the appropriate school authority taxonomy (US-ISD vs UK-LEA)
- ✓ No `CriticalError` modal appears during typing (Test 7)
- ✓ `CriticalError` DOES appear if enrichment fails after OK (e.g., bad API key) — FAIL HARD resumes normal behavior post-submit

---

## 7. Risk Notes

- **Events pipeline writes to `discovered_events`.** Each test that succeeds will insert real event rows for that test city. This is intentional — it's how the pipeline produces output — but it means dev DB will accumulate cross-city event data. Not a problem; can be cleaned up later via `DELETE FROM discovered_events WHERE created_at >= '2026-05-12'` or per-city by state.
- **`venue_catalog` may also gain rows** from events pipeline's Places (NEW) API resolution for new venues in test cities.
- **`coords_cache` will gain rows** for each tested coord (reverse-geocode + timezone lookups). Same disposition — fine in dev.
- **TomTom + Gemini API calls cost real money.** Each test = one full briefing waterfall = ~$0.05-0.10 in AI + API costs. Not a blocker for a handful of tests; flagged for awareness.

---

## 8. Implementation order

1. Write this plan doc → **(this commit)**
2. Wait for Melody's "All tests passed" approval (Rule 1).
3. Implement Change 1 + Change 2 (location-context-clean.tsx state + callback + auto-GPS gate). Verify TypeScript compiles.
4. Implement Change 3 (GlobalHeader.tsx UI + FAIL HARD gate).
5. Implement Change 4 (session-restore success → flip flag).
6. Manual test sequence: tests #1, #5, #7 from §6 (Chicago, London, empty-fields).
7. Report results to Melody — `[Briefing]` / `[Weather]` / `[Rideshare News]` / `[Traffic]` / `[Events]` / `[School Closures]` per city, per the original test brief.
8. After full validation: optional follow-up to add "clear and re-enter" runtime toggle if Melody wants it.

---

## 9. Approval

- [ ] Plan reviewed by Melody
- [ ] "All tests passed" received before code lands
- [ ] Removal commit reference (when feature is retired): _______________

