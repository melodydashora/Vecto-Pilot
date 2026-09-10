// tests/offers/delivery-and-sanity.test.js
// 2026-08-26 (v3.2): the implausible-parse tripwire and the delivery lane.
// Fixtures are REAL cards from the 2026-08-24 brief (tests/offers/fixtures/README.md).
// The live incident: on-device OCR dropped the decimal in "$7.50" → "$750" and the
// driver was told ACCEPT at $163.04/mi ($2368/hr). D2 below is that verbatim payload.

import { describe, it, expect } from '@jest/globals';
import {
  parseOfferText,
  extractPriceDetailed,
  extractTotalPair,
  classifyTier as classifyTierByProduct,
  formatPerMileForVoice,
} from '../../server/lib/offers/parse-offer-text.js';
import {
  DEFAULT_RULESET,
  migrateRuleset,
  classifyTier,
  checkSanity,
  evaluateDelivery,
  evaluateDeterministic,
  buildPhase1Prompt,
  buildPhase1VisionPrompt,
  buildPhase2Prompt,
} from '../../server/lib/offers/rules-engine.js';
import { validateRuleset } from '../../server/lib/offers/ruleset-schema.js';
import { normalizeOfferBody, normalizeShortcutSystem } from '../../server/lib/offers/normalize-offer-body.js';

const D2_LIVE = [
  '[0]: 12:55 J Baby (feat.',
  '[1]: YP Delivery Exclusive',
  '[2]: $750',
  '[3]: Includes expected tip',
  '[4]: O 19 min (4.6 mi) total',
  '[5]: *0 5G.ll 66',
  '[6]: Casa Del Bro Mexican Grill and',
  'Creamery',
  '[7]: Accept',
  '[8]: LEBANON F',
  '[9]: o Adelaide & Kennoway,',
  'The Colony',
  '[10]: X',
].join('\n');
const D1_CLEAN = D2_LIVE.replace('[2]: $750', '[2]: $7.50');
const R1_COMFORT = 'Comfort\n$13.25\n$33.13/active hr\n5.00 ★ Verified\n13 min (5.5 mi) away\nMain St\n10 mins (3.8 mi) trip\nElm St';
const R2_UBERX = 'UberX Priority\n$8.54\n4 min (1.9 mi) away\nThe Star Blvd & Winning Dr\n10 min (4.2 mi) trip\nBasilica Ln & Santa Bella Dr\n4.92\nVerified\nMatch';

