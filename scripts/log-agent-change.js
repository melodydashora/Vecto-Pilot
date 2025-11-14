import { db } from '../server/db/drizzle.js';
import { agent_changes } from '../shared/schema.js';

/**
 * Log an agent change to the database (append-only)
 * @param {Object} params
 * @param {string} params.change_type - Type of change: 'file_edit', 'file_create', 'dependency_update', 'schema_change', 'config_update', etc.
 * @param {string} params.description - Human-readable description of the change
 * @param {string} [params.file_path] - File path affected (optional)
 * @param {Object} [params.details] - Additional context (optional)
 * @returns {Promise<Object>} The inserted change record
 */
export async function logAgentChange({ change_type, description, file_path = null, details = null }) {
  try {
    const [record] = await db.insert(agent_changes).values({
      change_type,
      description,
      file_path,
      details
    }).returning();
    
    console.log(`[AGENT-CHANGE-LOG] ${change_type}: ${description}${file_path ? ` (${file_path})` : ''}`);
    return record;
  } catch (err) {
    console.error('[AGENT-CHANGE-LOG] Failed to log change:', err.message);
    throw err;
  }
}

/**
 * Retrieve recent agent changes
 * @param {number} limit - Number of records to retrieve (default: 50)
 * @returns {Promise<Array>} Recent change records
 */
export async function getRecentChanges(limit = 50) {
  try {
    const changes = await db.select()
      .from(agent_changes)
      .orderBy(agent_changes.created_at, 'desc')
      .limit(limit);
    return changes;
  } catch (err) {
    console.error('[AGENT-CHANGE-LOG] Failed to retrieve changes:', err.message);
    throw err;
  }
}

/**
 * CLI interface for logging changes
 * Usage: node scripts/log-agent-change.js <change_type> <description> [file_path]
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, change_type, description, file_path] = process.argv;
  
  if (!change_type || !description) {
    console.error('Usage: node scripts/log-agent-change.js <change_type> <description> [file_path]');
    console.error('Example: node scripts/log-agent-change.js file_edit "Updated schema" shared/schema.js');
    process.exit(1);
  }
  
  logAgentChange({ change_type, description, file_path })
    .then((record) => {
      console.log('✅ Change logged:', record);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Failed to log change:', err);
      process.exit(1);
    });
}
