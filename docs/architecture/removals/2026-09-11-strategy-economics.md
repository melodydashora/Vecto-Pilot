# Strategy economics removals — September 11, 2026

Reason: Strategy must use saved driver preferences and sourced prices. Illustrative fare cards, default fuel prices/MPG, default pickup limits, provider-branded eligibility, and invented surge ranges were presented to the model as usable economics. Unknown inputs now remain unknown; explicit goal/hour arithmetic is a target, not an earnings forecast. Model roles and schema are unchanged.

The following former source sections are preserved verbatim before this change. Some retained surrounding lines provide context.

```javascript
 * Generate immediate 1-hour tactical strategy from snapshot + briefing data.
 * NO minstrategy required - STRATEGY_TACTICAL has all the context it needs.
 *
 * 2026-04-11: STRATEGIST ENRICHMENT — the prompt now includes driver preferences
 * (vehicle class, fuel economy, earnings goal), full traffic intel (incidents,
 * closures, high-demand zones), NEAR/FAR event distance annotation, 6-hour
 * weather forecast timeline, event capacity estimates, home base context, and
 * pre-computed earnings math. See server/lib/ai/providers/STRATEGIST_ENRICHMENT_PLAN.md
 * for the full design. All enrichments are ADDITIVE — if a field is null or a
 * schema migration hasn't applied, helpers fall back to sensible defaults.
 *
 * @param {Object} snapshot - Full snapshot row from DB
 * @param {Object} briefing - Briefing data { traffic, events, weather, weather_forecast, news, school_closures, airport }
 */
async function generateImmediateStrategy({ snapshot, briefing }) {

  // 2026-02-17: Use snapshot directly — it has everything resolved from GlobalHeader
  const localTime = formatLocalTime(snapshot);

  try {
    // 2026-04-11: Fetch driver preferences (single indexed lookup, defensive defaults).
    // Returns a well-formed prefs object even when user_id is null, profile is
    // missing, or the migration hasn't run yet.
    const prefs = await loadDriverPreferences(snapshot.user_id);

    // 2026-04-11: Event distance annotation + NEAR/FAR bucketing via the
    // venue_lat / venue_lng already present in briefing.events (from the
    // venue_catalog LEFT JOIN in pipelines/events.js). No new DB query.
    const formattedEvents = await formatEventsForStrategist(briefing.events, snapshot, 15);

    // 2026-04-11: Traffic intelligence — structured incidents/closures/zones
    // when the new traffic shape is present, Gemini analysis fallback otherwise.
    const trafficBlock = formatTrafficIntelForStrategist(briefing.traffic);

    // 2026-04-11: Weather forecast timeline — reads briefing.weather_forecast
    // (already populated upstream, previously unused).
    const weatherBlock = formatWeatherForStrategist(briefing.weather, briefing.weather_forecast, snapshot.timezone);

    // 2026-04-11: Driver preference summary + pre-computed earnings math.
    const driverPrefBlock = buildDriverPreferencesSection(prefs);
    const earningsBlock = buildEarningsContextSection(prefs);
    const homeBaseLine = buildHomeBaseLine(snapshot, prefs);
=== OUTPUT FORMAT (no asterisks or bold in content — only section labels are bold) ===

**GO:** Where to position — cluster near events/venues, not isolated spots. Quote expected earnings: "$X-Y in surge rides" where appropriate.
**AVOID:** Roads/areas with incidents or competition — name specific road names from the TRAFFIC block.
**WHEN:** Hour-by-hour timing window — consider event END times for exit surge, not just starts. Phase the night if multiple events have different exit windows.
**WHY:** Which specific event/condition is driving this recommendation — reference the NEAR event or the FAR event whose surge flow you're catching.
**IF NO PING:** Wait X minutes, then backup plan — nearby cluster, or head home with destination filter on. Include a fuel-cost sanity check: "Drive to X (12mi, ~$2.40 fuel) for $40-60 surge rides."
**INTEL:** 2-3 sentences of additional context — competitive landscape, upcoming demand shifts, airport opportunities, weather changes, or anything from news that affects the next few hours.

PRINCIPLES:
- DOLLAR-SPECIFIC ADVICE: You have the driver's vehicle class, fuel cost per mile, and earnings goal. Quote dollar figures. "Drive to X (~$2.40 fuel) for $40-60 surge rides" beats "go north."
- NEAR vs FAR EVENTS: Events tagged [NEAR] are within 15mi — recommend them directly with pickup/drop-off pro-tips. Events tagged [FAR] are beyond 15mi — treat as SURGE FLOW INTELLIGENCE only: fans travel FROM hotels/dining/residential clusters near the driver TO the distant event, and that outflow creates pickup demand near the driver. Recommend the closest high-impact venues in the 15-mile radius that benefit from the outflow. NEVER recommend a [FAR] event venue as a destination.
- HOUR-BY-HOUR PHASING: When multiple events have different start/end times, phase the advice. "7-8pm: [NEAR] theater at 7:30 — drop-off surge. 9-10pm: stage at hotel cluster for the [FAR] sports game end — fans from the hotels will ride back."
- ROAD-SPECIFIC AVOID: Name the specific roads and distances from the TRAFFIC block. "Avoid I-35 near exit 428 (3.2mi, closed)."
- FUEL-COST REPOSITIONING: Before recommending a long reposition, compute whether it's worth it: drive distance × fuel cost/mi should be << expected surge revenue.
- NEVER include raw latitude/longitude coordinates in the strategy text. Always refer to locations by name — venue names, neighborhood names, intersection names ("Preston Road and Coit Road"), or landmark names. Coordinates are for internal use only and must never appear in user-facing text.
- Verify timing: cross-reference news published dates against current time — yesterday's surge is over, do not recommend stale opportunities.
- Event END times create bigger surge than start times — crowds leaving = ride demand.
- Stay in clusters (nightlife districts, hotel zones, event complexes) — do not send the driver to isolated one-off venues.
- If nothing is nearby and demand is low, it is OK to recommend heading home when fuel cost is material. The driver's max_deadhead_mi limits unpaid pickup miles; it is not a radius from home or an instruction to infer the driver's destination.
- Factor in competitive landscape — if autonomous vehicles or new services operate in specific zones, note the impact on demand.
- Reference specific data from the briefing (event names, road names, times).
- Do not use asterisks, bold, or markdown formatting inside the content text — only the section labels (GO, AVOID, WHEN, WHY, IF NO PING, INTEL) should be bold.`;


    // 2026-02-26: Uses STRATEGY_TACTICAL role via callModel adapter (Claude Opus)
    // 2026-04-11: System prompt expanded with the 5 owner directives (dollar-specific
    // advice, NEAR/FAR event reasoning, hour-by-hour phasing, specific roads, fuel-cost
    // repositioning math).
    const response = await callModel('STRATEGY_TACTICAL', {
      system: `You are the Rideshare Strategist Dispatch Authority. A driver and their family depend on the quality of your guidance. You have access to real-time traffic, events, weather, airport conditions, news, AND the driver's preferences (vehicle type, fuel costs, earnings goal, home base). Every recommendation must be actionable, specific, and dollar-aware.

CORE DIRECTIVES:
- You have the driver's vehicle type, fuel costs, and earnings goal. Use these to give DOLLAR-SPECIFIC advice. Quote expected earnings and fuel costs in your recommendations. "Drive to X (12mi, ~$2.40 fuel) for $40-60 in surge rides" beats "go north for surge."
- Every event has a distance from the driver. Events tagged [NEAR] are within 15 miles — recommend them directly as destinations with event-specific pro-tips. Events tagged [FAR] are beyond 15 miles — use them as SURGE FLOW INTELLIGENCE only: fans travel FROM hotels, dining clusters, and residential areas near the driver TO the distant event, and that outflow creates pickup demand NEAR the driver at the departure end. Recommend the closest high-impact venues within 15 miles that will benefit from the outflow. NEVER recommend a [FAR] event venue as a destination — it violates the closest-first invariant.
- Give hour-by-hour phased advice when multiple events have different start/end times. Phase the shift: what to do now, at 7pm, at 9pm, at 11pm.
- Name specific roads and intersections to avoid and specific named areas to stage. Use the TRAFFIC block's AVOID and CLOSURES rows verbatim when relevant.
- Include fuel cost estimates for any repositioning move. A 12-mile drive at 25 mpg and $3.50/gal costs ~$1.70 in fuel — factor that against expected surge revenue before recommending the drive.
- Attendance numbers are heuristic estimates only — never cite attendance numbers, crowd sizes, or capacity figures to the driver. Reason about event impact qualitatively using the high/medium/low demand signal. Use phrases like 'high-demand concert' or 'private event energy' instead of fabricated numbers.

You understand demand patterns: events create surge at END times (exit crowds), airports follow flight schedules, nightlife clusters outperform isolated venues, and sometimes the smartest move is heading home with destination filter on. Every recommendation directly impacts someone's livelihood. Be precise, be honest, be actionable, be dollar-aware.`,
//
// The schema migration (add 4 columns to driver_profiles) is documented in
// the plan file section 5 and docs/review-queue/pending.md as follow-up work.
// Until it runs, all new preference fields fall through to owner-specified
// defaults. After it runs, real values are picked up automatically.
/** Sensible defaults for driver preferences (plan file section 4). */
// 2026-04-16: Exported for reuse by tactical-planner.js (driver preference scoring)
export const DRIVER_PREF_DEFAULTS = Object.freeze({
  fuel_economy_mpg: 25,
  earnings_goal_daily: null,
  shift_hours_target: null,
  max_deadhead_mi: 15,
  vehicle_class: 'UberX',
});

/**
 * Default rate cards by vehicle class. Illustrative baselines labeled as
 * "estimated" in the prompt — replaceable whenever live market rates are wired
 * in. Keys match the vehicle_class values deriveVehicleClass() returns.
 */
const RATE_DEFAULTS = Object.freeze({
  'UberX':          { perMile: 0.80, perMin: 0.20 },
  'Uber Comfort':   { perMile: 1.20, perMin: 0.25 },
  'UberXL':         { perMile: 1.00, perMin: 0.22 },
  'UberXXL':        { perMile: 1.10, perMin: 0.24 },
  'Uber Black':     { perMile: 2.50, perMin: 0.50 },
  'Uber Black SUV': { perMile: 3.50, perMin: 0.70 },
});

// Default gas price per gallon for fuel cost math (replaceable via env var).
const DEFAULT_GAS_PRICE = Number(process.env.GAS_PRICE_DEFAULT || 3.50);
// Electric vehicle cost per mile (covers typical electricity cost for rideshare EVs).
const EV_COST_PER_MILE = 0.04;
// NEAR/FAR distance threshold — matches VENUE_SCORER's 15-mile rule so the
// strategist and Smart Blocks pipeline share a consistent mental model.
const NEAR_EVENT_RADIUS_MILES = 15;

/**
 * Derive the driver's primary vehicle class from driver_profiles.elig_*
 * booleans. Highest-tier-eligible wins. The class name is also the key into
 * RATE_DEFAULTS, so earnings math lines up with whatever class we derive.
 */
function deriveVehicleClass(profile) {
  if (!profile) return DRIVER_PREF_DEFAULTS.vehicle_class;
  if (profile.elig_luxury_suv)   return 'Uber Black SUV';
  if (profile.elig_luxury_sedan) return 'Uber Black';
  if (profile.elig_xxl)          return 'UberXXL';
  if (profile.elig_xl)           return 'UberXL';
  if (profile.elig_comfort)      return 'Uber Comfort';
  if (profile.elig_economy)      return 'UberX';
  return DRIVER_PREF_DEFAULTS.vehicle_class;
}

/**
 * Load a normalized driver_preferences object for a user. Always returns a
 * well-formed object even when:
 *   - user_id is null
 *   - driver_profiles row doesn't exist
 *   - schema migration hasn't applied (new columns missing, PG error 42703)
 *   - any other DB error
 *
 * Defaults are applied for fields that are null or unavailable. Callers get a
 * consistent shape regardless of schema state.
 */
// 2026-04-16: Exported for reuse by tactical-planner.js (driver preference scoring)
export async function loadDriverPreferences(userId) {
  const prefs = {
    vehicle_class: DRIVER_PREF_DEFAULTS.vehicle_class,
    fuel_economy_mpg: DRIVER_PREF_DEFAULTS.fuel_economy_mpg,
    earnings_goal_daily: DRIVER_PREF_DEFAULTS.earnings_goal_daily,
    shift_hours_target: DRIVER_PREF_DEFAULTS.shift_hours_target,
    max_deadhead_mi: DRIVER_PREF_DEFAULTS.max_deadhead_mi,
    is_electric: false,
    home_lat: null,
    home_lng: null,
    home_formatted_address: null,
    driver_nickname: null,
    rideshare_platforms: null,
    profile_loaded: false,
    migration_applied: false,
  };

  if (!userId) return prefs;

  try {
    // First try: full SELECT (assumes migration has run).
    // On PG error 42703 ("column does not exist"), fall back to the safe column set.
    let row = null;
    try {
      const rows = await db.select().from(driver_profiles)
        .where(eq(driver_profiles.user_id, userId))
        .limit(1);
      row = rows[0] || null;
      prefs.migration_applied = true;
    } catch (err) {
      const pgCode = err?.cause?.code || err?.original?.code || err?.code;
      const msg = err?.cause?.message || err?.message || '';
      if (pgCode === '42703' || /column.*does not exist/i.test(msg)) {
        // Schema migration hasn't applied — select only columns known to exist.
        const rows = await db.select({
          user_id: driver_profiles.user_id,
          first_name: driver_profiles.first_name,
          driver_nickname: driver_profiles.driver_nickname,
          home_lat: driver_profiles.home_lat,
          home_lng: driver_profiles.home_lng,
          home_formatted_address: driver_profiles.home_formatted_address,
          market: driver_profiles.market,
          rideshare_platforms: driver_profiles.rideshare_platforms,
          elig_economy: driver_profiles.elig_economy,
          elig_xl: driver_profiles.elig_xl,
          elig_xxl: driver_profiles.elig_xxl,
          elig_comfort: driver_profiles.elig_comfort,
          elig_luxury_sedan: driver_profiles.elig_luxury_sedan,
          elig_luxury_suv: driver_profiles.elig_luxury_suv,
          attr_electric: driver_profiles.attr_electric,
        }).from(driver_profiles)
          .where(eq(driver_profiles.user_id, userId))
          .limit(1);
        row = rows[0] || null;
        prefs.migration_applied = false;
      } else {
        throw err;
      }
    }

    if (!row) return prefs;

    prefs.profile_loaded = true;
    prefs.vehicle_class = deriveVehicleClass(row);
    prefs.is_electric = !!row.attr_electric;
    prefs.home_lat = row.home_lat;
    prefs.home_lng = row.home_lng;
    prefs.home_formatted_address = row.home_formatted_address;
    prefs.driver_nickname = row.driver_nickname || row.first_name || null;
    prefs.rideshare_platforms = row.rideshare_platforms || null;

    // New preference fields — only present when migration has applied.
    if (prefs.migration_applied) {
      if (row.fuel_economy_mpg != null) prefs.fuel_economy_mpg = row.fuel_economy_mpg;
      if (row.earnings_goal_daily != null) prefs.earnings_goal_daily = Number(row.earnings_goal_daily);
      if (row.shift_hours_target != null) prefs.shift_hours_target = Number(row.shift_hours_target);
      if (row.max_deadhead_mi != null) prefs.max_deadhead_mi = row.max_deadhead_mi;
    }

    return prefs;
  } catch (err) {
    aiLog.warn(1, `[strategist-enrichment] loadDriverPreferences failed for ${userId}: ${err.message}`, OP.DB);
    return prefs;
  }
}

/**
 * Compute per-mile fuel/energy cost based on vehicle type and preference data.
 * Returns the cost as a number (dollars per mile).
 */
function computeFuelCostPerMile(prefs) {
  if (prefs.is_electric) return EV_COST_PER_MILE;
  const mpg = Math.max(prefs.fuel_economy_mpg, 1);
  return DEFAULT_GAS_PRICE / mpg;
}

/**
 * Build the DRIVER PREFERENCES prompt section (single compact line).
 * Token budget: ~80 tokens.
 */
// 2026-04-16: Exported for reuse by tactical-planner.js (driver preference scoring)
export function buildDriverPreferencesSection(prefs) {
  const fuelType = prefs.is_electric ? 'electric' : 'gas';
  const mpgDisplay = prefs.is_electric ? 'n/a (EV)' : `${prefs.fuel_economy_mpg} mpg`;
  const perMileCost = computeFuelCostPerMile(prefs);
  const goalDisplay = prefs.earnings_goal_daily != null
    ? `$${prefs.earnings_goal_daily.toFixed(0)}`
    : 'not set';
  const hoursDisplay = prefs.shift_hours_target != null ? `${prefs.shift_hours_target}` : 'not set';

  return `Vehicle: ${prefs.vehicle_class} | Fuel economy: ${mpgDisplay} (${fuelType}) | Cost/mile: ~$${perMileCost.toFixed(2)} | Today's goal: ${goalDisplay} in ${hoursDisplay} hours | Max unpaid pickup distance: ${prefs.max_deadhead_mi} mi`;
}

/**
 * Build the EARNINGS CONTEXT prompt section — pre-computed economics the
 * strategist can quote directly. Omits the required-$/hr line when goal/hours
 * are not set. Token budget: ~180 tokens.
 */
function buildEarningsContextSection(prefs) {
  const rate = RATE_DEFAULTS[prefs.vehicle_class] || RATE_DEFAULTS['UberX'];
  const perMileCost = computeFuelCostPerMile(prefs);
  const netPerMile = rate.perMile - perMileCost;

  const lines = [];
  lines.push(`Vehicle class: ${prefs.vehicle_class} | Estimated rate: ~$${rate.perMile.toFixed(2)}/mi + $${rate.perMin.toFixed(2)}/min`);
  if (prefs.is_electric) {
    lines.push(`Fuel cost: ~$${EV_COST_PER_MILE.toFixed(2)}/mi (electric)`);
  } else {
    lines.push(`Fuel cost: $${DEFAULT_GAS_PRICE.toFixed(2)}/gal ÷ ${prefs.fuel_economy_mpg} mpg = ~$${perMileCost.toFixed(2)}/mi (gas)`);
  }
  lines.push(`Net per mile: ~$${netPerMile.toFixed(2)}/mi`);
  if (prefs.earnings_goal_daily != null && prefs.shift_hours_target != null && prefs.shift_hours_target > 0) {
    const perHourGross = prefs.earnings_goal_daily / prefs.shift_hours_target;
    lines.push(`To earn $${prefs.earnings_goal_daily.toFixed(0)} in ${prefs.shift_hours_target}hrs: need ~$${perHourGross.toFixed(0)}/hr gross`);
  }
  lines.push(`Surge multiplier on event nights: typically 1.5-3x in the first 30 min after major event end times`);
  return lines.join('\n');
}

/**
 * Build the home-base context line. Returns null when home fields are not
 * populated (caller omits the line entirely). The strategist should interpret
 * absence as "use current position as home."
 */
function buildHomeBaseLine(snapshot, prefs) {
  if (prefs.home_lat == null || prefs.home_lng == null) return null;
  const distFromHome = haversineMiles(snapshot.lat, snapshot.lng, prefs.home_lat, prefs.home_lng);
  const distDisplay = Number.isFinite(distFromHome)
    ? ` — ${distFromHome.toFixed(1)} mi from current position`
    : '';
  const homeAddress = prefs.home_formatted_address
    || `${Number(prefs.home_lat).toFixed(6)}, ${Number(prefs.home_lng).toFixed(6)}`;
  return `Home base: ${homeAddress}${distDisplay}`;
```
