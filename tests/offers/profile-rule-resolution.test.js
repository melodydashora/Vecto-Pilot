import { jest, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { DEFAULT_RULESET, migrateRuleset, evaluateDeterministic } from '../../server/lib/offers/rules-engine.js';
import { initialRulesetFromProfile } from '../../server/lib/offers/profile-ruleset.js';
import { formatDriverServicePreferences, formatDriverEconomics } from '../../server/lib/driver-preferences.js';

const execute = jest.fn();
const external = jest.fn(async () => { throw new Error('Unexpected external analysis'); });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { execute } }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: external }));
jest.unstable_mockModule('../../server/lib/offers/downscale-offer-image.js', () => ({ downscaleOfferImage: external }));
jest.unstable_mockModule('../../server/lib/events/pipeline/geocodeEvent.js', () => ({ geocodeEventAddress: external }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ resolvePlaceByTextSearch: external }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromCoords: external }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ offerHookLimiter: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => { req.auth = { userId: 'driver' }; next(); } }));
const { resolveRuleset, _clearCache, invalidateUser, hashRuleset } = await import('../../server/lib/offers/ruleset-store.js');
const { default: rulesRouter } = await import('../../server/api/offer-analyzer/index.js');
const { default: hookRouter } = await import('../../server/api/hooks/analyze-offer.js');
const app = express().use(express.json()).use('/rules-api', rulesRouter).use('/hooks', hookRouter);

beforeEach(() => { _clearCache(); jest.clearAllMocks(); execute.mockReset(); });

test.each([true, false, null])('unsaved editor and ingestion use identical signup-derived rules (shared=%s)', async prefShared => {
  const profile = { user_id: 'driver', pref_shared: prefShared, max_deadhead_mi: 0, config: null, version: null };
  execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [profile] }).mockResolvedValueOnce({ rows: [profile] });
  const editor = await request(app).get('/rules-api/rules');
  const ingest = await resolveRuleset('known-token');
  expect(editor.status).toBe(200);
  expect(editor.body.config).toEqual(ingest.ruleset);
  expect(editor.body.hash).toBe(ingest.hash);
  expect(ingest.ruleset.share.auto_reject).toBe(prefShared === true ? false : true);
  expect(ingest.ruleset.global.pickup_limits.max_miles).toBe(0);
  expect(ingest.ruleset).not.toBe(DEFAULT_RULESET);
});

test('saved analyzer gates override signup values in both consumers without writes', async () => {
  const config = migrateRuleset(null);
  config.share.auto_reject = true;
  config.global.pickup_limits = { max_miles: 2, max_minutes: 4 };
  const row = { user_id: 'driver', pref_shared: true, max_deadhead_mi: 0, config, version: 8, config_hash: hashRuleset(config) };
  execute.mockResolvedValue({ rows: [row] });
  const editor = await request(app).get('/rules-api/rules');
  const ingest = await resolveRuleset('known-token');
  expect(editor.body.config).toEqual(config);
  expect(ingest).toMatchObject({ ruleset: config, version: 8, status: 'saved' });
  expect(execute).toHaveBeenCalledTimes(2); // read paths only, no automatic persistence
});

test('profile changes invalidate unsaved inherited rules without changing frozen defaults', async () => {
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'driver', pref_shared: false, version: null }] });
  expect((await resolveRuleset('token')).ruleset.share.auto_reject).toBe(true);
  invalidateUser('driver');
  execute.mockResolvedValueOnce({ rows: [{ user_id: 'driver', pref_shared: true, version: null }] });
  expect((await resolveRuleset('token')).ruleset.share.auto_reject).toBe(false);
  expect(DEFAULT_RULESET.share.auto_reject).toBe(true);
});

test('unknown/incompatible economics and eligibility never invent offer rate gates', () => {
  expect(initialRulesetFromProfile({ pref_shared: null, max_deadhead_mi: null, earnings_goal_daily: 500, elig_luxury_suv: true }).config).toEqual(migrateRuleset(null));
  expect(initialRulesetFromProfile({ max_deadhead_mi: -1 }).sourceFields).toEqual([]);
});

