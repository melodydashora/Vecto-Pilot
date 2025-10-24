import pkg from 'pg';
const { Pool } = pkg;

/**
 * Shared PostgreSQL Connection Pool
 * 
 * Single source of truth for all database connections.
 * Prevents "Client disconnected by pool" errors with:
 * - TCP keepalive to survive NAT/LB idle timeouts
 * - Safe idle timeout (2 minutes vs aggressive 30s)
 * - Connection recycling to prevent zombie sockets
 * 
 * Feature flag: PG_USE_SHARED_POOL=true to enable
 */

let sharedPool = null;

/**
 * Get or create the singleton connection pool
 */
export function getSharedPool() {
  if (!sharedPool) {
    const useSharedPool = process.env.PG_USE_SHARED_POOL === 'true';
    
    if (!useSharedPool) {
      console.log('[pool] Shared pool disabled (PG_USE_SHARED_POOL=false)');
      return null;
    }

    if (!process.env.DATABASE_URL) {
      console.warn('[pool] DATABASE_URL not set, cannot create pool');
      return null;
    }

    const config = {
      connectionString: process.env.DATABASE_URL,
      
      // Pool size - Small, warm pool sized to real concurrency
      max: parseInt(process.env.PG_MAX ?? '10', 10),
      min: parseInt(process.env.PG_MIN ?? '2', 10),
      
      // Idle timeout - 2 minutes (safe for cloud NATs)
      // Cloud NATs typically drop at 2-15 min; 120s is boringly safe
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS ?? '120000', 10),
      
      // Connection timeout - How long to wait for new connection
      connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS ?? '10000', 10),
      
      // TCP keepalive - Prevents NAT/LB from dropping idle connections
      // AWS NLB default: 350s, ALB HTTP/1.1: 60s
      // 30s keepalive beats all common cloud network timers
      keepAlive: process.env.PG_KEEPALIVE !== 'false',
      keepAliveInitialDelayMillis: parseInt(process.env.PG_KEEPALIVE_DELAY_MS ?? '30000', 10),
      
      // Connection lifetime - Recycle to prevent zombie sockets
      // After 7500 queries, return connection to pool for refresh
      maxUses: parseInt(process.env.PG_MAX_USES ?? '7500', 10),
      
      // SSL for production
      ssl: process.env.NODE_ENV === 'production' 
        ? { rejectUnauthorized: false } 
        : false,
      
      // Don't exit on idle
      allowExitOnIdle: false
    };

    sharedPool = new Pool(config);

    // Error handler
    sharedPool.on('error', (err) => {
      console.error('[pool] Unexpected pool error:', err);
    });

    // Connect event (for monitoring)
    sharedPool.on('connect', (client) => {
      console.log('[pool] New client connected to pool');
    });

    // Remove event (for monitoring)
    sharedPool.on('remove', (client) => {
      console.log('[pool] Client removed from pool');
    });

    console.log('[pool] ✅ Shared pool initialized:', {
      max: config.max,
      min: config.min,
      idleTimeoutMs: config.idleTimeoutMillis,
      keepAlive: config.keepAlive,
      keepAliveDelayMs: config.keepAliveInitialDelayMillis,
      maxUses: config.maxUses
    });
  }

  return sharedPool;
}

/**
 * Get pool statistics for monitoring
 */
export function getPoolStats() {
  if (!sharedPool) {
    return {
      enabled: false,
      reason: process.env.PG_USE_SHARED_POOL !== 'true' 
        ? 'Feature flag disabled' 
        : 'Pool not initialized'
    };
  }

  return {
    enabled: true,
    totalCount: sharedPool.totalCount,
    idleCount: sharedPool.idleCount,
    waitingCount: sharedPool.waitingCount,
    maxSize: sharedPool.options.max,
    config: {
      max: sharedPool.options.max,
      idleTimeoutMs: sharedPool.options.idleTimeoutMillis,
      keepAlive: sharedPool.options.keepAlive,
      keepAliveDelayMs: sharedPool.options.keepAliveInitialDelayMillis
    }
  };
}

/**
 * Export singleton pool directly (for compatibility)
 */
const pool = getSharedPool();
export default pool;
