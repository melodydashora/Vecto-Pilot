import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { pgTable, integer } from 'drizzle-orm/pg-core';

const fixture = pgTable('schema_fixture', { id: integer('id').notNull() });
let config;
const client = { connect: jest.fn(), query: jest.fn(), end: jest.fn() };
const Client = jest.fn(function (options) { config = options; return client; });
jest.unstable_mockModule('pg', () => ({ default: { Client } }));
jest.unstable_mockModule('../../shared/schema.js', () => ({ fixture }));
const originalUrl = process.env.DATABASE_URL;
const originalExitCode = process.exitCode;
let output;

beforeEach(() => {
  jest.resetModules(); jest.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://fixture:synthetic@remote.example/fixture?sslmode=no-verify';
  process.exitCode = 0;
  client.query.mockImplementation(async query => {
    if (query.includes('information_schema.columns')) return { rows: [
      { table_name: 'schema_fixture', column_name: 'id', data_type: 'integer', formatted_type: 'integer', is_nullable: 'NO' },
    ] };
    return { rows: [] };
  });
  output = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  process.exitCode = originalExitCode;
  output.mockRestore();
});

test('CLI uses verified remote TLS and a read-only metadata transaction without application rows', async () => {
  await import('../../scripts/check-schema.mjs');
  expect(config).toMatchObject({ host: 'remote.example', database: 'fixture', ssl: { rejectUnauthorized: true } });
  expect(config.connectionString).toBeUndefined();
  expect(client.query.mock.calls[0][0]).toBe('BEGIN READ ONLY');
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  expect(client.query.mock.calls).toHaveLength(5);
  expect(client.query.mock.calls[2][0]).toContain('information_schema.columns');
  expect(client.query.mock.calls[3][0]).toContain('pg_catalog.pg_constraint');
  expect(client.end).toHaveBeenCalledTimes(1);
  expect(process.exitCode).toBe(0);
});

test('an unmirrored database check fails the CLI even when all columns match', async () => {
  const normalQuery = client.query.getMockImplementation();
  client.query.mockImplementation(async query => query.includes('pg_catalog.pg_constraint')
    ? { rows: [{ table_name: 'schema_fixture', constraint_name: 'missing_from_mirror', validated: true }] }
    : normalQuery(query));
  await import('../../scripts/check-schema.mjs');
  expect(process.exitCode).toBe(1);
  expect(JSON.parse(output.mock.calls[0][0]).undeclaredDatabaseChecks).toEqual(['schema_fixture.missing_from_mirror']);
});

test('query failures close the client and omit credential-bearing error detail', async () => {
  client.query.mockRejectedValueOnce(Object.assign(new Error('synthetic-secret private URL'), { code: 'fixture_error' }));
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await import('../../scripts/check-schema.mjs');
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith('Schema metadata check failed (fixture_error).');
    expect(client.end).toHaveBeenCalledTimes(1);
  } finally { error.mockRestore(); }
});
