# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — 2026-04-25 (P3 DB Sanity + Audit Verification)

### Database / Audit

- **`server/scripts/seed-dfw-venues.js`** — schema-mismatch fix. The script referenced `venue_catalog.name` and `{ name }` on the insert payload, but the Drizzle schema column is `venue_name`. Drizzle generated `WHERE  = $1` (empty column) and the seed 42601'd before inserting anything. Fixed inline so the seed completes; the local `dfwVenues` records keep `name` for readability and are mapped to `venue_name` at insert time.
- **`AUDIT_DB_COUNTS.md`** (new, top-level) — snapshot of `COUNT(*)` for the 15 audit-watch tables on the active DB. Documents that `pg_stat_user_tables.n_live_tup` was stale (autovacuum had not run; reported 0 for tables that actually held thousands of rows). Real `COUNT(*)` is the source of truth in this report.
- **`VERIFICATION.md`** (new, top-level) — per-item verification table for the 13 audit-fix items, including the verify command and observed output for each.

### Trigger conditions not met (logged for next run)

- The P3-13 catch-block instrumentation directive triggers when `users`, `snapshots`, `strategies`, `briefings`, `rankings`, or `triad_jobs` are 0 in a DB known to have been used. None were 0 in dev (Helium) at the time of this audit. A separate prod-recheck script (`scripts/p3-13-prod-recheck.mjs`, added in a follow-up commit) is provided so the same trigger condition can be evaluated against Neon prod, where dev/prod have isolated data per Rule 13.

---

## [Unreleased] — 2026-04-25 (P0 Security Audit Fixes)

### Security

- **gateway-server.js — middleware ordering (P0-1).** `configureMiddleware` (helmet, cors, body parsing) now runs BEFORE `configureHealthEndpoints` and BEFORE the `express.static(distDir)` mount. Previously, security headers were not applied to health probes or the SPA bundle, leaving the static assets and `/api/health` without CSP / HSTS / X-Content-Type-Options.
- **`/api/diagnostic/db-info` removed (P0-2).** The unauthenticated endpoint at this path leaked `database_host` (masked-but-resolvable) plus environment-detection metadata (`REPLIT_DEPLOYMENT`, `NODE_ENV`, app mode). Authenticated diagnostics under `/api/diagnostics/*` remain available.
- **JWKS endpoint and scaffolding removed (P0-3, follow-up).** `public/.well-known/jwks.json`, `scripts/sign-token.mjs`, and `scripts/make-jwks.mjs` were deleted. The originally-committed `kid: vectopilot-rs256-k1` had been published publicly but had **zero consumers**: no JWT verification middleware referenced it, no Neon Console JWKS URL was registered, and no `keys/` directory existed in the repo. Deletion was preferred over rotation because rotation would have required provisioning a verifier downstream that does not yet exist. The bot-blocker `/.well-known/` allow-list added in the same audit was also reverted, since the endpoint is now intentionally absent.

---

## [Unreleased] — 2026-04-11 (Strategist Data Enrichment — "Change Lives")

### Summary

This entry documents the **most significant change ever made to the strategist
pipeline**. The STRATEGY_TACTICAL (immediate) and STRATEGY_DAILY (daily) role
prompts in `server/lib/ai/providers/consolidator.js` previously received a
stripped-down version of the briefing data: 1-line summaries of traffic and
weather, unstructured/unsorted events with no distance signal, and **zero
driver preferences**. The result was generic advice instead of the personalized,
actionable, dollar-specific dispatch a skilled human dispatcher would produce.

The owner role-played as a dispatcher using the exact same data sent to the
strategist LLM and produced a perfect dispatch — hour-by-hour positioning,
staging advice, earnings math, fuel costs, safety alerts, avoid-areas with
specific road names, NEAR/FAR event intelligence with crowd sizes. The verdict:

> "This is the bare minimum of what we should be sending the strategist. If you
>  aren't getting what you need then our app is not giving what it needs."

This entry is that fix. Seven enrichments land additively — every helper
degrades gracefully when a field is null, a row is missing, or a schema
migration hasn't been applied yet. The strategist now receives the data a
human dispatcher would have in their head before picking up the phone.

### Design — the seven enrichments

1. **Driver preferences** (vehicle class, fuel economy, earnings goal, shift
   hours target, max deadhead distance, home base). Loaded per-call from
   `driver_profiles` via the `loadDriverPreferences(userId)` helper — a single
   indexed lookup on `user_id`.
2. **Full traffic intelligence** — structured `incidents[]`, `closures[]`,
   `highDemandZones[]`, `congestionLevel`, and `avoidAreas[]` from the raw
   TomTom data persisted alongside Gemini's analysis. Requires the additive
   change to `analyzeTrafficWithGemini` in `briefing-service.js` (see Changed
   section below).
3. **Event distance annotation (NEAR/FAR)** — every event gets a `distance_mi`
   computed from snapshot → event-venue via haversine, and a `[NEAR X.Xmi]` or
   `[FAR X.Xmi]` tag in the prompt. NEAR events (≤ 15 mi, matching the
   VENUE_SCORER rule) are prioritized in the slice; FAR events fill the
   remainder sorted by impact first, then distance. Uses the `venue_lat` /
   `venue_lng` fields already present in `briefings.events` from the
   venue_catalog LEFT JOIN — **no new DB query**.
4. **Weather forecast timeline** — a compact 6-hour forecast line
   (`6hr forecast: 76°F now → 75°F@7pm (14% precip) → ...`) plus a conditional
   `⚠️ STORM RISK` warning line when any hour has precipitation probability
   > 30%. Reads `briefings.weather_forecast` which was populated by the
   briefing pipeline but previously **never read by the strategist**.
5. **Event capacity heuristic** — each event gets an `estimated_attendance`
   numeric value derived from venue-type and category (stadium/arena → 18k,
   amphitheater → 12k, theater → 2k, comedy club → 350, etc.). The prompt
   renders it as `~X expected` after high-impact events so the LLM can
   distinguish a 500-person show from a 20k-person sold-out concert.
6. **Home base context** — explicit line showing the driver's home
   (`driver_profiles.home_lat` / `home_lng` / `home_formatted_address`) and
   their distance from it. Lets the strategist reason about "stay close to
   home vs go far for surge" and about the `max_deadhead_mi` preference.
7. **Earnings math context** — a pre-computed block with the driver's vehicle
   class, estimated per-mile and per-minute rates, fuel cost per mile
   (gas OR electric based on `attr_electric`), net per mile, and required
   $/hour gross to hit the earnings goal. Lets the strategist quote
   "Drive to X (12mi, ~$2.40 fuel) for $40-60 surge rides" instead of
   generic "go north."

### Global applicability

The NEAR/FAR threshold is 15 miles uniformly regardless of market. The 60-mile
metro context radius on event fetching is a default that works for a typical
large metro. Fuel cost math works for any currency / market with the
`GAS_PRICE_DEFAULT` env var. Vehicle class derivation is platform-agnostic —
the `elig_*` booleans on `driver_profiles` map directly to rate cards.
Illustrative defaults in the prompt (e.g., sample fuel prices) get replaced
by real market data at runtime whenever it's wired in.

### Changed