describe('parser: delivery cards + price format', () => {
  it('D1 clean delivery: kind, tip, single TOTAL pair, canonical product through OCR glyph junk', () => {
    const p = parseOfferText(D1_CLEAN);
    expect(p.offer_kind).toBe('delivery');
    expect(p.product_type).toBe('Delivery Exclusive'); // "YP Delivery Exclusive" → the fork icon became "YP"
    expect(p.tip_included).toBe(true);
    expect(p.price).toBe(7.5);
    expect(p.price_format).toBe('cents');
    expect(p.total_minutes).toBe(19);
    expect(p.total_miles).toBe(4.6);
    expect(p.pickup_minutes).toBeNull();
    expect(p.ride_minutes).toBeNull(); // no pickup-vs-trip logic on a delivery
    expect(p.per_mile).toBe(1.63);
    expect(p.parse_confidence).toBe('full'); // price + the one total line IS the complete card
  });

  it('D2 live payload: price 750 is read as an INTEGER (no cents) — the decimal-drop signature', () => {
    const p = parseOfferText(D2_LIVE);
    expect(p.price).toBe(750);
    expect(p.price_format).toBe('integer');
    expect(p.offer_kind).toBe('delivery');
    expect(p.per_mile).toBe(163.04); // exactly the live wrong figure — the parser is faithful, the GATE must catch it
    // music-player line [0] and signal junk [5] contribute no price candidate
    expect(extractPriceDetailed('[0]: 12:55 J Baby (feat.\n[5]: *0 5G.ll 66').value).toBeNull();
  });

  it('extractTotalPair reads the "total" suffix only', () => {
    expect(extractTotalPair('O 19 min (4.6 mi) total')).toEqual({ minutes: 19, miles: 4.6 });
    expect(extractTotalPair('10 min (4.2 mi) trip')).toBeNull();
  });

  // REGRESSION (adversarial review 2026-08-26, found by four independent lenses): the first
  // implementation let extractProductType claim "Delivery" from ANY word-bounded match,
  // before the ride brands — so a real UberX/Comfort ride whose card contains "Delivery Dr",
  // a restaurant name, or on-screen chrome was routed down the delivery lane and judged by
  // two delivery floors instead of the driver's rating / Verified / pickup / ladder rules.
  it('a two-pair ride card containing the word "Delivery" (an address) stays a RIDE', () => {
    const p = parseOfferText('UberX\n$14.20\n4.9 ★ Verified\n4 min (1.9 mi) away\n1200 Delivery Dr & Main\n10 min (4.2 mi) trip\nElm St');
    expect(p.offer_kind).toBe('ride');
    expect(p.product_type).toBe('UberX');          // the ride brand keeps the card
    expect(classifyTierByProduct(p.product_type)).toBe('standard');
    expect(classifyTier(p.product_type, DEFAULT_RULESET)).toBe('standard');
    expect(p.pickup_miles).toBe(1.9);
    expect(p.ride_miles).toBe(4.2);
    // …and the ride verdict is the ride verdict (ladder, not delivery floors)
    expect(evaluateDeterministic('standard', p, DEFAULT_RULESET)).toMatchObject({ decision: 'ACCEPT', reasonKind: 'accept' });
  });

  it('a brandless two-pair card containing "Delivery" is a ride with no product, never the delivery lane', () => {
    const p = parseOfferText('$14.20\n4 min (1.9 mi) away\nDelivery Rd\n10 min (4.2 mi) trip\nElm St');
    expect(p.offer_kind).toBe('ride');
    expect(p.product_type).toBeNull();
    expect(classifyTier(p.product_type, DEFAULT_RULESET)).toBe('standard');
  });

  it('a Comfort card with a delivery-sounding dropoff keeps its premium tier', () => {
    const p = parseOfferText('Comfort\n$18.00\n5.00 ★ Verified\n6 min (2.0 mi) away\nMain St\n12 min (5.0 mi) trip\nDelivery Station 4');
    expect(p.offer_kind).toBe('ride');
    expect(classifyTier(p.product_type, DEFAULT_RULESET)).toBe('premium');
  });

  it('the vision model\'s own product string routes case-insensitively (it writes free text)', () => {
    expect(classifyTier('delivery', DEFAULT_RULESET)).toBe('delivery');
    expect(classifyTier('  Delivery Exclusive ', DEFAULT_RULESET)).toBe('delivery');
    expect(classifyTier('UberX', DEFAULT_RULESET)).toBe('standard');
  });

  it('R1 Comfort regression: price is $13.25, the "$33.13/active hr" figure stays hourly, 9.3 mi', () => {
    const p = parseOfferText(R1_COMFORT);
    expect(p.price).toBe(13.25);
    expect(p.price_format).toBe('cents');
    expect(p.hourly_rate).toBe(33.13);
    expect(p.total_miles).toBe(9.3);
    expect(p.total_minutes).toBe(23);
    expect(p.per_mile).toBe(1.42);
    expect(p.offer_kind).toBe('ride');
    expect(p.product_type).toBe('Comfort');
  });

  it('formatPerMileForVoice never says "163 dollars four"', () => {
    expect(formatPerMileForVoice(163.04)).toBe('163 dollars four cents per mile');
    expect(formatPerMileForVoice(1.4)).toBe('dollar forty per mile'); // unchanged below $100
  });
});

