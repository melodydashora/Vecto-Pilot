// tests/offers/rules-engine-parity.test.js
// 2026-06-20: Golden parity test for server/lib/offers/rules-engine.js
//
// Proves evaluateDeterministic(tier, raw, DEFAULT_RULESET) reproduces the legacy
// analyze-offer.js decision ladder across a dense grid of per_mile × minutes ×
// rating. The `legacyOracle` below is an INDEPENDENT transcription of the legacy
// if/else fallback (analyze-offer.js:367-414) — NOT derived from the engine — so
// any off-by-one in a floor, rung, or boundary surfaces here.
//
// One intentional deviation from the literal legacy fallback: the rating gate.
// The legacy fallback read rating before assignment (dead code), so it never
// fired; the unified engine applies the rating gate the Phase-1 PROMPT always
// intended. The oracle encodes that intended behavior (rating active).

import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_RULESET,
  evaluateDeterministic,
  buildPhase1Prompt,
} from '../../server/lib/offers/rules-engine.js';

// ── Independent oracle: legacy ladder + intended rating gate ──────────────────
function legacyOracle(tier, pm, min, rating) {
  if (pm == null) return { decision: 'NO DATA', kind: 'no_data' };
  if (rating != null && rating < 4.85) return { decision: 'REJECT', kind: 'rating' };

  const totalMin = min == null ? 999 : min; // legacy: total_minutes ?? 999

  if (tier === 'premium') {
    if (pm < 1.10) return { decision: 'REJECT', kind: 'floor' };
    if (pm >= 1.10 && totalMin <= 25) return { decision: 'ACCEPT', kind: 'accept' };
    if (pm >= 1.40 && totalMin <= 30) return { decision: 'ACCEPT', kind: 'accept' };
    if (pm >= 1.75 && totalMin <= 40) return { decision: 'ACCEPT', kind: 'accept' };
    if (pm >= 2.00 && totalMin > 40) return { decision: 'ACCEPT', kind: 'accept' };
    if (totalMin > 40) return { decision: 'REJECT', kind: 'too_far' };
    return { decision: 'REJECT', kind: 'low' };
  }

  // standard
  if (pm < 0.90) return { decision: 'REJECT', kind: 'floor' };
  if (pm >= 0.90 && totalMin <= 20) return { decision: 'ACCEPT', kind: 'accept' };
  if (pm >= 1.10 && totalMin <= 25) return { decision: 'ACCEPT', kind: 'accept' };
  if (pm >= 1.75 && totalMin < 30) return { decision: 'ACCEPT', kind: 'accept' };
  if (totalMin >= 30 && totalMin <= 40 && pm >= 2.00) return { decision: 'ACCEPT', kind: 'accept' };
  if (totalMin > 40 && pm >= 2.00) return { decision: 'ACCEPT', kind: 'accept' };
  if (totalMin > 40) return { decision: 'REJECT', kind: 'too_far' };
  return { decision: 'REJECT', kind: 'low' };
}

const PER_MILE = [null, 0, 0.5, 0.8, 0.89, 0.9, 0.91, 1.0, 1.09, 1.1, 1.11,
  1.39, 1.4, 1.74, 1.75, 1.99, 2.0, 2.01, 2.5, 3.0];
const MINUTES = [null, 0, 5, 10, 15, 19, 20, 21, 24, 25, 26, 29, 30, 31, 35, 39, 40, 41, 45, 60];
const RATINGS = [null, 4.84, 4.85, 4.9, 5.0];

