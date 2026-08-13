// server/lib/offers/rules-engine.js
// 2026-06-20: Single source of truth for Offer Analyzer decision rules.
// 2026-07-03: SCHEMA v3 (todo #10) — per-driver DB-backed rules covering Melody's
// full verbatim spec (docs/OFFER_ANALYZER_DRIVER_RULESET.md). Design:
// docs/architecture/OFFER_RULESET_V3_DESIGN.md.
//
// WHY THIS EXISTS
// Before 2026-06-20 the rules lived in TWO places that drifted (see
// docs/architecture/OFFER_ANALYZER_EDITOR_PLAN.md §1.1):
//   1. the English Phase-1 prompt (PHASE1_PROMPTS in analyze-offer.js), and
//   2. the deterministic JS fallback ladder (analyze-offer.js).
// This module makes ONE config object the source: it RENDERS the prompts AND
// DRIVES the deterministic evaluator, so the lanes can never drift.
//
// TWO ENFORCEMENT LANES (v3):
//   - Vision-judgment rules (signal exists only in the screenshot: road types,
//     "On the way", the "…" map marker, Verified badge, stops, round trip,
//     avoid-place geography) are RENDERED into the prompts.
//   - Deterministic rules (floors, ladders, pickup/time limits, acceptance-rate
//     protection) are ALSO evaluated in code — the ground truth for arithmetic.
//   Geography additionally gets a deterministic Phase-2 audit once dropoff
//   coordinates exist (evaluateGeoRules), recording vision/geometry disagreements.
//
// PARITY: DEFAULT_RULESET reproduces the *decisions* of the legacy JS fallback
// exactly (proven by tests/offers/rules-engine-parity.test.js across a dense
// grid of per_mile × minutes × rating), and buildPhase1Prompt(tier, DEFAULT_RULESET)
// is BYTE-IDENTICAL to the legacy prompts (pinned in the same test). Every v3
// field is render-inert and decision-inert at its default value.
//
// Determinism doctrine (CLAUDE.md): integer minute cutoffs are stored inclusive
// (minutes are integers), e.g. legacy "<30 min" === max_total_min: 29. Avoid-place
// identity is Google place_id with 6-decimal coords — never name matching, never
// hardcoded locations (all places are user-entered data).

import { classifyTier as classifyTierByProduct, PREMIUM_PRODUCTS } from './parse-offer-text.js';
import { haversineDistanceMiles, bearingDegrees, bearingDiffDegrees } from '../location/geo.js';

export const RULESET_SCHEMA_VERSION = 3;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * DEFAULT_RULESET — decision-equivalent to the legacy analyze-offer.js fallback.
 *
 * Ladder semantics: first-match-wins. A rung ACCEPTs when
 *   per_mile >= min_per_mile
 *   AND (min_per_minute == null || per_minute >= min_per_minute)     // NEW v3
 *   AND (min_total_min == null || total_min >= min_total_min)        // inclusive
 *   AND (max_total_min == null || total_min <= max_total_min)        // inclusive
 * Below floor_per_mile → REJECT. No rung matches → REJECT
 * ("too far" when total_min > 40, else "low") — mirrors legacy exactly.
 *
 * v3 additions are ALL inert here (null/false/[]): they exist so per-driver
 * configs can enable them, and so the editor UI has a complete shape to render.
 */
