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
 */
export function getPoolStats() {
  try {
    return {
      idle: pool.idleCount,
      total: pool.totalCount,
      waiting: pool.waitingCount,
      max: pool._max || 20,
      status: 'ok'
    };
  } catch (err) {
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
