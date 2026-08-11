// tests/offers/rules-engine-v3.test.js
// 2026-07-03 (todo #10): v3 ruleset behavior — the rule kinds from Melody's
// verbatim spec (docs/OFFER_ANALYZER_DRIVER_RULESET.md), the v2→v3 migration,
// tier splitting, geography audit geometry, and write-gate validation.
//
// The companion parity suite (rules-engine-parity.test.js) proves v3 changes
// NOTHING at defaults; this suite proves the new rules do the right thing when
// a driver enables them.

import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_RULESET,
  migrateRuleset,
  classifyTier,
  evaluateDeterministic,
  evaluateGeoRules,
  buildPhase1Prompt,
  buildPhase1VisionPrompt,
  buildPhase2Prompt,
} from '../../server/lib/offers/rules-engine.js';
import { validateRuleset } from '../../server/lib/offers/ruleset-schema.js';
import { hashRuleset } from '../../server/lib/offers/ruleset-hash.js';

// ── Fixture: Melody's verbatim spec expressed as a v3 config ─────────────────
// Rate targets: UberX ≥$1.00/mi + ≥$0.50/min; Comfort ≥$1.25/mi + ≥$0.70/min;
// XL ≥$2.00/mi + ~$1.00/min. Rating 4.90. Pickup ≤3mi/≤8min. Time ≤20min unless
// $2/mi AND $1/min. ARP $1.00/total-mile. Geography/safety/staging enabled.
// Places are FIXTURE data (tests may hardcode what product code must not).
function melodySpec() {
  return migrateRuleset({
    schema_version: 3,
    basis: 'full_ride',
    global: {
      rating_floor: 4.90,
      require_verified: true,
      pickup_limits: { max_miles: 3, max_minutes: 8 },
      time_limit: { max_total_minutes: 20, unless: { min_per_mile: 2.00, min_per_minute: 1.00 } },
      acceptance_rate_protection: { min_per_total_mile: 1.00 },
      auto_reject: { multiple_stops: true, round_trip: true },
      safety_road_types: true,
      commercial_staging: true,
      notices: { verified_rider: true, on_the_way_filter: true, deadhead_reduction: true },
    },
    share: { auto_reject: true },
    tiers: {
      standard: {
        floor_per_mile: 1.00,
        floor_per_minute: 0.50,
        accept_ladder: [{ min_per_mile: 1.00, min_per_minute: 0.50 }],
      },
      premium: DEFAULT_RULESET.tiers.premium,
      comfort: {
        floor_per_mile: 1.25,
        floor_per_minute: 0.70,
        accept_ladder: [{ min_per_mile: 1.25, min_per_minute: 0.70 }],
      },
      xl: {
        floor_per_mile: 2.00,
        floor_per_minute: null,
        accept_ladder: [{ min_per_mile: 2.00 }],
      },
    },
    avoid: [
      // Anchors ≈ Fort Worth, Denton, and a US-380 corridor point (fixture values).
      { place_id: 'fixture_fw', label: 'Fort Worth', lat: 32.755488, lng: -97.330766, mode: 'heads_toward', corridor_deg: 30, min_trip_mi: 8, enabled: true },
      { place_id: 'fixture_denton', label: 'Denton', lat: 33.214841, lng: -97.133064, mode: 'destination_in', radius_mi: 6, enabled: true },
      { place_id: 'fixture_380', label: 'US-380', lat: 33.229, lng: -96.823, mode: 'north_of', enabled: true },
    ],
    home: { deadhead_only: true, mention_threshold_min: 20 },
  });
}