export const DEFAULT_RULESET = {
  schema_version: RULESET_SCHEMA_VERSION,

  // Which leg the $/mi and $/min comparisons measure.
  //   'full_ride'   → total_miles / total_minutes (includes the pickup deadhead) [LEGACY]
  //   'active_time' → ride_miles  / ride_minutes  (Uber's "active time", trip only)
  basis: 'full_ride',

  global: {
    rating_floor: 4.85,       // REJECT if a rider rating is visible and below this
    require_verified: true,   // prompt-only gate (no reliable deterministic signal)

    // ── v3 (inert defaults) ────────────────────────────────────────────────
    // { max_miles: 3, max_minutes: 8 } — REJECT long pickups (spec: Pickup Limits)
    pickup_limits: null,
    // { max_total_minutes: 20, unless: { min_per_mile: 2.00, min_per_minute: 1.00 } }
    // REJECT overlong rides unless the pay conjunction holds (spec: Time Limits)
    time_limit: null,
    // { min_per_total_mile: 1.00 } — ACCEPT (FALLBACK) after the ladder fails,
    // when no other reject gate fired (spec: Acceptance Rate Protection)
    acceptance_rate_protection: null,
    // { multiple_stops: true, round_trip: true } — vision-judgment lane
    auto_reject: null,
    // Vision lane: reject rides needing dirt/gravel/unpaved/ranch/oil-field/
    // off-road access, flooded crossings, closures, inaccessible gated areas
    safety_road_types: false,
    // Vision lane: near commercial hubs, do not penalize short trips
    commercial_staging: false,
    // { verified_rider: true, on_the_way_filter: true, deadhead_reduction: true }
    // — mention-if-present notices ("Filter Detected", the "…" marker, etc.)
    notices: null,
  },

  share: { auto_reject: true },

  tiers: {
    standard: {
      floor_per_mile: 0.90,
      floor_per_minute: null,
      accept_ladder: [
        { min_per_mile: 0.90, max_total_min: 20 },
        { min_per_mile: 1.10, max_total_min: 25 },
        { min_per_mile: 1.75, max_total_min_excl: 30 },             // legacy "< 30"
        { min_per_mile: 2.00, min_total_min: 30, max_total_min: 40 },
        { min_per_mile: 2.00, min_total_min_excl: 40 },             // legacy "> 40"
      ],
    },
    premium: {
      floor_per_mile: 1.10,
      floor_per_minute: null,
      accept_ladder: [
        { min_per_mile: 1.10, max_total_min: 25 },
        { min_per_mile: 1.40, max_total_min: 30 },
        { min_per_mile: 1.75, max_total_min: 40 },
        { min_per_mile: 2.00, min_total_min_excl: 40 },             // legacy "> 40"
      ],
    },
    // v3: optional premium split-outs. When non-null, classifyTier routes matching
    // products here (spec: Comfort $1.25/mi + $0.70/min, XL $2.00/mi + ~$1/min).
    comfort: null,
    xl: null,
  },

  // v3: when set, overrides which canonical product names route to comfort/xl:
  // { comfort: ["Comfort"], xl: ["UberXL", "UberXL Exclusive", "Lyft XL", ...] }
  tier_products: null,

  // Geo-scoped overrides. Each scope, when enabled, shallow-overrides `basis`,
  // `global`, and per-tier fields. Scope is resolved by the CALLER and passed
  // into the engine; all disabled by default → base rules apply.
  geo: {
    home_city:  { enabled: false, overrides: {} },
    other_city: { enabled: false, overrides: {} },
    airport:    { enabled: false, overrides: {} },
  },

  // v3: CONSUMED (was declared-but-inert in v2). User-entered places to avoid.
  // Identity is a Google place_id (determinism doctrine). Shape:
  //   { place_id, label, lat, lng, enabled,
  //     mode: 'destination_in' | 'heads_toward' | 'north_of' | 'south_of',
  //     radius_mi?,        // destination_in (default 6)
  //     corridor_deg?,     // heads_toward: ±deg around pickup→anchor bearing (default 30)
  //     min_trip_mi? }     // heads_toward: ignore short hops (default 8)
  // Rendered into prompts by label (vision lane) AND audited deterministically
  // in Phase 2 once dropoff coords are geocoded (evaluateGeoRules).
  avoid: [],

  // v3: home-base deadhead policy. Home coordinates come from the driver's
  // profile (driver_profiles.home_lat/home_lng — set at signup), NEVER from here.
  // { deadhead_only: true, mention_threshold_min: 20 } (spec: Home Logic)
  home: null,
};

// 2026-08-11: DEFAULT_RULESET is handed out BY REFERENCE to every untokened
// request (ruleset-store.js). Deep-freeze makes accidental in-place mutation —
// which would contaminate every driver at once — throw instead of corrupt.
function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}
deepFreeze(DEFAULT_RULESET);

/**
 * Default premium split when comfort/xl tiers are enabled but tier_products is
 * not customized. Canonical product names from parse-offer-text.js.
 */
export const DEFAULT_COMFORT_PRODUCTS = ['Comfort'];
export const DEFAULT_XL_PRODUCTS = ['UberXL', 'UberXL Exclusive', 'Lyft XL', 'VIP', 'Black', 'Lyft Lux', 'Lyft Black'];

/**
 * Upgrade any stored config (v1/v2/v3-partial) to the full v3 shape.
 * Absent keys get inert defaults — a migrated v2 config decides identically.
 * Always safe to call on already-v3 configs (idempotent).
 */
export function migrateRuleset(config) {
  const d = DEFAULT_RULESET;
  if (!config || typeof config !== 'object') {
    return JSON.parse(JSON.stringify(d));
  }
  return {
    schema_version: RULESET_SCHEMA_VERSION,
    basis: config.basis === 'active_time' ? 'active_time' : 'full_ride',
    global: { ...d.global, ...(config.global || {}) },
    share: { ...d.share, ...(config.share || {}) },
    tiers: {
      standard: cloneTier(config.tiers?.standard) || cloneTier(d.tiers.standard),
      premium: cloneTier(config.tiers?.premium) || cloneTier(d.tiers.premium),
      comfort: cloneTier(config.tiers?.comfort) || null,
      xl: cloneTier(config.tiers?.xl) || null,
    },
    tier_products: config.tier_products
      ? {
          comfort: [...(config.tier_products.comfort || [])],
          xl: [...(config.tier_products.xl || [])],
        }
      : null,
    geo: {
      home_city: { enabled: false, overrides: {}, ...(config.geo?.home_city || {}) },
      other_city: { enabled: false, overrides: {}, ...(config.geo?.other_city || {}) },
      airport: { enabled: false, overrides: {}, ...(config.geo?.airport || {}) },
    },
    avoid: Array.isArray(config.avoid) ? config.avoid.map((a) => ({ ...a })) : [],
    home: config.home ? { ...config.home } : null,
  };
}