- **`server/lib/ai/providers/consolidator.js`** (major additive changes):
  - New imports: `driver_profiles` from `shared/schema.js`.
  - New helper functions (added as a block before `batchLookupVenueHours`):
    - `haversineMiles(lat1, lon1, lat2, lon2)` — distance calc.
    - `DRIVER_PREF_DEFAULTS`, `RATE_DEFAULTS`, `DEFAULT_GAS_PRICE`,
      `EV_COST_PER_MILE`, `NEAR_EVENT_RADIUS_MILES` — defaults/constants.
    - `deriveVehicleClass(profile)` — maps `elig_*` booleans to a single
      vehicle class string (highest-tier-eligible wins).
    - `loadDriverPreferences(userId)` — fetches `driver_profiles` row with
      defensive fallback for PG error `42703` (column does not exist, used
      when migration hasn't applied) and missing profile. Returns a
      well-formed preferences object with defaults applied.
    - `computeFuelCostPerMile(prefs)` — EV or gas, per-mile cost.
    - `buildDriverPreferencesSection(prefs)` — single-line DRIVER PREFERENCES
      prompt block.
    - `buildEarningsContextSection(prefs)` — multi-line EARNINGS CONTEXT
      prompt block. Omits the "need ~$X/hr gross" line when earnings_goal or
      shift_hours_target are null.
    - `buildHomeBaseLine(snapshot, prefs)` — returns the home-base line or
      null if home fields are unpopulated.
    - `estimateEventCapacity(event)` — heuristic attendance numbers by
      venue name + category + expected_attendance.
    - `annotateAndBucketEvents(events, driverLat, driverLng)` — attaches
      `distance_mi` and `estimated_attendance` fields, sorts NEAR closest-
      first, sorts FAR by impact (high first) then distance.
    - `formatEventsForStrategist(events, snapshot, limit)` — the new event
      formatter. Reuses the existing `filterEventsToTimeWindow` +
      `filterStrategyWorthyEvents` + `batchLookupVenueHours` pipeline.
    - `formatTrafficIntelForStrategist(traffic)` — graceful-degradation
      ladder: full structured data → Gemini analysis → `driverImpact`-only.
    - `formatWeatherForStrategist(weatherCurrent, weatherForecast, timezone)`
      — current `driverImpact` + 6-hour timeline + optional storm warning.
      Fallback: `driverImpact` only when forecast is empty.
  - **`generateImmediateStrategy`** rewritten to use the new helpers. Loads
    prefs, pre-computes all the enriched sections, and interpolates them
    into a new prompt template with:
    - `=== DRIVER CONTEXT ===` — adds `Current position:` label and a
      `Home base:` line (only when home data exists).
    - `=== DRIVER PREFERENCES ===` — new section, single compact line.
    - `=== EARNINGS CONTEXT ===` — new section, pre-computed economics.
    - `=== BRIEFING DATA ===` — now uses `formatTrafficIntelForStrategist`,
      `formatEventsForStrategist`, `formatWeatherForStrategist`.
    - `=== TIME-OF-DAY INTELLIGENCE ===` — unchanged.
    - `=== OUTPUT FORMAT ===` — updated with NEAR/FAR guidance, dollar
      quoting, hour-by-hour phasing, specific-road AVOID instructions, and
      fuel-cost repositioning sanity check directives.
  - **STRATEGY_TACTICAL system prompt** rewritten with five core directives:
    (1) dollar-specific advice, (2) NEAR/FAR event reasoning, (3) hour-by-
    hour phased advice, (4) specific roads from the TRAFFIC block, (5) fuel-
    cost repositioning math.
  - **`runConsolidator`** (daily strategist) mirrored with the same
    enrichments: now parses `briefings.weather_forecast`, loads driver
    preferences, pre-computes the enriched sections, uses the same new
    prompt template (adapted to the 8–12 hour daily output format — 20
    events instead of 15, day-of-week context, phase-by-phase output).
  - **BRIEFING_FALLBACK system prompt** (inside `runConsolidator`) also
    expanded with NEAR/FAR event guidance so the fallback path maintains
    the same mental model when STRATEGY_DAILY fails.

- **`server/lib/briefing/briefing-service.js`** (additive-only): The
  `analyzeTrafficWithGemini` return object now preserves the raw TomTom
  data alongside Gemini's analyzed strings — `incidents[]` (top 20),
  `closures[]` (top 10), `highwayIncidents[]` (top 10), `congestionLevel`,
  `highDemandZones[]`. **Existing callers reading only `briefing`/
  `headline`/`keyIssues`/`avoidAreas`/`driverImpact` see no behavior change.**
  Legacy briefings written before this change lack the new fields; the
  strategist falls back gracefully to `avoidAreas[]` + `keyIssues[]` +
  `driverImpact` (the current behavior).

### Added

- **`server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md`** (new file,
  ~450 lines) — Plan document created per CLAUDE.md Rule 1 BEFORE the code
  changes. Contains: problem statement, design constraints, architectural
  pushback on the owner's suggestion to add columns to `snapshots` (the
  architecturally correct home is `driver_profiles` since these are
  user-level preferences, not snapshot-level), detailed specification of
  all seven enrichments with data sources and fallbacks, schema migration
  SQL as follow-up work, traffic persistence fix rationale, files affected,
  token budget math (~665 tokens added), test strategy (11 integration
  tests), rollback plan, and risks + mitigations.

### Docs

- **`server/lib/ai/providers/README.md`** — Updated with a new "2026-04-11
  STRATEGIST ENRICHMENT" section documenting the seven enrichments, the new
  helper function catalog, and the graceful-degradation ladders. Bumped
  `Last Verified` header.
- **`server/lib/briefing/README.md`** — Added a "Traffic Intelligence
  Persistence (2026-04-11)" subsection documenting the additive return-shape
  change in `analyzeTrafficWithGemini` and why strategist callers benefit.
- **`docs/EVENTS.md`** — Section 10 updated with a note that event distance
  annotation now also happens at the strategist layer (not just Smart Blocks),
  and both use the same 15-mile NEAR/FAR threshold for mental-model
  consistency.
- **`docs/review-queue/pending.md`** *(historical — `pending.md` retired 2026-04-29; current canon: `claude_memory` active rows)* — New entry logging the
  `driver_profiles` schema migration as pending follow-up work. The
  consolidator code falls through to defaults until the migration runs.

### Fixed

- **The strategist no longer operates like a new employee on their first
  day.** Before this change, every strategy call started from zero — no
  driver-specific context, no distance awareness, no earnings math. The
  strategist now receives the same data a seasoned dispatcher would have
  mentally loaded before taking a shift.

- **The driver's vehicle type matters for fuel-cost math.** EV drivers no
  longer get gas-cost-per-mile advice. The `attr_electric` flag on
  `driver_profiles` triggers the EV cost path (~$0.04/mi flat).

- **The strategist and VENUE_SCORER now use the same event mental model.**
  Both tag events with `[NEAR X.Xmi]` or `[FAR X.Xmi]` relative to the
  15-mile supreme distance rule (matching the 2026-04-11 Smart Blocks
  ↔ Event Venue Coordination work).

### Notes — schema migration pending (follow-up)

The new preference columns do not exist on `driver_profiles` yet. The owner
will run the migration separately:

```sql
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS fuel_economy_mpg integer,
  ADD COLUMN IF NOT EXISTS earnings_goal_daily numeric(10,2),
  ADD COLUMN IF NOT EXISTS shift_hours_target numeric(4,1),
  ADD COLUMN IF NOT EXISTS max_deadhead_mi integer;
```

Until the migration runs, `loadDriverPreferences` catches PG error code
`42703` ("column does not exist") and falls through to owner-specified
defaults (`vehicle_class: 'UberX'`, `fuel_economy_mpg: 25`,
`earnings_goal_daily: null`, `shift_hours_target: null`, `max_deadhead_mi: 15`).
After the migration runs, real values flow through automatically. **Zero code
changes required on migration day.**

### Architectural note — master architect pushback

The owner suggested adding the new preference fields to the `snapshots` row
directly, or creating a `driver_preferences` JSONB column on `snapshots`.
I pushed back: these preferences are user-level, not snapshot-level. They
change at most a few times a year. Putting them on every snapshot row
denormalizes data that rarely changes and creates two sources of truth. The
architecturally correct home is `driver_profiles`, matching the existing
convention where `elig_*`, `attr_*`, and `pref_*` all live there. A single
indexed lookup per strategy call costs ~5ms — negligible. Rationale
documented in `STRATEGIST_ENRICHMENT_PLAN.md` section 3.

### Testing

- **Static verification done in this session**: `node --check` passes on
  `server/lib/ai/providers/consolidator.js` and
  `server/lib/briefing/briefing-service.js`.
- **Integration testing (owner to run)** — see
  `STRATEGIST_ENRICHMENT_PLAN.md` section 9 for the 11-test plan covering:
  defaults path, EV path, high-tier vehicle path, NEAR events only, FAR
  event fill, weather forecast, traffic full path, traffic legacy path,
  missing goal, missing profile, system-prompt effect comparison.
