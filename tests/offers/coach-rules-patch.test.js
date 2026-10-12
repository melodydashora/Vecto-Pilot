const { structuredClone } = globalThis;
import { describe, test, expect } from '@jest/globals';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';
import { applyCoachRulesPatch, coachRulesPatchSchema, coachRulesInstructions } from '../../server/lib/offers/coach-rules-patch.js';
const action = changes => ({ reason: 'Driver requested tuning from saved evidence', changes });
const apply = (config, changes) => applyCoachRulesPatch(config, action(changes));
const change = (path, value, extra = {}) => ({ path, value, ...extra });
const defaults = () => migrateRuleset(null);

describe('Coach Offer Analyzer control patches', () => {
  test('a tier slider derives the actual ladder while preserving every untouched group and saved field', () => {
    const baseline = defaults();
    const before = structuredClone(baseline);
    const result = apply(baseline, [change('tiers.standard.floor_per_mile', 1.5), change('tiers.standard.max_trip_minutes', 25)]);
    expect(result.config.tiers.standard.accept_ladder).toEqual([{ min_per_mile: 1.5, max_total_min: 25 }]);
    expect(result.config.tiers.premium).toEqual(before.tiers.premium);
    expect(result.config.sanity).toEqual(before.sanity);
    expect(result.config.geo).toEqual(before.geo);
    expect(result.config.tier_products).toEqual(before.tier_products);
    expect(baseline).toEqual(before);
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tiers.standard.floor_per_mile', after: 1.5 }),
      expect.objectContaining({ path: 'tiers.standard.accept_ladder', after: [{ min_per_mile: 1.5, max_total_min: 25 }] }),
    ]));
  });
  test.each(['min_per_mile', 'min_per_minute'])('time exception %s preserves the two-rate UI conjunction when unless is null', key => {
    const baseline = defaults();
    baseline.global.time_limit = { max_total_minutes: 20, unless: null };
    const { config } = apply(baseline, [change(`global.time_limit.unless.${key}`, 1.5)]);
    expect(config.global.time_limit.unless).toEqual({ min_per_mile: key === 'min_per_mile' ? 1.5 : 2, min_per_minute: key === 'min_per_minute' ? 1.5 : 1 });
  });
  test('enabling preserves an existing group; disabling makes it inert and reports all changed values', () => {
    const baseline = defaults();
    baseline.global.pickup_limits = { max_miles: 9, max_minutes: 17 };
    expect(apply(baseline, [change('global.pickup_limits.enabled', true)]).changes).toEqual([]);
    const disabled = apply(baseline, [change('global.pickup_limits.enabled', false)]);
    expect(disabled.config.global.pickup_limits).toBeNull();
    expect(disabled.changes).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'global.pickup_limits.max_miles', before: 9, after: null })]));
    expect(apply(disabled.config, [change('global.pickup_limits.max_miles', 6)]).config.global.pickup_limits).toEqual({ max_miles: 6, max_minutes: 8 });
  });
  test('nullable rate and delivery switches disable without losing unrelated preferences', () => {
    const baseline = defaults();
    const { config } = apply(baseline, [change('tiers.comfort.enabled', true), change('tiers.comfort.floor_per_minute', null), change('delivery.min_per_hour', null), change('delivery.enabled', false)]);
    expect(config.tiers.comfort.floor_per_minute).toBeNull();
    expect(config.tiers.comfort.accept_ladder).toEqual([{ min_per_mile: 1.25, max_total_min: 20 }]);
    expect(config.delivery).toEqual({ ...baseline.delivery, min_per_hour: null, enabled: false });
  });
  test('notice and auto-reject groups preserve siblings and use null when all switches are off', () => {
    const baseline = defaults();
    baseline.global.notices = { verified_rider: true, on_the_way_filter: false, deadhead_reduction: false, hourly_rate: true };
    const first = apply(baseline, [change('global.notices.verified_rider', false)]).config;
    expect(first.global.notices.hourly_rate).toBe(true);
    expect(apply(first, [change('global.notices.hourly_rate', false)]).config.global.notices).toBeNull();
    baseline.global.auto_reject = { multiple_stops: true, round_trip: true };
    expect(apply(baseline, [change('global.auto_reject.multiple_stops', false)]).config.global.auto_reject.round_trip).toBe(true);
    expect(apply(baseline, [change('global.auto_reject.multiple_stops', false), change('global.auto_reject.round_trip', false)]).config.global.auto_reject).toBeNull();
  });
  test('existing place controls preserve verified identity and target place_id after removal', () => {
    const baseline = defaults();
    baseline.avoid = ['a', 'b'].map((id, index) => ({ place_id: id, label: `Public fixture ${id}`, lat: 33 + index, lng: -96, mode: 'destination_in', radius_mi: 6, enabled: true }));
    const { config, changes } = apply(baseline, [change('avoid.remove', true, { place_id: 'a' }), change('avoid.enabled', false, { place_id: 'b' })]);
    expect(config.avoid).toEqual([{ ...baseline.avoid[1], enabled: false }]);
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'avoid[a]', before: baseline.avoid[0], after: null }),
      expect.objectContaining({ path: 'avoid[b].enabled', before: true, after: false }),
    ]));
    expect(() => apply(baseline, [change('avoid.enabled', false, { place_id: 'invented' })])).toThrow('existing saved place_id');
  });
  test.each([
    ['global.rating_floor', 4.85], ['global.require_verified', false], ['share.auto_reject', false],
    ['global.safety_road_types', false], ['global.commercial_staging', false],
    ['global.pickup_limits.max_minutes', 9], ['global.time_limit.max_total_minutes', 25],
    ['global.time_limit.enabled', true], ['global.acceptance_rate_protection.enabled', true],
    ['global.acceptance_rate_protection.min_per_total_mile', 1.5],
    ['delivery.min_per_mile', 2.15], ['delivery.min_per_hour', 31], ['delivery.max_total_miles', 15],
    ['tiers.standard.floor_per_minute', 0.75], ['tiers.premium.max_total_miles', 18],
    ['tiers.xl.enabled', true], ['tiers.xl.max_trip_minutes', 28],
    ['global.notices.on_the_way_filter', true], ['global.notices.deadhead_reduction', true],
  ])('valid UI control %s is actionable', (path, value) => {
    expect(() => apply(defaults(), [change(path, value)])).not.toThrow();
  });
  test.each([
    ['__proto__.polluted', true], ['constructor.prototype.polluted', true], ['schema_version', 1],
    ['basis', 'active_time'], ['sanity.max_price', 999], ['tiers.standard.accept_ladder', 1],
    ['global.rating_floor', 6], ['global.rating_floor', '4.85'], ['global.rating_floor', 4.851],
    ['global.require_verified', 1], ['delivery.min_per_hour', 0], ['tiers.xl.max_trip_minutes', 60.5],
    ['avoid.lat', 33],
  ])('rejects unsupported or invalid control %s=%s', (path, value) => {
    expect(coachRulesPatchSchema.safeParse(action([change(path, value)])).success).toBe(false);
  });
  test('rejects empty, duplicate and identity-bearing actions', () => {
    expect(coachRulesPatchSchema.safeParse(action([])).success).toBe(false);
    expect(coachRulesPatchSchema.safeParse(action([change('global.require_verified', true), change('global.require_verified', false)])).success).toBe(false);
    expect(coachRulesPatchSchema.safeParse({ ...action([change('global.require_verified', true)]), user_id: 'other' }).success).toBe(false);
    expect(coachRulesPatchSchema.safeParse(action([change('global.time_limit.enabled', false), change('global.time_limit.max_total_minutes', 20)])).success).toBe(false);
  });
  test('instructions authorize directed tuning from evidence but keep review and saved records read-only', () => {
    const prompt = coachRulesInstructions();
    expect(prompt).toContain('does not require the driver to choose every numeric value');
    expect(prompt).toContain('alone NEVER authorize settings changes');
    expect(prompt).toContain('Do not tune automatically between turns');
    expect(prompt).toContain('global.notices.hourly_rate');
  });
});