/**
 * Classify a product type into a decision tier.
 * v3: ruleset-aware — when the ruleset enables comfort/xl tiers, premium products
 * route to them (tier_products override, else the DEFAULT_*_PRODUCTS split).
 * With a default ruleset this reduces exactly to the legacy share/standard/premium.
 * @returns {"share"|"standard"|"premium"|"comfort"|"xl"}
 */
export function classifyTier(productType, ruleset = DEFAULT_RULESET) {
  const base = classifyTierByProduct(productType);
  if (base !== 'premium') return base;

  const tiers = ruleset?.tiers || {};
  const custom = ruleset?.tier_products;
  const inXl = custom ? (custom.xl || []).includes(productType) : DEFAULT_XL_PRODUCTS.includes(productType);
  const inComfort = custom ? (custom.comfort || []).includes(productType) : DEFAULT_COMFORT_PRODUCTS.includes(productType);

  if (tiers.xl && inXl) return 'xl';
  if (tiers.comfort && inComfort) return 'comfort';
  return 'premium';
}

/**
 * Apply the matching geo scope (if any) on top of the base ruleset.
 * v3: tier iteration is dynamic (null tiers skipped) so comfort/xl participate
 * when enabled without touching the standard/premium behavior.
 * @param {object} ruleset
 * @param {{scope?: 'home_city'|'other_city'|'airport'|null}} [context]
 * @returns {{basis, global, share, tiers}} effective ruleset slice
 */
export function resolveScopedRuleset(ruleset, context = {}) {
  const tierNames = Object.keys(ruleset.tiers || {}).filter((t) => ruleset.tiers[t]);
  const base = {
    basis: ruleset.basis ?? 'full_ride',
    global: { ...ruleset.global },
    share: { ...ruleset.share },
    tiers: {},
  };
  for (const name of tierNames) {
    base.tiers[name] = cloneTier(ruleset.tiers[name]);
  }

  const scope = context.scope;
  const geo = scope ? ruleset.geo?.[scope] : null;
  if (!geo || !geo.enabled || !geo.overrides) return base;

  const o = geo.overrides;
  if (o.basis) base.basis = o.basis;
  if (o.global) base.global = { ...base.global, ...o.global };
  for (const tierName of tierNames) {
    if (o.tiers?.[tierName]) {
      base.tiers[tierName] = { ...base.tiers[tierName], ...o.tiers[tierName] };
    }
  }
  return base;
}

function cloneTier(tier) {
  if (!tier) return undefined;
  return {
    floor_per_mile: tier.floor_per_mile,
    floor_per_minute: tier.floor_per_minute ?? null,
    accept_ladder: (tier.accept_ladder || []).map((r) => ({ ...r })),
  };
}

/**
 * Compute the effective $/mi, $/min, and minutes for the configured basis.
 * Mirrors parse-offer-text.js rounding so per_mile equals the stored value
 * under the default 'full_ride' basis (parity).
 *
 * @param {object} raw - pre-parsed offer: { price, total_miles, total_minutes, ride_miles, ride_minutes, per_mile, per_minute }
 * @param {string} basis - 'full_ride' | 'active_time'
 */
export function deriveEffectiveMetrics(raw, basis = 'full_ride') {
  const useActive = basis === 'active_time';
  const miles = useActive ? raw.ride_miles : raw.total_miles;
  const minutes = useActive ? raw.ride_minutes : raw.total_minutes;

  // Under full_ride we prefer the already-stored per_mile/per_minute (identical
  // formula) so nothing shifts due to re-rounding; otherwise recompute.
  const perMile = (!useActive && raw.per_mile != null)
    ? raw.per_mile
    : (raw.price != null && miles > 0 ? round2(raw.price / miles) : null);
  const perMinute = (!useActive && raw.per_minute != null)
    ? raw.per_minute
    : (raw.price != null && minutes > 0 ? round2(raw.price / minutes) : null);

  return { perMile, perMinute, totalMin: minutes };
}

/**
 * Deterministic decision — the ground truth for arithmetic. Returns a decision
 * plus a `reasonKind` the caller turns into the terse spoken/notification string.
 *
 * v3 gate order (spec's Decision Priority, deterministic lane only — vision-lane
 * gates like safety/geography live in the prompt and the Phase-2 audit):
 *   rating → pickup limits → per-mile floor → per-minute floor → time limit →
 *   accept ladder → acceptance-rate protection → too_far/low.
 * All v3 gates are null at defaults → decisions identical to the legacy ladder.
 *
 * @returns {{ decision:'ACCEPT'|'REJECT'|'NO DATA', reasonKind:string, fallback?:boolean,
 *             perMile:number|null, perMinute:number|null, totalMin:number|null }}
 */
