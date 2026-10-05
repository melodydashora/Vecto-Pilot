import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';

let ruleset;
let selectedServices;
let reply;
let storeExpected;
const stored = [];
const notifications = [];
const dialect = new PgDialect();
let requestId = 0;
const model = jest.fn(async role => role === 'OFFER_ANALYZER'
  ? reply
  : { success: false, error: 'Synthetic deep failure' });
const execute = jest.fn(async () => ({ rows: storeExpected ? [{ timezone: 'UTC', created_at: new Date() }] : [] }));
const transaction = jest.fn(async work => work({
  execute: async statement => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes('pg_notify')) notifications.push(JSON.parse(query.params[0]));
    return { rows: [] };
  },
  insert: () => ({ values: row => ({ returning: async () => { stored.push(row); return [{ id: 'fixture-offer' }]; } }) }),
}));
const forbidden = jest.fn(async () => { throw new Error('Unexpected external transport'); });
const geocode = jest.fn(forbidden);
const places = jest.fn(forbidden);
const timezone = jest.fn(forbidden);
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { execute, transaction } }));
jest.unstable_mockModule('../../server/lib/offers/ruleset-store.js', () => ({
  resolveRuleset: async () => ({ ruleset, userId: 'fixture-driver', version: 2, hash: String(requestId),
    status: 'saved', selectedServices }),
}));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/lib/offers/downscale-offer-image.js', () => ({
  downscaleOfferImage: async (buffer, mimeType) => ({ buffer, mimeType, downscaled: false }),
}));
jest.unstable_mockModule('../../server/lib/events/pipeline/geocodeEvent.js', () => ({ geocodeEventAddress: geocode }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ resolvePlaceByTextSearch: places }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromCoords: timezone }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ offerHookLimiter: (_req, _res, next) => next() }));
const { default: router } = await import('../../server/api/hooks/analyze-offer.js');
const app = express().use(express.json()).use('/hooks', router);
const completeText = 'UberX\n$20.00\n5.00 Verified\n5 min (2.0 mi) away\n10 min (4.0 mi) trip';
const modelOffer = (fields = {}) => ({
  price: 20, total_miles: 6, total_minutes: 15,
  pickup_miles: 2, pickup_minutes: 5, ride_miles: 4, ride_minutes: 10,
  product: 'UberX', rating: 5, judgment_reject: '', decision: 'ACCEPT', reason: '$3.33 6.0mi', ...fields,
});
const success = fields => ({ success: true, model: 'fixture-fast-model', text: JSON.stringify(modelOffer(fields)) });
const analyze = body => request(app).post('/hooks/analyze-offer')
  .set('x-shortcut-token', `fixture-${requestId}`).send(body);
const finishBackground = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

beforeEach(() => {
  requestId++;
  ruleset = migrateRuleset(null);
  selectedServices = null;
  storeExpected = false;
  stored.length = 0;
  notifications.length = 0;
  reply = success();
  jest.clearAllMocks();
  execute.mockImplementation(async () => ({ rows: storeExpected ? [{ timezone: 'UTC', created_at: new Date() }] : [] }));
  for (const transport of [geocode, places, timezone]) transport.mockReset().mockImplementation(forbidden);
  model.mockImplementation(async role => role === 'OFFER_ANALYZER' ? reply : { success: false, error: 'Synthetic deep failure' });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { await finishBackground(); jest.restoreAllMocks(); });

function returnDeepPickup(pickup) {
  model.mockImplementation(async role => role === 'OFFER_ANALYZER' ? reply : {
    success: true, model: 'fixture-deep-model', text: JSON.stringify({
      decision: 'ACCEPT', parsed_data: { ...modelOffer(), pickup },
    }),
  });
}

test.each([[null, null], ['', ''], ['91', '0'], ['0', '-181']])(
  'missing or invalid snapshot coordinates (%j, %j) cannot anchor an address search at an invented point',
  async (lat, lng) => {
    execute.mockResolvedValue({ rows: [{ timezone: 'UTC', lat, lng, created_at: new Date() }] });
    returnDeepPickup(`Fixture Depot ${requestId}`);
    geocode.mockResolvedValue(null);
    places.mockResolvedValue({ outcome: 'absent', place: null, reason: 'Fixture miss' });
    expect((await analyze({ image: 'ZmFrZQ==' })).body.decision).toBe('ACCEPT');
    await finishBackground();
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode.mock.calls[0][3]).not.toHaveProperty('bias');
    expect(places).not.toHaveBeenCalled();
    expect(stored).toHaveLength(1);
    expect(stored[0].parsed_data_json.timezone_source).toBe('snapshot');
  },
);

