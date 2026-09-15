import { beforeEach, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();
let row, statement, update;
const db = {
  update: () => ({ set(values) { update = values; return { where(predicate) {
    statement = dialect.sqlToQuery(predicate);
    return { returning: async () => {
      if (statement.params[0] !== row.id || statement.params[1] !== row.user_id) return [];
      Object.assign(row, values);
      return [{ id: row.id, is_starred: row.is_starred }];
    } };
  } }; } }),
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/lib/events/pipeline/validateEvent.js', () => ({ VALIDATION_SCHEMA_VERSION: 1 }));
jest.unstable_mockModule('../../server/lib/location/daypart.js', () => ({ normalizeDayPartKey: jest.fn(), dayPartLabel: jest.fn() }));
jest.unstable_mockModule('../../server/lib/offers/offer-patterns.js', () => ({ formatOfferPatterns: jest.fn() }));
const { RideshareCoachDAL } = await import('../../server/lib/ai/rideshare-coach-dal.js');
const dal = new RideshareCoachDAL();
beforeEach(() => { row = { id: 'synthetic-message', user_id: 'owner', is_starred: false }; statement = null; update = null; });
test('owner star returns the saved row used by the API success branch', async () => {
  expect(await dal.toggleMessageStar(row.id, row.user_id, true)).toEqual({ id: row.id, is_starred: true });
  expect(statement.sql).toContain('"coach_conversations"."user_id"');
  expect(statement.params).toEqual(['synthetic-message', 'owner']);
  expect(update.updated_at).toBeInstanceOf(Date);
});
test('another driver cannot star a known message id', async () => {
  expect(await dal.toggleMessageStar(row.id, 'other-driver', true)).toBeNull();
  expect(row.is_starred).toBe(false);
});
test('missing ownership never invokes persistence', async () => {
  expect(await dal.toggleMessageStar(row.id, null, true)).toBeNull();
  expect(statement).toBeNull();
});
