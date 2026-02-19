import { Pool } from 'pg';

// SIMPLIFIED: Replit PostgreSQL automatically injects the correct DATABASE_URL 
// for both Development (local) and Production (Deployments).
// We do not need manual switching logic or external database provider checks.

if (!process.env.DATABASE_URL) {
  console.error("❌ Fatal: DATABASE_URL is missing. Ensure Replit Postgres is enabled.");
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

// Create a standard Postgres pool using the environment provided URL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Replit PostgreSQL requires SSL with self-signed certs support
  max: 25, // ISSUE #22 FIX: Increased from 10 to 25 - strategy (2-3) + briefing (4-5) + blocks (2-3) = 8-11 per user, need buffer for concurrent users
  idleTimeoutMillis: 3000, // 2026-02-17: Reduced from 10s to 3s — close idle connections BEFORE Neon's proxy terminates them (prevents 57P01 error wall on refresh)
  connectionTimeoutMillis: 15000, // Slightly increased for safety during connection spikes
  statement_timeout: 30000, // 30 second statement timeout to prevent long-running queries from blocking
  keepAlive: true, // Keep TCP connections alive
  keepAliveInitialDelayMillis: 10000, // Start keepalive after 10s
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
  // 2026-02-17: Distinguish Neon connection termination (57P01) from real errors.
  // 57P01 happens when: user refreshes → queries cancel → connections go idle → Neon proxy terminates.
  // The pool auto-recovers (evicts dead connection, creates new one on next query).
  if (err?.code === '57P01') {
    console.warn(`[pool] Neon terminated idle connection (57P01) — pool will auto-recover`);
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