describe('checkSanity — the implausible-parse tripwire', () => {
  it('D2 live numbers trip on three independent signals', () => {
    const r = checkSanity(parseOfferText(D2_LIVE));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' | ')).toMatch(/750 above \$500/);
    expect(r.problems.join(' | ')).toMatch(/has no cents/);
    expect(r.problems.join(' | ')).toMatch(/163\.04\/mi above/);
    expect(r.problems.join(' | ')).toMatch(/2368\/hr above/);
  });

  it('an integer price ≥ $100 trips even when the derived rates land in band', () => {
    // "$1.25" → "$125" on a long, slow trip: $5/mi and $187/hr are in band — the missing cents are not
    const r = checkSanity({ price: 125, price_format: 'integer', total_miles: 25, total_minutes: 40 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['price $125 has no cents']);
  });

  // REGRESSION (review 2026-08-26): the no-cents rule only fired at >= $100, so a one-glyph
  // variant of the same incident — "$750" read as "$75O", or "$7.50" read as "$75" — sailed
  // through as a spoken ACCEPT at $16.30/mi. A cents-less price is the decimal-drop
  // signature at ANY magnitude; the *_no_cents ceilings catch it by the rate it implies.
  it('a cents-less price is caught by the rate it implies, not only by its magnitude', () => {
    const oneGlyph = checkSanity({ price: 75, price_format: 'integer', total_miles: 4.6, total_minutes: 19 });
    expect(oneGlyph.ok).toBe(false);
    expect(oneGlyph.problems.join(' | ')).toMatch(/cents-less price \$75/);
    // a plausible integer price is NOT a breach — only an implausible rate from one is
    expect(checkSanity({ price: 14, price_format: 'integer', total_miles: 6, total_minutes: 20 }).ok).toBe(true);
  });

  // REGRESSION (review 2026-08-26): the first ceilings turned real minimum-fare/surge hops
  // into "No data. Numbers look wrong." — $35 over 1 mi / 5 min is a real offer. Rate
  // ceilings now need a meaningful denominator (>= 1 mi, >= 5 min).
  it('legitimate short and surge offers do NOT trip', () => {
    expect(checkSanity({ price: 20, price_format: 'cents', total_miles: 2.5, total_minutes: 7 }).ok).toBe(true);   // $171/hr, $8/mi
    expect(checkSanity({ price: 30, price_format: 'cents', total_miles: 1.2, total_minutes: 9 }).ok).toBe(true);   // $25/mi
    expect(checkSanity({ price: 30, price_format: 'cents', total_miles: 0.4, total_minutes: 3 }).ok).toBe(true);   // tiny denominators — not judged
    expect(checkSanity({ price: 35, price_format: 'cents', total_miles: 1.0, total_minutes: 5 }).ok).toBe(true);   // surge minimum fare
    expect(checkSanity({ price: 2.5, price_format: 'cents', total_miles: 1.1, total_minutes: 8 }).ok).toBe(true);  // cheap delivery
    expect(checkSanity({ price: 0 }).ok).toBe(true); // 0 = "not read", not a breach (honest-floor territory)
    expect(checkSanity({}).ok).toBe(true);
    expect(checkSanity({ per_mile: 3.0 }).ok).toBe(true); // parity-grid shape
  });

  it('negative money is a broken extraction, never "not read"', () => {
    expect(checkSanity({ price: -5, price_format: 'cents', total_miles: 3, total_minutes: 10 }).problems).toEqual(['price -5 is negative']);
    expect(checkSanity({ price: 10, total_miles: -3, total_minutes: 10 }).ok).toBe(false);
  });

  it('per-driver sanity ceilings are honored; migrateRuleset fills gaps AND refuses nulls', () => {
    const rs = migrateRuleset({ ...DEFAULT_RULESET, sanity: { max_per_mile: 10 } });
    expect(rs.sanity).toEqual({ ...DEFAULT_RULESET.sanity, max_per_mile: 10 });
    expect(checkSanity({ price: 30, price_format: 'cents', total_miles: 1.2, total_minutes: 9 }, rs).ok).toBe(false);
    // REGRESSION (review): explicit nulls used to survive migration and disable the
    // tripwire wholesale through the ordinary PUT /rules path.
    const nulled = migrateRuleset({ ...DEFAULT_RULESET, sanity: { max_price: null, max_per_mile: null, max_per_hour: null, min_price: null } });
    expect(nulled.sanity).toEqual(DEFAULT_RULESET.sanity);
    expect(checkSanity(parseOfferText(D2_LIVE), nulled).ok).toBe(false);
  });
});