test('a real zero-valued snapshot coordinate remains a usable anchor', async () => {
  execute.mockResolvedValue({ rows: [{ timezone: 'UTC', lat: '0', lng: '0', created_at: new Date() }] });
  const pickup = `Fixture Depot ${requestId}`;
  returnDeepPickup(pickup);
  geocode.mockResolvedValue(null);
  places.mockResolvedValue({ outcome: 'absent', place: null, reason: 'Fixture miss' });
  await analyze({ image: 'ZmFrZQ==' });
  await finishBackground();
  expect(places).toHaveBeenCalledWith(0, 0, pickup, expect.any(Object));
  expect(stored).toHaveLength(1);
});

test('Places provider failures remain retryable and successful structured results supply saved coordinates', async () => {
  execute.mockResolvedValue({ rows: [{ timezone: 'UTC', lat: '33.1', lng: '-96.8', created_at: new Date() }] });
  const pickup = `Fixture Depot ${requestId}`;
  returnDeepPickup(pickup);
  geocode.mockResolvedValue(null);
  timezone.mockResolvedValue('UTC');
  places.mockResolvedValueOnce({ outcome: 'provider_failure', place: null, reason: 'Fixture HTTP 503' })
    .mockResolvedValue({ outcome: 'found', reason: null, place: {
      lat: 33.1001, lng: -96.8001, placeId: 'fixture-depot', displayName: pickup,
      formattedAddress: pickup, types: ['point_of_interest'],
    } });
  await analyze({ image: 'ZmFrZQ==' });
  await finishBackground();
  expect(stored).toHaveLength(1);
  expect(stored[0].pickup_lat).toBeNull();
  expect(console.warn).toHaveBeenCalledWith('[HOOKS] Pickup unresolved: Places provider request failed');
  requestId++;
  await analyze({ image: 'ZmFrZQ==' });
  await finishBackground();
  expect(places).toHaveBeenCalledTimes(2);
  expect(stored).toHaveLength(2);
  expect(stored[1]).toMatchObject({ pickup_lat: 33.1001, pickup_lng: -96.8001 });
  requestId++;
  await analyze({ image: 'ZmFrZQ==' });
  await finishBackground();
  expect(places).toHaveBeenCalledTimes(2);
  expect(stored).toHaveLength(3);
  expect(stored[2]).toMatchObject({ pickup_lat: 33.1001, pickup_lng: -96.8001 });
});

test.each([
  ['UberX', 'uber'], ['Lyft', 'lyft'],
])('image-only %s keeps its platform in stored data and the realtime event when deep analysis fails', async (product, platform) => {
  storeExpected = true;
  reply = success({ product });
  const response = await analyze({ image: 'ZmFrZQ==' });
  expect(response.body.decision).toBe('ACCEPT');
  await finishBackground();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ platform, parsed_data_json: { platform, phase1_result: { platform } } });
  expect(notifications[0]).toMatchObject({ platform });
});

test.each([
  [undefined, 'LYFT', 'lyft'], ['Uber', 'lyft', 'uber'], ['invented', 'invented', 'unknown'],
])('image platform uses validated fast evidence (%s) before deep enrichment (%s)', async (fastPlatform, deepPlatform, expected) => {
  storeExpected = true;
  reply = success({ product: 'Comfort', platform: fastPlatform });
  model.mockImplementation(async role => role === 'OFFER_ANALYZER' ? reply : {
    success: true, model: 'fixture-deep-model', text: JSON.stringify({
      decision: 'ACCEPT', parsed_data: { ...modelOffer({ product: 'Comfort' }), platform: deepPlatform },
    }),
  });
  expect((await analyze({ image: 'ZmFrZQ==' })).body.decision).toBe('ACCEPT');
  await finishBackground();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ platform: expected, parsed_data_json: { platform: expected } });
  expect(notifications[0]).toMatchObject({ platform: expected });
});

