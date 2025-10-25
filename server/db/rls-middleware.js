/**
 * RLS (Row Level Security) Middleware
 * Sets session variables for PostgreSQL RLS policies
 */

import { getSharedPool } from "./pool.js";

/**
 * Execute a query with RLS context
 * @param {object} options - Query options
 * @param {string} options.userId - User ID for RLS (UUID or null)
 * @param {string} options.sessionId - Session ID for RLS (UUID or null)
 * @param {string} options.query - SQL query to execute
 * @param {Array} options.values - Query parameter values
 * @returns {Promise} Query result
 */
export async function queryWithRLS({ userId = null, sessionId = null, query, values = [] }) {
  const pool = getSharedPool();
  
  if (!pool) {
    throw new Error("Database pool not initialized");
  }

  const client = await pool.connect();
  
  try {
    // Set RLS session variables
    if (userId) {
      await client.query('SET LOCAL app.user_id = $1', [userId]);
    }
    
    if (sessionId) {
      await client.query('SET LOCAL app.session_id = $1', [sessionId]);
    }
    
    // Execute the actual query
    const result = await client.query(query, values);
    
    return result;
  } finally {
    // Reset session variables and release client back to pool
    try {
      await client.query('RESET app.user_id');
      await client.query('RESET app.session_id');
    } catch (err) {
      console.warn('[RLS] Failed to reset session variables:', err.message);
    }
    client.release();
  }
}

/**
 * Execute a transaction with RLS context
 * @param {object} options - Transaction options
 * @param {string} options.userId - User ID for RLS (UUID or null)
 * @param {string} options.sessionId - Session ID for RLS (UUID or null)
 * @param {Function} options.callback - Async callback that receives client
 * @returns {Promise} Transaction result
 */
export async function transactionWithRLS({ userId = null, sessionId = null, callback }) {
  const pool = getSharedPool();
  
  if (!pool) {
    throw new Error("Database pool not initialized");
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Set RLS session variables
    if (userId) {
      await client.query('SET LOCAL app.user_id = $1', [userId]);
    }
    
    if (sessionId) {
      await client.query('SET LOCAL app.session_id = $1', [sessionId]);
    }
    
    // Execute transaction callback
    const result = await callback(client);
    
    await client.query('COMMIT');
    
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create a wrapped pool that automatically sets RLS context
 * Use this for queries that need RLS enforcement
 */
export function createRLSPool({ userId = null, sessionId = null }) {
  const pool = getSharedPool();
  
  if (!pool) {
    throw new Error("Database pool not initialized");
  }

  return {
    query: async (text, params) => {
      return queryWithRLS({ userId, sessionId, query: text, values: params });
    },
    
    transaction: async (callback) => {
      return transactionWithRLS({ userId, sessionId, callback });
    },
    
    // Direct pool access (bypasses RLS)
    direct: pool
  };
}
