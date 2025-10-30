/**
 * GET LATEST SNAPSHOT ID
 * 
 * Usage:
 *   SNAPSHOT_ID=$(node scripts/latest-snapshot.mjs)
 * 
 * Returns the most recent snapshot ID without requiring psql
 */

import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

try {
  const result = await db.execute(sql`
    SELECT snapshot_id FROM snapshots 
    ORDER BY created_at DESC 
    LIMIT 1
  `);
  
  const snapshotId = result.rows?.[0]?.snapshot_id;
  
  if (!snapshotId) {
    console.error('❌ No snapshots found in database');
    process.exit(2);
  }
  
  // Output only the ID (for shell capture)
  process.stdout.write(String(snapshotId));
} catch (error) {
  console.error('❌ Failed to fetch latest snapshot:', error.message);
  process.exit(1);
}