test.each([
  [completeText, 'uber'], [completeText.replace('UberX', 'Comfort'), 'lyft'],
])('text platform evidence survives enrichment and unknown text permits deep identification: %s', async (text, platform) => {
  storeExpected = true;
  reply = success({ product: text.includes('UberX') ? 'UberX' : 'Comfort' });
  model.mockImplementation(async role => role === 'OFFER_ANALYZER' ? reply : {
    success: true, model: 'fixture-deep-model', text: JSON.stringify({
      decision: 'ACCEPT', parsed_data: { ...modelOffer(), platform: 'lyft' },
    }),
  });
  expect((await analyze({ text, image: 'ZmFrZQ==' })).body.decision).toBe('ACCEPT');
  await finishBackground();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ platform, parsed_data_json: { platform } });
  expect(notifications[0]).toMatchObject({ platform });
});

test('model failure never accepts a ride whose judgment gates were not checked, and retry is not replayed', async () => {
  reply = { success: false, error: 'Synthetic fast model unavailable' };
  const first = await analyze({ text: completeText });
  expect(first.body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Decide manually.' });
  reply = success();
  const second = await analyze({ text: completeText });
  expect(second.body.decision).toBe('ACCEPT');
  expect(second.body.duplicate).not.toBe(true);
});

test.each([false, true])('numeric rider gate arbitrates model ACCEPT on the text lane (image=%s)', async image => {
  reply = success({ rating: 4.2 });
  const response = await analyze({ text: completeText, ...(image ? { image: 'ZmFrZQ==' } : {}) });
  expect(response.body.decision).toBe('REJECT');
  expect(response.body.voice).toMatch(/low rider rating/);
});

test.each([false, true])('code corrects model arithmetic REJECT while preserving complete OCR numbers (image=%s)', async image => {
  reply = success({ decision: 'REJECT', reason: '$0.50 40mi low', per_mile: 0.5, total_miles: 40 });
  const response = await analyze({ text: completeText, ...(image ? { image: 'ZmFrZQ==' } : {}) });
  expect(response.body.decision).toBe('ACCEPT');
  expect(response.body.voice).toContain('three dollars thirty-three per mile');
});

test('conflicting OCR and model price decimals are manual NO DATA with quarantined source evidence', async () => {
  storeExpected = true;
  const text = completeText.replace('$20.00', '$75.00').replace('4.0 mi', '18.0 mi');
  reply = success({ price: 7.5, ride_miles: 18, total_miles: 20, decision: 'REJECT', reason: '$0.38 20mi low' });
  const response = await analyze({ text, image: 'ZmFrZQ==' });
  expect(response.body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Decide manually.' });
  await finishBackground();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ decision: 'NO DATA', price: null, per_mile: null, total_miles: null,
    parsed_data_json: { storage_quarantined: true, extraction_conflicts: [{ field: 'price', ocr: 75, model: 7.5 }],
      phase1_result: { reason_kind: 'extraction_conflict', extraction_conflicts: [{ field: 'price', ocr: 75, model: 7.5 }] } } });
  expect(notifications[0]).toMatchObject({ price: null, per_mile: null });
});

test.each([
  ['pickup_miles', 20], ['pickup_minutes', 50], ['ride_miles', 40], ['ride_minutes', 100],
])('conflicting concrete OCR/model %s cannot be silently overridden', async (field, value) => {
  reply = success({ [field]: value, decision: 'REJECT', reason: 'low' });
  expect((await analyze({ text: completeText, image: 'ZmFrZQ==' })).body)
    .toMatchObject({ decision: 'NO DATA', voice: 'No data. Decide manually.' });
});

