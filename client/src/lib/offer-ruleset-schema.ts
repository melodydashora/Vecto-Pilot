// client/src/lib/offer-ruleset-schema.ts
// 2026-07-03 (todo #10): Zod schema for the v3 offer ruleset config
// (docs/architecture/OFFER_ANALYZER.md §6.2 DEFAULT_RULESET). The Offer Analyzer form
// state maps 1:1 to this JSON: GET /api/offer-analyzer/rules → form.reset(config),
// Save = PUT { config }. Inert rules are null (never fabricated defaults).
// Mirrors server/lib/offers/ruleset-schema.js (the write-time gate) so invalid
// values fail client-side with the same bounds the server enforces.

import { z } from 'zod';

export const RULESET_SCHEMA_VERSION = 3;

// Shared bounds — keep in lockstep with server/lib/offers/ruleset-schema.js.
const money = z.number().min(0).max(50); // $/mi and $/min knobs
const minutes = z.number().int().min(0).max(600);
const miles = z.number().min(0).max(500);

// Ladder rung — key names mirror server DEFAULT_RULESET (rules-engine.js).
// The *_excl variants are the legacy exclusive bounds ("< 30", "> 40"); the editor
// preserves them on round-trip and only rewrites to the inclusive keys when the
// user edits that specific field.
export const ladderRungSchema = z.object({
  min_per_mile: money,
  min_per_minute: money.nullish(),
  min_total_min: minutes.nullish(),
  min_total_min_excl: minutes.nullish(),
  max_total_min: minutes.nullish(),
  max_total_min_excl: minutes.nullish(),
});
export type LadderRung = z.infer<typeof ladderRungSchema>;

export const tierConfigSchema = z.object({
  floor_per_mile: money,
  floor_per_minute: money.nullish(),
  max_total_miles: miles.nullish(), // v3.1 sliders (2026-08-17): per-tier distance cap
  // Derived, not edited (v3.1): the sliders write ONE rung { min_per_mile: floor, max_total_min }.
  // Legacy multi-rung ladders round-trip untouched until the tier is edited.
  accept_ladder: z.array(ladderRungSchema).max(12),
});
export type TierConfig = z.infer<typeof tierConfigSchema>;

export const AVOID_MODES = ['destination_in', 'heads_toward', 'north_of', 'south_of'] as const;
export type AvoidMode = (typeof AVOID_MODES)[number];

export const avoidRuleSchema = z.object({
  place_id: z.string().min(1).max(512), // Google identity — determinism doctrine
  label: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90), // 6-decimal, from Places — never typed by hand
  lng: z.number().min(-180).max(180),
  mode: z.enum(AVOID_MODES),
  radius_mi: miles.nullish(), // destination_in
  corridor_deg: z.number().min(5).max(90).nullish(), // heads_toward
  min_trip_mi: miles.nullish(), // heads_toward
  enabled: z.boolean().default(true),
});
export type AvoidRule = z.infer<typeof avoidRuleSchema>;

const geoScopeSchema = z.object({
  enabled: z.boolean(),
  overrides: z
    .object({
      basis: z.enum(['full_ride', 'active_time']).optional(),
      global: z.record(z.string(), z.unknown()).optional(),
      tiers: z.record(z.string(), z.unknown()).optional(),
    })
    .default({}),
});

export const offerRulesetSchema = z.object({
  schema_version: z.literal(RULESET_SCHEMA_VERSION),
  basis: z.enum(['full_ride', 'active_time']),
  global: z.object({
    rating_floor: z.number().min(0).max(5),
    require_verified: z.boolean(),
    pickup_limits: z
      .object({ max_miles: miles.nullish(), max_minutes: minutes.nullish() })
      .nullable(),
    time_limit: z
      .object({
        max_total_minutes: minutes,
        unless: z.object({ min_per_mile: money.nullish(), min_per_minute: money.nullish() }).nullable(),
      })
      .nullable(),
    acceptance_rate_protection: z.object({ min_per_total_mile: money }).nullable(),
    auto_reject: z
      .object({ multiple_stops: z.boolean().default(false), round_trip: z.boolean().default(false) })
      .nullable(),
    safety_road_types: z.boolean(),
    commercial_staging: z.boolean(),
    notices: z
      .object({
        verified_rider: z.boolean().default(false),
        on_the_way_filter: z.boolean().default(false),
        deadhead_reduction: z.boolean().default(false),
        hourly_rate: z.boolean().default(false), // v3.1: show computed $/hr (telemetry, never a decider)
      })
      .nullable(),
  }),
  share: z.object({ auto_reject: z.boolean() }),
  // v3.2 (2026-08-26): delivery lane — two floors + a distance cap (server evaluateDelivery).
  // .default() (not required): during a deploy skew a server instance still on the previous
  // image answers GET /rules without these keys, and a hard requirement would fail the whole
  // editor with "Rules payload did not match the expected v3 shape" (review 2026-08-26).
  delivery: z
    .object({
      enabled: z.boolean(),
      min_per_mile: money.nullish(),
      min_per_hour: z.number().min(0).max(500).nullish(),
      max_total_miles: miles.nullish(),
    })
    .default({ enabled: true, min_per_mile: 1.5, min_per_hour: 25, max_total_miles: 12 }),
  // v3.2 (2026-08-26): implausible-parse ceilings (server checkSanity). No editor — they
  // round-trip untouched; the server re-fills any missing/null value with its default.
  sanity: z
    .object({
      max_price: z.number().min(0).max(100000).nullish(),
      max_per_mile: z.number().min(0).max(1000).nullish(),
      max_per_hour: z.number().min(0).max(100000).nullish(),
      min_price: z.number().min(0).max(1000).nullish(),
      max_per_mile_no_cents: z.number().min(0).max(1000).nullish(),
      max_per_hour_no_cents: z.number().min(0).max(100000).nullish(),
    })
    .default({ max_price: 500, max_per_mile: 40, max_per_hour: 500, min_price: 1, max_per_mile_no_cents: 10, max_per_hour_no_cents: 200 }),
  tiers: z.object({
    standard: tierConfigSchema,
    premium: tierConfigSchema,
    comfort: tierConfigSchema.nullable(),
    xl: tierConfigSchema.nullable(),
  }),
  // No UI edits these two + geo (v2 unchanged) — they round-trip untouched.
  tier_products: z
    .object({
      comfort: z.array(z.string().max(60)).max(20),
      xl: z.array(z.string().max(60)).max(20),
    })
    .nullable(),
  geo: z.object({
    home_city: geoScopeSchema,
    other_city: geoScopeSchema,
    airport: geoScopeSchema,
  }),
  avoid: z.array(avoidRuleSchema).max(25),
  home: z
    .object({ deadhead_only: z.boolean().default(true), mention_threshold_min: minutes.nullish() })
    .nullable(),
});
export type OfferRulesetConfig = z.infer<typeof offerRulesetSchema>;
export type DeliveryConfig = OfferRulesetConfig['delivery'];