- **Manual dispatcher-quality check**: compare strategist output BEFORE and
  AFTER the enrichments for the same snapshot. After: dollar-specific,
  hour-phased, NEAR/FAR aware, fuel-cost aware, driver-personalized. Before:
  generic.

### Token budget

| Enrichment | Tokens added |
|---|---|
| Driver preferences block | ~80 |
| Full traffic intel block | ~60–150 |
| Event distance annotation | ~75 |
| Weather forecast timeline | ~80 |
| Event scale labels | ~60 |
| Home base context | ~40 |
| Earnings math block | ~180 |
| **Total** | **~575–665** |

Target was 500–800 tokens added. Projected is within budget. Pre-enrichment
prompt: 800–1500 tokens. Post-enrichment: 1400–2200 tokens. Well within
context-window limits for modern models.

---

## [Unreleased] — 2026-04-11 (Smart Blocks 15-Mile Rule Restoration)

### Summary

This entry documents a **second revert** on top of the Smart Blocks ↔ Event Venue
Alignment work. The followup fix described in the next entry — which split the
distance rule into *"general venues ≤ 15 mi, event venues ≤ 40 mi"* to make
distant event venues eligible as Smart Blocks recommendations — was itself
wrong. Owner direction: drivers need the **closest** high-impact venues first,
and the 15-mile rule exists precisely to encode that. Expanding the radius for
event venues inverted the core invariant (closest-first) and let VENUE_SCORER
reach for distant arenas at the expense of closer high-impact venues that
would benefit from the same events' surge flow.

The 15-mile rule is restored as the single absolute distance constraint for
ALL venue recommendations, event venues included. Event data remains in the
prompt, but it is now framed as **surge flow intelligence** rather than as a
candidate list.

### Design — NEAR / FAR bucket model

Events are split into two buckets by distance from the driver:

- **NEAR EVENTS (≤ 15 mi):** Candidate venues. If a near event is high-impact
  and starting/ending within the next 2 hours, `VENUE_SCORER` recommends the
  event venue directly with event-specific `pro_tips` (pickup surge timing,
  post-show staging, pre-show drop-off).
- **FAR EVENTS (> 15 mi):** Surge flow intelligence — NOT destinations. They
  violate the 15-mile rule and cannot be recommended. Instead, `VENUE_SCORER`
  uses them to reason about demand **origination**: attendees travel FROM
  hotels, residential areas, and dining clusters NEAR the driver TO the far
  venue. That outflow creates pickup demand within the driver's 15-mile
  radius at the departure end. `VENUE_SCORER` recommends the closest
  high-impact venues in the driver's radius that will benefit from the
  outflow (hotels near on-ramps, dining hubs, residential/entertainment
  centers).

This framing applies uniformly regardless of market size, geography, or
country. A driver in any metro sees the same mechanism.

### Changed

- **`server/lib/venue/enhanced-smart-blocks.js`** —
  - `fetchTodayDiscoveredEventsWithVenue` default `maxDistanceMiles` raised
    from **40 → 60**. The parameter is relabeled from a VENUE_SCORER constraint
    to a "metro context radius" — it only controls what events reach the
    prompt as surge-flow intelligence. 60 miles covers a typical large metro
    with headroom while excluding events from unrelated neighboring metros
    hundreds of miles away. Configurable per caller via the parameter.
  - The haversine distance annotation, closest-first sort, and `_distanceMiles`
    attachment are preserved — they are what powers the NEAR/FAR bucketing
    downstream. Only the default cap and the framing changed.
  - Distance-filter log line now reports near-vs-far split counts explicitly:
    `N state-wide → M within 60mi metro context (X near ≤15mi candidates, Y far >15mi surge intel, dropped K out-of-metro/orphan)`.

- **`server/lib/briefing/filter-for-planner.js :: formatBriefingForPrompt`** —
  Event section rewritten to emit **two bucketed blocks** instead of a single
  flat list. A new constant `NEAR_EVENT_RADIUS_MILES = 15` governs the split.
  - **NEAR EVENTS block** header: `"within N mi of driver — CANDIDATE VENUES"`
    followed by an instruction to recommend the event venue directly with
    event-specific pro_tips when high-impact and starting/ending within the
    next 2 hours. Slice cap: 6 events.
  - **FAR EVENTS block** header: `"beyond N mi — SURGE FLOW INTELLIGENCE, NOT
    destinations"` followed by an explicit `DO NOT recommend these venues`
    instruction and the origination-reasoning guidance (attendees depart FROM
    areas near the driver TO these far venues; recommend the closest high-
    impact venues in the driver's 15 mi radius that will benefit from the
    outflow). Slice cap: 8 events.
  - Rich per-event rendering preserved (venue name, coords, address, start/
    end time, category, attendance, distance from driver).
  - **Unbucketed fallback:** if `_distanceMiles` is not attached (caller did
    not pass driver coords), events render under a neutral header noting that
    the 15-mile rule still applies.

- **`server/lib/strategy/tactical-planner.js`** — Five prompt edits restore
  the 15-mile rule and reframe events as intelligence:
  - **System prompt rule #4** — Added explicit `"WITHIN 15 MILES"` qualifier
    on the event-venue-as-active-demand sub-bullets, plus a new line `"Event
    venues beyond 15 miles are NOT candidates — they are surge flow
    intelligence only."`
  - **System prompt EVENT VENUE PRIORITY → EVENT INTELLIGENCE block** —
    Full replacement. The old "Include 3-4 event venues as PRIMARY
    recommendations" language is gone. New content: `"The 15-mile rule
    OVERRIDES everything. NEVER recommend a venue more than 15 miles from
    the driver, even for events. Two buckets will appear in the user
    message: NEAR EVENTS (≤ 15 mi) are candidate venues; FAR EVENTS (> 15
    mi) are SURGE FLOW INTELLIGENCE. Do NOT recommend far events as
    destinations — instead reason about where their demand originates."`
  - **Outer section header** — `"event venues ARE the primary
    recommendations"` → `"event intelligence for surge-flow reasoning"`.
    Eliminates the framing contradiction between the wrapper and the inner
    block.
  - **User prompt CRITICAL block** — The `"You MUST include AT LEAST 2 of
    those event venues"` imperative is gone. Replaced with: `"Events listed
    above are happening in your metro today. Use them to understand where
    demand surges will come from. They are intelligence, NOT a venue list.
    HARD RULE: All venue recommendations MUST be within 15 miles of the
    driver. No exceptions."` plus explicit NEAR/FAR handling guidance.
  - **Distance rule** — the two-line split (`"General venues ≤ 15 mi, Event
    venues ≤ 40 mi"`) collapsed back into a single supreme constraint:
    `"ALL venue recommendations MUST be within 15 miles of the driver's GPS
    coordinates. This applies to event venues too. If an event is > 15 mi
    away, it is NOT a valid recommendation — it is intelligence about surge
    flow, not a destination."`
  - **Debug log** enhanced to report near-vs-far split counts on every
    VENUE_SCORER call and to tag each sampled event with `[NEAR]` or
    `[FAR]`. Example: `[VENUE_SCORER DEBUG] 22 events in prompt (4 near
    ≤15mi candidates, 18 far >15mi surge intel)`.

### Docs

- **`server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md`** — Added **Section
  13** documenting the second revert. Contains: what the followup got wrong,
  the owner's four-point correction, the NEAR/FAR bucket model with an ASCII
  diagram, the five code changes, a "why the data pipeline stays but the rule
  reverts" rationale, and a closing lesson about the role of the 15-mile rule.

- **`docs/EVENTS.md`** — **Section 10** rewritten. Previous content described
  "event venues as PRIMARY recommendations" with a 15/40 mi distance split;
  new content describes the NEAR/FAR bucket model, the post-revert pipeline
  flow, and points to the plan file for full history. Example-free / global.

- **`server/lib/venue/README.md`** — "Smart Blocks ↔ Event Venue Alignment"
  subsection rewritten to describe the current post-revert behavior: the
  NEAR/FAR bucket model, the post-revert pipeline flow, and why far events
  stay in the prompt even though they cannot be recommended.

