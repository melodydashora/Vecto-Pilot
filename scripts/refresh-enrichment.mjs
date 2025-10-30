/**
 * REFRESH VENUE ENRICHMENT
 * 
 * Triggers fn_refresh_venue_enrichment for a snapshot
 * Usage: SNAPSHOT_ID="uuid" npm run refresh:enrichment
 */

import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

const { SNAPSHOT_ID } = process.env;

if (!SNAPSHOT_ID) {
  console.error('❌ SNAPSHOT_ID environment variable required');
  console.error('');
  console.error('Example:');
  console.error('  SNAPSHOT_ID="123e4567-e89b-12d3-a456-426614174000" npm run refresh:enrichment');
  process.exit(1);
}

try {
  const startTime = Date.now();
  
  await db.execute(sql`select fn_refresh_venue_enrichment(${SNAPSHOT_ID}::uuid);`);
  
  const elapsed = Date.now() - startTime;
  
  console.log('✅ Enrichment refreshed successfully');
  console.log(`   Snapshot ID: ${SNAPSHOT_ID}`);
  console.log(`   Duration: ${elapsed}ms`);
  
  // Verify results
  const result = await db.execute(sql`
    select 
      name,
      place_id,
      venue_events->>'badge' as event_badge,
      venue_events->>'summary' as event_summary,
      event_badge_missing
    from ranking_candidates
    where snapshot_id = ${SNAPSHOT_ID}::uuid
    order by rank
    limit 5;
  `);
  
  if (result.rows && result.rows.length > 0) {
    console.log('\n📊 Top 5 candidates:');
    result.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.name}`);
      if (row.event_badge) {
        console.log(`      🎉 ${row.event_badge}: ${row.event_summary}`);
      } else if (row.event_badge_missing) {
        console.log(`      ⚪ No current events`);
      }
    });
  }
} catch (error) {
  console.error('❌ Enrichment refresh failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