describe('rules-engine parity with legacy analyze-offer ladder', () => {
  for (const tier of ['standard', 'premium']) {
    it(`${tier}: matches the legacy oracle across the full grid`, () => {
      const mismatches = [];
      for (const pm of PER_MILE) {
        for (const min of MINUTES) {
          for (const rating of RATINGS) {
            const expected = legacyOracle(tier, pm, min, rating);
            const got = evaluateDeterministic(tier, {
              per_mile: pm,
              total_minutes: min,
              rating,
            }, DEFAULT_RULESET);
            if (got.decision !== expected.decision || got.reasonKind !== expected.kind) {
              mismatches.push(
                `pm=${pm} min=${min} rating=${rating} → expected ${expected.decision}/${expected.kind}, got ${got.decision}/${got.reasonKind}`
              );
            }
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  }
});

describe('rules-engine boundary sanity (human-readable)', () => {
  const evalStd = (pm, min) => evaluateDeterministic('standard', { per_mile: pm, total_minutes: min }, DEFAULT_RULESET);
  const evalPrem = (pm, min) => evaluateDeterministic('premium', { per_mile: pm, total_minutes: min }, DEFAULT_RULESET);

  it('standard: $1.80 @ 29min ACCEPTs but @ 30min REJECTs (the <30 boundary)', () => {
    expect(evalStd(1.8, 29).decision).toBe('ACCEPT');
    expect(evalStd(1.8, 30).decision).toBe('REJECT');
    expect(evalStd(1.8, 30).reasonKind).toBe('low');
  });

  it('standard: $2.00 accepts at 30, 40, and 41min (the 30-40 and >40 rungs)', () => {
    expect(evalStd(2.0, 30).decision).toBe('ACCEPT');
    expect(evalStd(2.0, 40).decision).toBe('ACCEPT');
    expect(evalStd(2.0, 41).decision).toBe('ACCEPT');
  });

  it('standard: $1.90 @ 41min is too_far (long ride, under $2)', () => {
    const r = evalStd(1.9, 41);
    expect(r.decision).toBe('REJECT');
    expect(r.reasonKind).toBe('too_far');
  });

  it('standard: below floor ($0.89) REJECTs as floor', () => {
    expect(evalStd(0.89, 10)).toMatchObject({ decision: 'REJECT', reasonKind: 'floor' });
  });

  it('premium: floor is $1.10 — $1.05 REJECTs, $1.10 @ 25min ACCEPTs', () => {
    expect(evalPrem(1.05, 10)).toMatchObject({ decision: 'REJECT', reasonKind: 'floor' });
    expect(evalPrem(1.10, 25).decision).toBe('ACCEPT');
  });

  it('rating gate: visible rating below 4.85 REJECTs regardless of economics', () => {
    const r = evaluateDeterministic('standard', { per_mile: 3.0, total_minutes: 10, rating: 4.8 }, DEFAULT_RULESET);
    expect(r).toMatchObject({ decision: 'REJECT', reasonKind: 'rating' });
  });

  it('share tier always REJECTs', () => {
    expect(evaluateDeterministic('share', { per_mile: 5.0, total_minutes: 5 }, DEFAULT_RULESET))
      .toMatchObject({ decision: 'REJECT', reasonKind: 'share' });
  });

  it('no usable per_mile → NO DATA', () => {
    expect(evaluateDeterministic('standard', { per_mile: null, total_minutes: 10 }, DEFAULT_RULESET).decision)
      .toBe('NO DATA');
  });
});

describe('active-time basis flips the denominator', () => {
  it('uses ride-only metrics when basis=active_time', () => {
    // price $20, pickup 10mi/20min + ride 5mi/10min.
    // full_ride: $20/15mi=$1.33/mi, 30min. active_time: $20/5mi=$4.00/mi, 10min.
    const raw = {
      price: 20, total_miles: 15, total_minutes: 30, ride_miles: 5, ride_minutes: 10,
      per_mile: 1.33, per_minute: 0.67,
    };
    const full = evaluateDeterministic('standard', raw, { ...DEFAULT_RULESET, basis: 'full_ride' });
    const active = evaluateDeterministic('standard', raw, { ...DEFAULT_RULESET, basis: 'active_time' });
    expect(full.perMile).toBeCloseTo(1.33, 2);
    expect(active.perMile).toBeCloseTo(4.0, 2);
    expect(active.totalMin).toBe(10);
  });
});

// Exact current Phase-1 prompt strings (analyze-offer.js:99-139). The default
// ruleset must render byte-identically so the live Siri path is unchanged.
const LEGACY_STANDARD = `Raw JSON only. No markdown/backticks.

Math: total_miles=pickup_mi+ride_mi. total_min=pickup_min+ride_min. per_mile=price/total_miles.

Rules (first match wins):
1. REJECT if rating visible and <4.85.
2. REJECT if "Verified" missing.
3. REJECT if $/mi<0.90.
4. ACCEPT if $/mi>=0.90, total_min<=20.
5. ACCEPT if $/mi>=1.10, total_min<=25.
6. ACCEPT if $/mi>=1.75, total_min<30.
7. ACCEPT if $/mi>=2.00, total_min 30-40.
8. ACCEPT if $/mi>=2.00, total_min>40.
9. REJECT.

reason: terse. "$1.14 8.3mi" or "$0.78 14.0mi low". No sentences.

{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"$0.00 0.0mi"}`;

const LEGACY_PREMIUM = `Raw JSON only. No markdown/backticks.

Math: total_miles=pickup_mi+ride_mi. total_min=pickup_min+ride_min. per_mile=price/total_miles.

PREMIUM ride (Comfort/VIP/XL/Black). Higher floor, more time allowed.
Rules (first match wins):
1. REJECT if rating visible and <4.85.
2. REJECT if "Verified" missing.
3. REJECT if $/mi<1.10.
4. ACCEPT if $/mi>=1.10, total_min<=25.
5. ACCEPT if $/mi>=1.40, total_min<=30.
6. ACCEPT if $/mi>=1.75, total_min<=40.
7. ACCEPT if $/mi>=2.00, total_min>40.
8. REJECT.

reason: terse. "$1.21 13.7mi" or "$1.05 18mi low". No sentences.

{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"$0.00 0.0mi"}`;

const LEGACY_SHARE = `Raw JSON only. No markdown/backticks.
REJECT. Share rides always rejected.
{"price":0,"per_mile":0,"total_miles":0,"total_minutes":0,"decision":"REJECT","reason":"share"}`;

describe('buildPhase1Prompt is byte-identical to the legacy prompt for the default ruleset', () => {
  it('standard', () => {
    expect(buildPhase1Prompt('standard', DEFAULT_RULESET)).toBe(LEGACY_STANDARD);
  });
  it('premium', () => {
    expect(buildPhase1Prompt('premium', DEFAULT_RULESET)).toBe(LEGACY_PREMIUM);
  });
  it('share', () => {
    expect(buildPhase1Prompt('share', DEFAULT_RULESET)).toBe(LEGACY_SHARE);
  });
});
