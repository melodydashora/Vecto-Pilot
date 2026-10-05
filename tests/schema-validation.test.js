import { describe, test, expect } from '@jest/globals';
import { pgTable, serial, text, varchar, timestamp, integer, numeric, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { offer_intelligence } from '../shared/schema.js';
import { compareSchemaMetadata } from '../scripts/lib/schema-drift.mjs';

const fixture = pgTable('db_name', { id: serial('id').primaryKey(), title: varchar('title', { length: 80 }).notNull(), when: timestamp('when'), tags: text('tags').array() });
const rows = [
  { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
  { column_name: 'title', data_type: 'character varying', is_nullable: 'NO' },
  { column_name: 'when', data_type: 'timestamp without time zone', is_nullable: 'YES' },
  { column_name: 'tags', data_type: 'ARRAY', udt_name: '_text', is_nullable: 'YES' },
].map(row => ({ table_name: 'db_name', ...row }));

describe('Schema drift detection without database side effects', () => {
  test('uses SQL names, ignores relationship exports, and accepts PostgreSQL type aliases', () => {
    const result = compareSchemaMetadata({ javascriptName: fixture, relationship: {} }, rows);
    expect(result).toMatchObject({ declaredTables: 1, declaredColumns: 4, missingDeclaredColumns: [], looserDatabaseNullability: [], typeDifferences: [] });
  });
  test('reports absent columns instead of querying application records', () => {
    expect(compareSchemaMetadata({ fixture }, rows.slice(1)).missingDeclaredColumns).toEqual(['db_name.id']);
  });
  test('reports incompatible types and weaker database nullability', () => {
    const changed = rows.map(row => row.column_name === 'title' ? { ...row, data_type: 'integer', is_nullable: 'YES' } : row);
    const result = compareSchemaMetadata({ fixture }, changed);
    expect(result.looserDatabaseNullability).toEqual(['db_name.title']);
    expect(result.typeDifferences).toEqual([{ column: 'db_name.title', expected: 'character varying', actual: 'integer' }]);
  });
});


test('one table exported under two names is counted once', () => {
  const result = compareSchemaMetadata({ fixture, historicalAlias: fixture }, rows);
  expect(result.declaredTables).toBe(1);
  expect(result.declaredColumns).toBe(4);
});

test('array element drift cannot pass merely because both columns are arrays', () => {
  const changed = rows.map(row => row.column_name === 'tags' ? { ...row, udt_name: '_uuid' } : row);
  expect(compareSchemaMetadata({ fixture }, changed).typeDifferences)
    .toEqual([{ column: 'db_name.tags', expected: 'text[]', actual: 'uuid[]' }]);
});

test('missing array element metadata is visible, not assumed compatible', () => {
  const changed = rows.map(row => row.column_name === 'tags' ? { ...row, udt_name: undefined } : row);
  expect(compareSchemaMetadata({ fixture }, changed).typeDifferences).toHaveLength(1);
});

test('a stricter database null constraint is reported because inserts may fail', () => {
  const changed = rows.map(row => row.column_name === 'when' ? { ...row, is_nullable: 'NO' } : row);
  expect(compareSchemaMetadata({ fixture }, changed).stricterDatabaseNullability).toEqual(['db_name.when']);
});

test('character length and numeric scale are part of the type contract', () => {
  const amounts = pgTable('amounts', { label: varchar('label', { length: 80 }), amount: numeric('amount', { precision: 10, scale: 2 }) });
  const metadata = [
    { table_name: 'amounts', column_name: 'label', data_type: 'character varying', formatted_type: 'character varying(40)', is_nullable: 'YES' },
    { table_name: 'amounts', column_name: 'amount', data_type: 'numeric', formatted_type: 'numeric(10,3)', is_nullable: 'YES' },
  ];
  expect(compareSchemaMetadata({ amounts }, metadata).typeDifferences).toEqual([
    { column: 'amounts.label', expected: 'character varying(80)', actual: 'character varying(40)' },
    { column: 'amounts.amount', expected: 'numeric(10,2)', actual: 'numeric(10,3)' },
  ]);
});

test('declared CHECKs must exist and validate existing rows; extra checks reveal mirror drift', () => {
  const table = pgTable('revisions', { revision: integer('revision') }, table => [check('positive_revision', sql`${table.revision} >= 0`)]);
  const metadata = [{ table_name: 'revisions', column_name: 'revision', data_type: 'integer', is_nullable: 'YES' }];
  expect(compareSchemaMetadata({ table }, metadata, { checks: [] }).missingDeclaredChecks).toEqual(['revisions.positive_revision']);
  const result = compareSchemaMetadata({ table }, metadata, { checks: [
    { table_name: 'revisions', constraint_name: 'positive_revision', validated: false },
    { table_name: 'revisions', constraint_name: 'unmirrored_rule', validated: true },
  ] });
  expect(result.missingDeclaredChecks).toEqual([]);
  expect(result.unvalidatedChecks).toEqual(['revisions.positive_revision']);
  expect(result.undeclaredDatabaseChecks).toEqual(['revisions.unmirrored_rule']);
});

test('the offer-removal revision invariant is mirrored from its canonical migration', () => {
  const migration = readFileSync(new URL('../migrations/20260928_offer_removal.sql', import.meta.url), 'utf8');
  expect(migration).toMatch(/offer_intelligence_removal_revision_check/);
  expect(getTableConfig(offer_intelligence).checks.map(check => check.name))
    .toContain('offer_intelligence_removal_revision_check');
});


test('timestamp precision and timezone normalize to PostgreSQL catalog spelling', () => {
  const times = pgTable('times', {
    defaultTime: timestamp('default_time', { precision: 6 }),
    millis: timestamp('millis', { precision: 3 }),
    zoned: timestamp('zoned', { precision: 3, withTimezone: true }),
  });
  const metadata = [
    ['default_time', 'timestamp without time zone'],
    ['millis', 'timestamp(3) without time zone'],
    ['zoned', 'timestamp(3) with time zone'],
  ].map(([column_name, formatted_type]) => ({ table_name: 'times', column_name, formatted_type, is_nullable: 'YES' }));
  expect(compareSchemaMetadata({ times }, metadata).typeDifferences).toEqual([]);
  metadata[1].formatted_type = 'timestamp(2) without time zone';
  expect(compareSchemaMetadata({ times }, metadata).typeDifferences).toEqual([
    { column: 'times.millis', expected: 'timestamp(3) without time zone', actual: 'timestamp(2) without time zone' },
  ]);
});
