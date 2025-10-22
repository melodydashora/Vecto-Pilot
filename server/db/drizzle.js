import { drizzle } from 'drizzle-orm/node-postgres';
import pool from './client.js';
import * as schema from '../../shared/schema.js';

// Lazy drizzle instance - only creates pool when first query is made
let _db;
function getDB() {
  if (!_db) {
    _db = drizzle(pool, { schema });
  }
  return _db;
}

// Export a Proxy that lazily initializes the drizzle instance
export const db = new Proxy({}, {
  get(target, prop) {
    const actualDB = getDB();
    const value = actualDB[prop];
    return typeof value === 'function' ? value.bind(actualDB) : value;
  }
});
