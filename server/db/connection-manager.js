import pkg from 'pg';
const { Pool } = pkg;

// Replit Database - automatically handles DATABASE_URL for both dev and prod
// No manual environment switches needed
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

console.log('[connection-manager] ✅ Using Replit Database');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_MAX || 5),
  min: Number(process.env.PG_MIN || 0),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
  keepAlive: process.env.PG_KEEPALIVE !== 'false',
  ssl: { rejectUnauthorized: false },
  allowExitOnIdle: false,
});

// Basic error logging
pool.on('error', (err) => {
  console.error('[connection-manager] Unexpected error on idle client:', err.message);
  // Don't exit - just log and let reconnection happen naturally
});

export function getPool() {
  return pool;
}

export default pool;
