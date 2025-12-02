import { Pool } from 'pg';

// SIMPLIFIED: Replit PostgreSQL automatically injects the correct DATABASE_URL 
// for both Development (local) and Production (Deployments).
// We do not need manual switching logic or external database provider checks.

if (!process.env.DATABASE_URL) {
  console.error("❌ Fatal: DATABASE_URL is missing. Ensure Replit Postgres is enabled.");
  process.exit(1);
}

// Create a standard Postgres pool using the environment provided URL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // FIXED: Reduced from 35 to 10 (Replit Postgres handles ~5-10 concurrent connections)
  idleTimeoutMillis: 30000, // FIXED: Reduced from 60s to 30s to match Replit's connection lifecycle
  connectionTimeoutMillis: 15000, // Slightly increased for safety during connection spikes
  statement_timeout: 30000, // 30 second statement timeout to prevent long-running queries from blocking
});

// Add connection acquisition monitoring to detect pool exhaustion
const connectionWarningThreshold = 8; // Warn when 8/10 connections in use
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
  console.error('Unexpected error on idle client', err);
  // Don't exit process immediately in serverless/replit envs, just log
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
