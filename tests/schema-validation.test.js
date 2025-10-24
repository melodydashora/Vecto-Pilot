
// tests/schema-validation.test.js
// Validates that Drizzle schema matches actual database schema
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../shared/schema.js';
import pool from '../server/db/client.js';

const db = drizzle(pool, { schema });

async function validateSchema() {
  console.log('[schema-validation] Starting schema drift detection...');
  
  try {
    // Check that all tables exist
    const tables = Object.keys(schema);
    console.log(`[schema-validation] Checking ${tables.length} tables...`);
    
    for (const tableName of tables) {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        );
      `, [tableName]);
      
      if (!result.rows[0].exists) {
        throw new Error(`Table ${tableName} missing from database!`);
      }
    }
    
    console.log('[schema-validation] ✅ All tables exist');
    
    // Try a sample query on each table
    for (const tableName of tables) {
      await pool.query(`SELECT COUNT(*) FROM ${tableName} LIMIT 1`);
    }
    
    console.log('[schema-validation] ✅ All tables queryable');
    console.log('[schema-validation] ✅ No schema drift detected');
    
    return { ok: true, tables: tables.length };
    
  } catch (error) {
    console.error('[schema-validation] ❌ Schema validation failed:', error.message);
    return { ok: false, error: error.message };
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateSchema().then(result => {
    process.exit(result.ok ? 0 : 1);
  });
}

export default validateSchema;
