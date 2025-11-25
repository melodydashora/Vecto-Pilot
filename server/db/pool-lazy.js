// server/db/pool-lazy.js
// DEPRECATED: Use connection-manager.js directly instead
// This module now delegates to the shared connection pool for backward compatibility

import { getPool } from './connection-manager.js';

/**
 * Deprecated: Get or create the database pool
 * Now delegates to connection-manager.js
 */
export async function getLazyPool() {
  return getPool();
}

/**
 * Deprecated: Execute a query with lazy pool initialization
 * Now delegates to connection-manager.js pool
 */
export async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

/**
 * Deprecated: Get a client from the pool (for transactions)
 */
export async function getClient() {
  const pool = getPool();
  return pool.connect();
}

/**
 * Deprecated: Graceful shutdown
 */
export async function closePool() {
  // connection-manager handles pool lifecycle
  console.log('[pool-lazy] closePool() delegated to connection-manager');
}

/**
 * Deprecated: Health check
 */
export async function healthCheck() {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('[pool-lazy] Health check failed:', err.message);
    return false;
  }
}
