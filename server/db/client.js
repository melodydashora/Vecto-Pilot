
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // Retry connection on failure
  connectionTimeoutMillis: 10000
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

// Startup health check with retry logic
let healthCheckAttempts = 0;
const MAX_HEALTH_CHECK_ATTEMPTS = 5;
const HEALTH_CHECK_RETRY_DELAY = 2000;

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
      console.error('[db] Please check DATABASE_URL and ensure PostgreSQL is running');
      process.exit(1);
    }
    
    // Retry after delay
    console.log(`[db] Retrying health check in ${HEALTH_CHECK_RETRY_DELAY}ms...`);
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_RETRY_DELAY));
    return performHealthCheck();
  }
}

// Run health check in background - don't block server startup
performHealthCheck().catch(err => {
  console.error('[db] Health check failed, but continuing startup:', err.message);
  // Don't exit - let queries fail gracefully if DB is unavailable
});

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