export function evaluateDeterministic(tier, raw, ruleset = DEFAULT_RULESET, context = {}) {
  if (tier === 'share') {
    // share.auto_reject was a declared-but-dead knob in v2 (nothing consumed it —
    // fail-loud violation). Wired 2026-07-03: explicitly false → share offers are
    // evaluated under standard rules; anything else (true/absent) → legacy reject.
    if (ruleset.share?.auto_reject !== false) {
      return { decision: 'REJECT', reasonKind: 'share', perMile: null, perMinute: null, totalMin: null };
    }
    tier = 'standard';
  }

  const eff = resolveScopedRuleset(ruleset, context);
  const { perMile, perMinute, totalMin } = deriveEffectiveMetrics(raw, eff.basis);
  const rating = raw.rating ?? raw.rider_rating ?? null;

  // No usable rate → caller decides NO DATA vs upstream handling.
  if (perMile == null) {
    return { decision: 'NO DATA', reasonKind: 'no_data', perMile: null, perMinute, totalMin };
  }

  const t = eff.tiers[tier] || eff.tiers.standard;
  const g = eff.global || {};

  // Legacy parity: missing minutes are treated as a very long ride
  // (analyze-offer.js used `total_minutes ?? 999`), so an unknown duration
  // can only ACCEPT via a rung with no upper bound at a high $/mi.
  const minForRules = totalMin == null ? 999 : totalMin;

  // Global gate: rider rating (rarely present on the deterministic path).
  if (rating != null && rating < (g.rating_floor ?? 4.85)) {
    return { decision: 'REJECT', reasonKind: 'rating', perMile, perMinute, totalMin };
  }

  // v3: pickup limits. Only evaluable when pickup fields are present (text
  // pre-parse or vision-extracted); missing pickup data passes silently — the
  // prompt lane carries the rule for the model.
  if (g.pickup_limits) {
    const pMi = raw.pickup_miles ?? null;
    const pMin = raw.pickup_minutes ?? null;
    if ((g.pickup_limits.max_miles != null && pMi != null && pMi > g.pickup_limits.max_miles)
      || (g.pickup_limits.max_minutes != null && pMin != null && pMin > g.pickup_limits.max_minutes)) {
      return { decision: 'REJECT', reasonKind: 'pickup', perMile, perMinute, totalMin };
    }
  }

  // Spec semantics (ARP rescues PROFITABILITY failures only): when acceptance-
  // rate protection is enabled, the tier floors defer to it — a floor miss can
  // still ACCEPT (FALLBACK) if total pay clears the ARP line. Rating, pickup,
  // and time rejects are NEVER rescued ("No safety rule, No geography rule,
  // No time rule"). With ARP null (the default), floors reject here exactly as
  // the legacy ladder did — parity preserved.
  const arp = g.acceptance_rate_protection?.min_per_total_mile ?? null;

  // Per-mile floor.
  if (arp == null && perMile < t.floor_per_mile) {
    return { decision: 'REJECT', reasonKind: 'floor', perMile, perMinute, totalMin };
  }

  // Optional per-minute floor.
  if (arp == null && t.floor_per_minute != null && perMinute != null && perMinute < t.floor_per_minute) {
    return { decision: 'REJECT', reasonKind: 'min_floor', perMile, perMinute, totalMin };
  }

  // v3: total-time limit with pay-conjunction escape. Placed BEFORE the ladder:
  // an overlong ride is rejected even at ladder-passing rates unless the
  // conjunction holds (spec: "unless BOTH $2.00+/mile AND $1.00+/minute").
  // minForRules=999 for unknown duration → unknown durations hit this gate,
  // consistent with the legacy "missing minutes = very long ride" doctrine.
  if (g.time_limit && g.time_limit.max_total_minutes != null && minForRules > g.time_limit.max_total_minutes) {
    const u = g.time_limit.unless;
    const meetsUnless = u != null
      && (u.min_per_mile == null || perMile >= u.min_per_mile)
      && (u.min_per_minute == null || (perMinute != null && perMinute >= u.min_per_minute));
    if (!meetsUnless) {
      return { decision: 'REJECT', reasonKind: 'time_limit', perMile, perMinute, totalMin };
    }
  }

  // Accept ladder — first match wins (uses minForRules so unknown duration
  // behaves like the legacy `total_minutes ?? 999`).
  for (const rung of t.accept_ladder || []) {
    const okMile = perMile >= rung.min_per_mile;
    const okMinuteRate = rung.min_per_minute == null
      || (perMinute != null && perMinute >= rung.min_per_minute);
    const okMin = (rung.min_total_min == null || minForRules >= rung.min_total_min)
      && (rung.min_total_min_excl == null || minForRules > rung.min_total_min_excl)
      && (rung.max_total_min == null || minForRules <= rung.max_total_min)
      && (rung.max_total_min_excl == null || minForRules < rung.max_total_min_excl);
    if (okMile && okMinuteRate && okMin) {
      return { decision: 'ACCEPT', reasonKind: 'accept', perMile, perMinute, totalMin };
    }
  }

  // v3: Acceptance Rate Protection — the ladder (and possibly the floors)
  // failed, but total pay-per-mile clears the ARP line and no un-rescuable
  // gate fired above (spec: ACCEPT (FALLBACK)).
  if (arp != null && perMile >= arp) {
    return { decision: 'ACCEPT', reasonKind: 'accept_fallback', fallback: true, perMile, perMinute, totalMin };
  }

  // ARP enabled but not cleared: the deferred floor rejects report their
  // specific reason (better voice lines than a generic "low").
  if (arp != null && perMile < t.floor_per_mile) {
    return { decision: 'REJECT', reasonKind: 'floor', perMile, perMinute, totalMin };
  }
  if (arp != null && t.floor_per_minute != null && perMinute != null && perMinute < t.floor_per_minute) {
    return { decision: 'REJECT', reasonKind: 'min_floor', perMile, perMinute, totalMin };
  }

  // No rung matched.
  if (minForRules > 40) {
    return { decision: 'REJECT', reasonKind: 'too_far', perMile, perMinute, totalMin };
  }
  return { decision: 'REJECT', reasonKind: 'low', perMile, perMinute, totalMin };
}

