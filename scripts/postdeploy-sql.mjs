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

const MIGRATION_FILE = 'drizzle/0003_event_enrichment.sql';

try {
  console.log(`🔍 Loading migration: ${MIGRATION_FILE}`);
  
  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error(`❌ Migration file not found: ${MIGRATION_FILE}`);
    process.exit(1);
  }
  
  const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');
  
  console.log('⚙️  Executing migration...\n');
  
  const startTime = Date.now();
  await db.execute(sql.raw(migrationSQL));
  const elapsed = Date.now() - startTime;
  
  console.log(`\n✅ Migration completed successfully in ${elapsed}ms`);
  
  // Verify migration
  console.log('\n🔍 Verifying migration...');
  
  const checks = [
    { name: 'events_facts table', query: sql`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'events_facts'` },
    { name: 'event_badge_missing column', query: sql`SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'ranking_candidates' AND column_name = 'event_badge_missing'` },
    { name: 'v_coach_strategy_context view', query: sql`SELECT COUNT(*) as count FROM information_schema.views WHERE table_name = 'v_coach_strategy_context'` },
    { name: 'fn_upsert_event function', query: sql`SELECT COUNT(*) as count FROM information_schema.routines WHERE routine_name = 'fn_upsert_event'` },
    { name: 'fn_refresh_venue_enrichment function', query: sql`SELECT COUNT(*) as count FROM information_schema.routines WHERE routine_name = 'fn_refresh_venue_enrichment'` }
  ];
  
  let allPassed = true;
  
  for (const check of checks) {
    const result = await db.execute(check.query);
    const count = parseInt(result.rows[0].count);
    const status = count > 0 ? '✅' : '❌';
    console.log(`   ${status} ${check.name}`);
    if (count === 0) allPassed = false;
  }
  
  if (!allPassed) {
    console.error('\n❌ Some migration components failed to create');
    process.exit(1);
  }
  
  console.log('\n✅ All migration components verified');
  
} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