test('inherited zero pickup distance is a real reject gate and acceptance-rate protection cannot override it', () => {
  const { config } = initialRulesetFromProfile({ max_deadhead_mi: 0 });
  config.global.acceptance_rate_protection = { min_per_total_mile: 0 };
  const offer = { price: 20, price_format: 'cents', pickup_miles: 0.1, total_miles: 5, total_minutes: 15, per_mile: 4 };
  expect(evaluateDeterministic('standard', offer, config)).toMatchObject({ decision: 'REJECT', reasonKind: 'pickup' });
});

test.each(['unknown', 'database-failure', 'invalid-saved-rules'])('%s returns spoken NO DATA before model, image, or geocoding work', async failure => {
  if (failure === 'database-failure') execute.mockRejectedValue(new Error('Synthetic database unavailable'));
  else execute.mockResolvedValue({ rows: failure === 'unknown' ? [] : [{ user_id: 'driver', config: {}, version: 1 }] });
  const response = await request(app).post('/hooks/analyze-offer').set('x-shortcut-token', 'invalid-or-unavailable')
    .send({ text: 'UberX\n$25.00\n5.00 Verified\n1 min (0.2 mi) away\n10 min (3.0 mi) trip' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: false, decision: 'NO DATA', reason: 'Personal rules unavailable', personal_rules_verified: false, ruleset_version: null });
  expect(Number.isNaN(Date.parse(response.body.analyzed_at))).toBe(false);
  expect(response.body.voice).toMatch(/personal rules could not be verified.*retry when safe/i);
  expect(external).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(1);
});

test.each([true, false])('verdict metadata verifies only actual personal rules (token=%s) and replay retains analysis time', async personalized => {
  const config = migrateRuleset(null);
  if (personalized) external.mockResolvedValueOnce({ success: false, error: 'Synthetic second sweep unavailable' });
  execute.mockResolvedValue({ rows: [{ user_id: 'driver', config, version: 6, config_hash: hashRuleset(config) }] });
  const analyze = () => {
    const req = request(app).post('/hooks/analyze-offer');
    if (personalized) req.set('x-shortcut-token', 'known-metadata-token');
    return req.send({ text: 'UberX Share\n$10.00\n5.00 Verified\n1 min (0.2 mi) away\n10 min (3.0 mi) trip' });
  };
  const response = await analyze();
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ decision: 'REJECT', reason: 'share', personal_rules_verified: personalized, ruleset_version: personalized ? 6 : null });
  expect(Number.isNaN(Date.parse(response.body.analyzed_at))).toBe(false);
  const replay = await analyze();
  expect(replay.body.duplicate).toBe(true);
  expect(replay.body.analyzed_at).toBe(response.body.analyzed_at);
  if (personalized) {
    expect(external).toHaveBeenCalledTimes(1);
    expect(external.mock.calls[0][0]).toBe('OFFER_ANALYZER_DEEP');
  } else expect(external).not.toHaveBeenCalled();
});

test('Coach receives explicit avoidance, unknowns, and zero economics', () => {
  expect(formatDriverServicePreferences({ pref_shared: false, pref_teen: null, pref_assist: true }))
    .toBe('pet-friendly rides: not specified; unaccompanied teen rides: not specified; assistance rides: willing; shared rides: avoid');
  expect(formatDriverEconomics({ earnings_goal_daily: '0.00', max_deadhead_mi: 0 })).toMatch(/Daily earnings goal: 0.*Maximum empty pickup distance: 0 miles/);
});

test.each([
  { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 },
  { latitude: '0junk', longitude: '0' }, { latitude: '', longitude: '' },
  { latitude: null, longitude: null }, { latitude: 1 }, { latitude: false, longitude: 0 },
])('invalid provided coordinates stop before rules or analysis: %j', async coords => {
  const response = await request(app).post('/hooks/analyze-offer').send({ text: 'Share', ...coords });
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ decision: 'NO DATA', reason_kind: 'invalid_coordinates' });
  expect(execute).not.toHaveBeenCalled();
  expect(external).not.toHaveBeenCalled();
});

test.each([{ latitude: 0, longitude: 0 }, { latitude: '0', longitude: '-0.000001' }])('zero coordinates remain valid at the offer boundary: %j', async coords => {
  const response = await request(app).post('/hooks/analyze-offer').send({ text: 'Share', ...coords });
  expect(response.status).toBe(200);
  expect(response.body.decision).toBe('REJECT');
  expect(external).not.toHaveBeenCalled();
});
