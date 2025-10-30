// server/db/pool-lazy.js
// Truly lazy PostgreSQL pool with Cloud Run autoscale tuning
// Pool is NOT created at module load - only on first query

import pkg from 'pg';
const { Pool } = pkg;

let pool = null;
let poolCreationPromise = null;

/**
 * Environment detection for autoscale optimization
 */
const isAutoscale = !!(process.env.K_SERVICE || process.env.CLOUD_RUN_AUTOSCALE === '1');
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Get or create the database pool (lazy initialization)
 * This prevents DB connections from being created during boot
 * 
 * @returns {Promise<Pool>} PostgreSQL pool instance
 */
export async function getLazyPool() {
  // Return existing pool immediately
  if (pool) return pool;
  
  // Prevent concurrent pool creation
  if (poolCreationPromise) return poolCreationPromise;
  
  // Create pool with autoscale-aware settings
  poolCreationPromise = (async () => {
    console.log('[db-lazy] Creating pool on first use...');
    
    const poolConfig = {
      connectionString: process.env.DATABASE_URL,
      
      // Autoscale: Small pool, fast recycling
      // Reserved: Larger pool, longer-lived connections
      max: isAutoscale 
        ? Number(process.env.PG_MAX || 2)   // Autoscale: 2 connections max
        : Number(process.env.PG_MAX || 10), // Reserved: 10 connections max
      
      min: Number(process.env.PG_MIN || 0), // Always 0 - lazy connect
      
      // Autoscale: Aggressive timeout (Cloud Run terminates fast)
      // Reserved: Longer timeout (stable instances)
      idleTimeoutMillis: isAutoscale
        ? Number(process.env.PG_IDLE_TIMEOUT_MS || 10000)  // 10s on autoscale
        : Number(process.env.PG_IDLE_TIMEOUT_MS || 30000), // 30s on reserved
      
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 3000),
      
      // Allow pool to exit when idle (important for autoscale)
      allowExitOnIdle: true,
      
      // TCP keepalive - Prevents NAT/LB from dropping idle connections
      keepAlive: true,
      keepAliveInitialDelayMillis: 30000,
      
      // Connection lifetime - Recycle to prevent zombie sockets
      maxUses: isAutoscale ? 100 : 7500,
      
      // SSL for production
      ssl: isProduction 
        ? { rejectUnauthorized: false } 
        : false
    };
    
    pool = new Pool(poolConfig);
    
    // Error event handler - log but don't crash
    pool.on('error', (err) => {
      console.error('[db-lazy] Pool error:', err.message);
      if (err.code === 'ECONNREFUSED') {
        console.error('[db-lazy] Database connection refused - will retry on next query');
      }
    });
    
    // Connection event handler
    pool.on('connect', () => {
      console.log('[db-lazy] Client connected');
    });
    
    // Remove event handler
    pool.on('remove', () => {
      console.log('[db-lazy] Client removed from pool');
    });
    
    console.log(`[db-lazy] Pool created (max=${poolConfig.max}, mode=${isAutoscale ? 'autoscale' : 'reserved'})`);
    
    return pool;
  })();
  
  return poolCreationPromise;
}

/**
 * Execute a query with lazy pool initialization
 * This is the primary way to interact with the database
 * 
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(text, params) {
  const pool = await getLazyPool();
  return pool.query(text, params);
}

/**
 * Get a client from the pool (for transactions)
 * 
 * @returns {Promise<Object>} PostgreSQL client
 */
export async function getClient() {
  const pool = await getLazyPool();
  return pool.connect();
}

/**
 * Graceful shutdown - close all connections
 */
export async function closePool() {
  if (pool) {
    console.log('[db-lazy] Closing pool...');
    await pool.end();
    pool = null;
    poolCreationPromise = null;
    console.log('[db-lazy] Pool closed');
  }
}

/**
 * Optional: Health check (use sparingly, creates connection)
 * Only call this when explicitly needed, not during boot
 */
export async function healthCheck() {
  try {
    const result = await query('SELECT NOW() as current_time, version() as pg_version');
    console.log('[db-lazy] Health check OK');
    console.log('[db-lazy] PostgreSQL:', result.rows[0].pg_version.split(',')[0]);
    return true;
  } catch (err) {
    console.error('[db-lazy] Health check failed:', err.message);
    return false;
  }
}
