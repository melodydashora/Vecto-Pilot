/**
 * GET LATEST SNAPSHOT ID
 * 
 * Usage:
 *   SNAPSHOT_ID=$(node scripts/latest-snapshot.mjs)
 * 
 * Returns ONLY the UUID (no logs) for shell capture
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
    process.stderr.write('❌ No snapshots found in database\n');
    process.exit(2);
  }
  
  // Output ONLY the UUID to stdout (clean for shell capture)
  process.stdout.write(String(snapshotId) + '\n');
  process.exit(0);
} catch (error) {
  process.stderr.write(`❌ Failed to fetch latest snapshot: ${error.message}\n`);
  process.exit(1);
}