// ── Prompt rendering ─────────────────────────────────────────────────────────

/**
 * Render the numbered first-match-wins rule list for one tier. Shared by the
 * Phase-1 tier prompt, the Phase-1 vision (multi-tier) prompt, and Phase 2 —
 * the no-drift invariant depends on this single renderer.
 * Order mirrors the deterministic evaluator; vision-lane rules interleave at
 * their spec priority (safety first, geography after rider quality).
 */
function renderRuleLines(tierName, eff, ruleset, { tierRulesOnly = false } = {}) {
  const g = eff.global || {};
  const t = eff.tiers[tierName] || eff.tiers.standard;
  const rules = [];

  if (!tierRulesOnly) {
    if (g.safety_road_types) {
      rules.push('REJECT if route or destination needs dirt/gravel/unpaved/ranch/oil-field/off-road access, flooded crossings, construction closures, or gated areas with no access.');
    }
    rules.push(`REJECT if rating visible and <${g.rating_floor ?? 4.85}.`);
    if (g.require_verified) rules.push('REJECT if "Verified" missing.');
    for (const a of (ruleset.avoid || [])) {
      if (!a || a.enabled === false) continue;
      rules.push(renderAvoidRule(a));
    }
    if (g.auto_reject?.multiple_stops) rules.push('REJECT if multiple stops.');
    if (g.auto_reject?.round_trip) rules.push('REJECT if round trip (pickup equals destination).');
    if (g.pickup_limits) {
      const parts = [];
      if (g.pickup_limits.max_miles != null) parts.push(`pickup_mi>${g.pickup_limits.max_miles}`);
      if (g.pickup_limits.max_minutes != null) parts.push(`pickup_min>${g.pickup_limits.max_minutes}`);
      if (parts.length) rules.push(`REJECT if ${parts.join(' or ')}.`);
    }
  }

  // Spec semantics: when ARP is enabled the floors defer to it (a floor miss can
  // still ACCEPT (FALLBACK)), so their REJECT lines would contradict first-match-
  // wins reading — they're subsumed by the ARP line + terminal REJECT. With ARP
  // null (default) they render exactly where the byte pins expect them.
  const arpEnabled = g.acceptance_rate_protection?.min_per_total_mile != null;
  if (!arpEnabled) {
    rules.push(`REJECT if $/mi<${fmt(t.floor_per_mile)}.`);
    if (t.floor_per_minute != null) rules.push(`REJECT if $/min<${fmt(t.floor_per_minute)}.`);
  }

  if (!tierRulesOnly && g.time_limit?.max_total_minutes != null) {
    const u = g.time_limit.unless;
    const unless = u
      ? ` unless ${[
          u.min_per_mile != null ? `$/mi>=${fmt(u.min_per_mile)}` : null,
          u.min_per_minute != null ? `$/min>=${fmt(u.min_per_minute)}` : null,
        ].filter(Boolean).join(' and ')}`
      : '';
    rules.push(`REJECT if total_min>${g.time_limit.max_total_minutes}${unless}.`);
  }

  for (const rung of t.accept_ladder || []) {
    rules.push(`ACCEPT if ${renderRung(rung)}.`);
  }

  if (!tierRulesOnly && g.acceptance_rate_protection?.min_per_total_mile != null) {
    rules.push(`ACCEPT with "fallback":true if $/mi>=${fmt(g.acceptance_rate_protection.min_per_total_mile)}.`);
  }

  rules.push('REJECT.');
  return rules;
}

function renderAvoidRule(a) {
  const label = a.label || 'the avoid area';
  switch (a.mode) {
    case 'destination_in':
      return `REJECT if destination is in or within ~${a.radius_mi ?? 6}mi of ${label}.`;
    case 'north_of':
      return `REJECT if destination is north of ${label}.`;
    case 'south_of':
      return `REJECT if destination is south of ${label}.`;
    case 'heads_toward':
    default:
      // Render the evaluator's EFFECTIVE minimum (?? 8, mirroring evaluateGeoRules)
      // and name ride_mi — the trip-leg distance on the card, the closest
      // observable to the audit's pickup→dropoff distance. (Review 2026-07-03:
      // the old render dropped the default minimum and said total_mi, which
      // includes the pickup deadhead — a systematically different quantity.)
      return `REJECT if trip heads toward ${label} and ride_mi>=${a.min_trip_mi ?? 8}.`;
  }
}

/**
 * Guidance lines appended after the numbered rules (vision lane, non-numbered —
 * they inform judgment rather than gate it). Empty at defaults.
 */
function renderGuidanceLines(eff) {
  const g = eff.global || {};
  const lines = [];
  if (g.commercial_staging) {
    lines.push('Staging near commercial hubs (malls, stadiums, airports, downtown): do not penalize short trips — they chain into consecutive rides.');
  }
  return lines;
}