- **`server/lib/briefing/README.md`** — "Briefing Filter for Venue Planner"
  section expanded with a new "Event Bucketing in `formatBriefingForPrompt`"
  subsection documenting the NEAR/FAR logic, the `NEAR_EVENT_RADIUS_MILES`
  constant, the slice caps, and the unbucketed fallback path. Global
  example-free rewrite of the Why-This-Matters notes.

- **`docs/architecture/VENUES.md`** — Step 3 comment in the SmartBlocks
  pipeline diagram updated to note that events are distance-annotated + sorted
  closest-first, and that the matcher only finds matches for near-bucket
  events that VENUE_SCORER selected. Section 7 signature reference updated to
  reflect the NEAR/FAR consumption pattern.

### Fixed

- **The closest-first invariant is restored.** The followup fix's split
  distance rule broke it: `VENUE_SCORER` would recommend a distant event
  arena instead of a closer high-impact venue that would benefit from the
  same event's surge flow. With the 15-mile rule restored as absolute,
  closest high-impact venues win uniformly.

- **The doc / code / prompt layers stay coherent.** Previously the docs
  described "event venues as PRIMARY recommendations", the prompt had a split
  distance rule, and the fetch layer defaulted to 40 mi. Three different
  mental models in three layers. After this revert, all three layers describe
  the same NEAR/FAR bucket model.

- **Event data is still fully utilized.** Far events are not discarded — they
  participate in the prompt as surge flow intelligence and inform which of
  the close high-impact venues to prioritize. The model reasons about where
  attendees will depart from, and recommends the venues at the departure end.

### Notes

- **Why 60-mile metro context radius?** The new cap is not a `VENUE_SCORER`
  rule — it only controls what events reach the prompt as surge-flow intel.
  60 mi covers a typical large metro (the farthest point from a reasonable
  snapshot location in a large metropolitan area) with headroom while
  excluding events from unrelated neighboring metros. Tunable per caller via
  the `maxDistanceMiles` parameter; smaller markets or tighter geographies
  can pass a different value without code changes.

- **Why keep `haversineMiles` and `fetchTodayDiscoveredEventsWithVenue`?** The
  distance-annotation pipeline is what powers the NEAR/FAR bucketing in this
  revert. The original mistake was coupling the pipeline's radius cap to the
  venue-eligibility rule. Decoupling them — keep the annotation, revert the
  rule — is the right fix. The 60-mile metro context radius is a *data-layer*
  choice about what's worth reasoning over; the 15-mile rule is a *tactical-
  layer* choice about what a driver should drive to. They shouldn't have
  been the same number.

- **`event-matcher.js` untouched.** The matcher uses `place_id` / `venue_id` /
  name matching; distance plays no role in its logic. Once `VENUE_SCORER`
  picks only ≤ 15-mile venues, the matcher finds matches only for near-bucket
  events that were actually selected — a natural consequence, no code change.

- **Global app framing.** The NEAR/FAR bucket model is distance-based only
  and culture-neutral. A driver in any city with any metro layout sees the
  same mechanism. The DFW-specific illustrative examples in the
  `tactical-planner.js` prompt stay — they help the LLM ground its reasoning
  — but documentation (READMEs, EVENTS.md, this CHANGELOG entry) is written
  abstractly so a reader in any market gets the same conceptual model.

- **Testing.** The revert is code-complete and syntax-verified (`node --check`
  passes on all three modified files). End-to-end verification requires a
  live DB + LLM run with a driver snapshot that has events both within and
  beyond 15 miles. Expected telemetry after this fix:
  1. `[enhanced-smart-blocks] fetchTodayDiscoveredEventsWithVenue: N
     state-wide → M within 60mi metro context (X near ≤15mi, Y far >15mi,
     dropped K)` on every Smart Blocks run.
  2. `[VENUE_SCORER DEBUG] N events in prompt (X near ≤15mi candidates, Y
     far >15mi surge intel)`, plus a 3-event sample with `[NEAR]` / `[FAR]`
     tags.
  3. `VENUE_SCORER` output contains only venues within 15 miles of the
     driver. Distant event venues appear in the FAR bucket of the prompt
     but not in the returned venue list. Closest high-impact near-driver
     venues are consistently selected.
  4. `[event-matcher] ✅ MATCH (place_id): ...` lines appear only for
     near-bucket events that VENUE_SCORER selected.
  5. Regression check: for a driver in a metro with no events today, Smart
     Blocks still returns 4–6 quality general venues with no error.

- **No commit yet.** All changes land in the working tree. The owner reviews
  and commits at their discretion.

---

## [Unreleased] — 2026-04-11

### Summary

This entry documents a **venue address correctness overhaul** for the event discovery pipeline.
The work inverts the previous data-flow model: Google Places API (New) is now the authoritative
source of truth for venue addresses, coordinates, and cities, with Gemini discovery results
treated as untrusted input that must be validated and resolved before persistence.

Two long-standing data quality bugs are fixed at the root rather than patched downstream:

1. **Bad venue addresses** — entries like `"Theatre, Frisco, TX 75034"` (venue name fragment
   leaked into address) or `"Frisco, TX, USA"` (city-only, no street) are now detected and
   re-resolved via a Places API round-trip before they reach `venue_catalog` or
   `discovered_events`.
2. **Duplicate events with title variations** — `"Jon Wolfe"` / `"Jon Wolfe Concert"` /
   `"Jon Wolfe Live"` at the same venue on the same date are now collapsed to a single event,
   and events mis-assigned to mega-venues (e.g., a comedy show placed at Globe Life Field)
   are corrected in favor of smaller, plausible venues.

Work spans inline commit dates `2026-04-10` (pipeline rewrite) and `2026-04-11` (validation
layer + semantic dedup). International address support (German, French, Spanish, UK) is
preserved throughout — validation uses soft signals rather than US-only hard requirements.

### Added

- **`scripts/backfill-venue-addresses.js`** (341 lines) — One-time backfill script to fix
  existing `venue_catalog` rows with wrong addresses/coordinates. Uses a two-pass search
  strategy: an unbiased Places API text query first (lets Google find the canonical match by
  name alone), falling back to a metro-biased query only if the unbiased result is >100km
  from the driver's metro center. Supports `--dry-run`, `--all`, `--limit N`, and
  `--venue "name"` filters. Processes venues in batches of 5 with a 200ms inter-batch delay.
  Cascades `city`/`state`/`address` updates to `discovered_events` rows that reference each
  fixed venue. Distance-sanity check rejects Places results more than 100km from the bias
  center (catches wrong-match errors like `"Rosie McCann's"` in Santa Cruz vs. Frisco).
  Coordinates are rounded to 6 decimal places for consistency with `coord_key` precision.
  Max radius is capped at 50,000 m per Google Places API limits.

- **`server/lib/venue/venue-address-validator.js`** (196 lines) — Lightweight,
  API-call-free address quality validator. Exports `validateVenueAddress({ formattedAddress,
  venueName, lat, lng, city })` returning `{ valid, issues }`, plus a boolean convenience
  wrapper `isAddressValid(formattedAddress, venueName)`. Runs four checks:
  - `ADDRESS_HAS_STREET_NUMBER` (**soft signal**) — flags addresses with no digits at all.
    Soft rather than hard because some international addresses legitimately lack numbers.
  - `ADDRESS_NOT_GENERIC` (**hard fail**) — flags addresses whose first comma-delimited token
    is a generic venue type word (`theatre`, `arena`, `stadium`, `hall`, `club`, ~40 more),
    and also flags addresses that are pure `city, state, country` with no street component.
  - `ADDRESS_HAS_STREET_NAME` (**soft signal**) — flags addresses with no recognized street
    pattern. Street patterns include US/UK/Canada/Australia suffixes (St, Ave, Blvd, Way,
    Mews, Crescent), German (`Straße`, `Weg`, `Platz`, `Allee`), French (`Rue`, `Chemin`,
    `Allée`), and Spanish (`Calle`, `Avenida`, `Paseo`, `Camino`).
  - `COORD_SANITY` (**soft signal, placeholder**) — reserved for a future metro-bounding-box
    lookup; currently a no-op with a TODO.
  - **Scoring:** any hard fail = invalid. Two or more soft-signal failures = invalid. One
    soft failure = valid with warning. Failed validations log
    `[VENUE-VALIDATE] Address quality FAILED for "<name>": <address> — <issues>`.