describe('migrateRuleset', () => {
  it('upgrades a v2 config to v3 with all new keys inert', () => {
    const v2 = {
      schema_version: 2,
      basis: 'full_ride',
      global: { rating_floor: 4.85, require_verified: true },
      share: { auto_reject: true },
      tiers: { standard: DEFAULT_RULESET.tiers.standard, premium: DEFAULT_RULESET.tiers.premium },
      geo: DEFAULT_RULESET.geo,
      avoid: [],
    };
    const v3 = migrateRuleset(v2);
    expect(v3.schema_version).toBe(3);
    expect(v3.global.pickup_limits).toBeNull();
    expect(v3.global.time_limit).toBeNull();
    expect(v3.global.acceptance_rate_protection).toBeNull();
    expect(v3.tiers.comfort).toBeNull();
    expect(v3.tiers.xl).toBeNull();
    expect(v3.home).toBeNull();
  });

  it('a migrated v2 config decides identically to DEFAULT_RULESET', () => {
    const migrated = migrateRuleset({ schema_version: 2, global: { rating_floor: 4.85, require_verified: true } });
    for (const pm of [0.5, 0.9, 1.1, 1.75, 2.0, 3.0]) {
      for (const min of [10, 20, 25, 30, 41, null]) {
        const a = evaluateDeterministic('standard', { per_mile: pm, total_minutes: min }, DEFAULT_RULESET);
        const b = evaluateDeterministic('standard', { per_mile: pm, total_minutes: min }, migrated);
        expect(`${b.decision}/${b.reasonKind}`).toBe(`${a.decision}/${a.reasonKind}`);
      }
    }
  });

  it('garbage input degrades to the defaults, never throws', () => {
    expect(migrateRuleset(null).schema_version).toBe(3);
    expect(migrateRuleset('nonsense').schema_version).toBe(3);
    expect(migrateRuleset({}).tiers.standard.floor_per_mile).toBe(0.90);
  });
});

describe('classifyTier with comfort/xl splits', () => {
  it('default ruleset keeps the legacy 3-way classification', () => {
    expect(classifyTier('Comfort', DEFAULT_RULESET)).toBe('premium');
    expect(classifyTier('UberXL', DEFAULT_RULESET)).toBe('premium');
    expect(classifyTier('UberX', DEFAULT_RULESET)).toBe('standard');
    expect(classifyTier('Share', DEFAULT_RULESET)).toBe('share');
  });

  it('spec ruleset routes Comfort→comfort and XL products→xl', () => {
    const rs = melodySpec();
    expect(classifyTier('Comfort', rs)).toBe('comfort');
    expect(classifyTier('UberXL', rs)).toBe('xl');
    expect(classifyTier('Lyft XL', rs)).toBe('xl');
    expect(classifyTier('Black', rs)).toBe('xl');
    expect(classifyTier('UberX', rs)).toBe('standard');
    expect(classifyTier('Lyft Shared', rs)).toBe('share');
  });

  it('tier_products overrides the default split', () => {
    const rs = migrateRuleset({ ...melodySpec(), tier_products: { comfort: ['Black'], xl: ['UberXL'] } });
    expect(classifyTier('Black', rs)).toBe('comfort');
    expect(classifyTier('Lyft XL', rs)).toBe('premium'); // not in either custom list
  });
});

