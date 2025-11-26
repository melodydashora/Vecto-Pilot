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
 * Note: Direct pool access is now wrapped - use /health endpoint for state
 */
export function getPoolStats() {
  return {
    note: 'Pool statistics now available via /health endpoint',
    wrapped: true,
    degradation_support: true
  };
}

export function getSharedPool() {
  return pool;
}

export default getSharedPool;
