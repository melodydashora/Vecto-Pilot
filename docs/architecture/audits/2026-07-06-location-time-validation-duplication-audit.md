# Audit: Location / Time / Validation Stack — Duplication & Consolidation Plan

**Date:** 2026-07-06
**Provenance:** Claude-authored (multi-agent audit: 5 cluster mappers + synthesis,
verified by grep re-checks). Reviewed and amended by the main session; NOT yet
approved by Melody — this is a PROPOSAL. No consolidation work has been executed.

## ⚠️ Amendments from Melody (2026-07-06, after the audit ran — these override the plan below where they conflict)

1. **Timezone is coords-first, always.** The plan below proposes `resolveTimezone.js`
   as the canonical timezone adapter with its existing *market-first* design. That is
   now wrong: timezone must ALWAYS come from GPS coords via the Google Timezone API.
   The markets table is for market IDENTITY (linkage/naming) only, never for time.
   Already enforced today in: `/api/location/resolve` (market tz fast-path removed),
   `venue-cache.js` (venue tz now `resolveTimezoneFromCoords`), `PublicConciergePage`
   (device tz replaced with `GET /api/location/timezone` — which the audit flagged as
   dead and is now live). The canonical adapter's `resolveTimezone()` orchestrator must
   be rewritten coords-first before any consolidation lands.

2. **Pipeline rules (verbatim doctrine, restated by Melody 2026-07-06):**
   - No fallbacks.
   - Coords are always 6 decimals.
   - The snapshot is its own table/pipeline and is a row that can have NO blank
     fields; once it is done, the snapshot row is sent with all calls after it in
     the waterfall.
   - No location hardcoded, anywhere.
   - The briefing row must always have no null fields until the calls come back,
     and must have a reason.

   Every phase below must be checked against these rules before execution.

---

# Consolidation Plan — Location / Time / Validation Stack

**Provenance:** Claude-authored synthesis of five Claude-authored cluster audits (all dated 2026-07-06). Dead-code claims for the modules slated for deletion were independently re-verified by grep before writing this plan (geocode-enhanced.js, confidence-scorer.js, weather-traffic-validator.js, get-snapshot-context.js, both barrels, and the never-called `validateLocationFreshness` import all confirmed). Constraint honored: no DB column renames, no API response-shape changes proposed anywhere below.

---

## 1. Inventory

