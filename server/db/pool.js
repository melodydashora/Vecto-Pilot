import { getPool } from './connection-manager.js';

/**
 * Connection Pool with Admin Termination Handling
 * 
 * Wraps pg.Pool with degradation/reconnection logic to handle:
 * - Database admin-terminated connections (code 57P01)
 * - Connection pool exhaustion with background worker
 * - Exponential backoff with jitter for reconnection
 * - NDJSON audit trails for observability
 * 
 * See server/db/connection-manager.js for implementation
 */

const pool = getPool();

/**
 * Get pool statistics for monitoring
 * Returns actual connection pool metrics for health checks
 * Uses only public pg.Pool properties (safe across all versions)
 */
export function getPoolStats() {
  try {
    // Get max pool size from pool options (public API, safe across versions)
    // Fallback to 20 if not available (matches default in connection-manager.js)
    const maxPoolSize = pool.options?.max ?? 20;
    
    return {
      idle: pool.idleCount ?? 0,
      total: pool.totalCount ?? 0,
      waiting: pool.waitingCount ?? 0,
      max: maxPoolSize,
      status: 'ok'
    };
  } catch (err) {
    // If any error occurs accessing pool properties, return safe defaults
    return {
      idle: 0,
      total: 0,
      waiting: 0,
      max: 20,
      status: 'error',
      error: err.message
    };
  }
}

export function getSharedPool() {
  return pool;
}

export default getSharedPool;
