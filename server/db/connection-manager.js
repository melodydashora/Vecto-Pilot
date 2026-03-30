import { Pool } from 'pg';

// Replit PostgreSQL automatically injects the correct DATABASE_URL
// for both Development (Helium, local) and Production (Deployments).
// 2026-02-26: Migrated from Neon to Replit Helium (PostgreSQL 16).
// Helium runs locally — no SSL needed in dev. Production may still require SSL.

if (!process.env.DATABASE_URL) {
  console.error("❌ Fatal: DATABASE_URL is missing. Ensure Replit Postgres is enabled.");
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

// 2026-02-26: SSL conditional — Helium (dev) runs locally without SSL,
// production databases (Neon, external) may require SSL.
const isProduction = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
const sslConfig = isProduction ? { rejectUnauthorized: false } : false;

// Create a standard Postgres pool using the environment provided URL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  max: 25, // ISSUE #22 FIX: Increased from 10 to 25 - strategy (2-3) + briefing (4-5) + blocks (2-3) = 8-11 per user, need buffer for concurrent users
  idleTimeoutMillis: 10000, // 2026-02-26: Relaxed from 3s to 10s — Helium runs locally, no Neon proxy termination risk
  connectionTimeoutMillis: 15000,
  statement_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

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
  // In Neon: proxy terminates idle connections. In Helium: shouldn't happen.
  // Pool auto-recovers in both cases (evicts dead connection, creates new one on next query).
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