describe('v3 deterministic gates (spec rules)', () => {
  const rs = melodySpec();

  it('pickup limits: 4mi pickup REJECTs as pickup; 2mi passes', () => {
    const long = evaluateDeterministic('standard', { per_mile: 2.0, total_minutes: 15, pickup_miles: 4, pickup_minutes: 5 }, rs);
    expect(long).toMatchObject({ decision: 'REJECT', reasonKind: 'pickup' });
    const ok = evaluateDeterministic('standard', { per_mile: 2.0, per_minute: 1.2, total_minutes: 15, pickup_miles: 2, pickup_minutes: 5 }, rs);
    expect(ok.decision).toBe('ACCEPT');
  });

  it('pickup limits: missing pickup data passes the gate (vision lane carries it)', () => {
    const r = evaluateDeterministic('standard', { per_mile: 1.5, per_minute: 0.9, total_minutes: 15 }, rs);
    expect(r.decision).toBe('ACCEPT');
  });

  it('time limit: 25min at $1.50/mi REJECTs as time_limit even though the ladder would accept', () => {
    const r = evaluateDeterministic('standard', { per_mile: 1.50, per_minute: 0.80, total_minutes: 25 }, rs);
    expect(r).toMatchObject({ decision: 'REJECT', reasonKind: 'time_limit' });
  });

  it('time limit: the $2/mi AND $1/min conjunction escapes it', () => {
    const r = evaluateDeterministic('standard', { per_mile: 2.10, per_minute: 1.05, total_minutes: 45 }, rs);
    expect(r.decision).toBe('ACCEPT');
  });

  it('time limit: $2/mi but only $0.80/min does NOT escape (AND, not OR)', () => {
    const r = evaluateDeterministic('standard', { per_mile: 2.10, per_minute: 0.80, total_minutes: 45 }, rs);
    expect(r).toMatchObject({ decision: 'REJECT', reasonKind: 'time_limit' });
  });

  it('min_per_minute rung: $1.20/mi at $0.40/min fails the standard rung → ARP catches at ≥$1/total-mi', () => {
    const r = evaluateDeterministic('standard', { per_mile: 1.20, per_minute: 0.40, total_minutes: 18 }, rs);
    expect(r).toMatchObject({ decision: 'ACCEPT', reasonKind: 'accept_fallback', fallback: true });
  });

  it('ARP does not rescue below its floor: $0.95/mi stays REJECT', () => {
    // floor_per_mile is 1.00 in the spec config → floor fires first.
    const r = evaluateDeterministic('standard', { per_mile: 0.95, per_minute: 0.60, total_minutes: 15 }, rs);
    expect(r).toMatchObject({ decision: 'REJECT', reasonKind: 'floor' });
  });

  it('ARP does not override the time limit (spec: "No time rule")', () => {
    const r = evaluateDeterministic('standard', { per_mile: 1.20, per_minute: 0.40, total_minutes: 30 }, rs);
    expect(r).toMatchObject({ decision: 'REJECT', reasonKind: 'time_limit' });
  });

  it('ARP rescues a tier-floor miss (spec: "If Primary Tier fails" → fallback)', () => {
    // Comfort floor is $1.25/mi, but $1.10/mi clears the $1.00 ARP line.
    const r = evaluateDeterministic('comfort', { per_mile: 1.10, per_minute: 0.80, total_minutes: 12 }, rs);
    expect(r).toMatchObject({ decision: 'ACCEPT', reasonKind: 'accept_fallback', fallback: true });
  });

  it('rating floor honors the spec 4.90: a 4.89 rider REJECTs', () => {
    const r = evaluateDeterministic('standard', { per_mile: 2.5, per_minute: 1.5, total_minutes: 10, rating: 4.89 }, rs);
    expect(r).toMatchObject({ decision: 'REJECT', reasonKind: 'rating' });
  });

  it('comfort tier applies its own floors ($1.25/mi + $0.70/min) — ARP disabled to isolate them', () => {
    const noArp = migrateRuleset({ ...rs, global: { ...rs.global, acceptance_rate_protection: null } });
    expect(evaluateDeterministic('comfort', { per_mile: 1.20, per_minute: 0.80, total_minutes: 10 }, noArp))
      .toMatchObject({ decision: 'REJECT', reasonKind: 'floor' });
    expect(evaluateDeterministic('comfort', { per_mile: 1.30, per_minute: 0.60, total_minutes: 10 }, noArp))
      .toMatchObject({ decision: 'REJECT', reasonKind: 'min_floor' });
    expect(evaluateDeterministic('comfort', { per_mile: 1.30, per_minute: 0.80, total_minutes: 10 }, noArp).decision)
      .toBe('ACCEPT');
  });

  it('xl tier: $2.00/mi floor rejects without ARP; ARP rescues at ≥$1/total-mi (spec)', () => {
    const noArp = migrateRuleset({ ...rs, global: { ...rs.global, acceptance_rate_protection: null } });
    expect(evaluateDeterministic('xl', { per_mile: 1.80, per_minute: 1.2, total_minutes: 10 }, noArp))
      .toMatchObject({ decision: 'REJECT', reasonKind: 'floor' });
    expect(evaluateDeterministic('xl', { per_mile: 1.80, per_minute: 1.2, total_minutes: 10 }, rs))
      .toMatchObject({ decision: 'ACCEPT', reasonKind: 'accept_fallback' });
    expect(evaluateDeterministic('xl', { per_mile: 2.10, per_minute: 1.2, total_minutes: 10 }, rs).decision)
      .toBe('ACCEPT');
    expect(evaluateDeterministic('xl', { per_mile: 2.10, per_minute: 1.2, total_minutes: 10 }, rs).reasonKind)
      .toBe('accept');
  });
});

