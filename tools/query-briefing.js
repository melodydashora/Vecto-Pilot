
import { db } from '../server/db/drizzle.js';
import { snapshots } from '../shared/schema.js';
import { desc } from 'drizzle-orm';

async function queryLastSnapshot() {
  try {
    console.log('🔍 Querying last snapshot row...\n');
    
    const result = await db
      .select()
      .from(snapshots)
      .orderBy(desc(snapshots.created_at))
      .limit(1);

    if (result.length === 0) {
      console.log('❌ No snapshots found in database');
      process.exit(0);
    }

    const snapshot = result[0];
    
    console.log('✅ Last Snapshot Record:');
    console.log('========================\n');
    
    // Print full JSON
    console.log(JSON.stringify(snapshot, null, 4));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error querying snapshots:', error);
    process.exit(1);
  }
}

queryLastSnapshot();