test('numeric acceptance preserves a model judgment rejection for the configured avoid area', async () => {
  ruleset.avoid = [{ place_id: 'fixture-area', label: 'Avoid area', lat: 0, lng: 0, mode: 'destination_in', enabled: true }];
  reply = success({ decision: 'REJECT', judgment_reject: 'avoid:Avoid area', reason: '$3.33 6.0mi avoid area' });
  expect((await analyze({ text: completeText, image: 'ZmFrZQ==' })).body.decision).toBe('REJECT');
});

test('a partial OCR leg cannot replace a complete model total and turn a below-floor offer into an acceptance', async () => {
  reply = success({ price: 10, pickup_miles: 2, pickup_minutes: 5, ride_miles: 18, ride_minutes: 20,
    total_miles: 20, total_minutes: 25, per_mile: 0.5 });
  const response = await analyze({ text: 'UberX\n$10.00\n5 min (2.0 mi) away', image: 'ZmFrZQ==' });
  expect(response.body.decision).toBe('REJECT');
  expect(response.body.voice).toContain('fifty cents per mile');
  expect(response.body.voice).toContain('20 miles');
});

test.each([null, [], { decision: 'GO', price: 20, total_miles: 6 }])('invalid model reply shape or verdict returns manual NO DATA: %j', async payload => {
  reply = { success: true, text: JSON.stringify(payload) };
  const response = await analyze({ text: completeText });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Decide manually.' });
});

test('active-time vision arithmetic uses actual trip legs and labels its spoken denominator', async () => {
  ruleset.basis = 'active_time';
  reply = success({ price: 20, total_miles: 15, total_minutes: 30, pickup_miles: 10, pickup_minutes: 20,
    ride_miles: 5, ride_minutes: 10, decision: 'REJECT', reason: '$1.33 15mi low' });
  const response = await analyze({ image: 'ZmFrZQ==' });
  expect(response.body.decision).toBe('ACCEPT');
  expect(response.body.voice).toContain('four dollars per mile');
  expect(response.body.voice).toMatch(/trip miles only/i);
});