- **`server/lib/events/pipeline/deduplicateEventsSemantic.js`** (348 lines) — Title-similarity
  event dedup, additive to the existing hash-based dedup. Exports `deduplicateEventsSemantic`,
  `titlesMatch`, and `normalizeTitleForComparison`.
  - `normalizeTitleForComparison(title)` strips quotes, parentheticals, `"at Venue"` / `"- Venue"`
    suffixes, `"Live music: "` prefixes, non-alphanumerics, then pops trailing suffix words
    (`concert`, `live`, `show`, `tour`, `performance`, `experience`, `night`, `standup`,
    `comedy`, `acoustic`, `unplugged`, `in concert`, ~15 total). Example:
    `"Jon Wolfe Concert"` → `"jon wolfe"`.
  - `titlesMatch(a, b)` matches on three levels: exact normalized equality, substring
    containment, and primary-artist match (first segment before `,` or ` & `, with a guard
    that prevents splitting two-word artist names like `"Tito & Tarantula"`).
  - `LARGE_VENUE_PATTERNS` — regex list detecting stadiums, ballparks, coliseums, arenas,
    speedways, convention centers, expo centers, fairgrounds. Used by `scoreEventPreference`
    to prefer specific venues over mega-venues when choosing which duplicate to keep.
  - `scoreEventPreference(event)` — +5 for having `venue_name`, **+10 additional** for
    non-stadium venue, +3 for address, +2 for `place_id`, +1 for start time, +2 if title
    length >20, +1 more if >40. Highest-scored event in each group wins.
  - `sameTimeSlot(a, b, threshold=120)` — same date required; if both have start times,
    compares within a 120-minute window; if one or both lack times, same date is sufficient
    (deliberately conservative — prefer false positive over false negative).
  - O(n²) union-find grouping, acceptable because n is typically 20–60 events per run.

### Changed

- **`server/lib/venue/venue-cache.js`** (+120 lines) — Added `maybeReResolveAddress()`
  as a validation gate on all four `findOrCreateVenue()` return paths: the place-ID cache
  hit, the coord-key cache hit, the fuzzy-name cache hit, and the newly-created venue path.
  The gate validates the venue's `formatted_address` via `validateVenueAddress`; on failure
  it calls `searchPlaceWithTextSearch()` with a 50 km radius, **re-validates the new result**
  (refuses to replace bad with bad), and on success updates `venue_catalog` in place with
  fresh `formatted_address`, `address_1`, `city`, `state`, `zip`, `lat`, `lng`, `coord_key`,
  `place_id`, and `updated_at`. Coordinates are rounded to 6 decimal places. The function is
  non-throwing: any error falls through to returning `null`, which the caller treats as
  "use the original venue record." Imports `validateVenueAddress` from
  `./venue-address-validator.js` and `searchPlaceWithTextSearch` from
  `./venue-address-resolver.js`.

- **`server/lib/briefing/briefing-service.js`** (+172, −65 lines) — **Rewrote the venue
  resolution path inside `fetchEventsForBriefing()`.** The old flow geocoded the event's
  `venue_name` and passed the Gemini-supplied `event.address`/`city`/`state` straight through
  to `findOrCreateVenue` and `discovered_events`. The new flow uses a three-step priority chain:
  1. **Place-ID cache hit** via `lookupVenue({ placeId })` — if Gemini returned a `ChIJ…` ID
     and the venue exists in `venue_catalog` with complete Places API data, use it directly.
  2. **Places API text search** via `searchPlaceWithTextSearch(lat, lng, venue_name, { radius: 50000 })`
     — biased to the driver's snapshot coordinates with a 50 km metro radius. The
     returned `formattedAddress`, `lat`, `lng`, and parsed `city`/`state` become the
     authoritative values passed to `findOrCreateVenue`.
  3. **Geocode fallback** via `geocodeEventAddress` — only if Places API returns nothing.
  - The resolved venue's `formatted_address`, `city`, and `state` are then used both on the
    initial `db.insert(discovered_events).values(...)` **and** on the `onConflictDoUpdate.set`
    branch. The prior bug was that conflict updates still used raw `event.address`, silently
    re-introducing the bad data on every re-discovery. Gemini's `venue_name` is kept as-is
    for display, but address data is taken from `venue_catalog` / Places API.
  - After venue resolution, `validateVenueAddress` is called on the final address for
    monitoring only (the `venue-cache.js` layer already re-resolves bad data upstream). Low-
    quality addresses log a `[VENUE-VALIDATE]` warning scoped to the event title.
  - Added a two-phase dedup at the Gemini merge point in `fetchEventsWithGemini3ProPreview()`.
    Phase 1 is the pre-existing exact-title case-insensitive dedup (renamed target from
    `allEvents` to `rawEvents`). Phase 2 is the new `deduplicateEventsSemantic` call, which
    produces the final `allEvents` and a `mergeLog` written to `briefingLog` for traceability.
  - Changed the post-discovery read query from `eq(city, snapshot.city) AND eq(state, ...)`
    to `eq(state, ...)` alone. Events now store their *venue's actual city* (e.g.,
    `"Fort Worth"`, `"Arlington"`) resolved from Places API, so filtering by the driver's
    snapshot city (`"Dallas"`) would mask all metro events. State-wide filtering is the
    correct granularity for metro-wide discovery.
  - New imports: `lookupVenue` (added to existing `findOrCreateVenue` import),
    `searchPlaceWithTextSearch`, `validateVenueAddress`, `deduplicateEventsSemantic`.

- **`server/api/briefing/briefing.js`** (+21, −4 lines) — Added `deduplicateEventsSemantic`
  as a **read-time safety net** on `GET /events/:snapshotId` for both the local event set
  (after the existing `deduplicateEvents` hash pass) and the market-proxy event set. Logs
  before/after counts as `[BriefingRoute] Semantic dedup: N → M events`. Also mirrors the
  `briefing-service.js` query-by-state change on both `GET /events/:snapshotId` and
  `GET /discovered-events/:snapshotId` — the `eq(discovered_events.city, snapshot.city)`
  predicate is removed from both endpoints.

- **`server/lib/venue/venue-address-resolver.js`** (+29, −12 lines) — Exported
  `searchPlaceWithTextSearch()` (previously module-private) for use by the event pipeline
  and the venue cache validation gate. Added an `options` argument with `radius` defaulting
  to 50 m; callers can pass `{ radius: 50000 }` for metro-wide event discovery versus the
  default 50 m precise-venue-lookup radius. Coordinates returned from Google are now rounded
  to 6 decimal places (`~11 cm` precision) to match `coord_key` storage precision and
  eliminate floating-point noise like `32.782698100000005` drifting in the database.

- **`server/lib/venue/README.md`** (+27 lines) — Added an "Address Quality Validation"
  section documenting the four validator checks, the scoring rules, the two integration
  points (`venue-cache.js findOrCreateVenue` and `briefing-service.js` event pipeline),
  and the global-awareness rationale. Updated the module table to include
  `venue-address-validator.js` and added `searchPlaceWithTextSearch()` to the
  `venue-address-resolver.js` row. Bumped the `Last Verified` header to `2026-04-11`.

- **`server/lib/events/pipeline/README.md`** (+3 lines) — Added `deduplicateEventsSemantic.js`
  to the pipeline file table (listing `deduplicateEventsSemantic`, `titlesMatch`,
  `normalizeTitleForComparison` as exports). Bumped the `Last Verified` header to `2026-04-11`.

### Fixed

- **Venue addresses validated on every insert and update**, not only when Places API first
  runs. Bad cached data (such as `"Frisco, TX, USA"` stored for Globe Life Field, which is
  actually at `"1000 Ballpark Way, Arlington, TX 76011"`) is now caught by
  `maybeReResolveAddress` on the next `findOrCreateVenue` call and corrected in place via a
  Places API round-trip. Root-cause fix, not data patching.

