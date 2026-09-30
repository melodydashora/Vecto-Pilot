// tests/venue/catalog-country-migration-sql.test.js
// 2026-09-29 (Claude): runs the text of migrations/20260929_venue_catalog_country_iso2.sql
// twice in PGlite against legacy-shaped rows, following catalog-colocation-sql.test.js.
// Fixtures are synthetic except the two literal country values the migration is about.
import { beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { venue_catalog } from '../../shared/schema.js';

const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const MIGRATION = new URL('../../migrations/20260929_venue_catalog_country_iso2.sql', import.meta.url);
let pg, orm;
const UPDATED = new Date('2026-01-02T03:04:05.000Z');
const row = (name, country, extra = {}) => ({ venue_name: name, normalized_name: name.toLowerCase(),
  place_id: `provider-${name.toLowerCase().replace(/\s+/g, '-')}`, address: '123 Fixture Street, Fixture City, XX',
  formatted_address: '123 Fixture Street, Fixture City, XX', city: 'Fixture City', state: 'XX', country,
  lat: 1.123456, lng: 2.123456, coord_key: '1.123456_2.123456', category: 'venue', discovery_source: 'fixture',
  timezone: null, updated_at: UPDATED, ...extra });
const catalog = async () => (await pg.query('SELECT * FROM venue_catalog ORDER BY venue_name')).rows;

beforeAll(async () => {
  pg = new PGlite(); orm = drizzle(pg);
  const config = getTableConfig(venue_catalog);
  await pg.exec('CREATE TABLE venue_catalog (' + config.columns.map(c => '"' + c.name + '" ' + c.getSQLType() +
    (c.name === 'venue_id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : '')).join(', ') +
    ', CONSTRAINT venue_catalog_place_id_unique UNIQUE(place_id))');
}, 30000);
beforeEach(async () => { await pg.exec('TRUNCATE venue_catalog'); });
afterAll(async () => { await pg?.close(); });

test('the long legacy country becomes the ISO-2 code, and a second run changes nothing', async () => {
  await orm.insert(venue_catalog).values([
    row('Legacy One', 'United States'), row('Legacy Two', 'United States', { timezone: 'Etc/UTC' }),
    row('Current', 'US'), row('Elsewhere', 'CA'), row('Unknown', null),
    // Only the exact stored legacy value is in scope; nothing is inferred from look-alikes.
    row('Lowercase', 'united states'), row('Padded', ' United States '), row('Three Letter', 'USA'),
  ]);
  const before = await catalog();
  const migration = await readFile(MIGRATION, 'utf8');

  await pg.exec(migration);
  const once = await catalog();
  await pg.exec(migration);
  const twice = await catalog();

  expect(once.map(r => [r.venue_name, r.country])).toEqual([
    ['Current', 'US'], ['Elsewhere', 'CA'], ['Legacy One', 'US'], ['Legacy Two', 'US'],
    ['Lowercase', 'united states'], ['Padded', ' United States '], ['Three Letter', 'USA'], ['Unknown', null],
  ]);
  expect(twice).toEqual(once);
  // Data only, and only the country column: every other stored value is untouched.
  expect(once.map(({ country: _country, ...rest }) => rest)).toEqual(before.map(({ country: _country, ...rest }) => rest));
  expect(once.every(r => r.updated_at.getTime() === UPDATED.getTime())).toBe(true);
});

test('the migration is a no-op on a catalog that holds no legacy value', async () => {
  await orm.insert(venue_catalog).values([row('Current', 'US'), row('Elsewhere', 'CA'), row('Unknown', null)]);
  const before = await catalog();
  const migration = await readFile(MIGRATION, 'utf8');
  await pg.exec(migration); await pg.exec(migration);
  expect(await catalog()).toEqual(before);
});

test('the migration text changes data only and states its provenance', async () => {
  const migration = await readFile(MIGRATION, 'utf8');
  const statements = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .split(';').map(statement => statement.replace(/\s+/g, ' ').trim()).filter(Boolean);
  expect(statements).toEqual(["UPDATE venue_catalog SET country = 'US' WHERE country = 'United States'"]);
  expect(migration).toMatch(/Claude/);
  expect(migration).toMatch(/2026-09-29/);
  expect(migration).toMatch(/idempotent/i);
  expect(migration).toMatch(/data only/i);
});
