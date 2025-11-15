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
 * ALWAYS enabled - shared pool is mandatory for production stability
 */
export function getSharedPool() {
  if (!sharedPool) {
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

    // Error handler - critical for autoscale where connections may be terminated
    sharedPool.on('error', (err) => {
      console.error('[pool] Pool error (non-fatal):', {
        code: err.code,
        message: err.message,
        severity: err.severity
      });
      
      // Don't crash the app on connection errors
      // Cloud Run autoscale may hit connection limits temporarily
      if (err.code === '57P01') {
        console.error('[pool] Database connection terminated (likely connection limit)');
        console.error('[pool] Retrying on next query...');
      }
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
      reason: 'Pool not initialized (DATABASE_URL missing or first access not yet made)'
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
 * Export singleton pool getter (lazy initialization)
 * Pool is NOT created until first access - prevents boot-time DB connections
 */
export default getSharedPool;
