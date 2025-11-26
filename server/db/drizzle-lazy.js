// Lazy-loaded Drizzle instance
import { drizzle } from 'drizzle-orm/node-postgres';
import pool from './connection-manager.js';
import * as schema from '../../shared/schema.js';

let db = null;

export function getDb() {
  if (!db) {
    db = drizzle(pool, { schema });
  }
  return db;
}

export { getPool } from './connection-manager.js';