/**
 * Extra JSON template fields required by enabled v3 rules. Empty at defaults
 * (template byte-parity). Notices values the model may emit are fixed strings
 * so the caller can map them to the spec's Required Notifications verbatim.
 */
export const NOTICE_LABELS = {
  verified_rider: 'Verified Rider',
  on_the_way_filter: 'Filter Detected',
  deadhead_reduction: 'Deadhead Reduction Pickup',
};

function templateExtras(eff) {
  const g = eff.global || {};
  let extras = '';
  if (g.pickup_limits) extras += ',"pickup_miles":0,"pickup_minutes":0';
  if (g.acceptance_rate_protection?.min_per_total_mile != null) extras += ',"fallback":false';
  if (g.notices && Object.values(g.notices).some(Boolean)) extras += ',"notices":[]';
  return extras;
}

function noticesLine(eff) {
  const g = eff.global || {};
  if (!g.notices) return null;
  const wanted = Object.entries(NOTICE_LABELS)
    .filter(([key]) => g.notices[key])
    .map(([, label]) => `"${label}"`);
  if (!wanted.length) return null;
  return `notices: include any observed of [${wanted.join(',')}]. On the way = Filter Detected; map "…" = Deadhead Reduction Pickup.`;
}

/**
 * Render the Phase-1 system prompt for a KNOWN tier (text path — tier comes
 * from the OCR pre-parse). Generated from the SAME rules the evaluator uses.
 * BYTE-IDENTICAL to the legacy prompts at DEFAULT_RULESET (pinned in tests).
 *
 * @param {"share"|"standard"|"premium"|"comfort"|"xl"} tier
 */
export function buildPhase1Prompt(tier, ruleset = DEFAULT_RULESET, context = {}) {
  if (tier === 'share') {
    // Mirrors evaluateDeterministic: auto_reject false → standard rules apply.
    if (ruleset.share?.auto_reject !== false) {
      return `Raw JSON only. No markdown/backticks.
REJECT. Share rides always rejected.
{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"share"}`;
    }
    tier = 'standard';
  }

  const eff = resolveScopedRuleset(ruleset, context);
  const active = eff.basis === 'active_time';

  // Math line reflects the configured basis.
  const mathLine = active
    ? 'Math: per_mile=price/ride_mi. per_min=price/ride_min. Use ACTIVE time (ride only, exclude pickup).'
    : 'Math: total_miles=pickup_mi+ride_mi. total_min=pickup_min+ride_min. per_mile=price/total_miles.';

  const tierLine = tier === 'premium'
    ? 'PREMIUM ride (Comfort/VIP/XL/Black). Higher floor, more time allowed.\n'
    : tier === 'comfort'
      ? 'COMFORT ride. Higher floor than standard.\n'
      : tier === 'xl'
        ? 'XL ride (UberXL/Lyft XL/Black). Highest floor.\n'
        : '';

  const rules = renderRuleLines(tier, eff, ruleset);
  const numbered = rules.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const guidance = renderGuidanceLines(eff);
  const notices = noticesLine(eff);
  const extraSections = [...guidance, ...(notices ? [notices] : [])];
  const extraBlock = extraSections.length ? `\n${extraSections.join('\n')}\n` : '';

  const reasonHint = tier === 'standard'
    ? 'reason: terse. "$1.14 8.3mi" or "$0.78 14.0mi low". No sentences.'
    : 'reason: terse. "$1.21 13.7mi" or "$1.05 18mi low". No sentences.';

  const jsonTemplate = `{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0${templateExtras(eff)},"decision":"REJECT","reason":"$0.00 0.0mi"}`;

  return `Raw JSON only. No markdown/backticks.

${mathLine}

${tierLine}Rules (first match wins):
${numbered}
${extraBlock}
${reasonHint}

${jsonTemplate}`;
}

/**
 * Render the Phase-1 system prompt for the VISION path (image with no OCR
 * pre-parse → product/tier unknown before the model looks). Renders global
 * gates once, then each enabled tier's floors/ladder, and asks the model to
 * classify the product first. NEW in v3 — not covered by the legacy byte pins
 * (the endpoint previously sent the standard-tier prompt for all vision
 * requests, silently judging premium offers by standard floors).
 */
