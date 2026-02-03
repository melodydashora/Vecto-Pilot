#!/usr/bin/env node
/**
 * Preflight Check - Run before deployment
 * Verifies database integrity, RLS status, and app health
 * 
 * Usage:
 *   npm run preflight
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Load DATABASE_URL
let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  try {
    const envContent = readFileSync('mono-mode.env', 'utf8');
    const match = envContent.match(/^DATABASE_URL=(.+)$/m);
    if (match) {
      DATABASE_URL = match[1].trim();
    }
  } catch (err) {
    console.error('❌ Could not read mono-mode.env:', err.message);
    process.exit(1);
  }
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

console.log('\n🚀 Vecto Pilot™ Preflight Check\n');
console.log('=' .repeat(60));

let hasErrors = false;
let hasWarnings = false;

// Test 1: Database Connection
console.log('\n📊 1. Database Connection...');
try {
  const client = await pool.connect();
  const result = await client.query('SELECT version()');
  console.log('   ✅ Connected to PostgreSQL');
  console.log(`   📌 Version: ${result.rows[0].version.split(' ').slice(0, 2).join(' ')}`);
  client.release();
} catch (err) {
  console.error('   ❌ Database connection failed:', err.message);
  hasErrors = true;
}

// Test 2: Table Count
console.log('\n📋 2. Table Integrity...');
try {
  const result = await pool.query(`
    SELECT COUNT(*) as count 
    FROM pg_tables 
    WHERE schemaname = 'public'
  `);
  const count = parseInt(result.rows[0].count);
  if (count === 19) {
    console.log(`   ✅ All 19 tables present`);
  } else {
    console.error(`   ❌ Expected 19 tables, found ${count}`);
    hasErrors = true;
  }
} catch (err) {
  console.error('   ❌ Table check failed:', err.message);
  hasErrors = true;
}

// Test 3: Primary Keys
console.log('\n🔑 3. Primary Key Integrity...');
try {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM information_schema.table_constraints
    WHERE constraint_type = 'PRIMARY KEY' 
      AND table_schema = 'public'
  `);
  const count = parseInt(result.rows[0].count);
  if (count === 19) {
    console.log(`   ✅ All 19 primary keys intact`);
  } else {
    console.error(`   ❌ Expected 19 primary keys, found ${count}`);
    hasErrors = true;
  }
} catch (err) {
  console.error('   ❌ Primary key check failed:', err.message);
  hasErrors = true;
}

// Test 4: Foreign Keys
console.log('\n🔗 4. Foreign Key Relationships...');
try {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM pg_constraint
    WHERE contype = 'f'
  `);
  const count = parseInt(result.rows[0].count);
  if (count >= 14) {
    console.log(`   ✅ ${count} foreign key relationships intact`);
  } else {
    console.error(`   ⚠️  Expected at least 14 foreign keys, found ${count}`);
    hasWarnings = true;
  }
} catch (err) {
  console.error('   ❌ Foreign key check failed:', err.message);
  hasErrors = true;
}

// Test 5: RLS Status
console.log('\n🔒 5. Row Level Security Status...');
try {
  const result = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE rowsecurity = true) as enabled,
      COUNT(*) FILTER (WHERE rowsecurity = false) as disabled
    FROM pg_tables 
    WHERE schemaname = 'public'
  `);
  const enabled = parseInt(result.rows[0].enabled);
  const disabled = parseInt(result.rows[0].disabled);
  
  if (enabled === 19) {
    console.log('   ✅ RLS ENABLED on all 19 tables (Production Ready)');
  } else if (disabled === 19) {
    console.log('   ⚠️  RLS DISABLED on all 19 tables (Development Mode)');
    console.log('   ⚠️  Run `npm run rls:enable` before deploying to production');
    hasWarnings = true;
  } else {
    console.error(`   ❌ Inconsistent RLS state: ${enabled} enabled, ${disabled} disabled`);
    hasErrors = true;
  }
} catch (err) {
  console.error('   ❌ RLS check failed:', err.message);
  hasErrors = true;
}

// Test 6: RLS Policy Count
console.log('\n🛡️  6. RLS Policy Coverage...');
try {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM pg_policies
    WHERE schemaname = 'public'
  `);
  const count = parseInt(result.rows[0].count);
  if (count >= 30) {
    console.log(`   ✅ ${count} RLS policies configured`);
  } else {
    console.error(`   ❌ Expected at least 30 policies, found ${count}`);
    hasErrors = true;
  }
} catch (err) {
  console.error('   ❌ Policy check failed:', err.message);
  hasErrors = true;
}

// Test 7: Memory Tables
console.log('\n🧠 7. Memory Tables...');
try {
  const tables = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('assistant_memory', 'eidolon_memory', 'cross_thread_memory', 'agent_memory')
    ORDER BY table_name
  `);
  if (tables.rows.length === 4) {
    console.log('   ✅ All 4 memory tables present');
    tables.rows.forEach(r => console.log(`      • ${r.table_name}`));
  } else {
    console.error(`   ❌ Expected 4 memory tables, found ${tables.rows.length}`);
    hasErrors = true;
  }
} catch (err) {
  console.error('   ❌ Memory table check failed:', err.message);
  hasErrors = true;
}

// Test 8: App Health
console.log('\n🏥 8. Application Health...');
try {
  const { stdout } = await execAsync('curl -s http://localhost:5174/health');
  if (stdout.trim() === 'OK') {
    console.log('   ✅ App is running and healthy');
  } else {
    console.error('   ❌ App health check failed:', stdout);
    hasErrors = true;
  }
} catch (err) {
  console.error('   ❌ App is not running or health endpoint failed');
  hasErrors = true;
}

// Test 9: Migration Files
console.log('\n📁 9. Migration Files...');
try {
  const { stdout } = await execAsync('ls -1 migrations/*.sql 2>&1');
  const migrations = stdout.trim().split('\n').filter(f => f.endsWith('.sql'));
  if (migrations.length >= 3) {
    console.log(`   ✅ ${migrations.length} migration files found`);
    migrations.forEach(m => {
      const name = m.split('/').pop();
      console.log(`      • ${name}`);
    });
  } else {
    console.error(`   ⚠️  Expected at least 3 migrations, found ${migrations.length}`);
    hasWarnings = true;
  }
} catch (err) {
  console.error('   ❌ Migration check failed:', err.message);
  hasErrors = true;
}

// Cleanup
await pool.end();

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n📋 Preflight Summary:\n');

if (hasErrors) {
  console.log('❌ FAILED - Critical issues detected');
  console.log('   Fix the errors above before deploying\n');
  process.exit(1);
} else if (hasWarnings) {
  console.log('⚠️  PASSED WITH WARNINGS');
  console.log('   Review warnings above before deploying\n');
  process.exit(0);
} else {
  console.log('✅ ALL CHECKS PASSED');
  console.log('   Your database is ready for deployment!\n');
  process.exit(0);
}