| Module | Purpose | Live callers | Verdict |
|---|---|---|---|
| `server/lib/location/geocode.js` | Forward geocode (structured addr) + TZ transport | 2 (auth.js, resolveTimezone.js) | **keep-as-canonical** (becomes transport inside geocoding + timezone adapters) |
| `server/lib/location/geocode-enhanced.js` | Geocode w/ confidence scoring | 0 | **delete-dead** (entire module) |
| `server/lib/location/confidence-scorer.js` | Geocode result scoring | 0 (only dead geocode-enhanced) | **delete-dead** (transitively) |
| `server/lib/location/address-validation.js` | Google Address Validation (USPS CASS) | 1 (auth.js registration) | **keep**; prune dead exports `isAddressDeliverable`, `ValidationVerdict`, default export |
| `server/lib/venue/venue-address-resolver.js` | Coords→address: catalog cache → Places → reverse geocode | 4 (events.js, venue-cache.js, venue-enrichment.js, blocks-fast.js) | **keep-as-canonical** reverse-geocode; drop `export` on `resolveVenueAddress` (internal-only) |
| `server/lib/events/pipeline/geocodeEvent.js` | Forward geocode (string addr, +place_id) | 2 (analyze-offer.js, events.js) | **keep**; `geocodeMissingCoordinates` becomes live by absorbing the sync-events copy |
| `server/scripts/sync-events.mjs:55-145` (private copies) | Verbatim copies of geocodeEvent.js | script itself | **merge-into geocodeEvent.js** |
| `server/api/location/location.js` inline Geocoding fetches (229, 297, 564, 1507, 1617) + TZ fetches (361, 711, 1526) | 4th forward-geocode + 2nd reverse + 3 TZ impls | route handlers (live) | **merge-into adapters** (behavioral, last phase) |
| `server/lib/location/resolveTimezone.js` | Market-first TZ + Google fallback | 3 (location.js ×2, venue-cache.js, analyze-offer.js) | **keep-as-canonical** timezone adapter |
| `server/scripts/backfill-timezone.js` | One-time TZ backfill, inline market matching | entrypoint | **merge-into** `resolveTimezoneFromMarket` (weaker duplicate today) |
| `GET /api/location/timezone` (location.js:341-401) | HTTP TZ lookup | 0 in-repo | **suspected-dead — Melody decision** (Q1) |
| `server/lib/location/get-snapshot-context.js` | Snapshot→context assembler | 0 | **delete-dead** (entire module; header claim stale) |
| `server/lib/location/getSnapshotTimeContext.js` | Pure snapshot→time-context, fail-loud | 1 (consolidator.js via `formatLocalTime`) | **keep-as-canonical** snapshot-time adapter; prune dead exports (`getEventDateRange`, `isToday`, `toLocalTimeString`); fix `country \|\| 'US'` |
| `server/lib/ai/rideshare-coach-dal.js:getHeaderSnapshot` | Coach header context (soft-fail) | 4 call paths (chat.js, realtime.js) | **keep**; absorb time derivations from getSnapshotTimeContext (keep its soft error posture) |
| `server/lib/ai/context/enhanced-context-base.js` | Ambient AI-identity context (different family) | live (agent-server, chat.js, sdk-embed) | **keep — separate family, do not merge with snapshot modules**; fix phantom columns; absorb `context-awareness.js:getProjectContext` |
| `server/agent/context-awareness.js:getProjectContext` | Re-implements the above's DB portion | 1 (agent-server.js:532) | **merge-into enhanced-context-base.js** |
| `server/eidolon/enhanced-context.js` | Wrapper, zero importers | 0 | **delete-dead** |
| `server/lib/location/validation-gates.js` | Freshness/window gates | 0 (one never-called import) | **delete-dead** (entire module, incl. unexecutable `checkMovementInvalidation`) |
| `server/lib/location/weather-traffic-validator.js` | AI weather/traffic gates | 0 | **delete-dead** (+ orphaned registry roles `UTIL_WEATHER_VALIDATOR`/`UTIL_TRAFFIC_VALIDATOR`, model-registry.js:222,229 — confirm Q6) |
| `server/util/validate-snapshot.js` | Snapshot NOT-NULL guard + V1 shape | 5 call sites | **keep-as-canonical** snapshot validator; delete never-called `validateIncomingSnapshot` |
| `server/lib/events/pipeline/validateEvent.js` | Canonical event hard filter (13 rules) | 6+ modules | **keep-as-canonical** event validator; delete `filterInvalidEventsLegacy` |
| `server/lib/location/geo.js` | Haversine + bearing wrappers | 7 modules | **keep**; promote to `shared/` for client reuse (Phase 3); drop unused `haversineDistanceKm` export |
| `server/lib/location/coords-key.js` | Canonical 6-decimal coord key | 5 modules | **keep**; prune dead `parseCoordKey`, `isValidCoordKey`, `generateCoordKey` |
| `server/lib/location/holiday-detector.js` | Holiday detection | 1 (location.js) | **keep**; fix 2 bugs (override path, CLI import) + migrate its local-date trick to `shared/dayparts.js` |
| `server/lib/location/index.js`, `server/lib/index.js`, `server/lib/venue/index.js` | Barrels | 0 importers; location barrel **cannot even load** (SyntaxError on phantom exports) | **delete-dead** (all three) |
| `server/lib/location/README.md` | Directory doc | n/a | **rewrite** after Phase 1 (7 documented inaccuracies) |
| Client: `co-pilot-helpers.ts` `haversineDistance`/`todayInTimezone`/`getGreeting`, `BriefingTab.tsx:77`, `BarsDataGrid.tsx:106`, `PublicConciergePage.tsx:119` | Client copies of server/shared logic | live UI | **merge-into shared adapters** (Phase 3/5) |

---

## 2. Target architecture — one adapter per concern

Same pattern as `shared/dayparts.js` (2026-07-06): one named module per concern; everything else imports it; no barrels.

