// server/db/drizzle-lazy.js
// Lazy-loaded Drizzle instance using shared connection-manager pool
import { drizzle } from 'drizzle-orm/node-postgres';
import { getPool } from './connection-manager.js';

let db = null;

export function getDb() {
  if (!db) {
    const pool = getPool();
    db = drizzle(pool, { logger: false });
  }
  
  return db;
}

export { getPool } from './connection-manager.js';
