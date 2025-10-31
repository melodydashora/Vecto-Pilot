import { drizzle } from 'drizzle-orm/node-postgres';
import { getSharedPool } from './pool.js';
import pkg from 'pg';
import * as schema from '../../shared/schema.js';

const { Pool } = pkg;

// ROOT CAUSE FIX: The original Proxy approach broke Drizzle's synchronous method chaining
// Drizzle expects: db.select().from().where() - all methods are synchronous builders
// Solution: Use shared pool if enabled, otherwise create dedicated pool
let pool = getSharedPool();

if (!pool) {
  // Shared pool disabled - create dedicated pool for Drizzle
  console.log('[drizzle] Creating dedicated pool (shared pool disabled)');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 120000,
    connectionTimeoutMillis: 10000
  });
}

export const db = drizzle(pool, { schema });
