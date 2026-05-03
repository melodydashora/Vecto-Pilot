# Plan: Strategist Data Enrichment — "Give the Strategist What It Needs to Change Lives"

**Status:** Plan drafted 2026-04-11 — awaiting Melody's test confirmation after Phase 2–5 implementation
**Created:** 2026-04-11
**Author:** Claude Code (Opus 4.6, 1M ctx) in session with Melody
**Scope:** Enrich the prompts passed to `STRATEGY_TACTICAL` and `STRATEGY_DAILY` roles so the LLM produces dispatcher-quality, dollar-specific, driver-personalized output instead of generic advice. Changes live in `server/lib/ai/providers/consolidator.js` and (additively) `server/lib/briefing/briefing-service.js`.

---

## 1. Problem Statement

### The failing standard

Melody role-played as a rideshare dispatcher using the exact same data sent to the strategist LLM. The dispatch was perfect: hour-by-hour positioning, staging advice, earnings math, fuel costs, safety alerts, avoid-areas with specific road names, NEAR/FAR event intelligence with crowd sizes. Owner's verdict:

> "This is the bare minimum of what we should be sending the strategist. If you aren't getting what you need then our app is not giving what it needs."

### The current state

`generateImmediateStrategy` in `consolidator.js:148–240` and `runConsolidator` at `consolidator.js:764–980` both assemble the strategist prompt. Both pass a filtered, summarized version of the briefing data. Specifically:

1. **Traffic:** only `briefing.traffic.driverImpact` reaches the LLM (one line). No structured incident list, no closures with road names, no distance from driver, no congestion level breakdown.
2. **Weather:** only `weather.driverImpact` reaches the LLM (one line). The 6-hour hourly forecast — already populated in `briefings.weather_forecast` — is **never read**. The strategist has no way to reason about "storm hits at 8pm, position before it."
3. **Events:** passed through `formatEventsForLLM`, which produces compact event objects with `venue, time, end, type, coords (if present), distance (if present)`. **`distance_mi` is never set upstream**, so the strategist sees events as an unordered list with no distance signal. `venue_lat` / `venue_lng` are already present in `briefings.events` from the venue_catalog LEFT JOIN, but unused for distance.
4. **Driver preferences:** **ZERO.** The strategist does not know the driver's vehicle class, fuel economy, earnings goal, work-hours target, max deadhead distance, whether they drive an EV (fuel cost math differs), their home base (distinct from current snapshot position), or their platform mix.
5. **Earnings math:** no pre-computed economics. The strategist says "go north for surge" without being able to say "drive 12mi (~$2.40 fuel) to earn $40–60 in surge rides."

### The cost

Generic advice instead of personalized, actionable, life-changing dispatch. A driver who needs to earn $X in Y hours gets told "position near events" instead of "position at Hotel A on the airport approach, 4mi north, you should clear $45–60 this hour; if no ping in 15 min, move to Dining Cluster B and catch the 8pm theater exit surge."

---

## 2. Design Constraints (owner-supplied)

1. **Additive only.** If a new field is null / missing / the schema hasn't been migrated yet, the code must fall back to the current behavior gracefully. Zero breakage of the existing pipeline.
2. **Token budget: +500–800 tokens.** Compact formatting, not verbose JSON dumps. The 7 enrichments together should add roughly 500–800 tokens to the prompt. If we're at +2000, we've done it wrong.
3. **Global app.** No US-specific examples in code comments or docs. DFW examples inside the prompt template as illustrative defaults are OK (they get replaced by real data at runtime).
4. **CLAUDE.md Rule 1:** This plan document exists before code changes. Implementation waits for owner approval ("All tests passed").
5. **CLAUDE.md Rule 9:** Zero tolerance for drift between docs, schema, metadata, and code. Every enrichment gets documented in CHANGELOG, providers/README, and relevant architecture docs.
6. **Must `node --check` clean** on every modified file.

---