test('active-time extraction missing its required trip denominator cannot keep a model ACCEPT', async () => {
  ruleset.basis = 'active_time';
  reply = success({ pickup_miles: null, pickup_minutes: null, ride_miles: null, ride_minutes: null });
  const response = await analyze({ image: 'ZmFrZQ==' });
  expect(response.body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Decide manually.' });
});

test('missing rider rating cannot bypass the configured rating floor on an acceptance', async () => {
  reply = success({ rating: null });
  expect((await analyze({ image: 'ZmFrZQ==' })).body.decision).toBe('NO DATA');
});

test.each(['ACCEPT', 'REJECT'])('a model %s without an explicit judgment report cannot become an acceptance', async decision => {
  const payload = modelOffer({ decision, reason: 'avoid area' });
  delete payload.judgment_reject;
  reply = { success: true, text: JSON.stringify(payload) };
  expect((await analyze({ image: 'ZmFrZQ==' })).body.decision).toBe('NO DATA');
});

test('a generic OCR platform label allows the model to identify the actual service', async () => {
  selectedServices = ['comfort'];
  reply = success({ product: 'Comfort' });
  expect((await analyze({ text: 'Uber\n$20.00', image: 'ZmFrZQ==' })).body.decision).toBe('ACCEPT');
});

test('conflicting explicitly identified OCR and vision services cannot combine into an acceptance', async () => {
  reply = success({ product: 'Comfort' });
  expect((await analyze({ text: completeText, image: 'ZmFrZQ==' })).body.decision).toBe('NO DATA');
});

test('a contradictory model acceptance and judgment rejection is manual NO DATA', async () => {
  reply = success({ judgment_reject: 'verified_missing' });
  expect((await analyze({ image: 'ZmFrZQ==' })).body.decision).toBe('NO DATA');
});

test('negative extracted leg distances cannot hide behind a positive summed total', async () => {
  reply = success({ pickup_miles: -2, ride_miles: 8 });
  expect((await analyze({ image: 'ZmFrZQ==' })).body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Numbers look wrong. Decide manually.' });
});

test.each([
  'Delivery\n$12.00\nIncludes expected tip',
  'Delivery\nIncludes expected tip\n20 min (4.0 mi) total',
])('incomplete delivery OCR uses the screenshot to obtain missing offer numbers: %s', async text => {
  selectedServices = ['delivery'];
  reply = success({ price: 12, product: 'Delivery', total_miles: 4, total_minutes: 20,
    pickup_miles: null, pickup_minutes: null, ride_miles: null, ride_minutes: null,
    tip_included: true });
  const response = await analyze({ text, image: 'ZmFrZQ==' });
  expect(response.body).toMatchObject({ decision: 'ACCEPT', decision_basis: 'full_ride' });
  const fastCalls = model.mock.calls.filter(([role]) => role === 'OFFER_ANALYZER');
  expect(fastCalls).toHaveLength(1);
  expect(fastCalls[0][1].images).toEqual([{ mimeType: 'image/jpeg', data: 'ZmFrZQ==' }]);
});

test.each([
  ['Delivery\n$12.00\n20 min (4.0 mi) total', 'ACCEPT'],
  ['Delivery\n$7.50\n19 min (4.6 mi) total', 'REJECT'],
])('complete delivery OCR %s returns deterministic %s without a fast model call', async (text, decision) => {
  selectedServices = ['delivery'];
  const response = await analyze({ text, image: 'ZmFrZQ==' });
  expect(response.body.decision).toBe(decision);
  expect(model.mock.calls.filter(([role]) => role === 'OFFER_ANALYZER')).toHaveLength(0);
});

test.each([false, true])('delivery off ends incomplete OCR before the fast model (image=%s)', async image => {
  selectedServices = ['delivery'];
  ruleset.delivery.enabled = false;
  const response = await analyze({ text: 'Delivery\n$12.00\nIncludes expected tip', ...(image ? { image: 'ZmFrZQ==' } : {}) });
  expect(response.body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Delivery offers are off in your rules.' });
  expect(model.mock.calls.filter(([role]) => role === 'OFFER_ANALYZER')).toHaveLength(0);
});

test('incomplete delivery OCR cannot accept when the screenshot model fails', async () => {
  selectedServices = ['delivery'];
  reply = { success: false, error: 'Synthetic fast model unavailable' };
  const response = await analyze({ text: 'Delivery\n$12.00\nIncludes expected tip', image: 'ZmFrZQ==' });
  expect(response.body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Decide manually.' });
  expect(model.mock.calls.filter(([role]) => role === 'OFFER_ANALYZER')).toHaveLength(1);
});

test('explicit services reject a recognized disabled service before a model can accept it', async () => {
  selectedServices = ['comfort'];
  const response = await analyze({ text: completeText });
  expect(response.body.decision).toBe('REJECT');
  expect(response.body.reason).toMatch(/service/i);
  expect(model.mock.calls.filter(([role]) => role === 'OFFER_ANALYZER')).toHaveLength(0);
});

test.each([
  ['Share', null, completeText.replace('UberX', 'UberX Share').replace('20.00', '750'), 'Reject. Share tier.'],
  ['disabled ride', ['comfort'], completeText.replace('20.00', '750'), 'Reject. Service not selected.'],
  ['disabled delivery', ['economy'], 'Delivery\n$750\n19 min (4.6 mi) total', 'Reject. Service not selected.'],
])('%s identity rejection never speaks implausible hourly money', async (_kind, selected, text, voice) => {
  selectedServices = selected;
  ruleset.global.notices = { hourly_rate: true };
  const response = await analyze({ text });
  expect(response.body).toMatchObject({ decision: 'REJECT', voice });
  expect(response.body.notification).not.toMatch(/\$|\/hr/);
  expect(response.body.notices.some(notice => /\$|\/hr/.test(notice))).toBe(false);
});

test('an explicit service selection refuses an unidentified product instead of assigning standard economics', async () => {
  selectedServices = ['economy'];
  reply = success({ product: 'Unidentified product' });
  const response = await analyze({ image: 'ZmFrZQ==' });
  expect(response.body).toMatchObject({ decision: 'NO DATA', voice: 'No data. Decide manually.' });
});

test('active-time spoken rates never replace the full-ride metrics stored for history', async () => {
  storeExpected = true;
  selectedServices = ['economy'];
  ruleset.basis = 'active_time';
  reply = success({ price: 20, total_miles: 15, total_minutes: 30, pickup_miles: 10, pickup_minutes: 20,
    ride_miles: 5, ride_minutes: 10 });
  const response = await analyze({ image: 'ZmFrZQ==' });
  expect(response.body.voice).toContain('four dollars per mile');
  await finishBackground();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ price: 20, per_mile: 1.33, per_minute: 0.67, total_miles: 15, total_minutes: 30,
    parsed_data_json: { phase1_contract_version: 1, storage_metrics_source: 'phase1', storage_quarantined: false,
      phase1_result: { decision: 'ACCEPT', total_miles: 15, total_minutes: 30 },
      decision_basis: 'active_time', decision_per_mile: 4, decision_miles: 5, decision_minutes: 10,
      selected_services: ['economy'], selection_verified: true } });
  expect(notifications[0]).toMatchObject({ price: 20, per_mile: 1.33 });
});

test('implausible deep extraction after degraded vision stays in the audit, not aggregatable money columns', async () => {
  storeExpected = true;
  model.mockImplementation(async role => role === 'OFFER_ANALYZER'
    ? { success: false, error: 'Synthetic fast failure' }
    : { success: true, text: JSON.stringify({ decision: 'ACCEPT', parsed_data: {
      price: 750, miles: 4.6, pickup_minutes: 2, ride_minutes: 17, product_type: 'UberX',
    } }) });
  expect((await analyze({ image: 'ZmFrZQ==' })).body.decision).toBe('NO DATA');
  await finishBackground();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ decision: 'NO DATA', price: null, per_mile: null, total_miles: null,
    parsed_data_json: { price: 750, implausible: true, storage_quarantined: true, storage_metrics_source: 'phase2',
      phase1_contract_version: 1, phase1_result: { decision: 'NO DATA', price: null, total_miles: null } } });
  expect(notifications[0]).toMatchObject({ decision: 'NO DATA', price: null, per_mile: null });
});