| Concern | Adapter (future home) | Surface |
|---|---|---|
| **Day-part / local time** | `shared/dayparts.js` — *done today* | `getDayPartKey`, `getLocalDateString`, `getLocalDow`, `classifyDayPart`, `normalizeDayPartKey` |
| **Geo math** | `shared/geo.js` — *new; extracted from `server/lib/location/geo.js` + `server/util/eta.js:haversineMeters`* (server file becomes a re-export shim, mirroring `server/lib/location/daypart.js`) | `haversineMeters/Km/Miles`, `bearingDegrees`, `bearingDiffDegrees` |
| **Coordinate identity** | `server/lib/location/coords-key.js` — already canonical | `coordsKey` (+ legacy aliases until callers migrate) |
| **Timezone resolution** | `server/lib/location/resolveTimezone.js` — already 3 live callers, market-first design | `resolveTimezone()` (full orchestrator, throws), `resolveTimezoneFromMarket`, `resolveTimezoneFromCoords` (gains coords_cache + circuit breaker). Google transport (`getTimezoneForCoords`) folds in as a private helper; `googleMapsCircuit` moves from location.js module-local to a shared lib (e.g. `server/lib/external/google-maps-circuit.js`). |
| **Forward geocoding** | `server/lib/location/geocode.js` — absorbs the string-input variant | `geocodeAddress(structured)` and `geocodeEventAddress(string) → +place_id` live side by side (geocodeEvent.js's header already documents why the shapes differ); geocodeEvent.js becomes a re-export shim or moves wholesale. Both routed through the shared circuit breaker. |
| **Reverse geocoding** | `server/lib/venue/venue-address-resolver.js` — already canonical per its own doctrine comment | `resolveVenueAddressesBatch`, `searchPlaceWithTextSearch`; expose one thin `reverseGeocode(lat,lng)` export for the location.js call sites that need raw reverse-geocode without venue-catalog semantics |
| **Address validation** | `server/lib/location/address-validation.js` — already canonical | `validateAddress` only |
| **Snapshot time-context** | `server/lib/location/getSnapshotTimeContext.js` — pure, strict, normalizing | `getSnapshotTimeContext`, `formatLocalTime`; plus a shared `SNAPSHOT_REQUIRED_FIELDS` constant (see next row) |
| **Snapshot validation** | `server/util/validate-snapshot.js` — the "SINGLE guard" its own comment claims to be | `validateSnapshotFields`, `validateSnapshotV1`; exports the one canonical `SNAPSHOT_REQUIRED_FIELDS` list that blocks-fast.js:603 imports instead of hard-coding |
| **Event validation** | `server/lib/events/pipeline/validateEvent.js` — already canonical, claim verified | unchanged |
| **Ambient AI context** | `server/lib/ai/context/enhanced-context-base.js` — separate family, kept separate by design | absorbs `context-awareness.js:getProjectContext` |

Error-posture contract (proposed, pending Q3): adapters **throw** on required-data failure (repo fail-loud doctrine; the dead-but-best-specified `resolveTimezone()` already models this); HTTP layers catch and map to 502; chat/coach paths may deliberately soft-degrade at *their* layer, never inside the adapter.

---

## 3. Phased execution plan (risk-ordered; each phase independently shippable)

### Phase 1 — Mechanical deletions (zero behavior change; all targets verified zero-caller)
Delete files:
- `server/lib/location/geocode-enhanced.js`
- `server/lib/location/confidence-scorer.js`
- `server/lib/location/get-snapshot-context.js`
- `server/lib/location/validation-gates.js`
- `server/lib/location/weather-traffic-validator.js`
- `server/lib/location/index.js`, `server/lib/index.js`, `server/lib/venue/index.js` (barrels; location barrel is load-broken anyway)
- `server/eidolon/enhanced-context.js`

Delete dead exports/imports in surviving files:
- `server/api/location/location.js:15` — unused `validateLocationFreshness` import; `:25` — imported-but-never-called `resolveTimezoneFromCoords` (or start calling it, Phase 4)
- `server/api/location/snapshot.js:7` — unused `validateIncomingSnapshot` import, then the function itself (`server/util/validate-snapshot.js:1-25`)
- `server/lib/events/pipeline/validateEvent.js:283` `filterInvalidEventsLegacy`
- `server/lib/location/address-validation.js` — `isAddressDeliverable`, `ValidationVerdict` export, default export
- `server/lib/location/coords-key.js` — `parseCoordKey`, `isValidCoordKey`, `generateCoordKey`
- `server/lib/location/geo.js` — `haversineDistanceKm` export (keep as internal helper)
- `server/lib/venue/venue-address-resolver.js` — drop `export` keyword on `resolveVenueAddress`
- `server/lib/ai/model-registry.js:222,229` — `UTIL_WEATHER_VALIDATOR` / `UTIL_TRAFFIC_VALIDATOR` roles (pending Q6)

Verify: server boots, test suite passes, grep confirms no references.

### Phase 2 — Bug fixes & stale-truth repairs (small, isolated, high value)
- `holiday-detector.js:103` — fix override path to `../../config/holiday-override.json` (override system currently silently dead — violates fail-loud)
- `server/scripts/holiday-override.js:164` — fix import path to `../lib/location/holiday-detector.js`
- `enhanced-context-base.js:132-133` — phantom `s.weather_condition`/`s.temperature_f` → real `weather`/`air` jsonb per `shared/schema.js:65-66`
- `getSnapshotTimeContext.js` — remove `country || 'US'` silent fallback (contradicts its own doctrine); prune dead exports `getEventDateRange`, `isToday`, `toLocalTimeString`
- `server/scripts/test-validate-event-tz.mjs:25` — schema-version assertion 5 → 6 (currently failing)
- Fix stale headers: `resolveTimezone.js:17` (false backfill-timezone consumer claim), `geocode.js:113-116` (false "exclusively" reverse-geocode claim), `validateEvent.js:31/183` (nonexistent endpoint reference)
- Rewrite `server/lib/location/README.md` against post-Phase-1 reality

### Phase 3 — Shared adapters for client (new code, additive)
- Create `shared/geo.js` from `geo.js`/`eta.js` haversine + bearing; `server/lib/location/geo.js` becomes a re-export shim (dayparts pattern)
- Client migrations: `co-pilot-helpers.ts:708 haversineDistance` → `shared/geo`; `co-pilot-helpers.ts:443 todayInTimezone` → `getLocalDateString` (note: removes its silent browser-tz fallback — fail-loud instead); `BriefingTab.tsx:77` inline `isEventForToday` → existing `isEventToday()`; `getGreeting()` (co-pilot-helpers.ts:407) → `shared/dayparts` with GPS-resolved timezone; `BarsDataGrid.tsx:106` device-local weekday → `getLocalDow` with snapshot timezone
- Server: migrate `holiday-detector.js:38-40,363-365` `toLocaleString` re-parse anti-pattern → `getLocalDateString`

### Phase 4 — Timezone adapter consolidation (behavioral: caching + breaker semantics change)
- Move `googleMapsCircuit` from location.js module-local to shared lib; fold `getTimezoneForCoords` transport into `resolveTimezone.js` behind it (also fixes: bare fetch with no timeout can currently hang auth address save and analyze-offer)
- Add `coords_cache` consult/write inside `resolveTimezoneFromCoords`
- Migrate call sites: location.js:710 slow path → `resolveTimezoneFromCoords`; location.js:1526 minimal mode → full `resolveTimezone()` (gains market fast path + cache it currently lacks); `backfill-timezone.js` → `resolveTimezoneFromMarket` (fixes its Birmingham-Paradox regression); GET /timezone route → delegate or delete per Q1
- Standardize on the throw contract; HTTP layers keep their existing 502 responses (no response-shape change)

### Phase 5 — Geocoding adapter consolidation (behavioral: most call sites, live routes)
- `sync-events.mjs:55-145` → import `geocodeEventAddress`/`geocodeMissingCoordinates` from geocodeEvent.js (resolve the `!e.lat` vs `!Number.isFinite` filter divergence first — Q4)
- `location.js` inline geocode fetches (229, 297, 1617 forward; 564, 1507 reverse) → `geocodeAddress`/`geocodeEventAddress`/resolver `reverseGeocode`
- `PublicConciergePage.tsx:119` browser-direct Google Geocoding → existing `GET /api/location/geocode/reverse` (also stops shipping `VITE_GOOGLE_MAPS_API_KEY` usage for this path and restores server caching/quota control); fix the `°N/°W` hardcode at :80 en route

### Phase 6 — Snapshot-context & validation unification (behavioral, most judgment-laden)
- Export canonical `SNAPSHOT_REQUIRED_FIELDS` from `validate-snapshot.js`; `blocks-fast.js:603` imports it
- `getHeaderSnapshot` (coach DAL) delegates day_of_week/is_weekend/day_part derivation to `getSnapshotTimeContext` internals while keeping its own soft-null posture (two error postures stay explicit, per the audit's recommendation — confirm Q8)
- Single shared `dayNames` helper (or `Intl` weekday via shared/dayparts) replacing the 5+ inline copies (rideshare-coach-dal.js:135, tactical-planner.js:221, location.js:1973, dump-last-briefing.js:80)
- Ambient-context family: absorb `context-awareness.js:getProjectContext` into `getEnhancedProjectContextBase`; `agent-server.js:532` switches to the agent wrapper

---

## 4. Disagreements found — duplicates returning DIFFERENT answers for the same input

**These are latent bugs, not style drift. Each pair claims the same truth and disagrees.**

1. **"The snapshot NOT-NULL fields" — two lists, two answers.** `validation-gates.js:24-28` requires 12 fields (incl. `created_at`); `validate-snapshot.js:47-51` requires 11 (no `created_at`). Both comments claim to mirror the schema. Only harmless because validation-gates is dead — Phase 1 deletes the loser, Phase 6 makes the survivor the single exported list.
2. **`dow=0` (Sunday) and `hour=0` (midnight) rejected by falsy check.** `validation-gates.js:147` uses `!snapshot[field]`, wrongly failing Sunday/midnight snapshots that the null-check 20 lines above in the *same file* passes. Dead code, but the pattern is a standing trap — do not copy it into the survivor.
3. **"What date is this snapshot?" — two answers around midnight.** `get-snapshot-context.js` returns stored `snapshot.date`; `getSnapshotTimeContext.js` computes today-*now* in snapshot tz via `new Date()`. For a snapshot consumed after local midnight they diverge by a day. Deletion of the former removes the conflict, but the survivor's call-time semantics need a deliberate decision (Q5).
4. **`day_part_key` handling — three answers.** Raw passthrough (get-snapshot-context), normalize-or-**throw** (getSnapshotTimeContext), normalize-or-`'unknown'` (getHeaderSnapshot). Same legacy value → crash, raw string, or "unknown" depending on which module reads it.
5. **"Is this event missing coordinates?" — `lat=0` flips the answer.** sync-events.mjs filters `!e.lat || !e.lng` (0 = missing); geocodeEvent.js filters `!Number.isFinite(e.lat)` (0 = present). Identical event, opposite geocoding behavior (Q4).
6. **Timezone failure — silent null vs 502 vs throw, per-copy.** geocode.js/resolveTimezoneFromCoords silently null; location.js routes 502; the (dead) `resolveTimezone()` throws. `analyze-offer.js` silently writes NULL temporal columns on the same failure that would 502 a /resolve request.
7. **Market matching — backfill script is a weaker fork.** `backfill-timezone.js` lacks `state_abbr` matching and the `country_code` filter that `resolveTimezoneFromMarket` carries specifically as the Birmingham-Paradox fix — the script can mismatch Birmingham AL / Birmingham UK where the shared module cannot.
8. **"Today" on the client — silent browser-tz fallback.** `todayInTimezone()` falls back to device-local when timezone is absent; `shared/dayparts.js getLocalDateString` fails loud. Same missing-tz input → wrong-but-plausible date vs error.
9. **Greeting/hours use device clock against GPS doctrine.** `getGreeting()` (device `getHours()`) and `BarsDataGrid.tsx:106` (device weekday) both give wrong answers when the driver's device tz ≠ GPS tz — BarsDataGrid's own header comment says this exact bug class was already removed once.
10. **Phantom columns read as real.** `enhanced-context-base.js:132-133` reads `weather_condition`/`temperature_f`, which don't exist — snapshot weather/temperature in AI ambient context is silently always `undefined` today.
11. **Broken-by-construction paths shipping as working features:** holiday override file path (always null → overrides silently ignored), holiday-override CLI test command (unresolvable import), the location barrel (SyntaxError if anything ever imports it), `checkMovementInvalidation` (`require` in ESM + wrong path — dead three ways).

---

## 5. Open questions — Melody only

1. **`GET /api/location/timezone`** (location.js:341-401): zero in-repo callers. Does any external consumer (mobile app, Siri shortcut, monitoring) call it? Delete, or keep and delegate to the adapter?
2. **PublicConciergePage device timezone** (:49): rider-facing page on the rider's own device — is device tz the *intended* semantics here (rider's wall clock), or should it match the GPS-resolved doctrine? Real tension, flagged rather than collapsed; the browser-direct Google geocode call (:119) is separate and migrates regardless.
3. **Adapter error posture:** confirm fail-loud (throw) as the adapter contract, with two sanctioned exceptions — `address-validation.js` stays fail-open in registration (deliberate: don't block signup on a Google outage), and chat/coach paths soft-degrade at their own layer. OK?
4. **`lat=0` semantics for events** (disagreement 5): is 0 ever a legitimate stored coordinate here, or is treating 0 as missing correct product behavior? Decides which filter survives.
5. **Snapshot "today" semantics** (disagreement 3): should time-context reflect the snapshot's stored moment or the moment of consumption? Matters for anything read after local midnight.
6. **Weather/traffic AI validation** (dead module + 2 orphaned model-registry roles): abandoned experiment safe to delete, or planned feature to keep parked? Deleting the registry roles is destructive-ish to a future plan only you know about.
7. **`shared/geo.js` naming/home:** promoting haversine+bearing to `shared/` mirrors the dayparts move — confirm the name and that geo math belongs in the shared tier.
8. **Coach header soft fallbacks** (`'Unknown'` city, `dow ?? 0`, `day_part 'unknown'`): keep the degrade-gracefully posture for chat, or tighten any of these now that the derivations will come from the strict adapter?