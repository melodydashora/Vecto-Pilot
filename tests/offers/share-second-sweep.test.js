import { jest, beforeEach, test, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { migrateRuleset } from '../../server/lib/offers/rules-engine.js';

let rulesKnown;
let currentSnapshot;
let finishDeep;
const calls = [];
const saved = [];
const notifications = [];
const forbidden = jest.fn(async () => { throw new Error('Unexpected external transport'); });
const timezone = jest.fn();
const model = jest.fn(() => new Promise(resolve => { finishDeep = resolve; }));
const dialect = new PgDialect();
const execute = jest.fn(async statement => {
  const query = dialect.sqlToQuery(statement);
  calls.push(query.sql);
  if (query.sql.includes('driver_profiles')) {
    return { rows: rulesKnown ? [{ user_id: 'share-driver', config: migrateRuleset(null), version: 4, config_hash: 'fixture-hash' }] : [] };
  }
  if (query.sql.includes('JOIN snapshots')) return { rows: currentSnapshot ? [currentSnapshot] : [] };
  throw new Error(`Unexpected fixture read: ${query.sql}`);
});
const transaction = jest.fn(async operation => operation({
  execute: async statement => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes('pg_notify')) notifications.push(JSON.parse(query.params[0]));
    return { rows: [] };
  },
  insert: table => ({ values: row => ({ returning: async () => {
    expect(getTableName(table)).toBe('offer_intelligence');
    saved.push(row);
    return [{ id: 'fixture-offer' }];
  } }) }),
}));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { execute, transaction } }));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel: model }));
jest.unstable_mockModule('../../server/lib/offers/downscale-offer-image.js', () => ({ downscaleOfferImage: forbidden }));
jest.unstable_mockModule('../../server/lib/events/pipeline/geocodeEvent.js', () => ({ geocodeEventAddress: forbidden }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ resolvePlaceByTextSearch: forbidden }));
jest.unstable_mockModule('../../server/lib/location/resolveTimezone.js', () => ({ resolveTimezoneFromCoords: timezone }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ offerHookLimiter: (_req, _res, next) => next() }));
const { _clearCache } = await import('../../server/lib/offers/ruleset-store.js');
const { default: router } = await import('../../server/api/hooks/analyze-offer.js');
const app = express().use(express.json()).use('/hooks', router);
const text = 'UberX Share\n$10.00\n5.00 Verified\n1 min (0.2 mi) away\n10 min (3.0 mi) trip';
let caseId = 0;
const analyze = (coords = {}) => request(app).post('/hooks/analyze-offer').set('x-shortcut-token', `share-token-${caseId}`)
  .send({ text, ...coords });
const flushBackground = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };

beforeEach(() => {
  caseId++;
  _clearCache();
  jest.clearAllMocks();
  rulesKnown = true;
  currentSnapshot = null;
  saved.length = 0;
  calls.length = 0;
  notifications.length = 0;
  finishDeep = null;
  timezone.mockResolvedValue('UTC');
});

test('verified Share rejection responds before second sweep, then stores and notifies without accepting deep-model dissent', async () => {
  const response = await analyze({ latitude: 0, longitude: 0 });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ decision: 'REJECT', reason: 'share', voice: 'Reject. Share tier.', personal_rules_verified: true, ruleset_version: 4 });
  expect(model).toHaveBeenCalledTimes(1);
  expect(model.mock.calls[0][0]).toBe('OFFER_ANALYZER_DEEP');
  expect(saved).toHaveLength(0); // the deep model is still pending while the phone has its verdict
  expect(transaction).not.toHaveBeenCalled();
  finishDeep({ success: true, model: 'fixture-deep-model', text: JSON.stringify({
    decision: 'ACCEPT', reasoning: 'Synthetic dissent for preservation test', confidence: 0,
    parsed_data: { product_type: 'Share', price: 10 },
  }) });
  await flushBackground();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ user_id: 'share-driver', decision: 'REJECT', product_type: 'Share',
    driver_lat: 0, driver_lng: 0, coord_key: '0.000000_0.000000', timezone: 'UTC', ruleset_version: 4,
    confidence_score: 0, ai_model: 'fixture-deep-model',
    parsed_data_json: { deep_decision: 'ACCEPT', deep_disagrees: true, reason_kind: 'share', timezone_source: 'gps' },
  });
  expect(saved[0].decision_reasoning).toMatch(/^\[deep model dissents: ACCEPT\]/);
  expect(timezone).toHaveBeenCalledWith(0, 0, expect.any(Object));
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({ user_id: 'share-driver', offer_id: 'fixture-offer', decision: 'REJECT' });
  expect(forbidden).not.toHaveBeenCalled();
  expect((await analyze({ latitude: 0, longitude: 0 })).body.duplicate).toBe(true);
  expect(saved).toHaveLength(1);
  expect(model).toHaveBeenCalledTimes(1);
});

test('Share still rejects without GPS but refuses storage without any real timezone source', async () => {
  const response = await analyze();
  expect(response.body.decision).toBe('REJECT');
  finishDeep({ success: true, text: JSON.stringify({ decision: 'REJECT', parsed_data: { product_type: 'Share' } }) });
  await flushBackground();
  expect(saved).toHaveLength(0);
  expect(transaction).not.toHaveBeenCalled();
  expect(timezone).not.toHaveBeenCalled();
  expect(forbidden).not.toHaveBeenCalled();
});

test('deep failure preserves the deterministic rejection when the owned current snapshot supplies timezone', async () => {
  currentSnapshot = { timezone: 'America/New_York', lat: 0, lng: 0, created_at: new Date() };
  expect((await analyze()).body.decision).toBe('REJECT');
  finishDeep({ success: false, error: 'Synthetic deep failure' });
  await flushBackground();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ decision: 'REJECT', ai_model: 'rules-engine-deterministic', timezone: 'America/New_York',
    parsed_data_json: { timezone_source: 'snapshot', deep_decision: null, deep_disagrees: false } });
  expect(forbidden).not.toHaveBeenCalled();
});

test('an unverified token never enters the quick verdict, second sweep, or storage lane', async () => {
  rulesKnown = false;
  expect((await analyze()).body).toMatchObject({ decision: 'NO DATA', personal_rules_verified: false });
  expect(model).not.toHaveBeenCalled();
  expect(timezone).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
  expect(forbidden).not.toHaveBeenCalled();
});
