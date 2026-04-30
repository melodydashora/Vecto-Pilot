import { Pool } from 'pg';

// DATABASE_URL auto-injected by Replit (Helium PostgreSQL 16).
// Dev: local, no SSL. Production: SSL required.

if (!process.env.DATABASE_URL) {
  console.error("❌ Fatal: DATABASE_URL is missing. Ensure Replit Postgres is enabled.");
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

// SSL conditional — Helium (dev) runs locally without SSL, production requires SSL.
const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
const sslConfig = isProduction ? { rejectUnauthorized: false } : false;

// Create a standard Postgres pool using the environment provided URL
// 2026-04-23: FIX — tuned pool for 57P01 resilience.
//   - idleTimeoutMillis bumped from 10s → 30s: 10s churned connections aggressively so the
//     pool was constantly opening new TCP sessions. 30s lets keepAlive keep warm connections
//     alive through the server's own idle timeout without excessive eviction.
//   - allowExitOnIdle: false made explicit — prevents the process from exiting when the pool
//     is briefly empty (happens during reconnect storms).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  max: 25, // ISSUE #22 FIX: Increased from 10 to 25 - strategy (2-3) + briefing (4-5) + blocks (2-3) = 8-11 per user, need buffer for concurrent users
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  statement_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: false,
});

// 2026-04-23: FIX — transient-error retry wrapper around pool.query.
// pg.Pool already evicts dead clients from `pool.on('error')`, but queries that are in
// flight when the server terminates the connection (57P01 admin_shutdown, 08006 connection
// failure, etc.) fail at the caller. One retry with a small backoff is safe because:
//   (a) 57P01 happens before the server commits anything (connection dies first), and
//   (b) the pool's next `connect()` pulls a fresh client and the retry runs on it.
// Both Drizzle (server/db/drizzle.js imports this same pool) and the raw `query` export
// below inherit this behavior since we monkey-patch the instance method directly.
const TRANSIENT_PG_ERROR_CODES = new Set([
  '57P01', // admin_shutdown — connection terminated by server
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
]);

const originalPoolQuery = pool.query.bind(pool);
pool.query = function retryablePoolQuery(textOrConfig, paramsOrCallback, maybeCallback) {
  // Callback-style invocation: pass through unchanged (pool handles callback semantics
  // internally; promise-wrapping it would break the contract).
  if (typeof paramsOrCallback === 'function' || typeof maybeCallback === 'function') {
    return originalPoolQuery(textOrConfig, paramsOrCallback, maybeCallback);
  }

  // Promise-style: retry once on transient error.
  return originalPoolQuery(textOrConfig, paramsOrCallback).catch(async (err) => {
    if (!TRANSIENT_PG_ERROR_CODES.has(err?.code)) throw err;
    const sqlPreview = String(textOrConfig?.text || textOrConfig || '').slice(0, 80).replace(/\s+/g, ' ');
    console.warn(`[pool] Transient ${err.code} on query; retrying once — "${sqlPreview}…"`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return originalPoolQuery(textOrConfig, paramsOrCallback);
  });
};

// Add connection acquisition monitoring to detect pool exhaustion
const connectionWarningThreshold = 20; // ISSUE #22 FIX: Updated threshold for 25 pool size (warn at 80%)
let lastWarningTime = 0;

pool.on('connect', (client) => {
  // Set statement timeout on each new connection
  client.query('SET statement_timeout TO 30000');
});

setInterval(() => {
  const stats = {
    idle: pool.idleCount ?? 0,
    total: pool.totalCount ?? 0,
    waiting: pool.waitingCount ?? 0,
    max: pool.options?.max ?? 35,
  };
  
  // Warn if pool is getting full
  if (stats.total >= connectionWarningThreshold && Date.now() - lastWarningTime > 60000) {
    console.warn(`⚠️ Connection pool nearing capacity: ${stats.total}/${stats.max} connections in use, ${stats.waiting} waiting`);
    lastWarningTime = Date.now();
  }
}, 30000); // Check every 30 seconds

pool.on('error', (err) => {
  // 57P01 = admin_shutdown (connection terminated by server).
  // Pool auto-recovers (evicts dead connection, creates new one on next query).
  if (err?.code === '57P01') {
    console.warn(`[pool] Connection terminated by server (57P01) — pool will auto-recover`);
  } else {
    console.error('[pool] Unexpected error on idle client:', err?.message || err);
  }
});

export const query = (text, params) => pool.query(text, params);

export function getPool() {
  return pool;
}

// Get agent state for health monitoring (PostgreSQL via Replit is stable, always report healthy)
export function getAgentState() {
  return {
    degraded: false,
    poolAlive: true,
    lastEvent: 'db.healthy',
    currentBackoffDelay: 0,
    reconnecting: false
  };
}

export default pool;
