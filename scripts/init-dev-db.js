/**
 * Initialize dev database with production schema
 * Usage: DEV_DATABASE_URL=<url> node scripts/init-dev-db.js
 */

import pg from 'pg';
const { Pool } = pg;

const devDbUrl = process.env.DEV_DATABASE_URL;

if (!devDbUrl) {
  console.error('❌ DEV_DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: devDbUrl,
  ssl: { rejectUnauthorized: false }
});

async function initDevDatabase() {
  console.log('🚀 Initializing dev database schema...');
  
  try {
    // Read production schema and replicate it
    const prodPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // Get all table creation SQL from production
    const tablesResult = await prodPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`📋 Found ${tablesResult.rows.length} tables in production`);
    
    for (const { table_name } of tablesResult.rows) {
      console.log(`  📦 Copying schema for table: ${table_name}`);
      
      // Get table structure
      const structureResult = await prodPool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table_name]);
      
      // Build CREATE TABLE statement
      const columns = structureResult.rows.map(col => {
        let def = `"${col.column_name}" ${col.data_type}`;
        if (col.is_nullable === 'NO') def += ' NOT NULL';
        if (col.column_default) def += ` DEFAULT ${col.column_default}`;
        return def;
      }).join(', ');
      
      const createTableSQL = `CREATE TABLE IF NOT EXISTS "${table_name}" (${columns})`;
      
      try {
        await pool.query(createTableSQL);
        console.log(`    ✅ Created ${table_name}`);
      } catch (err) {
        console.log(`    ⚠️  ${table_name}: ${err.message}`);
      }
    }
    
    await prodPool.end();
    
    // Verify dev database
    const verifyResult = await pool.query(`
      SELECT COUNT(*) as table_count 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log(`\n✅ Dev database initialized with ${verifyResult.rows[0].table_count} tables`);
    
  } catch (error) {
    console.error('❌ Error initializing dev database:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDevDatabase();