- **Duplicate events across Gemini category searches** are collapsed. Title variants
  (`"Jon Wolfe"` / `"Jon Wolfe Concert"` / `"Jon Wolfe Live"`), multi-performer expansions
  (`"Fatboy Slim"` vs. `"Fatboy Slim, Coco & Breezy, Jay Pryor"`), and case/punctuation drift
  (`"Kathy Griffin Live"` vs. `"Kathy Griffin"`) no longer produce separate rows in
  `discovered_events` or the briefing UI. Dedup runs at both the Gemini merge point (write
  time, in `briefing-service.js`) and at the read endpoint (read time, in `briefing.js`)
  as a defense-in-depth safety net.

- **Events incorrectly assigned to mega-venues** are corrected in favor of the plausible
  venue. When Gemini returns the same event both at a small venue (e.g., `"Jon Wolfe"` at
  Billy Bob's Texas) and at a nearby stadium (e.g., `"Jon Wolfe"` at Globe Life Field), the
  semantic deduper's `scoreEventPreference` scoring (`+10` for non-stadium venue, plus
  bonuses for address, `place_id`, title length) keeps the small-venue version and drops
  the stadium version. The mega-venue list is regex-based: stadiums, ballparks, coliseums,
  arenas, speedways, convention centers, expo centers, fairgrounds.

- **`onConflictDoUpdate` no longer silently reverts corrected venue data.** The insert
  branch already received resolved address/city/state from Places API, but the conflict-
  update branch was re-writing the raw `event.address` from Gemini, so every re-discovery
  wiped out the correction. Both branches now use the same `resolvedAddress`, `resolvedCity`,
  and `resolvedState` values.

- **Metro-wide event discovery no longer drops out-of-city events.** The pre-existing
  `eq(city, snapshot.city)` filter on `GET /events/:snapshotId`, `GET /discovered-events/:snapshotId`,
  and the post-discovery read in `fetchEventsForBriefing` was pre-Places-API — when Gemini's
  guessed city usually matched the driver's snapshot city, it worked by coincidence. Now
  that venues carry their true city from Places API (Arlington, Fort Worth, Frisco for a
  Dallas driver), city-level filtering would mask legitimate metro events. All three queries
  are now state-scoped.

- **Coordinate precision mismatch between `lat`/`lng` and `coord_key`.** Google Places API
  returns arbitrary-precision floats (`32.782698100000005`). These now round to 6 decimal
  places in `searchPlaceWithTextSearch`, `maybeReResolveAddress`, and the backfill script,
  matching `coord_key`'s precision and eliminating a class of cache-miss bugs where two
  stored representations of the "same" coordinate didn't compare equal.

- **Google Places API `radius` upper bound (50,000 m).** The first draft of the backfill
  script passed `100,000`, which the API rejects with a 400 error. Reduced to 50 km, which
  still covers the full DFW metro (Dallas to Fort Worth is ~50 km).

### Notes

- **International support preserved.** The address validator's street-name regex includes
  German (`Straße`, `Weg`, `Platz`, `Allee`), French (`Rue`, `Chemin`, `Allée`), and Spanish
  (`Calle`, `Avenida`, `Paseo`, `Camino`) patterns. Street-number check is a soft signal
  (not a hard fail) because rural/historic international addresses legitimately lack
  numbers. Hard fails only trigger on generic venue words or pure city/state/country
  strings, neither of which is region-specific.

- **Additive, not replacing.** `deduplicateEventsSemantic` runs *after* the existing
  hash-based `deduplicateEvents`, not in place of it. Hash dedup remains the cheap first
  pass for true exact duplicates; semantic dedup catches the variant cases hash dedup
  cannot see.

- **Backfill script is one-time and opt-in.** It is *not* wired into any boot path, cron,
  or route. Run it manually with `node scripts/backfill-venue-addresses.js --dry-run` to
  preview, then without `--dry-run` to commit. Rate-limited to 5 venues per batch with a
  200 ms delay; safe to interrupt and restart.

- **Date provenance.** Inline comments in this set of changes carry two dates:
  `2026-04-10` (initial rewrite of `briefing-service.js` venue pipeline and
  `venue-address-resolver.js` export changes) and `2026-04-11` (the validator, semantic
  deduper, `venue-cache.js` re-resolution gate, and cross-file integration). Listed as a
  single `2026-04-11` changelog entry because that is the completion date; the
  `2026-04-10` work was not independently releasable.

---

## [Unreleased] — 2026-04-11 (Smart Blocks ↔ Event Venue Alignment)

### Summary

This entry documents a **Smart Blocks ↔ discovered events alignment fix** for the
`VENUE_SCORER` pipeline. The Strategy tab and Smart Blocks were producing contradictory
venue lists — Strategy tab said "go to the Majestic Theatre for tonight's show" while
Smart Blocks said "go to Andretti 25 miles north." Events DID reach `VENUE_SCORER`, but
five stacked bugs along the way crippled them before they could influence the venue
selection.

The fix installs event-venue scaffolding at every layer of the pipeline: a new
state-scoped DB query feeds rich event metadata into both the prompt and the matcher,
the VENUE_SCORER prompt is rewritten to include event venues as PRIMARY recommendations,
and the post-VENUE_SCORER matcher is rewritten to use strong identity keys (`place_id`)
instead of fragile address string comparison.

Design constraint honored: "not without losing the best of all." Event venues become
first-class recommendations **without demoting** the best non-event venues. Target
split when events exist: 3–4 event venues + 1–2 general. When no events exist, Smart
Blocks reverts to the previous 4–6 general-venue behavior with no regression.

### Added

- **`server/lib/venue/enhanced-smart-blocks.js` → `fetchTodayDiscoveredEventsWithVenue(state, eventDate)`** — New
  exported helper that fetches today's `discovered_events` state-scoped (not city-scoped)
  with a `LEFT JOIN venue_catalog` on `venue_id`. Returns rows with discovered_events
  fields plus `vc_*` prefixed venue_catalog fields (`vc_place_id`, `vc_venue_name`,
  `vc_formatted_address`, `vc_address`, `vc_city`, `vc_state`, `vc_lat`, `vc_lng`).
  Called once at the top of `generateEnhancedSmartBlocks` and the result is reused by
  both the prompt filter and the post-`VENUE_SCORER` matcher — avoids a redundant DB
  round-trip. Uses `LEFT JOIN` (not inner) so orphan events (null `venue_id` from
  `ON DELETE SET NULL`) still surface with null `vc_*` fields, and consumers fall
  through to discovered_events fields. Non-throwing: any DB error returns `[]` so
  the pipeline degrades gracefully to the event-less code path.

- **`server/lib/venue/SMART_BLOCKS_EVENT_ALIGNMENT_PLAN.md`** (new file, ~400 lines) —
  Plan document with root cause analysis (five stacked bugs), chosen design (Option C —
  fix all 5 bugs with explicit event-venue scaffolding), two rejected alternatives
  (Option A: bypass VENUE_SCORER; Option B: only enrich prompt), files affected, test
  strategy, decisions made without explicit Melody approval, risks + mitigations, and
  rollback plan. Created per CLAUDE.md Rule 1 (planning before implementation) in
  the same directory as `server/lib/venue/README.md`. Status: implementation complete,
  pending Melody's testing approval.

### Changed

- **`server/lib/venue/enhanced-smart-blocks.js`** — Wired `fetchTodayDiscoveredEventsWithVenue`
  call at the top of the `try` block (after `updatePhase 'venues'`). Its result is passed
  as the third arg to `filterBriefingForPlanner(briefing, snapshot, todayEvents)` and as
  the second arg to `matchVenuesToEvents(enrichedVenues, todayEvents)`. Removed the old
  `const eventDate = snapshot.date || new Date().toISOString().slice(0, 10);` line and
  the `await matchVenuesToEvents(enrichedVenues, snapshot.city, snapshot.state, eventDate)`
  4-arg async call. Date computation now uses `snapshot.timezone` via
  `toLocaleDateString('en-CA', { timeZone })` — matches `filter-for-planner.js :: getLocalDate()`
  so both halves of the pipeline agree on "today" in timezone-aware terms.

