
import { db } from '../server/db/drizzle.js';
import { briefings } from '../shared/schema.js';
import { desc } from 'drizzle-orm';

async function queryLastBriefing() {
  try {
    console.log('🔍 Querying last briefing row...\n');
    
    const result = await db
      .select()
      .from(briefings)
      .orderBy(desc(briefings.created_at))
      .limit(1);

    if (result.length === 0) {
      console.log('❌ No briefings found in database');
      process.exit(0);
    }

    const briefing = result[0];
    
    console.log('✅ Last Briefing Record:');
    console.log('========================\n');
    
    // Print each field with its name and value
    Object.keys(briefing).forEach(field => {
      const value = briefing[field];
      if (typeof value === 'object' && value !== null) {
        console.log(`${field}:`);
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(`${field}: ${value}`);
      }
      console.log('---');
    });
    
    console.log('\n📊 Field Names:');
    console.log(Object.keys(briefing).join(', '));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error querying briefings:', error);
    process.exit(1);
  }
}

queryLastBriefing();
