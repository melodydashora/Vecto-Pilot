/**
 * POST-DEPLOY SQL RUNNER
 * 
 * Executes migration SQL files after deployment
 * Usage: npm run postdeploy:sql
 */

import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

const MIGRATION_FILES = [
  'drizzle/0003_event_enrichment.sql',
  'drizzle/0004_event_proximity.sql',
  'drizzle/0005_staging_nodes.sql'
];

// Check DATABASE_URL (sanitized output)
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('❌ DATABASE_URL environment variable not set');
  process.exit(1);
}

console.log('🔍 Database connection:');
console.log(`   URL present: ✅`);
console.log(`   SSL mode: ${dbUrl.includes('sslmode=require') ? '✅ required' : '⚠️  not set (may fail with Neon)'}`);

// Test connection
try {
  console.log('\n🔌 Testing database connection...');
  const testResult = await db.execute(sql`SELECT now() as current_time, current_database() as db_name`);
  console.log(`   ✅ Connected to: ${testResult.rows[0].db_name}`);
  console.log(`   ✅ Server time: ${testResult.rows[0].current_time}`);
} catch (err) {
  console.error('\n❌ Database connection failed:', err.message);
  console.error('   Check your DATABASE_URL secret and ensure it includes ?sslmode=require for Neon');
  process.exit(1);
}

// Check extensions
console.log('\n🔍 Checking required extensions...');
try {
  const extResult = await db.execute(sql`
    SELECT extname, extversion 
    FROM pg_extension 
    WHERE extname IN ('pgcrypto', 'pg_trgm')
  `);
  const installed = extResult.rows.map(r => r.extname);
  console.log(`   Extensions: ${installed.length > 0 ? installed.join(', ') : 'none yet (will be created)'}`);
} catch (err) {
  console.warn('   ⚠️  Could not check extensions (will be created during migration)');
}

// Execute migrations
console.log('\n⚙️  Executing migrations...\n');

for (const migrationFile of MIGRATION_FILES) {
  console.log(`📄 ${migrationFile}`);
  
  if (!fs.existsSync(migrationFile)) {
    console.log(`   ⏭️  Skipped (file not found)`);
    continue;
  }
  
  try {
    const migrationSQL = fs.readFileSync(migrationFile, 'utf8');
    const startTime = Date.now();
    await db.execute(sql.raw(migrationSQL));
    const elapsed = Date.now() - startTime;
    console.log(`   ✅ Completed in ${elapsed}ms`);
  } catch (err) {
    console.error(`   ❌ Failed: ${err.message}`);
    // Don't exit - continue with other migrations
  }
  console.log('');
}

console.log('✅ All migrations processed\n');

// Verify migration components
console.log('🔍 Verifying migration components...');

const checks = [
  { name: 'events_facts table', query: sql`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'events_facts'` },
  { name: 'event_badge_missing column', query: sql`SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'ranking_candidates' AND column_name = 'event_badge_missing'` },
  { name: 'node_type column (staging)', query: sql`SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'ranking_candidates' AND column_name = 'node_type'` },
  { name: 'v_coach_strategy_context view', query: sql`SELECT COUNT(*) as count FROM information_schema.views WHERE table_name = 'v_coach_strategy_context'` },
  { name: 'fn_upsert_event function', query: sql`SELECT COUNT(*) as count FROM information_schema.routines WHERE routine_name = 'fn_upsert_event'` },
  { name: 'fn_refresh_venue_enrichment function', query: sql`SELECT COUNT(*) as count FROM information_schema.routines WHERE routine_name = 'fn_refresh_venue_enrichment'` },
  { name: 'fn_haversine_distance function', query: sql`SELECT COUNT(*) as count FROM information_schema.routines WHERE routine_name = 'fn_haversine_distance'` }
];

let allPassed = true;

for (const check of checks) {
  try {
    const result = await db.execute(check.query);
    const count = parseInt(result.rows[0].count);
    const status = count > 0 ? '✅' : '⚠️ ';
    console.log(`   ${status} ${check.name}`);
    if (count === 0) allPassed = false;
  } catch (err) {
    console.log(`   ❌ ${check.name} (error: ${err.message})`);
    allPassed = false;
  }
}

if (!allPassed) {
  console.warn('\n⚠️  Some migration components may not be present (non-blocking)');
} else {
  console.log('\n✅ All migration components verified');
}
