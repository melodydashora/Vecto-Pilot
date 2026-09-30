import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { markets, market_cities } from '../../shared/schema.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
let pg, actualDb;
const db = new Proxy({}, { get: (_target, name) => actualDb[name].bind(actualDb) });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ locationLog: { done: jest.fn(), warn: jest.fn() }, OP: {} }));
const { resolveTimezoneFromMarket: resolve } = await import('../../server/lib/location/resolveTimezone.js');
beforeAll(async () => {
  pg = new PGlite(); actualDb = drizzle(pg);
  for (const table of [markets, market_cities]) {
    const config = getTableConfig(table);
    await pg.exec('CREATE TABLE ' + config.name + ' (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType()).join(', ') + ')');
  }
}, 30000);
beforeEach(async () => { await pg.exec('TRUNCATE markets, market_cities'); });
afterAll(async () => { await pg?.close(); });
const market = (overrides = {}) => ({ market_slug: 'fixture-market', market_name: 'Fixture Metro', primary_city: 'Fixture Capital',
  state: 'Province Alpha', state_abbr: 'AA', country_code: 'US', timezone: 'UTC', city_aliases: ['Fixture Suburb'], is_active: true, ...overrides });

test('every identity path respects an explicit country', async () => {
  await actualDb.insert(markets).values(market());
  await expect(resolve('Fixture Capital', 'AA', 'CA')).resolves.toBeNull();
  await expect(resolve('Fixture Suburb', 'AA', 'CA')).resolves.toBeNull();
});
test('a supplied state cannot silently become another state through a city-only fallback', async () => {
  await actualDb.insert(markets).values(market());
  await expect(resolve('Fixture Capital', 'BB', 'US')).resolves.toBeNull();
  await expect(resolve('Fixture Suburb', 'BB', 'US')).resolves.toBeNull();
});
test('an explicit cross-state city mapping preserves its metro through the canonical FK', async () => {
  await actualDb.insert(markets).values(market());
  await actualDb.insert(market_cities).values({ market_slug: 'fixture-market', market_name: 'Old denormalized name',
    city: 'Fixture Suburb', state: 'Province Beta', state_abbr: 'BB', country_code: 'US' });
  await expect(resolve('fixture suburb', 'bb', 'us')).resolves.toEqual({ market_slug: 'fixture-market', market_name: 'Fixture Metro', timezone: 'UTC' });
});
test('known primary names, aliases and full state names retain the legacy return contract', async () => {
  await actualDb.insert(markets).values(market());
  for (const [city, state] of [['fixture capital', 'aa'], ['fixture suburb', 'province alpha']]) {
    await expect(resolve(city, state, 'us')).resolves.toEqual({ market_slug: 'fixture-market', market_name: 'Fixture Metro', timezone: 'UTC' });
  }
});
test('missing country never invents US and ambiguous identities never choose the first row', async () => {
  await actualDb.insert(markets).values(market({ country_code: 'CA' }));
  expect((await resolve('Fixture Capital', 'AA')).market_slug).toBe('fixture-market');
  await actualDb.insert(markets).values(market({ market_slug: 'other-country', country_code: 'US' }));
  await expect(resolve('Fixture Capital', 'AA')).resolves.toBeNull();
});
test('missing state works only for an unambiguous city within its country', async () => {
  await actualDb.insert(markets).values(market());
  expect((await resolve('Fixture Capital', undefined, 'US')).market_slug).toBe('fixture-market');
  await actualDb.insert(markets).values(market({ market_slug: 'other-state', state: 'Province Beta', state_abbr: 'BB' }));
  await expect(resolve('Fixture Capital', undefined, 'US')).resolves.toBeNull();
});
test('inactive markets and malformed identity cannot select a market', async () => {
  await actualDb.insert(markets).values(market({ is_active: false }));
  await expect(resolve('Fixture Capital', 'AA', 'US')).resolves.toBeNull();
  await expect(resolve(['Fixture Capital'], 'AA', 'US')).resolves.toBeNull();
  await expect(resolve('Fixture Capital', 'AA', 'not a country')).resolves.toBeNull();
});
