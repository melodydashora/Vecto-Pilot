// server/lib/offers/ruleset-schema.js
// 2026-07-03 (todo #10): Zod validation for the v3 offer ruleset.
//
// This is the WRITE-TIME gate (fail-loud): PUT /api/offer-analyzer/rules refuses
// anything that doesn't parse, so a malformed config can never persist. The read
// path (ruleset-store.js) still fail-opens to DEFAULT_RULESET with a loud log —
// that branch should be unreachable precisely because this gate exists.
// Doc: docs/architecture/OFFER_ANALYZER.md §6.6 (write-time validation) and §7 (read posture).

import { z } from 'zod';
import { RULESET_SCHEMA_VERSION } from './rules-engine.js';

const money = z.number().min(0).max(50);        // $/mi and $/min knobs
const minutes = z.number().int().min(0).max(600);
const miles = z.number().min(0).max(500);

const ladderRung = z.object({
  min_per_mile: money,
  min_per_minute: money.nullish(),
  min_total_min: minutes.nullish(),
  min_total_min_excl: minutes.nullish(),
  max_total_min: minutes.nullish(),
  max_total_min_excl: minutes.nullish(),
}).strict();

const tier = z.object({
  floor_per_mile: money,
  floor_per_minute: money.nullish(),
  max_total_miles: miles.nullish(),   // v3.1 sliders (2026-08-17)
  accept_ladder: z.array(ladderRung).max(12),
}).strict();

const geoScope = z.object({
  enabled: z.boolean(),
  overrides: z.object({
    basis: z.enum(['full_ride', 'active_time']).optional(),
    global: z.record(z.string(), z.unknown()).optional(),
    tiers: z.record(z.string(), z.unknown()).optional(),
  }).strict().default({}),
}).strict();

const avoidPlace = z.object({
  place_id: z.string().min(1).max(512),          // Google place identity (determinism doctrine)
  label: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  mode: z.enum(['destination_in', 'heads_toward', 'north_of', 'south_of']),
  radius_mi: miles.nullish(),
  corridor_deg: z.number().min(5).max(90).nullish(),
  min_trip_mi: miles.nullish(),
  enabled: z.boolean().default(true),
}).strict();

export const rulesetSchema = z.object({
  schema_version: z.literal(RULESET_SCHEMA_VERSION),
  basis: z.enum(['full_ride', 'active_time']),
  global: z.object({
    rating_floor: z.number().min(0).max(5),
    require_verified: z.boolean(),
    pickup_limits: z.object({
      max_miles: miles.nullish(),
      max_minutes: minutes.nullish(),
    }).strict().nullable(),
    time_limit: z.object({
      max_total_minutes: minutes,
      unless: z.object({
        min_per_mile: money.nullish(),
        min_per_minute: money.nullish(),
      }).strict().nullable(),
    }).strict().nullable(),
    acceptance_rate_protection: z.object({
      min_per_total_mile: money,
    }).strict().nullable(),
    auto_reject: z.object({
      multiple_stops: z.boolean().default(false),
      round_trip: z.boolean().default(false),
    }).strict().nullable(),
    safety_road_types: z.boolean(),
    commercial_staging: z.boolean(),
    notices: z.object({
      verified_rider: z.boolean().default(false),
      on_the_way_filter: z.boolean().default(false),
      deadhead_reduction: z.boolean().default(false),
      hourly_rate: z.boolean().default(false),   // v3.1: show computed $/hr — telemetry, never a decider
    }).strict().nullable(),
  }).strict(),
  share: z.object({ auto_reject: z.boolean() }).strict(),
  // v3.2 (2026-08-26): delivery lane — two floors + a distance cap (rules-engine evaluateDelivery).
  delivery: z.object({
    enabled: z.boolean(),
    min_per_mile: money.nullish(),
    min_per_hour: z.number().min(0).max(500).nullish(),
    max_total_miles: miles.nullish(),
  }).strict(),
  // v3.2 (2026-08-26): implausible-parse ceilings (rules-engine checkSanity). Wide bounds on
  // purpose — these are "impossible", not "unattractive" (the tiers hold the taste).
  sanity: z.object({
    max_price: z.number().min(0).max(100000).nullish(),
    max_per_mile: z.number().min(0).max(1000).nullish(),
    max_per_hour: z.number().min(0).max(100000).nullish(),
    min_price: z.number().min(0).max(1000).nullish(),
    // the decimal-drop detector (a platform price is always cents-precise)
    max_per_mile_no_cents: z.number().min(0).max(1000).nullish(),
    max_per_hour_no_cents: z.number().min(0).max(100000).nullish(),
  }).strict(),
  tiers: z.object({
    standard: tier,
    premium: tier,
    comfort: tier.nullable(),
    xl: tier.nullable(),
  }).strict(),
  tier_products: z.object({
    comfort: z.array(z.string().max(60)).max(20),
    xl: z.array(z.string().max(60)).max(20),
  }).strict().nullable(),
  geo: z.object({
    home_city: geoScope,
    other_city: geoScope,
    airport: geoScope,
  }).strict(),
  avoid: z.array(avoidPlace).max(25),
  home: z.object({
    deadhead_only: z.boolean().default(true),
    mention_threshold_min: minutes.nullish(),
  }).strict().nullable(),
}).strict();

/**
 * Validate a (post-migrateRuleset) config. Returns { ok, config?, errors? }.
 * Callers must run migrateRuleset() first — this schema is v3-exact on purpose,
 * so drift between the engine shape and the validator surfaces immediately.
 */
export function validateRuleset(config) {
  const result = rulesetSchema.safeParse(config);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