- **`server/lib/briefing/filter-for-planner.js`** —
  - `filterBriefingForPlanner(briefing, snapshot)` → `filterBriefingForPlanner(briefing, snapshot, todayEvents = null)`.
    When `todayEvents` is provided, it replaces `briefing.events` as the event source and
    bypasses `filterEventsForPlanner` (no further filtering — the caller's state-scoped
    DB query is authoritative). The legacy `briefing.events` code path is kept only for
    back-compat and is unreachable from any live caller (grep confirmed only one caller:
    `enhanced-smart-blocks.js:263`).
  - `formatBriefingForPrompt` now emits multi-line event blocks with venue name, exact
    coordinates (6-decimal), full address, start/end time, category, and expected
    attendance instead of the old single-line `"- ${title} at ${venue} (${time})"`
    format. Header changed from `"TODAY'S EVENTS (prioritize venues near these):"` to
    `"TODAY'S EVENTS (INCLUDE THESE VENUES AS PRIMARY RECOMMENDATIONS — use the exact coords provided):"`
    to eliminate the "near these" geographic-vicinity ambiguity.
  - The legacy helpers `isLargeEvent`, `filterEventsForPlanner`, `LARGE_EVENT_INDICATORS`,
    and `LARGE_EVENT_CATEGORIES` are kept in the file (still exported) for any unmigrated
    consumers but are no longer used by the primary code path.

- **`server/lib/strategy/tactical-planner.js`** — Rewrote the VENUE_SCORER prompt.
  System prompt additions:
  - Rule #4 expanded: `"Focus on venues with ACTIVE demand RIGHT NOW or within the next 2 hours"` with two sub-bullets explicitly stating that event venues with shows starting in the next 2 hours, or events ending in the next hour (pickup surge window), count as ACTIVE demand.
  - New **"EVENT VENUE PRIORITY (2026-04-11)"** block in VENUE SELECTION: "When today's events are listed in the user message below, include 3–4 of those event venues as PRIMARY recommendations. Use the EXACT name and coordinates provided. Set category to the event's category or `'event_venue'`. Write `pro_tips` specific to the event. Fill remaining 1–2 slots with high-quality GENERAL venues near the event cluster."
  - Explicit "When no events are listed: recommend 4–6 general venues as usual (no change from old behavior)." to preserve the event-less regression path.

  User prompt changes:
  - `"Focus on venues with ACTIVE demand RIGHT NOW (not future events)."` → `"Focus on venues with ACTIVE demand RIGHT NOW — venues that are open, or have events starting/ending in the next 2 hours."` The `"(not future events)"` language that was actively discouraging event-venue picks is gone.
  - `"PRIORITIZE venues near today's events listed above."` → a multi-line `CRITICAL:` block instructing the model to `"INCLUDE the event venues themselves as your PRIMARY recommendations"`, use the exact coords and names provided, write event-specific `pro_tips`, and fill remaining 1–2 slots with general venues.

- **`server/lib/venue/event-matcher.js`** — **Full rewrite.** Previous implementation
  used fragile street-address string matching (`addressesMatchStrictly` required exact
  street number + street name equality across two independently-sourced Google address
  strings) and queried the DB internally with a city-scoped filter that carried the same
  bug fixed elsewhere on 2026-04-11. New implementation:
  - Signature: `matchVenuesToEvents(venues, todayEvents)` — synchronous, no DB query.
    Was: `async matchVenuesToEvents(venues, city, state, eventDate)`.
  - Match priority: **(1) `place_id`** (`venue.placeId === event.vc_place_id`, both sides
    Google-sourced, most reliable) → **(2) `venue_id`** (`venue.venue_id === event.venue_id`,
    dormant at current call site since catalog promotion runs later, kept as a defensive
    check) → **(3) substantial name match** (`venueNamesMatch(venue.name, event.vc_venue_name || event.venue_name)`,
    tertiary fallback with ≥50% containment threshold to prevent over-matching short strings).
  - Return shape preserved from the old API: `Map<venueName, EventMatch[]>` where
    `EventMatch = { title, venue_name, event_start_time, event_end_time, category, expected_attendance }`.
    Callers (`enhanced-smart-blocks.js` candidate assembly, `isEventTimeRelevant` filter,
    `venue_events` FK on candidate rows) do not need to change.
  - Logs now show the match type: `[event-matcher] ✅ MATCH (place_id): "..." ↔ "..."` instead of the old `(address)` / `(name)` labels.

- **`server/lib/venue/README.md`** — Added a new "Smart Blocks ↔ Event Venue Alignment (2026-04-11)" section documenting the five bugs, the fix, and the post-fix pipeline flow. Bumped `Last Verified` header to include the Smart Blocks alignment note. Pointer to the plan file.

- **`server/lib/briefing/README.md`** — Fixed a pre-existing doc bug: the `event-matcher.js` row in the Files table had the wrong function name (`matchEventsToVenues` — with the arguments reversed) and pointed to the wrong module location (claimed it lived under `server/lib/briefing/`). Corrected to `matchVenuesToEvents(venues, todayEvents)` with a note that the file lives in `server/lib/venue/`. Updated the `filter-for-planner.js` row with the new 3-arg signature. Updated the usage example + Filtering Rules table to reflect the `todayEvents` preferred path vs. the legacy `briefing.events` path.

- **`docs/architecture/VENUES.md`** — Updated the pipeline diagram's Step 3 comment (was "Link discovered_events to venues by city/state + fuzzy name match" → now "Match via place_id (primary) → venue_id → name fallback") and the section 7 `matchVenuesToEvents` signature reference (was 4-arg async → now 2-arg sync with the new match priority documented inline).

- **`docs/EVENTS.md`** — Added section 10 "Smart Blocks ↔ Event Venue Coordination (2026-04-11)" covering the problem, root cause (all five bugs), the fix at each layer, the post-fix pipeline flow diagram, and the "not without losing the best of all" design constraint. Pointer to the plan, the venue README section, and this changelog entry.

### Fixed

- **Smart Blocks now recommend event venues as first-class candidates.** When discovered
  events exist for today in the driver's metro, the event's actual venue (Majestic
  Theatre, Dallas Comedy Club, Billy Bob's Texas) appears as a Smart Block — not a
  generic venue in the vicinity. Target split: 3–4 event venues + 1–2 general.

- **Metro-wide event matching restored.** Events at Arlington, Fort Worth, Frisco, and
  other metro-outside-snapshot-city venues now surface for a Dallas driver. Previously
  the city-scoping bug in `filter-for-planner.js :: filterEventsForPlanner` and the
  identical bug in `event-matcher.js` meant only literally-in-Dallas events could match.
  Both are now state-scoped, consistent with the three other event queries
  (`briefing-service.js` post-discovery read, `briefing.js /events`, `briefing.js /discovered-events`)
  that were state-scoped in the earlier 2026-04-11 work.

- **Event metadata now attaches to matching candidates reliably.** The `venue_events[]`
  array on `ranking_candidates` rows is now populated via `place_id` matching instead
  of fragile address-string matching. The old implementation had false negatives when
  `venue_catalog.formatted_address` and `enrichVenues` address formatting drifted
  (`"...TX 76011"` vs `"...TX 76011, USA"`); the new implementation compares Google
  Places IDs which are invariant across formatting.

- **VENUE_SCORER prompt no longer contains self-contradicting language.** The previous
  prompt told the model both `"Focus on venues with ACTIVE demand RIGHT NOW (not future events)"`
  and `"PRIORITIZE venues near today's events listed above"` in the same instruction
  block — the first line discouraged event venues while the second weakly encouraged
  them via geographic vicinity. Both lines are now replaced with explicit "include
  event venues as PRIMARY recommendations with 3–4 of your 4–6 slots" language.

- **Pre-existing `server/lib/briefing/README.md` doc bug.** The `event-matcher.js` row
  in the Files table claimed the export was `matchEventsToVenues(events, venues)` —
  wrong function name AND arguments reversed from the actual `matchVenuesToEvents(venues, todayEvents)`.
  Fixed while updating the file. The file's location note (`server/lib/briefing/` vs.
  the actual `server/lib/venue/`) was also wrong; corrected.

### Notes

- **Catalog promotion intentionally NOT reordered.** The naïve fix for Bug 5 (pipeline
  ordering) would be to move `promoteToVenueCatalog` before `matchVenuesToEvents` so
  `venue_id` is available at matching time. I chose not to do this because:
  (a) catalog promotion does DB writes and a DB failure there shouldn't block event
  matching; (b) `place_id` is available earlier (from `enrichVenues`) and is a perfectly
  good strong identity key on its own; (c) reordering has a larger blast radius than
  switching the match key. The `venue_id` branch in `event-matcher.js` is kept as a
  defensive check for any future caller that matches after promotion.

