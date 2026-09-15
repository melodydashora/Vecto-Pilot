#!/usr/bin/env node
// Opt-in read-only metadata check. Uses only the supplied DATABASE_URL.
import pg from 'pg';
import * as schema from '../shared/schema.js';
import { compareSchemaMetadata } from './lib/schema-drift.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '15s'");
  const { rows } = await client.query("SELECT table_name,column_name,data_type,udt_name,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position");
  const result = compareSchemaMetadata(schema, rows);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.missingDeclaredColumns.length || result.looserDatabaseNullability.length || result.typeDifferences.length ? 1 : 0;
  await client.query('ROLLBACK');
} catch (error) {
  console.error(`Schema metadata check failed (${error.code ?? 'unknown error'}).`);
  process.exitCode = 1;
} finally { await client.end(); }
