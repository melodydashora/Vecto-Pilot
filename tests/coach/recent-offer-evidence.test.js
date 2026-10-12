import { beforeAll, beforeEach, afterAll, describe, expect, jest, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../shared/schema.js';

let pg, orm;
const owner = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
const { RideshareCoachDAL } = await import('../../server/lib/ai/rideshare-coach-dal.js');
const dal = new RideshareCoachDAL();
beforeAll(async () => {
  pg = new PGlite();
  for (const table of [schema.offer_intelligence, schema.offer_outcomes]) {
    const { name, columns } = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${name}" (${columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.name === 'total_earned' ? ' GENERATED ALWAYS AS (coalesce(actual_pay,0)+coalesce(reimbursements,0)+coalesce(extras,0)+coalesce(other,0)) STORED' : ''}`).join(', ')})`);
  }
  await pg.exec('CREATE UNIQUE INDEX outcome_offer_fixture ON offer_outcomes(offer_intelligence_id)');
  orm = drizzle(pg, { schema });
}, 30000);
beforeEach(async () => { await pg.exec('DELETE FROM offer_outcomes; DELETE FROM offer_intelligence'); });
afterAll(async () => { await pg?.close(); });
async function offer(number, extra = {}) {
  const row = { id: id(number), user_id: owner, device_id: 'synthetic', decision: 'ACCEPT',
    created_at: new Date('2026-10-12T12:00:00Z'), updated_at: new Date('2026-10-12T12:00:00Z'),
    timezone: 'America/Chicago', raw_text: 'Synthetic rider explicitly named Taylor', raw_ai_response: '{"reason":"deep evidence"}',
    parsed_data_json: { request_at: Date.parse('2026-10-12T11:59:00Z'), phase1_result: { decision: 'ACCEPT', reason: 'quick evidence' }, deep_decision: 'REJECT' }, ...extra };
  await orm.insert(schema.offer_intelligence).values(row);
  return row;
}

describe('recent quick/deep offer evidence and driver outcomes', () => {
  test('full quick/deep raw evidence and owner-matched outcome survive as separate records', async () => {
    const original = await offer(1);
    await orm.insert(schema.offer_outcomes).values({ id: id(101), user_id: owner, offer_intelligence_id: original.id,
      revision: 3, driver_decision: 'Accepted', actual_pay: null, reimbursements: null, extras: null, other: null,
      total_earned: 0, outcome_source: 'web_app', updated_at: new Date('2026-10-12T12:01:00Z') });
    const result = await dal.getOfferHistory(owner);
    expect(result.source_state).toBe('available'); expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ decision: original.decision, raw_text: original.raw_text,
      raw_ai_response: original.raw_ai_response, parsed_data_json: original.parsed_data_json,
      observed_at: '2026-10-12T11:59:00.000Z', observed_at_source: 'request_at',
      outcome: { user_id: owner, revision: 3, driver_decision: 'Accepted', actual_pay: null, total_earned: 0 } });
    expect(result.offers[0]).not.toHaveProperty('on_trip');
    expect(result.offers[0]).not.toHaveProperty('passenger_name');
  });
  test('foreign outcome cannot join an owned offer; removed and foreign offers stay excluded', async () => {
    await offer(1); await offer(2, { user_id: foreign }); await offer(3, { removed_at: new Date() });
    await orm.insert(schema.offer_outcomes).values({ id: id(101), user_id: foreign, offer_intelligence_id: id(1), driver_decision: 'Completed', actual_pay: 999 });
    const result = await dal.getOfferHistory(owner);
    expect(result.offers.map(row => row.id)).toEqual([id(1)]); expect(result.offers[0].outcome).toBeNull();
  });
  test('latest observation wins even when older deep analysis finishes later; limit follows observation ordering', async () => {
    await offer(1, { created_at: new Date('2026-10-12T12:05:00Z'), parsed_data_json: { request_at: Date.parse('2026-10-12T11:58:00Z') } });
    await offer(2, { created_at: new Date('2026-10-12T12:01:00Z'), parsed_data_json: { request_at: Date.parse('2026-10-12T12:00:00Z') } });
    expect((await dal.getOfferHistory(owner, 1)).offers.map(row => row.id)).toEqual([id(2)]);
    expect((await dal.getOfferHistory(owner, 2)).offers.map(row => row.id)).toEqual([id(2), id(1)]);
  });
  test.each([null, '1791806340000', 'invalid', {}, [], -1, 1.5, 8640000000000001, 1e30])('malformed or legacy request_at %j falls back explicitly without failing the SQL read', async request_at => {
    await offer(1, { parsed_data_json: { request_at } });
    const result = await dal.getOfferHistory(owner);
    expect(result.source_state).toBe('available');
    expect(result.offers[0]).toMatchObject({ observed_at: '2026-10-12T12:00:00.000Z', observed_at_source: 'created_at', outcome: null });
  });
  test('a JSON numeric timestamp with a zero decimal suffix shares the same SQL and returned observation receipt', async () => {
    await offer(1);
    await pg.query('UPDATE offer_intelligence SET parsed_data_json = $1::jsonb WHERE id = $2', ['{"request_at":1791806340000.0}', id(1)]);
    const result = await dal.getOfferHistory(owner);
    expect(result.offers[0].observed_at_source).toBe('request_at');
    expect(result.offers[0].observed_at).toBe(new Date(1791806340000).toISOString());
  });
  test('empty owner results are distinct from unavailable identity', async () => {
    expect(await dal.getOfferHistory(owner)).toMatchObject({ source_state: 'available', offers: [] });
    expect(await dal.getOfferHistory(null)).toMatchObject({ source_state: 'unavailable', offers: [] });
  });
});