describe('evaluateDeterministic — gate order with the tripwire', () => {
  it('D2 live payload → NO DATA implausible_parse on the deterministic path (never ACCEPT)', () => {
    const p = parseOfferText(D2_LIVE);
    const tier = classifyTier(p.product_type, DEFAULT_RULESET);
    expect(tier).toBe('delivery');
    const v = evaluateDeterministic(tier, p, DEFAULT_RULESET);
    expect(v.decision).toBe('NO DATA');
    expect(v.reasonKind).toBe('implausible_parse');
    // …and under the old "standard" routing the same numbers are ALSO caught
    const asRide = evaluateDeterministic('standard', { ...p, offer_kind: 'ride' }, DEFAULT_RULESET);
    expect(asRide.decision).toBe('NO DATA');
    expect(asRide.reasonKind).toBe('implausible_parse');
  });

  it('share identity-reject still wins over garbage numbers', () => {
    const v = evaluateDeterministic('share', { price: 750, price_format: 'integer', total_miles: 4.6, total_minutes: 19, per_mile: 163.04 }, DEFAULT_RULESET);
    expect(v.decision).toBe('REJECT');
    expect(v.reasonKind).toBe('share');
  });

  it('R1 Comfort and R2 UberX decide exactly as before (premium ACCEPT / standard ACCEPT)', () => {
    const c = parseOfferText(R1_COMFORT);
    expect(evaluateDeterministic(classifyTier(c.product_type, DEFAULT_RULESET), c, DEFAULT_RULESET)).toMatchObject({ decision: 'ACCEPT', reasonKind: 'accept', perMile: 1.42 });
    const u = parseOfferText(R2_UBERX);
    expect(evaluateDeterministic(classifyTier(u.product_type, DEFAULT_RULESET), u, DEFAULT_RULESET)).toMatchObject({ decision: 'ACCEPT', reasonKind: 'accept', perMile: 1.4 });
  });
});

describe('delivery lane — evaluateDelivery', () => {
  it('D1 clean at defaults: $1.63/mi passes the mile floor, $24/hr fails the hourly floor → REJECT delivery_low_hr', () => {
    const p = parseOfferText(D1_CLEAN);
    const v = evaluateDeterministic('delivery', p, DEFAULT_RULESET);
    expect(v).toMatchObject({ decision: 'REJECT', reasonKind: 'delivery_low_hr', perMile: 1.63, perHour: 24, delivery: true });
  });

  it('floors and cap in order: too_far → low_mi → low_hr → ACCEPT; tip call-out marks thin margins', () => {
    const rs = migrateRuleset({ ...DEFAULT_RULESET, delivery: { enabled: true, min_per_mile: 1.5, min_per_hour: 20, max_total_miles: 12 } });
    expect(evaluateDelivery({ price: 30, total_miles: 13, total_minutes: 30 }, rs).reasonKind).toBe('delivery_too_far');
    expect(evaluateDelivery({ price: 6, total_miles: 5, total_minutes: 15 }, rs).reasonKind).toBe('delivery_low_mi');
    expect(evaluateDelivery({ price: 7.5, total_miles: 4.6, total_minutes: 30 }, rs).reasonKind).toBe('delivery_low_hr'); // $15/hr
    const ok = evaluateDelivery({ price: 7.5, total_miles: 4.6, total_minutes: 19, tip_included: true }, rs);
    expect(ok).toMatchObject({ decision: 'ACCEPT', reasonKind: 'delivery_accept', perHour: 24 });
    expect(ok.tipThin).toBe(true); // 1.63 < 1.5 × 1.15 with the tip counted in
    const wide = evaluateDelivery({ price: 12, total_miles: 4.6, total_minutes: 19, tip_included: true }, rs);
    expect(wide.decision).toBe('ACCEPT');
    expect(wide.tipThin).toBe(false);
  });

  it('enabled:false → NO DATA delivery_off; missing minutes with an hourly floor → NO DATA (no fallback)', () => {
    const off = migrateRuleset({ ...DEFAULT_RULESET, delivery: { enabled: false } });
    expect(evaluateDelivery({ price: 20, total_miles: 4, total_minutes: 10 }, off).reasonKind).toBe('delivery_off');
    expect(evaluateDelivery({ price: 20, total_miles: 4 }, DEFAULT_RULESET).reasonKind).toBe('no_data');
  });

  it('ride gates never apply to a delivery: a 4.2★ un-Verified delivery still ACCEPTs on its two floors', () => {
    const v = evaluateDeterministic('delivery', { price: 15, total_miles: 5, total_minutes: 20, rating: 4.2 }, DEFAULT_RULESET);
    expect(v.decision).toBe('ACCEPT');
  });
});

