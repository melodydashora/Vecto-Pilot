const { structuredClone, AbortController } = globalThis;
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getCoachContextProgress, describeStrategyStatus } from '../../server/lib/ai/coach-context-progress.js';
import { formatCoachSourceContext } from '../../server/lib/ai/coach-source-context.js';
import { DEFAULT_RULESET } from '../../server/lib/offers/rules-engine.js';
import { hashRuleset } from '../../server/lib/offers/ruleset-hash.js';

let rows = [], failure = false;
const selected = [], predicates = [], limits = [];
const db = { select: fields => {
  selected.push(fields);
  const chain = { from: () => chain, leftJoin: () => chain, where: predicate => { predicates.push(new PgDialect().sqlToQuery(predicate)); return chain; }, orderBy: () => chain, limit: async limit => {
    limits.push(limit); if (failure) throw new Error('synthetic read failure'); return rows;
  } };
  return chain;
} };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const { RideshareCoachDAL } = await import('../../server/lib/ai/rideshare-coach-dal.js');
const dal = new RideshareCoachDAL();
beforeEach(() => { rows = []; failure = false; selected.length = 0; predicates.length = 0; limits.length = 0; });

describe('Coach persisted source updates', () => {
  test('owned history selects the saved timezone beside each real snapshot instant', async () => {
    rows = [{ snapshot_id: 'saved-snapshot', created_at: '2026-11-01T06:30:00Z', timezone: 'America/New_York' }];
    const history = await dal.getSnapshotHistory('alice', 10);
    expect(selected[0].timezone).toBeDefined();
    expect(history[0]).toMatchObject({ created_at: rows[0].created_at, timezone: rows[0].timezone });
    expect(predicates[0].params).toEqual(['alice']);
  });
  test('current owner rules are reread each turn and historical receipts remain distinct', async () => {
    const config = structuredClone(DEFAULT_RULESET);
    rows = [{ config, version: 1, config_hash: hashRuleset(config), updated_at: '2026-09-29T08:00:00Z' }];
    const early = await dal.getOfferRules('alice');
    const edited = structuredClone(config); edited.global.rating_floor = 4.95;
    rows = [{ config: edited, version: 2, config_hash: hashRuleset(edited), updated_at: '2026-09-29T09:00:00Z' }];
    const later = await dal.getOfferRules('alice');
    expect(early).toMatchObject({ source_state: 'saved', version: 1 });
    expect(later).toMatchObject({ source_state: 'saved', version: 2, config: { global: { rating_floor: 4.95 } } });
    await dal.getOfferRules('bob');
    expect(predicates.map(p => p.params[0])).toEqual(['alice', 'alice', 'bob']);
    expect(predicates.every(p => p.sql.includes('offer_rulesets') && p.sql.includes('user_id'))).toBe(true);
    const prompt = formatCoachSourceContext(null, null, { offerRules: later,
      driverProfile: { selected_services: ['comfort'], elig_economy: true },
      offerHistory: { offers: [{ decision: 'ACCEPT', ruleset_version: 1, ruleset_hash: early.hash }] } });
    expect(prompt).toContain(later.hash); expect(prompt).toContain(early.hash);
    expect(prompt).toContain('selected_services');
    expect(prompt).toContain('Current rules do not prove which rules produced an older offer');
  });

  test('rules absence, unsaved profile defaults, invalid receipt and read error cannot masquerade as saved rules', async () => {
    expect(await dal.getOfferRules(null)).toMatchObject({ source_state: 'unavailable', config: null });
    expect(await dal.getOfferRules('alice')).toMatchObject({ source_state: 'unavailable', config: null });
    expect(await dal.getOfferRules('alice', { user_id: 'bob', pref_shared: true })).toMatchObject({ source_state: 'unavailable' });
    expect(await dal.getOfferRules('alice', { user_id: 'alice', pref_shared: true })).toMatchObject({ source_state: 'profile_defaults', version: null, config: { share: { auto_reject: false } } });
    rows = [{ config: DEFAULT_RULESET, version: 1, config_hash: 'wrong' }];
    expect(await dal.getOfferRules('alice')).toMatchObject({ source_state: 'invalid', config: null });
    const malformed = { ...DEFAULT_RULESET, global: [] };
    rows = [{ config: malformed, version: 1, config_hash: hashRuleset(malformed) }];
    expect(await dal.getOfferRules('alice')).toMatchObject({ source_state: 'invalid', config: null });
    failure = true;
    expect(await dal.getOfferRules('alice', { user_id: 'alice' })).toMatchObject({ source_state: 'read_failed', config: null });
  });

  test('a valid legacy saved receipt remains distinct from its migrated effective rules', async () => {
    const legacy = structuredClone(DEFAULT_RULESET); delete legacy.delivery; delete legacy.sanity;
    rows = [{ config: legacy, version: 2, config_hash: hashRuleset(legacy) }];
    const rules = await dal.getOfferRules('alice');
    expect(rules.source_state).toBe('saved');
    expect(rules.hash).toBe(hashRuleset(legacy));
    expect(rules.effective_hash).toBe(hashRuleset(rules.config));
    expect(rules.effective_hash).not.toBe(rules.hash);
  });

  test('driver context projects selected services and requires an active primary vehicle', async () => {
    rows = [{ id: 'profile-a', user_id: 'alice', selected_services: ['comfort'] }];
    const context = await dal.getDriverProfile('alice');
    expect(context.profile.selected_services).toEqual(['comfort']);
    expect(selected[0].selected_services).toBeDefined();
    expect(predicates[0].params).toEqual(['alice']);
    expect(predicates[1].sql).toMatch(/is_primary/);
    expect(predicates[1].sql).toMatch(/is_active/);
    expect(predicates[1].params).toEqual(['profile-a', true, true]);
  });
  test('snapshot evidence stays intact without inventing Sunday or midnight for missing data', async () => {
    rows = [{ snapshot_id: 'snap', user_id: 'alice', created_at: '2026-09-11T08:00:00Z', lat: 1, lng: 2, dow: null, hour: null }];
    const snapshot = await dal.getHeaderSnapshot('snap');
    expect(selected).toHaveLength(1);
    expect(snapshot.source_record).toEqual(rows[0]);
    expect(snapshot).toMatchObject({ dow: null, hour: null, day_of_week: 'Unknown', lat: 1, lng: 2 });
    expect(getCoachContextProgress({ snapshot }).snapshot.state).toBe('partial');
  });
  test('each owned offer read includes the later sweep without changing its original decision', async () => {
    rows = [{ id: 'offer-a', decision: 'ACCEPT', per_mile: '0', created_at: '2026-09-11T08:00:00Z', updated_at: '2026-09-11T08:00:00Z', parsed_data_json: { phase: 1 } }];
    const early = await dal.getOfferHistory('alice');
    rows = [{ ...rows[0], updated_at: '2026-09-11T08:02:00Z', parsed_data_json: { phase: 2, venue_context: 'saved second sweep' }, raw_ai_response: '{"reason":"stored analysis"}' }];
    const later = await dal.getOfferHistory('alice');
    expect(early.offers[0].parsed_data_json.phase).toBe(1);
    expect(later.offers[0]).toMatchObject({ decision: 'ACCEPT', parsed_data_json: { phase: 2 }, raw_ai_response: '{"reason":"stored analysis"}' });
    expect(later.stats.avg_per_mile).toBe('0.00');
    expect(predicates).toHaveLength(2);
    expect(predicates.every(p => p.sql.includes('user_id') && p.params[0] === 'alice')).toBe(true);
    expect(selected).toEqual([undefined, undefined]);
    expect(limits).toEqual([20, 20]);
    const prompt = formatCoachSourceContext({ created_at: rows[0].created_at }, { source_record: { status: 'pending', news: { title: 'already saved' }, events: null } }, { strategy: null, offerHistory: later });
    expect(prompt).toContain('saved second sweep');
    expect(prompt).toContain('already saved');
    expect(prompt).toContain('"events": null');
    expect(prompt).toContain('never OCR a new offer or issue a new ACCEPT/REJECT/CANCEL');
  });

  test('empty history, read failure and absent owner are distinct', async () => {
    expect(await dal.getOfferHistory('alice')).toMatchObject({ source_state: 'available', offers: [] });
    failure = true;
    expect(await dal.getOfferHistory('alice')).toMatchObject({ source_state: 'read_failed', offers: [] });
    const reads = selected.length;
    expect(await dal.getOfferHistory(null)).toMatchObject({ source_state: 'unavailable' });
    expect(selected).toHaveLength(reads);
  });

  test('full Strategy survives independently of Briefing and records actual update time', async () => {
    rows = [{ id: 's', snapshot_id: 'snap', created_at: '2026-09-11T07:00:00Z', updated_at: '2026-09-11T08:00:00Z', status: 'failed', phase: 'venues', error_message: 'saved failure', strategy_for_now: 'Earlier partial text' }];
    const strategy = await dal.getLatestStrategy('snap');
    expect(selected).toHaveLength(1);
    expect(strategy).toMatchObject({ phase: 'venues', error_message: 'saved failure', strategy_timestamp: '2026-09-11T08:00:00.000Z' });
    expect(describeStrategyStatus(strategy)).toBe('Generation failed — last updated 2026-09-11T08:00:00.000Z');
    const progress = getCoachContextProgress({ strategy, briefing: { exists: true, status: 'pending' }, offerHistory: { source_state: 'read_failed' } }, '2026-09-11T09:00:00Z');
    expect(progress.strategy).toMatchObject({ state: 'failed', created_at: '2026-09-11T07:00:00.000Z', updated_at: '2026-09-11T08:00:00.000Z' });
    expect(progress.read_at).toBe('2026-09-11T09:00:00.000Z');
    expect(progress.briefing.state).toBe('partial');
    expect(progress.offers.state).toBe('read_failed');
    failure = true;
    expect((await dal.getLatestStrategy('snap')).source_state).toBe('read_failed');
  });
});