export function buildPhase1VisionPrompt(ruleset = DEFAULT_RULESET, context = {}) {
  const eff = resolveScopedRuleset(ruleset, context);
  const active = eff.basis === 'active_time';

  const mathLine = active
    ? 'Math: per_mile=price/ride_mi. per_min=price/ride_min. Use ACTIVE time (ride only, exclude pickup).'
    : 'Math: total_miles=pickup_mi+ride_mi. total_min=pickup_min+ride_min. per_mile=price/total_miles.';

  // Global gates = the standard render minus tier-specific lines. The ARP
  // fallback ACCEPT is excluded here and re-appended AFTER the tier ladders —
  // first-match-wins means it must not outrank any tier's ACCEPT rungs.
  const globalRules = renderRuleLines('standard', eff, ruleset).filter((r) =>
    !r.startsWith('REJECT if $/mi<') && !r.startsWith('REJECT if $/min<')
    && !r.startsWith('ACCEPT') && r !== 'REJECT.');
  const numberedGlobal = globalRules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const arp = eff.global?.acceptance_rate_protection?.min_per_total_mile;
  const arpLine = arp != null
    ? `No tier rule matched but $/mi>=${fmt(arp)}: ACCEPT with "fallback":true.\n`
    : '';

  // Headers reflect ACTUAL routing under this ruleset: enabling comfort/xl pulls
  // those products out of premium, so premium's header lists only what remains
  // (and the section disappears entirely when nothing routes there anymore) —
  // otherwise the model would apply premium floors to products the driver gave
  // their own tier (adversarial review 2026-07-03).
  const premiumRemainder = [...PREMIUM_PRODUCTS].filter((p) => classifyTier(p, ruleset) === 'premium');
  const premiumHeader = premiumRemainder.length === PREMIUM_PRODUCTS.size
    ? 'PREMIUM (Comfort/VIP/XL/Black):'                       // no splits — compact legacy label
    : `PREMIUM (${premiumRemainder.join('/') || 'other premium'}):`;
  const tierHeaders = {
    standard: 'STANDARD (UberX, Lyft):',
    premium: premiumHeader,
    comfort: 'COMFORT (Uber Comfort):',
    xl: 'XL (UberXL/Lyft XL/Black/Lux):',
  };
  const enabled = Object.keys(eff.tiers)
    .filter((n) => eff.tiers[n])
    .filter((n) => n !== 'premium' || premiumRemainder.length > 0);
  const tierSections = enabled.map((name) => {
    const tierRules = renderRuleLines(name, eff, ruleset, { tierRulesOnly: true })
      .filter((r) => r !== 'REJECT.');
    return `${tierHeaders[name] || `${name.toUpperCase()}:`}\n${tierRules.map((r) => `- ${r}`).join('\n')}`;
  }).join('\n');

  const guidance = renderGuidanceLines(eff);
  const notices = noticesLine(eff);
  const extraSections = [...guidance, ...(notices ? [notices] : [])];
  const extraBlock = extraSections.length ? `\n${extraSections.join('\n')}\n` : '';

  const jsonTemplate = `{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"product":""${templateExtras(eff)},"decision":"REJECT","reason":"$0.00 0.0mi"}`;

  const shareLine = ruleset.share?.auto_reject !== false
    ? 'Share/pool rides (Uber Share, Lyft Shared): REJECT always.'
    : 'Share/pool rides (Uber Share, Lyft Shared): apply STANDARD rules.';

  return `Raw JSON only. No markdown/backticks.

${mathLine}

Read the screenshot. Identify the product (put it in "product"), pick its tier below, apply gates then that tier's rules (first match wins).
${shareLine}

Gates (all tiers):
${numberedGlobal}

${tierSections}

${arpLine}No tier rule matched: REJECT.
${extraBlock}
reason: terse. "$1.14 8.3mi" or "$0.78 14.0mi low". No sentences.

${jsonTemplate}`;
}

/**
 * Render the Phase-2 (deep, async) system prompt from the SAME ruleset.
 * Replaces the hardcoded English ladder that lived in analyze-offer.js
 * (buildPhase2SystemPrompt), which drifted from per-driver rules by
 * construction. Full extraction contract per Melody's 2026-07-03 direction:
 * Phase 2 extracts EVERYTHING (the pings/patterns dataset); addresses are
 * geocoded afterward by the caller.
 */
export function buildPhase2Prompt(ruleset = DEFAULT_RULESET, context = {}) {
  const eff = resolveScopedRuleset(ruleset, context);
  const enabled = Object.keys(eff.tiers).filter((n) => eff.tiers[n]);

  const tierBlocks = enabled.map((name) => {
    const lines = renderRuleLines(name, eff, ruleset, { tierRulesOnly: true })
      .filter((r) => r !== 'REJECT.')
      .map((r, i) => `  ${i + 1}. ${r}`);
    return `${name.toUpperCase()}:\n${lines.join('\n')}`;
  }).join('\n');

  const globalLines = renderRuleLines('standard', eff, ruleset)
    .filter((r) => !r.startsWith('REJECT if $/mi<') && !r.startsWith('REJECT if $/min<')
      && !r.startsWith('ACCEPT') && r !== 'REJECT.')
    .map((r, i) => `  ${i + 1}. ${r}`);
  const arpMile = eff.global?.acceptance_rate_protection?.min_per_total_mile;
  const arpGeneral = arpMile != null
    ? `\n  - No tier rule matched but $/mi>=${fmt(arpMile)} and no other gate fired: ACCEPT (mark "fallback").`
    : '';

  const guidance = renderGuidanceLines(eff);

  return `You are a rideshare offer analyst. The driver's GPS may be provided below.
Provide DEEP analysis with FULL extraction of everything visible. Return ONLY valid JSON.

{
  "parsed_data": {
    "price": number, "miles": number, "pickup_minutes": number, "pickup_miles": number|null,
    "ride_minutes": number, "ride_miles": number|null,
    "pickup": "full pickup address/intersection as shown", "dropoff": "full destination address/intersection as shown",
    "platform": "uber"|"lyft"|"unknown", "surge": number|null, "per_mile": number,
    "rider_rating": number|null, "verified": boolean|null, "product_type": string|null,
    "multiple_stops": boolean|null, "round_trip": boolean|null,
    "on_the_way": boolean|null, "map_ellipsis": boolean|null,
    "road_flags": string[]|null
  },
  "decision": "ACCEPT"|"REJECT",
  "reasoning": "2-3 sentences: location quality, return-trip viability, economic assessment",
  "confidence": 0-100,
  "location_analysis": {
    "dropoff_zone": "core"|"deadhead"|"fringe",
    "return_difficulty": "easy"|"moderate"|"hard",
    "area_demand": "high"|"medium"|"low"
  }
}

GATES (all tiers, first match wins):
${globalLines.join('\n')}

RULES (tier-aware — check TIER tag below):
${tierBlocks}
SHARE: ${ruleset.share?.auto_reject !== false ? 'Always REJECT.' : 'Apply STANDARD rules.'}
GENERAL:
  - Rides to rural outskirts or areas with difficult return trips need high $/mi.
    Use the driver's GPS (when provided) to judge deadhead/rural RELATIVE to the
    driver's actual location — do NOT assume any specific metro.
  - If already near the dropoff area, deadhead is near-zero.${arpGeneral}${guidance.length ? `\n  - ${guidance.join('\n  - ')}` : ''}

Trust pre-parsed numbers if provided. Extract addresses EXACTLY as shown — they are geocoded downstream.`;
}