// Pre-load form defaults. Mirrors the server DEFAULT_RULESET (rules-engine.js)
// plus the v3 inert keys — only shown until GET /rules resolves and resets the form.
export const DEFAULT_OFFER_RULESET_CONFIG: OfferRulesetConfig = {
  schema_version: RULESET_SCHEMA_VERSION,
  basis: 'full_ride',
  global: {
    rating_floor: 4.85,
    require_verified: true,
    pickup_limits: null,
    time_limit: null,
    acceptance_rate_protection: null,
    auto_reject: null,
    safety_road_types: false,
    commercial_staging: false,
    notices: null,
  },
  share: { auto_reject: true },
  delivery: { enabled: true, min_per_mile: 1.5, min_per_hour: 25, max_total_miles: 12 },
  sanity: { max_price: 500, max_per_mile: 40, max_per_hour: 500, min_price: 1, max_per_mile_no_cents: 10, max_per_hour_no_cents: 200 },
  tiers: {
    standard: {
      floor_per_mile: 0.9,
      floor_per_minute: null,
      max_total_miles: null,
      accept_ladder: [
        { min_per_mile: 0.9, max_total_min: 20 },
        { min_per_mile: 1.1, max_total_min: 25 },
        { min_per_mile: 1.75, max_total_min_excl: 30 },
        { min_per_mile: 2.0, min_total_min: 30, max_total_min: 40 },
        { min_per_mile: 2.0, min_total_min_excl: 40 },
      ],
    },
    premium: {
      floor_per_mile: 1.1,
      floor_per_minute: null,
      max_total_miles: null,
      accept_ladder: [
        { min_per_mile: 1.1, max_total_min: 25 },
        { min_per_mile: 1.4, max_total_min: 30 },
        { min_per_mile: 1.75, max_total_min: 40 },
        { min_per_mile: 2.0, min_total_min_excl: 40 },
      ],
    },
    comfort: null,
    xl: null,
  },
  tier_products: null,
  geo: {
    home_city: { enabled: false, overrides: {} },
    other_city: { enabled: false, overrides: {} },
    airport: { enabled: false, overrides: {} },
  },
  avoid: [],
  home: null,
};

// Seed values used when an enable-switch turns a null (inert) rule on.
// Numbers come from the design §3 examples (comfort/xl from the spec's tier
// targets) — user-editable immediately after.
export const ENABLE_SEEDS = {
  pickup_limits: { max_miles: 3, max_minutes: 8 },
  time_limit: { max_total_minutes: 20, unless: { min_per_mile: 2.0, min_per_minute: 1.0 } },
  acceptance_rate_protection: { min_per_total_mile: 1.0 },
  delivery: { enabled: true, min_per_mile: 1.5, min_per_hour: 25, max_total_miles: 12 },
  comfort_tier: { floor_per_mile: 1.25, floor_per_minute: 0.7, max_total_miles: null, accept_ladder: [{ min_per_mile: 1.25, max_total_min: 20 }] } as TierConfig,
  xl_tier: { floor_per_mile: 2.0, floor_per_minute: 1.0, max_total_miles: null, accept_ladder: [{ min_per_mile: 2.0, max_total_min: 20 }] } as TierConfig,
} as const;

/** v3.1 sliders: the tier's ONE accept rule, derived from the sliders. */
export const DEFAULT_MAX_TRIP_MINUTES = 20;
export function tierMaxTripMinutes(tier: TierConfig): number {
  const r = tier.accept_ladder[0];
  return r?.max_total_min ?? r?.max_total_min_excl ?? DEFAULT_MAX_TRIP_MINUTES;
}
export function withDerivedLadder(tier: TierConfig, maxTripMinutes: number): TierConfig {
  return {
    ...tier,
    accept_ladder: [{ min_per_mile: tier.floor_per_mile, max_total_min: Math.round(maxTripMinutes) }],
  };
}

/** New avoid-place rule with the design §3 defaults for every mode's fields. */
export function makeAvoidRule(place: {
  place_id: string;
  label: string;
  lat: number;
  lng: number;
}): AvoidRule {
  return {
    ...place,
    label: place.label.slice(0, 120), // server caps label length
    mode: 'heads_toward',
    radius_mi: 6,
    corridor_deg: 30,
    min_trip_mi: 8,
    enabled: true,
  };
}