describe('prompts + schema + migration round-trip', () => {
  it('vision prompt carries a DELIVERY section at defaults, without the words the default pins forbid', () => {
    const v = buildPhase1VisionPrompt(DEFAULT_RULESET);
    expect(v).toContain('DELIVERY (');
    expect(v).toContain('REJECT if $/hr<25');
    expect(v).toContain('"tip_included":false');
    expect(v).not.toContain('fallback');
    expect(v).not.toContain('COMFORT (');
  });

  // REGRESSION (review 2026-08-26): with delivery OFF the prompt said nothing about
  // delivery at all, so the model had no word for the card and silently judged it by the
  // ride rules — the promised "delivery is off in your rules" never happened.
  it('delivery OFF still teaches the model to LABEL a delivery, then refuse it', () => {
    const off = migrateRuleset({ ...DEFAULT_RULESET, delivery: { enabled: false } });
    const v = buildPhase1VisionPrompt(off);
    expect(v).toContain('DELIVERY (');
    expect(v).toContain('delivery off');
    expect(v).not.toContain('REJECT if $/hr<');           // no floors when the lane is off
    expect(buildPhase2Prompt(off)).toContain('delivery off');
  });

  it('Phase-2 prompt asks for offer_kind + tip_included and renders the delivery block', () => {
    const p2 = buildPhase2Prompt(DEFAULT_RULESET);
    expect(p2).toContain('"offer_kind": "ride"|"delivery"');
    expect(p2).toContain('DELIVERY (offer_kind "delivery"');
  });

  it('buildPhase1Prompt("delivery") renders delivery rules, never ride rules', () => {
    const p = buildPhase1Prompt('delivery', DEFAULT_RULESET);
    expect(p).toContain('DELIVERY card');
    expect(p).not.toContain('Rules (first match wins):\n1. REJECT if rating');
  });

  it('a pre-v3.2 stored config migrates with delivery + sanity defaults and validates strictly', () => {
    const stored = JSON.parse(JSON.stringify(DEFAULT_RULESET));
    delete stored.delivery; delete stored.sanity;
    const migrated = migrateRuleset(stored);
    expect(migrated.delivery).toEqual(DEFAULT_RULESET.delivery);
    expect(migrated.sanity).toEqual(DEFAULT_RULESET.sanity);
    const v = validateRuleset(migrated);
    expect(v.ok).toBe(true);
    // idempotent + edits survive
    const edited = migrateRuleset({ ...migrated, delivery: { ...migrated.delivery, min_per_hour: 30 } });
    expect(edited.delivery.min_per_hour).toBe(30);
    expect(validateRuleset(edited).ok).toBe(true);
    expect(validateRuleset({ ...migrated, delivery: { ...migrated.delivery, bogus: 1 } }).ok).toBe(false);
  });

  it('shortcut_system: aliases map, value is normalized, absent → null', () => {
    expect(normalizeOfferBody({ Client: 'MacroDroid/5.65' }).body.shortcut_system).toBe('MacroDroid/5.65');
    expect(normalizeShortcutSystem('  MacroDroid/5.65 (Samsung)  ')).toBe('macrodroid/5.65 samsung');
    expect(normalizeShortcutSystem('x'.repeat(80))).toHaveLength(40);
    expect(normalizeShortcutSystem('')).toBeNull();
    expect(normalizeShortcutSystem(42)).toBeNull();
  });
});
