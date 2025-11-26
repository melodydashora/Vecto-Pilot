// Deprecated: Use connection-manager.js directly
// This module delegates to the shared connection pool for backward compatibility

import { getPool } from './connection-manager.js';

export async function getLazyPool() {
  return getPool();
}

export async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

export async function getClient() {
  const pool = getPool();
  return pool.connect();
}

export async function closePool() {
  // connection-manager handles pool lifecycle
  console.log('[pool-lazy] closePool() delegated to connection-manager');
}

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