## 3. Architectural Recommendation (pushing back as master architect)

The owner's message said: *"add them to the snapshot row or create a driver_preferences JSONB column on snapshots."* I want to push back on the snapshot-row placement.

**Driver preferences are user-level, not snapshot-level.** Fuel economy, earnings goal, shift length, max deadhead — these change at most a few times a year. Putting them on every snapshot row denormalizes data that rarely changes and creates two sources of truth (the latest snapshot vs. a "canonical" preference store). The architecturally correct home is `driver_profiles` — matching the existing convention where vehicle eligibility (`elig_*`), vehicle attributes (`attr_*`), and service preferences (`pref_*`) all live as columns on `driver_profiles`.

**Chosen approach — user-level placement + runtime fetch:**

1. Preferences live on `driver_profiles`, joined into the strategy pipeline via `snapshot.user_id` at strategy-build time.
2. A single indexed lookup per strategy call (typically <5ms — negligible latency impact).
3. `vehicle_class` is **derived** from the existing `elig_*` booleans (highest tier that's true wins), not a new column.
4. Schema migration (add 4 new columns to `driver_profiles`) is documented in Section 5 as **follow-up work** — NOT applied in this session.
5. Consolidator code runs correctly against the **current** schema using owner-specified defaults. When the migration runs, the code picks up the real values automatically.

**Rationale for not applying the migration in this session:**
- CLAUDE.md Rule 13: Dev vs. Prod DB awareness. Migrations touch a real table; schema changes should be done deliberately and reviewed separately from code changes.
- The additive design makes the code migration-agnostic: same behavior whether the migration has run or not.
- Reduces blast radius of this change. Code-only changes are easily reverted; schema changes are harder.

---

## 4. The Seven Enrichments

Each enrichment lists: (a) what it adds, (b) the exact code location, (c) the data source (existing schema vs. new fetch vs. defensive default), (d) the token budget, (e) the fallback path.

### Enrichment 1 — Driver Preferences

**Adds:** A new `=== DRIVER PREFERENCES ===` section after `=== DRIVER CONTEXT ===` in the prompt.

**Format (single compact line, ~80 tokens):**
```
Vehicle: {vehicle_class} | Fuel economy: {mpg} mpg ({fuelType}) | Gas cost/mile: ~${gasPerMile} | Today's goal: {goal} in {hours} hours | Max deadhead: {maxDist} mi from home
```

**Data source & fallbacks:**

| Field | Source | Default if null/missing |
|---|---|---|
| `vehicle_class` | Derived from `driver_profiles.elig_*` booleans (highest-tier wins) | `"UberX"` |
| `mpg` | `driver_profiles.fuel_economy_mpg` (new column — migration pending) | `25 mpg` |
| `fuelType` | Derived from `driver_profiles.attr_electric` | `"gas"` (or `"electric"` if attr_electric=true) |
| `gasPerMile` | Computed: `gasPrice / mpg`. `gasPrice` TBD per market (defer to defaults for now). | `$0.14/mi` (computed from `$3.50/gal ÷ 25 mpg`) |
| `goal` | `driver_profiles.earnings_goal_daily` (new column — migration pending) | `null` → display as "not set" |
| `hours` | `driver_profiles.shift_hours_target` (new column — migration pending) | `null` → display as "not set" |
| `maxDist` | `driver_profiles.max_deadhead_mi` (new column — migration pending) | `15 mi` |

**Rank derivation function (new helper in consolidator.js):**

```javascript
function deriveVehicleClass(profile) {
  if (!profile) return 'UberX';
  if (profile.elig_luxury_suv)    return 'Uber Black SUV';
  if (profile.elig_luxury_sedan)  return 'Uber Black';
  if (profile.elig_xxl)           return 'UberXXL';
  if (profile.elig_xl)            return 'UberXL';
  if (profile.elig_comfort)       return 'Uber Comfort';
  if (profile.elig_economy)       return 'UberX';
  return 'UberX';  // Default if no eligibility flags set
}
```

EV handling: if `attr_electric = true`, `fuelType = "electric"`, `gasPerMile = electricityCostPerMile` (use default `$0.04/mi` for electric vehicles — a typical US rate, replaceable later).

### Enrichment 2 — Full Traffic Intelligence

**Adds:** Replaces the single `TRAFFIC: {driverImpact}` line with a structured multi-line block.

**Format (compact, target ~150 tokens):**
```
TRAFFIC: {driverImpact} | Congestion: {congestionLevel}
AVOID: {avoidArea1} | {avoidArea2} | {avoidArea3}
CLOSURES: {road1} ({dist1}mi) | {road2} ({dist2}mi) | ...  [top 5, sorted by distance]
TOP INCIDENTS: {road1} ({dist1}mi, {severity1}) | ... [top 5, sorted by priority/severity desc]
HIGH-DEMAND ZONES: {zone1} | {zone2} | ... [if populated]
```

**Data source:** This is the enrichment that requires the **traffic persistence fix** in `briefing-service.js`. See Section 7.

**Fallback when raw incident data is missing (legacy briefings or no TomTom data):**
Fall back to the existing behavior — emit only the `driverImpact` line. The `keyIssues[]` and `avoidAreas[]` string arrays from Gemini's analysis are *also* available as a middle ground: even without raw incidents, we can emit `avoidAreas` verbatim.

**Graceful degradation ladder:**
1. Full structured data (incidents + closures + congestion + highDemandZones) — best case
2. Only Gemini analysis (`avoidAreas` + `keyIssues` + `closuresSummary`) — good case
3. Only `driverImpact` — current behavior, worst case

### Enrichment 3 — Event Distance Annotation (NEAR/FAR)

**Adds:** Every event gets a `distance_mi` field (computed from snapshot → event venue via haversine) and a `[NEAR]` / `[FAR]` tag in the prompt. Events are sorted closest-first. NEAR events are prioritized to fill the 15-event (immediate) / 20-event (daily) slice, with remaining slots filled by highest-impact FAR events.

**Format per event (multi-line, ~30 tokens each):**
```
[NEAR 3.2mi] The SpongeBob Musical — Casa Mañana — 17:00-20:00 — theater — ~2,000 expected
[FAR 24.1mi] Local Stars vs Rangers — Main Arena — 16:00-19:00 — sports — HIGH IMPACT — ~18,500 expected
```

**Data source:** **FREE — `venue_lat` and `venue_lng` are already in `briefings.events`** from the venue_catalog LEFT JOIN at `briefing-service.js:1472–1473`. No new DB query, no schema change. Pure in-memory computation.

**Threshold:** `NEAR_EVENT_RADIUS_MILES = 15` (matches the VENUE_SCORER constraint the strategist should be aligned with, per the earlier 2026-04-11 Smart Blocks ↔ Event coordination work).

**Haversine helper:** Reuse the one already in `server/lib/venue/enhanced-smart-blocks.js:87–96`. Import it or re-declare it locally (local declaration avoids a cross-module dependency; 10 lines of duplication is cheaper than a new import for a utility function).

**Priority ordering for the slice:**

```javascript
// Immediate strategist: slice to 15 events
// Daily strategist: slice to 20 events
function prioritizeEvents(events, limit) {
  // All NEAR events first (sorted closest-first)
  const nearEvents = events.filter(e => e.distance_mi <= 15).sort((a, b) => a.distance_mi - b.distance_mi);
  const farEvents = events.filter(e => e.distance_mi > 15);

  if (nearEvents.length >= limit) return nearEvents.slice(0, limit);

  // Fill remaining with highest-impact FAR events (expected_attendance === 'high' first, then by distance)
  const remainingSlots = limit - nearEvents.length;
  const sortedFar = farEvents.sort((a, b) => {
    const aHigh = a.expected_attendance === 'high' ? 1 : 0;
    const bHigh = b.expected_attendance === 'high' ? 1 : 0;
    if (aHigh !== bHigh) return bHigh - aHigh;  // high-impact first
    return a.distance_mi - b.distance_mi;        // then closest
  });
  return [...nearEvents, ...sortedFar.slice(0, remainingSlots)];
}
```

### Enrichment 4 — Weather Forecast Timeline

**Adds:** A compact 6-hour forecast timeline after the existing `WEATHER:` line, with an optional storm risk warning.

**Format (compact, target ~80 tokens):**
```
WEATHER: {current.driverImpact}
6hr forecast: {temp0}°F now → {temp1}°F@{hour1} ({precip1}% precip) → {temp2}°F@{hour2} ({precip2}%) → ...
⚠️ STORM RISK: {time} ({precip}%) — factor into positioning  [only if any hour has precip > 30%]
```

**Data source:** **FREE — `briefings.weather_forecast` is already populated** with 6 hourly entries from `briefing-service.js:1680–1708`. Each entry has `time`, `tempF`, `conditions`, `precipitationProbability`, etc. The strategist simply never reads this column. Adding the forecast timeline is a pure formatting change against data already in the briefing row.

**Fallback:** If `weather_forecast` is empty or missing (legacy briefings, API failure), emit only the current `driverImpact` line (existing behavior).

### Enrichment 5 — Event Scale Signal (capacity estimation)

**Adds:** Each event gets an `estimated_attendance` numeric value displayed in the prompt, derived from a heuristic based on venue type and event category.

**Format in prompt (appended to each event line):**
```
[NEAR 3.2mi] The SpongeBob Musical — Casa Mañana — 17:00-20:00 — theater — ~2,000 expected
```

**Heuristic function (new helper in consolidator.js):**

```javascript
function estimateEventCapacity(event) {
  const category = (event.category || '').toLowerCase();
  const venueName = (event.venue_name || '').toLowerCase();
  const attendance = (event.expected_attendance || 'medium').toLowerCase();

  // Venue-type heuristic (strongest signal)
  if (/stadium|arena|coliseum|speedway/.test(venueName)) return 18000;
  if (/pavilion|amphitheater|amphitheatre/.test(venueName)) return 12000;
  if (/convention center|expo center|fairgrounds/.test(venueName)) return 8000;
  if (/theater|theatre|playhouse|hall/.test(venueName)) return 2000;
  if (/comedy club|comedy cellar/.test(venueName)) return 350;
  if (/nightclub|club/.test(venueName) && category === 'nightlife') return 1000;

  // Category fallback
  if (category === 'sports') return 15000;
  if (category === 'concert') return 10000;
  if (category === 'festival') return 8000;
  if (category === 'theater') return 2000;
  if (category === 'comedy') return 350;
  if (category === 'nightlife') return 500;

  // Expected_attendance fallback
  if (attendance === 'high') return 5000;
  if (attendance === 'low') return 200;
  return 1000;  // medium default
}
```

**Important: this is a heuristic, not ground truth.** The prompt label says "~X expected" to signal uncertainty. When we eventually get real capacity data (from venue discovery enrichment or a `venue_catalog.capacity` column), the heuristic becomes the fallback.

**Not touching the schema for this in Phase 2.** `discovered_events` already has `expected_attendance` as a 3-level enum (`high/medium/low`). Adding a numeric `capacity_estimate` column would be a discovered_events schema change, which is out of scope for this session. Heuristic runs at prompt-build time.

### Enrichment 6 — Home Base Context

**Adds:** Explicit home-base line in the DRIVER CONTEXT section so the strategist knows the driver's anchor point (vs. just the current snapshot position).

**Format (compact, ~40 tokens):**
```
Current position: {snapshot.formatted_address}  ({snapshot.lat}, {snapshot.lng})
Home base: {driver_profiles.home_formatted_address}  ({home_lat}, {home_lng}) — {distance_from_home} mi from current position
```

**Data source:** `driver_profiles.home_lat`, `driver_profiles.home_lng`, `driver_profiles.home_formatted_address` — **already exist on the schema**, just unused. Same fetch as Enrichment 1 (single driver_profiles lookup).

**Fallback:** If home fields are null (OAuth signup, profile incomplete), emit the current position line only (existing behavior). The strategist will interpret absence as "use current position as home."

### Enrichment 7 — Earnings Math Context

**Adds:** A new `=== EARNINGS CONTEXT ===` section after DRIVER PREFERENCES with pre-computed economics the strategist can quote directly.

**Format (compact block, ~180 tokens):**
```
=== EARNINGS CONTEXT ===
Vehicle class: {class} | Estimated rate: ~${ratePerMile}/mi + ${ratePerMin}/min
Fuel cost: ${gasPrice}/gal ÷ {mpg} mpg = ~${costPerMile}/mi ({fuelType})
Net per mile: ~${netPerMile}/mi
To earn ${goal} in {hours}hrs: need ~${perHour}/hr gross  [if goal/hours set]
Surge multiplier on event nights: typically 1.5-3x in the first 30 min after major event end times
```

**Rate defaults by vehicle class (illustrative, not US-specific — platform-agnostic targets):**

```javascript
const RATE_DEFAULTS = {
  'UberX':          { perMile: 0.80, perMin: 0.20 },
  'Uber Comfort':   { perMile: 1.20, perMin: 0.25 },
  'UberXL':         { perMile: 1.00, perMin: 0.22 },
  'UberXXL':        { perMile: 1.10, perMin: 0.24 },
  'Uber Black':     { perMile: 2.50, perMin: 0.50 },
  'Uber Black SUV': { perMile: 3.50, perMin: 0.70 },
};
```

**Fuel cost defaults:**
- Gas vehicle: `$3.50/gal ÷ mpg → $/mile`
- Electric vehicle: `$0.04/mile` flat (covers typical electricity cost for rideshare EVs)

These are **intentionally round defaults** that the prompt labels as "estimated" — the strategist knows they're baselines, not live market rates. When we eventually wire in live rate feeds or market-specific gas prices, the defaults become the fallback.

**Conditional display:** If `earnings_goal_daily` and `shift_hours_target` are both set, include the `need ~${perHour}/hr gross` line. Otherwise omit it.

---

## 5. Schema Migration (Documented, NOT Applied in This Session)

The following migration should be run separately when the owner is ready. The consolidator code will pick up the new values automatically.

**File: `migrations/YYYYMMDD_add_driver_preference_columns.sql`** (to be created)

```sql
-- Add driver preference columns for STRATEGY_TACTICAL / STRATEGY_DAILY enrichment
-- See server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md section 5 for rationale.

ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS fuel_economy_mpg integer,         -- e.g., 25 (mpg). null = use default (25).
  ADD COLUMN IF NOT EXISTS earnings_goal_daily numeric(10,2),-- e.g., 250.00 ($). null = goal not set.
  ADD COLUMN IF NOT EXISTS shift_hours_target numeric(4,1),  -- e.g., 8.0 (hours). null = target not set.
  ADD COLUMN IF NOT EXISTS max_deadhead_mi integer;          -- e.g., 15 (miles). null = use default (15).

COMMENT ON COLUMN driver_profiles.fuel_economy_mpg IS 'Driver vehicle fuel economy in mpg (or null to use default 25). Used by strategist prompt for per-mile gas cost math. Ignored when attr_electric = true.';
COMMENT ON COLUMN driver_profiles.earnings_goal_daily IS 'Driver daily earnings target in local currency (or null). Used by strategist to compute required $/hr for the shift.';
COMMENT ON COLUMN driver_profiles.shift_hours_target IS 'Driver target shift length in hours (or null). Paired with earnings_goal_daily for $/hr pacing.';
COMMENT ON COLUMN driver_profiles.max_deadhead_mi IS 'Max miles the driver will drive empty for a pickup (or null to use default 15).';
```

**Until this migration runs,** the code reads these columns via a `try/catch` wrapper that returns defaults on "column does not exist" errors (Postgres error `42703`). After the migration runs, the code picks up real values seamlessly.

**Why not apply this in the same session as the code change?**
1. Schema migrations have different review/rollback characteristics than code changes.
2. CLAUDE.md Rule 13: Dev/Prod DB awareness — migrations should be run deliberately.
3. The additive-default design means the code works correctly either way.
4. Smaller blast radius: the code change can be tested independently of the migration.

---

## 6. Traffic Persistence Fix (Additive Change to briefing-service.js)

Enrichment 2 requires structured incident data that **is not currently persisted**. The fix:

**File:** `server/lib/briefing/briefing-service.js`

**Function:** `analyzeTrafficWithGemini` — expand the return object at lines 529–539.

**Change (additive only — existing fields preserved):**

```javascript
return {
  // EXISTING fields (unchanged)
  briefing: analysis.briefing,
  headline: analysis.briefing?.split('.')[0] + '.' || analysis.headline,
  keyIssues: analysis.keyIssues || [],
  avoidAreas: analysis.avoidAreas || [],
  driverImpact: analysis.driverImpact,
  closuresSummary: analysis.closuresSummary,
  constructionSummary: analysis.constructionSummary,
  analyzedAt: new Date().toISOString(),
  provider: 'BRIEFING_TRAFFIC',

  // NEW additive fields (2026-04-11): raw TomTom data preserved for strategist enrichment
  incidents: incidents.slice(0, 20),      // Top 20 incidents with road/distance/severity/delayMinutes
  closures: closures.slice(0, 10),        // Filtered: category = 'Road Closed' or 'Lane Closed'
  highwayIncidents: highwayIncidents.slice(0, 10),
  congestionLevel: tomtomData.congestionLevel || 'unknown',
  highDemandZones: tomtomData.highDemandZones || [],
};
```

**Impact:**
- Legacy briefings written before this change: will not have the new fields. Strategist falls back to the existing `avoidAreas[]` / `keyIssues[]` / `driverImpact` path.
- New briefings: will have the new fields. Strategist reads structured data.
- No breakage: the new fields are purely additive.

**Token budget impact on the briefings JSONB column:** ~5–10 KB of additional JSON per briefing row (20 incidents × ~300 bytes each). `briefings.traffic_conditions` is a JSONB column with no size constraint documented in schema.js — verified acceptable.

---

## 7. Files Affected (Exhaustive List)

### Code files

| File | Change type | Summary |
|------|-------------|---------|
| `server/lib/ai/providers/consolidator.js` | **Modify** | Add `loadDriverPreferences(userId)` helper. Add `formatTrafficIntelForLLM`, `formatWeatherForecastForLLM`, `formatEventsForLLMWithDistance` helpers. Modify `generateImmediateStrategy` and `runConsolidator` to use the new helpers. Update both system prompts. |
| `server/lib/briefing/briefing-service.js` | **Modify** | `analyzeTrafficWithGemini` — expand return object to include raw TomTom incidents, closures, congestionLevel, highDemandZones. Additive only. |
| `server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md` | **Create (this file)** | Plan document per Rule 1. |

### Schema files

| File | Change type | Summary |
|------|-------------|---------|
| `shared/schema.js` | **NOT TOUCHED IN THIS SESSION** | Migration documented in Section 5 as follow-up work. |

### Documentation files

| File | Change type | Summary |
|------|-------------|---------|
| `CHANGELOG.md` | **Append** | New `[Unreleased] — 2026-04-11 (Strategist Data Enrichment)` entry. |
| `server/lib/ai/providers/README.md` | **Create** | New README documenting the enriched strategist prompts, the 7 enrichments, and how each maps to a data source. |
| `server/lib/briefing/README.md` | **Modify** | Add a "Traffic Intelligence Persistence (2026-04-11)" subsection documenting the additive changes to `analyzeTrafficWithGemini`. |
| `docs/architecture/VENUES.md` | **Not affected** | Smart Blocks pipeline unchanged. |
| `docs/EVENTS.md` | **Modify** | Add a note under Section 10 that events now flow through distance annotation at strategist-build time AS WELL AS at Smart Blocks time, and both use the same 15-mile NEAR/FAR threshold. |
| `claude_memory` table | **Insert** | Log the schema migration as a `status='active'` row per CLAUDE.md Rule 15 (`pending.md` retired 2026-04-29). |

---

## 8. Token Budget Math

| Enrichment | Additional tokens per prompt | Cumulative |
|---|---|---|
| 1. Driver preferences block | ~80 | 80 |
| 2. Full traffic intel block | ~150 (best case) / ~60 (fallback) | 230 |
| 3. Event distance annotation | ~5 tokens per event × 15 events = 75 | 305 |
| 4. Weather forecast timeline | ~80 | 385 |
| 5. Event scale labels | ~4 tokens per event × 15 events = 60 | 445 |
| 6. Home base context | ~40 | 485 |
| 7. Earnings math block | ~180 | 665 |
| **Total** | — | **~665 tokens** |

Target was **500–800 tokens added**. Projected is ~665. Within budget.

Current prompt size is roughly 800–1500 tokens (varies with briefing data). Post-enrichment: ~1500–2200 tokens. Well within any modern model's context window.

---

## 9. Test Strategy

### Static verification (this session, before handoff to Melody)
- `node --check server/lib/ai/providers/consolidator.js`
- `node --check server/lib/briefing/briefing-service.js`
- Grep confirmation that no orphan references remain
- Confirm all imports resolve
- Confirm no US-specific strings leaked into docs (beyond the prompt template's illustrative defaults, which the owner explicitly permitted)

### Integration tests (Melody to run)
- **T1 (defaults path):** Driver with `fuel_economy_mpg = null` → prompt shows "25 mpg (default)"
- **T2 (EV path):** Driver with `attr_electric = true` → prompt shows "electric" fuel type, $0.04/mi cost
- **T3 (high-tier vehicle):** Driver with `elig_luxury_sedan = true` → `vehicle_class = "Uber Black"` with corresponding rates
- **T4 (NEAR events only):** Driver snapshot with 3 NEAR events, 0 FAR → prompt shows 3 events, all tagged `[NEAR]`
- **T5 (FAR events fill):** Driver snapshot with 2 NEAR events, 15 FAR events → prompt shows 2 NEAR + 13 FAR (highest impact first), all distance-annotated
- **T6 (weather forecast):** Briefing with populated `weather_forecast` array → prompt shows 6-hour timeline. If precip > 30% in any hour, storm warning line appears
- **T7 (traffic full path):** Briefing with new fields (incidents, closures, highDemandZones) → prompt shows full structured traffic block
- **T8 (traffic legacy path):** Briefing with old shape (only Gemini analysis) → prompt falls back to `avoidAreas[]` + `driverImpact` line
- **T9 (goal not set):** Driver with `earnings_goal_daily = null` → EARNINGS CONTEXT block omits the "need ~$X/hr gross" line
- **T10 (regression):** Driver with no profile row at all → defaults used everywhere, no errors, strategist produces output
- **T11 (system-prompt effect):** Compare strategist output BEFORE and AFTER the enrichments for the same snapshot. After: dollar-specific, hour-phased, NEAR/FAR aware, fuel-cost aware. Before: generic.

### Manual dispatcher-quality check (Melody's subjective test)
> "Does the strategist output match what I produced when I role-played as the dispatcher? Does it give dollar-specific advice? Does it reference specific roads to avoid? Does it phase the night hour by hour? Does it know my vehicle and my goal?"

---

## 10. Rollback Plan

Each enrichment is an additive change. Rollback is one-commit-revert:

1. `git revert` the consolidator.js change → prompt returns to current form
2. `git revert` the briefing-service.js change → traffic_conditions returns to old shape
3. Plan file and docs can stay or be reverted independently
4. Schema migration has not been applied, so no rollback needed there

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| New driver_profiles columns don't exist yet → query fails | `try/catch` wrapper around the fetch; Postgres error `42703` ("column does not exist") returns defaults gracefully. |
| driver_profiles row doesn't exist (user without completed profile) | Fetch returns null, defaults are used, no errors propagated |
| briefings.weather_forecast is empty or missing (legacy briefings) | Forecast timeline section omitted; only `driverImpact` line shown |
| briefings.events lacks venue_lat/venue_lng (legacy or orphan events) | Distance annotation falls back to "?mi" and events keep their existing position in the list |
| TomTom traffic fetch fails → no incidents/closures data | Strategist falls back to Gemini's `avoidAreas[]` + `keyIssues[]` + `driverImpact` line (current behavior) |
| Prompt becomes too long | Token budget math in Section 8 says ~665 added; monitor and tune caps if needed |
| Heuristic capacity estimates are wildly wrong | Labels as "~X expected" communicate uncertainty; doesn't drive decisions by itself, only supplements the `HIGH IMPACT` flag |
| `vehicle_class` derivation picks the wrong tier | Cheapest tier always eligible; highest-tier-eligible wins; owner can override by flipping `elig_*` flags |

---

## 12. Implementation Steps (Phase 2+ tracking)

1. **Add helper functions at the top of consolidator.js:** `loadDriverPreferences`, `deriveVehicleClass`, `haversineMiles`, `annotateEventsWithDistance`, `prioritizeEvents`, `estimateEventCapacity`, `formatTrafficIntelForLLM`, `formatWeatherForecastForLLM`, `formatEventsForLLMWithDistance`, `buildDriverPreferencesSection`, `buildEarningsContextSection`.
2. **Modify `generateImmediateStrategy`** to call the helpers and inject the new prompt sections. Keep the existing structure; additions are inserted in specific spots (DRIVER PREFERENCES after DRIVER CONTEXT, EARNINGS CONTEXT after DRIVER PREFERENCES, enriched TRAFFIC/WEATHER/EVENTS in the BRIEFING DATA section).
3. **Update the STRATEGY_TACTICAL system prompt** per owner's 5 directives.
4. **Mirror the changes in `runConsolidator`** (daily strategist) with the 20-event cap.
5. **Modify `analyzeTrafficWithGemini`** in briefing-service.js to preserve raw TomTom data additively.
6. **Update docs** per Section 7.
7. **`node --check` on every modified file.**
8. **Log findings to `claude_memory`** (`category='audit', status='active'`) so future sessions know the migration is outstanding (replaced retired `pending.md` 2026-04-29; see CLAUDE.md Rule 15).

---

## 13. Status Log

| Timestamp | Event |
|-----------|-------|
| 2026-04-11 | Owner issues CRITICAL MISSION: "Give the strategist what it needs to change lives" — 5-phase plan with 7 enrichments |
| 2026-04-11 | Phase 1 reads complete — schema, briefing shapes, and gap analysis done |
| 2026-04-11 | Plan drafted (this file) — architectural pushback on snapshot-level placement; preferences go on driver_profiles |
| — | Phase 2 (code changes) — **pending this plan's approval and/or owner giving the GO signal** |
| — | Phase 3 (system prompt update) — pending Phase 2 |
| — | Phase 4 (daily strategist mirror) — pending Phase 3 |
| — | Phase 5 (docs) — pending Phase 4 |
| — | Final `node --check` verification — pending Phase 5 |
| — | Owner test run + confirmation — pending handoff |
