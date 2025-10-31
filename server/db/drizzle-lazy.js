// server/db/drizzle-lazy.js
// Lazy-loaded Drizzle instance
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
const { Pool } = pg;

let db = null;
let pool = null;

export function getDb() {
  if (!db) {
    const DATABASE_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    db = drizzle(pool);
  }
  
  return db;
}

export function getPool() {
  if (!pool) {
    getDb(); // Initialize pool if not already
  }
  return pool;
}
