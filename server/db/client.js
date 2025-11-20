import pkg from 'pg';
const { Pool } = pkg;
import { getSharedPool } from './pool.js';

// LAZY POOL INITIALIZATION - Only create on first use
let pool = null;

function getPool() {
  if (pool) return pool;
  
  // Try shared pool first
  pool = getSharedPool();
  if (pool) return pool;
  
  // Fallback: Create local pool with OLD settings for backward compatibility
  console.log('[db] Creating local pool (shared pool disabled)');
  
  // DEV/PROD split: Use DEV_DATABASE_URL in local development
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1' 
    || process.env.REPLIT_DEPLOYMENT === 'true'
    || (process.env.NODE_ENV === 'production' && !process.env.DEV_DATABASE_URL);
  
  const dbUrl = isProduction 
    ? process.env.DATABASE_URL 
    : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);
  
  pool = new Pool({
    connectionString: dbUrl,
    max: 20,
    idleTimeoutMillis: 120000,  // 2 minutes (safe for Cloud Run)
    connectionTimeoutMillis: 5000,
    
    // TCP keepalive - Prevents NAT/LB from dropping idle connections
    keepAlive: true,
    keepAliveInitialDelayMillis: 30000,  // 30 seconds
    
    // Connection lifetime - Recycle to prevent zombie sockets
    maxUses: 7500,
    
    // SSL for production
    ssl: process.env.NODE_ENV === 'production' 
      ? { rejectUnauthorized: false } 
      : false
  });

  // Error event handler
  pool.on('error', (err, client) => {
    console.error('[db] ❌ Unexpected pool error:', err.message);
    console.error('[db] Stack:', err.stack);
    
    // Don't exit process, let connection retry logic handle it
    if (err.code === 'ECONNREFUSED') {
      console.error('[db] Database connection refused - will retry on next query');
    }
  });

  // Connection event handler
  pool.on('connect', (client) => {
    console.log('[db] ✅ New client connected to database');
  });

  // Remove event handler
  pool.on('remove', (client) => {
    console.log('[db] 🔌 Client disconnected from pool');
  });
  
  return pool;
}

// Startup health check with retry logic
let healthCheckAttempts = 0;
const MAX_HEALTH_CHECK_ATTEMPTS = 3;  // Reduced from 5 to 3 for faster failure
const HEALTH_CHECK_RETRY_DELAY = 1000;  // Reduced from 2s to 1s

async function performHealthCheck() {
  try {
    const result = await getPool().query('SELECT NOW() as current_time, version() as pg_version');
    console.log('[db] ✅ Database connection established');
    console.log('[db] PostgreSQL version:', result.rows[0].pg_version.split(',')[0]);
    console.log('[db] Current time:', result.rows[0].current_time);
    return true;
  } catch (err) {
    healthCheckAttempts++;
    console.error(`[db] ❌ Health check failed (attempt ${healthCheckAttempts}/${MAX_HEALTH_CHECK_ATTEMPTS}):`, err.message);
    
    if (healthCheckAttempts >= MAX_HEALTH_CHECK_ATTEMPTS) {
      console.error('[db] ❌ Database connection failed after maximum retry attempts');
      console.error('[db] WARNING: Database not available - app will continue but DB features won\'t work');
      console.error('[db] Please check DATABASE_URL and ensure PostgreSQL is accessible');
      // DON'T exit - let server continue running for health checks
      return false;
    }
    
    // Retry after delay
    console.log(`[db] Retrying health check in ${HEALTH_CHECK_RETRY_DELAY}ms...`);
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_RETRY_DELAY));
    return performHealthCheck();
  }
}

// REMOVED: Auto-run health check at module load
// This was triggering DB connections BEFORE health endpoints could respond
// Health checks now happen on-demand when first query is made

// Export enhanced pool with LAZY query wrapper
const enhancedPool = {
  async query(...args) {
    try {
      return await getPool().query(...args);
    } catch (err) {
      console.error('[db] Query error:', err.message);
      console.error('[db] Query:', args[0]?.substring?.(0, 100) || args[0]);
      throw err;
    }
  },
  
  // Health check method for monitoring
  async healthCheck() {
    try {
      await getPool().query('SELECT 1');
      return { ok: true, timestamp: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: err.message, timestamp: new Date().toISOString() };
    }
  },
  
  // Expose pool getter for direct access if needed
  getPool,
  
  // Delegate other pool methods lazily
  on: (...args) => getPool().on(...args),
  connect: (...args) => getPool().connect(...args),
  end: (...args) => getPool().end(...args)
};

export default enhancedPool;
