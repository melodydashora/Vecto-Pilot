import pkg from 'pg';
const { Pool } = pkg;
import { getSharedPool } from './pool.js';

// Try to use shared pool first (feature-flagged), fall back to local pool
let pool = getSharedPool();

if (!pool) {
  // Fallback: Create local pool with OLD settings for backward compatibility
  // This path is active when PG_USE_SHARED_POOL=false
  console.log('[db] Using local pool (shared pool disabled)');
  
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000  // Reduced from 10s to 5s for faster startup
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
}

// Startup health check with retry logic
let healthCheckAttempts = 0;
const MAX_HEALTH_CHECK_ATTEMPTS = 3;  // Reduced from 5 to 3 for faster failure
const HEALTH_CHECK_RETRY_DELAY = 1000;  // Reduced from 2s to 1s

async function performHealthCheck() {
  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
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

// Run health check in background after a delay - completely non-blocking
// Use setTimeout instead of setImmediate to ensure server starts first
setTimeout(() => {
  performHealthCheck().catch(err => {
    console.error('[db] Background health check failed:', err.message);
    console.error('[db] WARNING: Database not available - app will continue but DB features won\'t work');
  });
}, 2000); // Wait 2 seconds after server starts

// Export enhanced pool with query wrapper for better error logging
const enhancedPool = {
  ...pool,
  
  async query(...args) {
    try {
      return await pool.query(...args);
    } catch (err) {
      console.error('[db] Query error:', err.message);
      console.error('[db] Query:', args[0]?.substring?.(0, 100) || args[0]);
      throw err;
    }
  },
  
  // Health check method for monitoring
  async healthCheck() {
    try {
      await pool.query('SELECT 1');
      return { ok: true, timestamp: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: err.message, timestamp: new Date().toISOString() };
    }
  }
};

export default enhancedPool;