describe('prompt rendering with v3 rules enabled', () => {
  const rs = melodySpec();

  it('tier prompt renders the new rule lines and extended JSON template', () => {
    const p = buildPhase1Prompt('standard', rs);
    expect(p).toContain('REJECT if pickup_mi>3 or pickup_min>8.');
    expect(p).toContain('REJECT if total_min>20 unless $/mi>=2.00 and $/min>=1.00.');
    expect(p).toContain('ACCEPT with "fallback":true if $/mi>=1.00.');
    expect(p).toContain('REJECT if trip heads toward Fort Worth and ride_mi>=8.');
    expect(p).toContain('REJECT if destination is in or within ~6mi of Denton.');
    expect(p).toContain('REJECT if destination is north of US-380.');
    expect(p).toContain('"pickup_miles":0');
    expect(p).toContain('"fallback":false');
    expect(p).toContain('"notices":[]');
    expect(p).toContain('rating visible and <4.9');
  });

  it('vision prompt lists all enabled tiers and keeps ARP after the ladders', () => {
    const p = buildPhase1VisionPrompt(rs);
    expect(p).toContain('STANDARD');
    expect(p).toContain('COMFORT');
    expect(p).toContain('XL');
    expect(p).toContain('"product":""');
    // ARP must render AFTER tier sections (first-match-wins ordering).
    const arpIdx = p.indexOf('$/mi>=1.00: ACCEPT with "fallback":true');
    const xlIdx = p.indexOf('XL (');
    expect(arpIdx).toBeGreaterThan(xlIdx);
    expect(arpIdx).toBeGreaterThan(-1);
  });

  it('vision prompt at DEFAULTS carries both legacy tiers and no v3 lines', () => {
    const p = buildPhase1VisionPrompt(DEFAULT_RULESET);
    expect(p).toContain('STANDARD');
    expect(p).toContain('PREMIUM');
    expect(p).not.toContain('COMFORT (');
    expect(p).not.toContain('pickup_mi>');
    expect(p).not.toContain('fallback');
  });

  it('Phase-2 prompt renders from the same ruleset (full-extraction contract + spec rules)', () => {
    const p = buildPhase2Prompt(rs);
    expect(p).toContain('"verified": boolean|null');
    expect(p).toContain('"on_the_way": boolean|null');
    expect(p).toContain('REJECT if trip heads toward Fort Worth');
    expect(p).toContain('COMFORT:');
    expect(p).toContain('geocoded downstream');
  });
});

describe('review regressions (2026-07-03 adversarial findings)', () => {
  it('renderRung: mixed inclusive/exclusive bounds ALL render (no silent drops)', () => {
    // A UI-buildable rung mixing bounds must render every bound the evaluator
    // enforces — the old else-if chain dropped one of a mixed pair.
    const rs = migrateRuleset({
      ...DEFAULT_RULESET,
      tiers: {
        ...DEFAULT_RULESET.tiers,
        standard: {
          floor_per_mile: 0.90,
          floor_per_minute: null,
          accept_ladder: [{ min_per_mile: 1.50, min_total_min: 20, max_total_min_excl: 30 }],
        },
      },
    });
    const p = buildPhase1Prompt('standard', rs);
    expect(p).toContain('ACCEPT if $/mi>=1.50, total_min>=20, total_min<30.');
    // And the evaluator agrees with the full conjunction:
    expect(evaluateDeterministic('standard', { per_mile: 1.55, total_minutes: 10 }, rs).decision).toBe('REJECT');
    expect(evaluateDeterministic('standard', { per_mile: 1.55, total_minutes: 25 }, rs).decision).toBe('ACCEPT');
  });

  it('heads_toward without min_trip_mi renders the evaluator default (>=8)', () => {
    const rs = migrateRuleset({
      ...DEFAULT_RULESET,
      avoid: [{ place_id: 'x', label: 'Fort Worth', lat: 32.75, lng: -97.33, mode: 'heads_toward', enabled: true }],
    });
    expect(buildPhase1Prompt('standard', rs)).toContain('REJECT if trip heads toward Fort Worth and ride_mi>=8.');
  });

  it('vision prompt: enabling comfort+xl removes their products from the PREMIUM header', () => {
    const p = buildPhase1VisionPrompt(melodySpec());
    expect(p).not.toContain('PREMIUM (Comfort/VIP/XL/Black):');
    // Everything premium routes to comfort/xl under the spec split → no premium section.
    expect(p).not.toContain('\nPREMIUM (');
  });

  it('share.auto_reject=false routes share offers through standard rules (knob is live)', () => {
    const rs = migrateRuleset({ ...DEFAULT_RULESET, share: { auto_reject: false } });
    const r = evaluateDeterministic('share', { per_mile: 1.20, total_minutes: 15 }, rs);
    expect(r.decision).toBe('ACCEPT'); // standard ladder: >=1.10 @ <=25min
    expect(buildPhase1Prompt('share', rs)).toContain('Rules (first match wins)'); // full prompt, not the share stub
    expect(buildPhase1VisionPrompt(rs)).toContain('apply STANDARD rules');
    // Default stays hard-reject:
    expect(evaluateDeterministic('share', { per_mile: 5, total_minutes: 5 }, DEFAULT_RULESET).reasonKind).toBe('share');
  });
});