test('changing selected services invalidates an otherwise-identical verdict replay', async () => {
  selectedServices = ['economy'];
  const first = await analyze({ text: completeText });
  expect(first.body).toMatchObject({ decision: 'ACCEPT', selection_verified: true });
  selectedServices = ['comfort'];
  const second = await analyze({ text: completeText });
  expect(second.body.decision).toBe('REJECT');
  expect(second.body.duplicate).not.toBe(true);
});

test('legacy null selection is explicitly unverified, without inventing eligible services', async () => {
  expect((await analyze({ text: completeText })).body).toMatchObject({ decision: 'ACCEPT', selection_verified: false });
});

test.each([['OFFER_ANALYZER', 20000], ['OFFER_ANALYZER_DEEP', 45000]])('%s deadline aborts its model transport', async (timedRole, deadline) => {
  const realSetTimeout = global.setTimeout;
  let signal;
  jest.spyOn(global, 'setTimeout').mockImplementation((callback, ms, ...args) =>
    realSetTimeout(callback, ms === deadline ? 1 : ms, ...args));
  model.mockImplementation(async (role, params) => {
    if (role !== timedRole) return role === 'OFFER_ANALYZER' ? reply : { success: false, error: 'Synthetic deep failure' };
    signal = params.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Synthetic aborted transport')), { once: true }));
  });
  const response = await analyze({ text: completeText });
  expect(response.body.decision).toBe(timedRole === 'OFFER_ANALYZER' ? 'NO DATA' : 'ACCEPT');
  await new Promise(resolve => realSetTimeout(resolve, 10));
  expect(signal.aborted).toBe(true);
  expect(global.setTimeout.mock.calls.some(([, ms]) => ms === deadline)).toBe(true);
});
