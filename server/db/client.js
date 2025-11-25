// server/db/client.js
// DEPRECATED: Use connection-manager.js directly instead
// Kept for backward compatibility - delegates to shared connection pool
import { getPool as getSharedPool } from './connection-manager.js';

// Forward pool methods to shared connection manager
function getPool() {
  return getSharedPool();
}

const enhancedPool = {
  async query(...args) {
    try {
      return await getPool().query(...args);
    } catch (err) {
      console.error('[db-client] Query error:', err.message);
      throw err;
    }
  },
  
  async healthCheck() {
    try {
      await getPool().query('SELECT 1');
      return { ok: true, timestamp: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: err.message, timestamp: new Date().toISOString() };
    }
  },
  
  getPool,
  on: (...args) => getPool().on(...args),
  connect: (...args) => getPool().connect(...args),
  end: (...args) => getPool().end(...args)
};

export default enhancedPool;