describe('evaluateGeoRules geometry', () => {
  const rs = melodySpec();
  // Frisco-ish pickup (fixture): 33.150, -96.824
  const frisco = { lat: 33.15, lng: -96.824 };

  it('destination_in: dropoff inside the Denton radius violates', () => {
    const results = evaluateGeoRules(rs, { pickup: frisco, dropoff: { lat: 33.22, lng: -97.14 } });
    const denton = results.find((r) => r.label === 'Denton');
    expect(denton.result).toBe('violated');
  });

  it('north_of: dropoff above the US-380 anchor latitude violates', () => {
    const results = evaluateGeoRules(rs, { pickup: frisco, dropoff: { lat: 33.40, lng: -96.80 } });
    expect(results.find((r) => r.label === 'US-380').result).toBe('violated');
  });

  it('heads_toward: a long trip toward Fort Worth violates; a short hop does not', () => {
    // ~25mi southwest toward Fort Worth
    const towardFW = evaluateGeoRules(rs, { pickup: frisco, dropoff: { lat: 32.90, lng: -97.10 } });
    expect(towardFW.find((r) => r.label === 'Fort Worth').result).toBe('violated');
    // ~2mi in the same direction — under min_trip_mi
    const shortHop = evaluateGeoRules(rs, { pickup: frisco, dropoff: { lat: 33.13, lng: -96.85 } });
    expect(shortHop.find((r) => r.label === 'Fort Worth').result).toBe('clear');
  });

  it('heads_toward: moving AWAY from the anchor is clear even if far', () => {
    // Northeast, away from Fort Worth
    const away = evaluateGeoRules(rs, { pickup: frisco, dropoff: { lat: 33.45, lng: -96.40 } });
    expect(away.find((r) => r.label === 'Fort Worth').result).toBe('clear');
  });

  it('missing dropoff coords → no_data, never a guess', () => {
    const results = evaluateGeoRules(rs, { pickup: frisco, dropoff: null });
    expect(results.every((r) => r.result === 'no_data')).toBe(true);
  });
});

describe('write-gate validation + hashing', () => {
  it('accepts the migrated defaults and the spec fixture', () => {
    expect(validateRuleset(migrateRuleset(DEFAULT_RULESET)).ok).toBe(true);
    expect(validateRuleset(melodySpec()).ok).toBe(true);
  });

  it('rejects unknown keys and out-of-range values with named paths', () => {
    const bad = migrateRuleset(DEFAULT_RULESET);
    bad.global.rating_floor = 7; // > 5
    const r1 = validateRuleset(bad);
    expect(r1.ok).toBe(false);
    expect(r1.errors.join(' ')).toContain('global.rating_floor');

    const junk = { ...migrateRuleset(DEFAULT_RULESET), surprise_key: true };
    expect(validateRuleset(junk).ok).toBe(false);
  });

  it('hashRuleset is key-order independent (canonical)', () => {
    const a = hashRuleset({ x: 1, y: { b: 2, a: 3 } });
    const b = hashRuleset({ y: { a: 3, b: 2 }, x: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

// 2026-08-11: DEFAULT_RULESET is shared by reference with every untokened
// request — a single in-place mutation would contaminate all drivers at once.
// Pin that it is deeply frozen (mutation throws in strict/ESM mode).
describe('DEFAULT_RULESET immutability', () => {
  test('top-level and nested mutation both throw', () => {
    expect(() => { DEFAULT_RULESET.basis = 'active_time'; }).toThrow(TypeError);
    expect(() => { DEFAULT_RULESET.global.rating_floor = 0; }).toThrow(TypeError);
    expect(() => { DEFAULT_RULESET.tiers.standard.floor_per_mile = 0; }).toThrow(TypeError);
  });
});
