/**
 * Enhanced Database Logger Middleware
 * 
 * Add to server/index.js or routes.js to log all database operations
 * during workflow testing
 */

import { db } from '../shared/db.js';

// Query operation logger
export function logDatabaseOperation(operation, table, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    operation,
    table,
    data: data ? (typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data) : null
  };
  
  console.log(`[DB-OP] ${operation} on ${table}`, logEntry);
  return logEntry;
}

// Wrapper for database queries
export async function loggedQuery(queryFn, operation, table, description = '') {
  const startTime = Date.now();
  
  logDatabaseOperation('START', table, { operation, description });
  
  try {
    const result = await queryFn();
    const duration = Date.now() - startTime;
    
    const resultInfo = {
      duration: `${duration}ms`,
      rowCount: Array.isArray(result) ? result.length : result?.rowCount || 0,
      description
    };
    
    logDatabaseOperation('COMPLETE', table, resultInfo);
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logDatabaseOperation('ERROR', table, {
      duration: `${duration}ms`,
      error: error.message,
      description
    });
    
    throw error;
  }
}

// Example usage in routes:
/*
import { loggedQuery } from '../scripts/enhanced-db-logger.js';

// In your route handler:
const snapshots = await loggedQuery(
  () => db.select().from(snapshotsTable).where(eq(snapshotsTable.id, snapshotId)),
  'SELECT',
  'snapshots',
  `Fetching snapshot ${snapshotId}`
);

const inserted = await loggedQuery(
  () => db.insert(candidatesTable).values(candidateData).returning(),
  'INSERT',
  'candidates',
  `Inserting ${candidateData.length} candidates`
);
*/

export default {
  logDatabaseOperation,
  loggedQuery
};