- **No env flag / feature gate.** Per CLAUDE.md: *"Don't use feature flags or backwards-
  compatibility shims when you can just change the code."* The change is purely
  additive on the read path (new helper function, expanded prompt, new matcher logic)
  and the legacy `briefing.events` code path in `filter-for-planner.js` remains
  reachable by any unmigrated caller. Rollback is `git revert` per-step if needed.

- **Two docs-sync side effects fixed in passing.** `docs/architecture/VENUES.md` and
  `server/lib/briefing/README.md` both referenced the old `matchVenuesToEvents`
  signature and/or wrong function names. Per CLAUDE.md Rule 2 (README sync on folder
  modifications) and Rule 9 (zero tolerance for drift between docs and code), I fixed
  both while in the affected files. The `server/lib/briefing/README.md` function-name
  bug (`matchEventsToVenues` with reversed args) was pre-existing and unrelated to
  this work — flagged + fixed.

- **Testing.** I verified static correctness (imports resolve, signatures match at
  every call site, schema column names match `shared/schema.js`, no orphan references
  to removed variables) but I cannot run integration or E2E tests in this session
  without DB + LLM access. The plan document's section 8 lists the manual tests
  Melody should run before considering this done:
  1. Open the Strategy tab for a real session with events. Record the venues it mentions.
  2. Open Smart Blocks for the same session. Verify at least 2/3 of those venues also appear with event badges.
  3. Verify at least one non-event general venue is also in Smart Blocks (quality preservation).
  4. Check server logs — `[event-matcher]` lines should show `(place_id)` or `(venue_id)` match types, not the old `(address)` / `(name)` paths.
  5. Regression check: `GET /events/:snapshotId` still returns correctly.

- **No commit yet.** All changes land in the working tree. Melody reviews and commits
  at her discretion.

### Followup Fix (2026-04-11, same day)

The first implementation above wired the data path correctly — 22 events reached the
VENUE_SCORER prompt via the verified chain — but VENUE_SCORER picked 5 generic restaurants
(Legacy Hall, North Italia, Haywire, Marriott, Renaissance Dallas) instead of any of the
22 event venues. `[event-matcher] No matches for 5 venues against 22 events`. Root cause
was three stacked prompt bugs, not a plumbing bug.

**Bugs that the first attempt missed:**

1. **`tactical-planner.js:242` — `"All venues must be within 15 miles of driver's current GPS coordinates"` hard rule was not modified.** Placed *after* the CRITICAL event-priority block in the user prompt, so it functioned as an overriding absolute constraint. Every DFW event venue (American Airlines Center ~25mi, Fair Park ~28mi, Dickies Arena ~42mi, Billy Bob's Texas ~45mi from Legacy West/Plano) is outside 15 miles. The LLM obeyed the 15-mile rule and fell back to the closest generic venues — exactly what showed up.

2. **`tactical-planner.js:204` — outer section header still said `"prioritize venues near events"`.** The inner `formatBriefingForPrompt` header said `"INCLUDE THESE VENUES AS PRIMARY RECOMMENDATIONS"` but the outer wrapper said `"near events"` — mixed signal. "Near" pushed the LLM toward geographic-vicinity interpretation, contradicting the venue-identity instruction.

3. **`fetchTodayDiscoveredEventsWithVenue` returned events state-wide, unsorted.** With 22 Texas-wide events and `slice(0, 10)` in unsorted DB order, the first 10 could include Austin or Houston events that a Plano driver can never reach. The prompt had no per-event distance signal so the LLM couldn't self-filter.

4. **CRITICAL block used soft "aim for 3-4" language** instead of imperative "MUST include at least 2", which lost the conflict with the 15-mile rule.

**Fix — five changes across three files:**

- **`server/lib/venue/enhanced-smart-blocks.js`** — Added `haversineMiles(lat1, lon1, lat2, lon2)` helper. Extended `fetchTodayDiscoveredEventsWithVenue` signature from `(state, eventDate)` to `(state, eventDate, driverLat, driverLng, maxDistanceMiles = 40)`. When driver coords are provided, computes haversine distance per row, filters to rows within 40 miles, sorts ascending by distance, and attaches `_distanceMiles` to each row. Orphan events (null `venue_id` → null `vc_*` fields) get `Infinity` distance and fall out naturally. Logs `N state-wide → M within 40mi (dropped K far/orphan)`. Call site at `enhanced-smart-blocks.js:263` updated to pass `snapshot.lat`/`snapshot.lng`.

- **`server/lib/briefing/filter-for-planner.js :: formatBriefingForPrompt`** — Shows `— X.X mi from driver` on each event line when `_distanceMiles` is attached. Event block header rewritten from `"INCLUDE THESE VENUES AS PRIMARY RECOMMENDATIONS — use the exact coords provided"` to `"sorted closest-first, all within reachable range. INCLUDE THESE VENUES AS PRIMARY RECOMMENDATIONS — use the exact coordinates shown"` so the LLM knows the list is curated to reachable events.

- **`server/lib/strategy/tactical-planner.js`** — Three prompt edits:
  - Outer section header: `"=== TODAY'S CONTEXT (prioritize venues near events, avoid traffic issues) ==="` → `"=== TODAY'S CONTEXT (event venues ARE the primary recommendations; avoid traffic issues) ==="`.
  - CRITICAL event-priority block strengthened from `"aim for 3-4 of your 4-6 total slots"` to `"You MUST include AT LEAST 2 of those event venues in your 4-6 recommendations. Target: 3-4 event venues + 1-2 general venues."` Hard floor of 2, soft ceiling of 4.
  - Replaced the single `"All venues must be within 15 miles of driver's current GPS coordinates"` line with a two-line split: `"General venues (dining, hotels, shopping, airport) must be within 15 miles of driver's GPS"` + `"Event venues may be up to 40 miles away — drivers WILL travel farther for confirmed event surges. The events above are already pre-filtered to the 40-mile reachable radius, so any event listed is in range."` Under a new `"DISTANCE RULES:"` header.

- **`server/lib/strategy/tactical-planner.js` debug log** — Added right before `callModel('VENUE_SCORER', ...)`. Dumps `briefingContext.events.length` and a 3-sample preview showing `- "title" @ "venue" (distance, state, coords)`. Pure instrumentation, no behavior change. Lets future debugging read the actual event data reaching the prompt without a separate diagnostic pass.

**Why the split 15/40 rule (not just "remove the 15-mile rule"):**

Removing it would be simpler but wrong. General venues (hotels, dining, airport) legitimately benefit from the 15-mile constraint — a driver does NOT want to drive 40 minutes to a hotel when there are closer options. The 15-mile rule is correct *for general venues*; it was just wrong to apply it uniformly. The split preserves the benefit for generals while unblocking event venues.

**Why 40 miles specifically:**

≈50 min of drive in typical DFW traffic, which is the usual breakeven for a single event pickup. Close enough that the drive is justified by an expected surge, far enough to cover the metro from any reasonable snapshot location (Plano to Fort Worth is ~35mi). Configurable via the `maxDistanceMiles` parameter so different markets can tune it without a code change.

**Expected telemetry after the fix (Melody's next run):**

- `[enhanced-smart-blocks] fetchTodayDiscoveredEventsWithVenue: 22 state-wide → ~10-15 within 40mi (dropped ~7-12 far/orphan)` — Austin/Houston events dropped
- `[VENUE_SCORER DEBUG] briefingContext has N events in prompt` — N should be the distance-filtered count
- `[VENUE_SCORER DEBUG] First 3 events in prompt:` — showing the 3 closest
- `VENUE_SCORER returned 4-6 venues` — should include ≥2 from the event list
- `[event-matcher] ✅ MATCH (place_id): "..." ↔ "..."` — matches should now appear

**If this still fails**, the debug log will show the actual event data reaching VENUE_SCORER, so we can diagnose whether the issue is now data (orphan events, missing coords) rather than prompt engineering.

---

[Unreleased]: #unreleased--2026-04-11
