import { describe, test, expect } from '@jest/globals';
import { pgTable, serial, text, varchar, timestamp } from 'drizzle-orm/pg-core';
import { compareSchemaMetadata } from '../scripts/lib/schema-drift.mjs';

const fixture = pgTable('db_name', { id: serial('id').primaryKey(), title: varchar('title', { length: 80 }).notNull(), when: timestamp('when'), tags: text('tags').array() });
const rows = [
  { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
  { column_name: 'title', data_type: 'character varying', is_nullable: 'NO' },
  { column_name: 'when', data_type: 'timestamp without time zone', is_nullable: 'YES' },
  { column_name: 'tags', data_type: 'ARRAY', is_nullable: 'YES' },
].map(row => ({ table_name: 'db_name', ...row }));

describe('Schema drift detection without database side effects', () => {
  test('uses SQL names, ignores relationship exports, and accepts PostgreSQL type aliases', () => {
    const result = compareSchemaMetadata({ javascriptName: fixture, relationship: {} }, rows);
    expect(result).toEqual({ declaredTables: 1, declaredColumns: 4, missingDeclaredColumns: [], looserDatabaseNullability: [], typeDifferences: [] });
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
