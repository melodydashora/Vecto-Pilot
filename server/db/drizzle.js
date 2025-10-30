import { drizzle } from 'drizzle-orm/node-postgres';
import { getSharedPool } from './pool.js';
import * as schema from '../../shared/schema.js';

// ROOT CAUSE FIX: The original Proxy approach broke Drizzle's synchronous method chaining
// Drizzle expects: db.select().from().where() - all methods are synchronous builders
// Solution: Use the pool getter which is lazy (no connections until first query)
const pool = getSharedPool();
export const db = drizzle(pool, { schema });
