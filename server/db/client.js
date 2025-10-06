import pkg from 'pg';
const { Pool } = pkg;

// Singleton pool - survives hot reloads in development
// Prevents duplicate pools that cause connection churn
if (!globalThis.__pgPool__) {
  globalThis.__pgPool__ = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Neon requires SSL
    keepAlive: true,                     // Detect dropped connections fast
    max: 10,                             // Reasonable pool size for Neon
    idleTimeoutMillis: 30_000,          // 30s - don't let dead clients linger
    connectionTimeoutMillis: 5_000,     // 5s - fail fast to enter retry path
  });

  // Log pool errors (connection terminated, etc.) but don't crash
  globalThis.__pgPool__.on('error', (err) => {
    console.error('[pg-pool] Unexpected pool error (connection may have been terminated):', err.message);
  });
}

const pool = globalThis.__pgPool__;

/**
 * Retry wrapper for transient Postgres errors
 * Handles Neon autosuspend, compute restarts, and connection terminations
 * 
 * @param {Function} fn - Async function that performs the database operation
 * @param {number} attempts - Number of retry attempts (default: 3)
 * @returns {Promise<T>} Result of the database operation
 */
export async function withPgRetry(fn, attempts = 3) {
  let lastErr;
  
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = err?.code;
      const message = String(err?.message ?? '');
      
      // Detect transient errors that should be retried
      const transient =
        code === '57P01' || // terminating connection due to administrator command
        code === '57P03' || // cannot connect now
        code === '53300' || // too many connections
        message.includes('ECONNRESET') ||
        message.includes('reset by peer') ||
        message.includes('Client has encountered a connection error');

      // If not transient or final attempt, throw
      if (!transient || i === attempts - 1) {
        throw err;
      }

      // Simple exponential backoff: 250ms, 500ms, 750ms
      const backoffMs = 250 * (i + 1);
      console.log(`[pg-pool] Transient error (${code || 'network'}), retrying in ${backoffMs}ms... (attempt ${i + 1}/${attempts})`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      lastErr = err;
    }
  }
  
  throw lastErr;
}

// Example usage:
// import pool, { withPgRetry } from './db/client.js';
// 
// const rows = await withPgRetry(async () => {
//   const result = await pool.query('SELECT * FROM snapshots WHERE id = $1', [id]);
//   return result.rows;
// });

export default pool;