function renderRung(rung) {
  const parts = [`$/mi>=${fmt(rung.min_per_mile)}`];
  if (rung.min_per_minute != null) parts.push(`$/min>=${fmt(rung.min_per_minute)}`);
  const lo = rung.min_total_min, loX = rung.min_total_min_excl;
  const hi = rung.max_total_min, hiX = rung.max_total_min_excl;
  // Every present bound must render — the evaluator enforces all four
  // conjunctively, and a UI-built rung can legally mix inclusive/exclusive
  // bounds (adversarial review 2026-07-03: the old else-if chain silently
  // dropped one bound of a mixed pair, breaking the no-drift invariant).
  // The inclusive lo-hi pair keeps the legacy "total_min L-H" form (byte pins).
  if (lo != null && hi != null && loX == null && hiX == null) {
    parts.push(`total_min ${lo}-${hi}`);
  } else {
    if (lo != null) parts.push(`total_min>=${lo}`);
    if (loX != null) parts.push(`total_min>${loX}`);
    if (hi != null) parts.push(`total_min<=${hi}`);
    if (hiX != null) parts.push(`total_min<${hiX}`);
  }
  return parts.join(', ');
}

function fmt(n) {
  if (n == null) return '0.00';
  // Match legacy prompt style: always two decimals (0.90, 1.10, 1.75, 2.00).
  return Number(n).toFixed(2);
}

// ── Deterministic geography audit (Phase 2, post-geocode) ────────────────────

/**
 * Evaluate the avoid[] rules against geocoded pickup/dropoff coordinates.
 * Pure geometry — no network. Called from Phase 2 after the offer's addresses
 * are geocoded; the result is stored so vision-vs-geometry disagreements
 * become training data.
 *
 * heads_toward semantics: the trip is long enough to matter, the pickup→dropoff
 * bearing points into the anchor's corridor, AND the dropoff is actually closer
 * to the anchor than the pickup was (motion toward, not just alignment).
 *
 * @param {object} ruleset
 * @param {{pickup?: {lat:number,lng:number}|null, dropoff?: {lat:number,lng:number}|null}} coords
 * @returns {Array<{place_id:string, label:string, mode:string, result:'violated'|'clear'|'no_data'}>}
 */
export function evaluateGeoRules(ruleset, { pickup, dropoff }) {
  const results = [];
  for (const a of (ruleset.avoid || [])) {
    if (!a || a.enabled === false) continue;
    const entry = { place_id: a.place_id, label: a.label, mode: a.mode };

    if (!dropoff || a.lat == null || a.lng == null) {
      results.push({ ...entry, result: 'no_data' });
      continue;
    }

    let violated = false;
    switch (a.mode) {
      case 'destination_in':
        violated = haversineDistanceMiles(dropoff.lat, dropoff.lng, a.lat, a.lng) <= (a.radius_mi ?? 6);
        break;
      case 'north_of':
        violated = dropoff.lat > a.lat;
        break;
      case 'south_of':
        violated = dropoff.lat < a.lat;
        break;
      case 'heads_toward':
      default: {
        if (!pickup) {
          results.push({ ...entry, result: 'no_data' });
          continue;
        }
        const tripMi = haversineDistanceMiles(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
        const toDrop = bearingDegrees(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
        const toAnchor = bearingDegrees(pickup.lat, pickup.lng, a.lat, a.lng);
        const closing = haversineDistanceMiles(dropoff.lat, dropoff.lng, a.lat, a.lng)
          < haversineDistanceMiles(pickup.lat, pickup.lng, a.lat, a.lng);
        violated = tripMi >= (a.min_trip_mi ?? 8)
          && bearingDiffDegrees(toDrop, toAnchor) <= (a.corridor_deg ?? 30)
          && closing;
        break;
      }
    }
    results.push({ ...entry, result: violated ? 'violated' : 'clear' });
  }
  return results;
}
