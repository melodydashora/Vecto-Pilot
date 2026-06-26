// server/lib/offers/rules-engine.js
// 2026-06-20: Single source of truth for Offer Analyzer decision rules.
//
// WHY THIS EXISTS
// Before today the rules lived in TWO places that drifted (see
// docs/architecture/OFFER_ANALYZER_EDITOR_PLAN.md §1.1):
//   1. the English Phase-1 prompt (PHASE1_PROMPTS in analyze-offer.js), and
//   2. the deterministic JS fallback ladder (analyze-offer.js).
// They could disagree (the fallback's rating gate was dead code; "Verified" had
// no fallback). This module makes ONE config object the source: it RENDERS the
// Phase-1 prompt AND DRIVES the deterministic evaluator, so the two can never
// drift again.
//
// PARITY: DEFAULT_RULESET reproduces the *decisions* of the legacy JS fallback
// exactly (proven by tests/offers/rules-engine-parity.test.js across a dense
// grid of per_mile × minutes × rating). The rendered prompt is semantically
// equivalent (the model runs at temperature 0.1); the deterministic evaluator
// is the ground truth that fires whenever the model is uncertain.
//
// NEW DIMENSIONS (inert by default → zero behavior change for un-migrated users):
//   - per-minute floor (floor_per_minute, default null)
//   - active-time vs full-ride basis (basis, default 'full_ride' = legacy)
//   - geo-scoped overrides (home_city / other_city / airport, default disabled)
// Determinism doctrine (CLAUDE.md): integer minute cutoffs are stored inclusive
// (minutes are integers), e.g. legacy "<30 min" === max_total_min: 29.

import { classifyTier as classifyTierByProduct } from './parse-offer-text.js';

export const RULESET_SCHEMA_VERSION = 2;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * DEFAULT_RULESET — decision-equivalent to the legacy analyze-offer.js fallback.
 *
 * Ladder semantics: first-match-wins. A rung ACCEPTs when
 *   per_mile >= min_per_mile
 *   AND (min_total_min == null || total_min >= min_total_min)   // inclusive
 *   AND (max_total_min == null || total_min <= max_total_min)   // inclusive
 * Below floor_per_mile → REJECT. No rung matches → REJECT
 * ("too far" when total_min > 40, else "low") — mirrors legacy exactly.
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
  },

  share: { auto_reject: true },

  tiers: {
    standard: {
      floor_per_mile: 0.90,
      floor_per_minute: null, // NEW — inactive by default
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
      floor_per_minute: null, // NEW — inactive by default
      accept_ladder: [
        { min_per_mile: 1.10, max_total_min: 25 },
        { min_per_mile: 1.40, max_total_min: 30 },
        { min_per_mile: 1.75, max_total_min: 40 },
        { min_per_mile: 2.00, min_total_min_excl: 40 },             // legacy "> 40"
      ],
    },
  },

  // NEW — geo-scoped overrides. Each scope, when enabled, shallow-overrides
  // `basis`, `global`, and per-tier fields. Scope is resolved by the CALLER
  // (driver GPS vs home + avoid/airport places) and passed into the engine;
  // all disabled by default → base rules apply → zero behavior change.
  geo: {
    home_city:  { enabled: false, overrides: {} },
    other_city: { enabled: false, overrides: {} },
    airport:    { enabled: false, overrides: {} },
  },

  // NEW — user-entered places to avoid, optionally time-windowed. Identity is a
  // Google place_id (determinism doctrine: never hardcoded city/airport coords).
  // Shape: { place_id, label, lat, lng, radius_mi, reason,
  //          time_windows: [{ days:[0..6], start:"HH:MM", end:"HH:MM" }] }
  avoid: [],
};

/**
 * Classify a product type into a decision tier. Delegates to the canonical
 * product→tier sets in parse-offer-text.js (single source). `ruleset` is
 * accepted for a future where membership is user-editable (backlog).
 * @returns {"share"|"standard"|"premium"}
 */
export function classifyTier(productType, _ruleset = DEFAULT_RULESET) {
  return classifyTierByProduct(productType);
}

/**
 * Apply the matching geo scope (if any) on top of the base ruleset.
 * @param {object} ruleset
 * @param {{scope?: 'home_city'|'other_city'|'airport'|null}} [context]
 * @returns {{basis, global, share, tiers}} effective ruleset slice
 */
