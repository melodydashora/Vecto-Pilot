import { Pool } from 'pg';
import { databaseConnectionConfig } from './connection-config.js';

// DATABASE_URL auto-injected by Replit: Helium PostgreSQL 16 in dev workspace,
// Neon serverless Postgres in published deployment.
// Dev: local, no SSL. Production: SSL required.

if (!process.env.DATABASE_URL) {
  console.error("Fatal: DATABASE_URL is missing. Ensure Replit Postgres is enabled.");
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

// Create a standard Postgres pool using the environment provided URL
// 2026-04-23: FIX — tuned pool for 57P01 resilience.
//   - idleTimeoutMillis bumped from 10s → 30s: 10s churned connections aggressively so the
//     pool was constantly opening new TCP sessions. 30s lets keepAlive keep warm connections
//     alive through the server's own idle timeout without excessive eviction.
//   - allowExitOnIdle: false made explicit — prevents the process from exiting when the pool
//     is briefly empty (happens during reconnect storms).
export const pool = new Pool({
  ...databaseConnectionConfig(),
  max: 25, // ISSUE #22 FIX: Increased from 10 to 25 - strategy (2-3) + briefing (4-5) + blocks (2-3) = 8-11 per user, need buffer for concurrent users
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  statement_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: false,
});

// Do not transparently replay queries after connection loss. The server may
// have committed before its response was lost; even SELECT can invoke a
// sequence or a volatile function. pg evicts broken clients so later explicit
// operations can reconnect. A caller that can prove idempotence owns its retry.

// Add connection acquisition monitoring to detect pool exhaustion
const connectionWarningThreshold = 20; // ISSUE #22 FIX: Updated threshold for 25 pool size (warn at 80%)
let lastWarningTime = 0;

pool.on('connect', (client) => {
  // statement_timeout is sent in pg's startup configuration above. A duplicate
  // fire-and-forget SET here used to introduce an unhandled query rejection.
  // 2026-08-17 (race review, verified with a protocol-faithful fake PG server): a client
  // that is CHECKED OUT (db.transaction / pool.connect) has no 'error' listener — pg-pool
  // removes its idle listener on acquire — so a 57P01 / socket death mid-transaction
  // raises Node's unhandled 'error' event → uncaughtException → gateway exit(1). The
  // pool.query path never had this exposure (pg-pool attaches client.once('error') per
  // query). This listener stays for the client's whole life; it only logs — the query
  // itself still rejects to the caller, who decides whether to retry.
  client.on('error', (err) => {
    console.warn(`[DB] Client error while checked out (${err?.code || 'no code'}): ${err?.message || err} — pool will evict it`);
  });
});

const poolMonitor = setInterval(() => {
  const stats = {
    idle: pool.idleCount ?? 0,
    total: pool.totalCount ?? 0,
    waiting: pool.waitingCount ?? 0,
    max: pool.options?.max ?? 35,
  };
  
  // Warn if pool is getting full
  if (stats.total >= connectionWarningThreshold && Date.now() - lastWarningTime > 60000) {
    console.warn(`Connection pool nearing capacity: ${stats.total}/${stats.max} connections in use, ${stats.waiting} waiting`);
    lastWarningTime = Date.now();
  }
}, 30000); // Check every 30 seconds

// Monitoring must not keep CLI checks/tests alive after their work and pool close.
poolMonitor.unref();

pool.on('error', (err) => {
  // 57P01 = admin_shutdown (connection terminated by server).
  // Pool auto-recovers (evicts dead connection, creates new one on next query).
  if (err?.code === '57P01') {
    console.warn(`[DB] Connection terminated by server (57P01) — pool will auto-recover`);
  } else {
    console.error('[DB] Unexpected error on idle client:', err?.message || err);
  }
});

export const query = (text, params) => pool.query(text, params);

export function getPool() {
  return pool;
}

// Legacy retry-agent compatibility fields only; the pool has no retry agent.
// These defaults are not a database health probe. Health/readiness routes issue
// their own SELECT 1 and must keep using that result to determine availability.
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
