#!/usr/bin/env node
// Opt-in read-only metadata check. Uses only the supplied DATABASE_URL.
import pg from 'pg';
import * as schema from '../shared/schema.js';
import { databaseConnectionConfig } from '../server/db/connection-config.js';
import { compareSchemaMetadata, hasSchemaDrift } from './lib/schema-drift.mjs';

// No gateway import, environment loader, migration runner, or application rows.
const client = new pg.Client({ ...databaseConnectionConfig(), connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '15s'");
  const { rows } = await client.query(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type
    FROM information_schema.columns c
    JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
    JOIN pg_catalog.pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
    WHERE c.table_schema = 'public' AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.table_name, c.ordinal_position
  `);
  const { rows: checks } = await client.query(`
    SELECT t.relname AS table_name, c.conname AS constraint_name, c.convalidated AS validated
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND c.contype = 'c'
    ORDER BY t.relname, c.conname
  `);
  const result = compareSchemaMetadata(schema, rows, { checks });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = hasSchemaDrift(result) ? 1 : 0;
  await client.query('ROLLBACK');
} catch (error) {
  console.error(`Schema metadata check failed (${error.code ?? 'unknown error'}).`);
  process.exitCode = 1;
} finally { await client.end(); }