export function resolveScopedRuleset(ruleset, context = {}) {
  const base = {
    basis: ruleset.basis ?? 'full_ride',
    global: { ...ruleset.global },
    share: { ...ruleset.share },
    tiers: {
      standard: cloneTier(ruleset.tiers?.standard),
      premium: cloneTier(ruleset.tiers?.premium),
    },
  };

  const scope = context.scope;
  const geo = scope ? ruleset.geo?.[scope] : null;
  if (!geo || !geo.enabled || !geo.overrides) return base;

  const o = geo.overrides;
  if (o.basis) base.basis = o.basis;
  if (o.global) base.global = { ...base.global, ...o.global };
  for (const tierName of ['standard', 'premium']) {
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
 * Deterministic decision — the ground truth. Returns a decision plus a
 * `reasonKind` the caller turns into the terse spoken/notification string,
 * preserving the legacy reason format.
 *
 * @returns {{ decision:'ACCEPT'|'REJECT'|'NO DATA', reasonKind:string,
 *             perMile:number|null, perMinute:number|null, totalMin:number|null }}
 */
export function evaluateDeterministic(tier, raw, ruleset = DEFAULT_RULESET, context = {}) {
  if (tier === 'share') {
    return { decision: 'REJECT', reasonKind: 'share', perMile: null, perMinute: null, totalMin: null };
  }

  const eff = resolveScopedRuleset(ruleset, context);
  const { perMile, perMinute, totalMin } = deriveEffectiveMetrics(raw, eff.basis);
  const rating = raw.rating ?? raw.rider_rating ?? null;

  // No usable rate → caller decides NO DATA vs upstream handling.
  if (perMile == null) {
    return { decision: 'NO DATA', reasonKind: 'no_data', perMile: null, perMinute, totalMin };
  }

  const t = eff.tiers[tier] || eff.tiers.standard;

  // Legacy parity: missing minutes are treated as a very long ride
  // (analyze-offer.js used `total_minutes ?? 999`), so an unknown duration
  // can only ACCEPT via a rung with no upper bound at a high $/mi.
  const minForRules = totalMin == null ? 999 : totalMin;

  // Global gate: rider rating (rarely present on the deterministic path).
  if (rating != null && rating < (eff.global?.rating_floor ?? 4.85)) {
    return { decision: 'REJECT', reasonKind: 'rating', perMile, perMinute, totalMin };
  }

  // Per-mile floor.
  if (perMile < t.floor_per_mile) {
    return { decision: 'REJECT', reasonKind: 'floor', perMile, perMinute, totalMin };
  }

  // Optional per-minute floor (NEW, inactive by default).
  if (t.floor_per_minute != null && perMinute != null && perMinute < t.floor_per_minute) {
    return { decision: 'REJECT', reasonKind: 'min_floor', perMile, perMinute, totalMin };
  }

  // Accept ladder — first match wins (uses minForRules so unknown duration
  // behaves like the legacy `total_minutes ?? 999`).
  for (const rung of t.accept_ladder || []) {
    const okMile = perMile >= rung.min_per_mile;
    const okMin = (rung.min_total_min == null || minForRules >= rung.min_total_min)
      && (rung.min_total_min_excl == null || minForRules > rung.min_total_min_excl)
      && (rung.max_total_min == null || minForRules <= rung.max_total_min)
      && (rung.max_total_min_excl == null || minForRules < rung.max_total_min_excl);
    if (okMile && okMin) {
      return { decision: 'ACCEPT', reasonKind: 'accept', perMile, perMinute, totalMin };
    }
  }

  // No rung matched.
  if (minForRules > 40) {
    return { decision: 'REJECT', reasonKind: 'too_far', perMile, perMinute, totalMin };
  }
  return { decision: 'REJECT', reasonKind: 'low', perMile, perMinute, totalMin };
}

/**
 * Render the Phase-1 system prompt from the ruleset. Generated from the SAME
 * ladder the evaluator uses, so prompt and evaluator cannot drift. Semantically
 * equivalent to the legacy PHASE1_PROMPTS.
 *
 * @param {"share"|"standard"|"premium"} tier
 */
export function buildPhase1Prompt(tier, ruleset = DEFAULT_RULESET, context = {}) {
  const jsonTemplate = '{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"$0.00 0.0mi"}';

  if (tier === 'share') {
    return `Raw JSON only. No markdown/backticks.
REJECT. Share rides always rejected.
{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"share"}`;
  }

  const eff = resolveScopedRuleset(ruleset, context);
  const t = eff.tiers[tier] || eff.tiers.standard;
  const active = eff.basis === 'active_time';

  // Math line reflects the configured basis.
  const mathLine = active
    ? 'Math: per_mile=price/ride_mi. per_min=price/ride_min. Use ACTIVE time (ride only, exclude pickup).'
    : 'Math: total_miles=pickup_mi+ride_mi. total_min=pickup_min+ride_min. per_mile=price/total_miles.';

  const premiumLine = tier === 'premium'
    ? 'PREMIUM ride (Comfort/VIP/XL/Black). Higher floor, more time allowed.\n'
    : '';

  // Build the numbered, first-match-wins rule list from config.
  const rules = [];
  rules.push(`REJECT if rating visible and <${eff.global?.rating_floor ?? 4.85}.`);
  if (eff.global?.require_verified) rules.push('REJECT if "Verified" missing.');
  rules.push(`REJECT if $/mi<${fmt(t.floor_per_mile)}.`);
  if (t.floor_per_minute != null) rules.push(`REJECT if $/min<${fmt(t.floor_per_minute)}.`);
  for (const rung of t.accept_ladder || []) {
    rules.push(`ACCEPT if ${renderRung(rung)}.`);
  }
  rules.push('REJECT.');

  const numbered = rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const reasonHint = tier === 'premium'
    ? 'reason: terse. "$1.21 13.7mi" or "$1.05 18mi low". No sentences.'
    : 'reason: terse. "$1.14 8.3mi" or "$0.78 14.0mi low". No sentences.';

  return `Raw JSON only. No markdown/backticks.

${mathLine}

${premiumLine}Rules (first match wins):
${numbered}

${reasonHint}

${jsonTemplate}`;
}

function renderRung(rung) {
  const parts = [`$/mi>=${fmt(rung.min_per_mile)}`];
  const lo = rung.min_total_min, loX = rung.min_total_min_excl;
  const hi = rung.max_total_min, hiX = rung.max_total_min_excl;
  if (lo != null && hi != null) parts.push(`total_min ${lo}-${hi}`);
  else if (hiX != null) parts.push(`total_min<${hiX}`);
  else if (hi != null) parts.push(`total_min<=${hi}`);
  else if (loX != null) parts.push(`total_min>${loX}`);
  else if (lo != null) parts.push(`total_min>=${lo}`);
  return parts.join(', ');
}

function fmt(n) {
  if (n == null) return '0.00';
  // Match legacy prompt style: always two decimals (0.90, 1.10, 1.75, 2.00).
  return Number(n).toFixed(2);
}