describe('Coach saved weather presentation', () => {
  test('preserves structured snapshot wind units and numeric Briefing temperature, wind and zero humidity', () => {
    const prompt = dal.formatContextForPrompt({
      snapshot: { weather: { tempF: 32, conditions: 'Clear', windSpeed: { value: 0, unit: 'KILOMETERS_PER_HOUR' } } },
      briefing: { weather_current: { temperature: 0, tempF: 32, tempC: 0, tempUnit: 'C', windSpeed: 16, windSpeedUnit: 'km/h', humidity: 0 }, weather_forecast: [{ temperature: 1, tempUnit: 'C' }] },
    });
    expect(prompt).toContain('Wind: 0 km/h');
    expect(prompt).toContain('Current: 0°C');
    expect(prompt).toContain('Wind: 16 km/h');
    expect(prompt).toContain('Humidity: 0%');
    expect(prompt).toContain('Forecast (next 6h): 1°C');
    expect(prompt).not.toContain('[object Object]');
  });
});


describe('Coach automatic learning cancellation and receipts', () => {
  test('failed tip inserts are not counted as saved', async () => {
    const save = jest.spyOn(dal, 'saveUserNote').mockResolvedValue(null);
    try { expect(await dal.extractAndSaveTips('owner', 'Try a quieter street. Consider an earlier break.')).toBe(0); }
    finally { save.mockRestore(); }
  });
  test('cancel after the first saved tip does not begin subsequent tip writes', async () => {
    const controller = new AbortController();
    const save = jest.spyOn(dal, 'saveUserNote').mockImplementation(async () => { controller.abort(); return { id: 'saved' }; });
    try {
      expect(await dal.extractAndSaveTips('owner', 'Try a quieter street. Consider an earlier break.', { signal: controller.signal })).toBe(1);
      expect(save).toHaveBeenCalledTimes(1);
    } finally { save.mockRestore(); }
  });
});
