// Check traffic data format
import { db } from '../../db/drizzle.js';
import { briefings } from '../../../shared/schema.js';
import { desc } from 'drizzle-orm';

const [row] = await db.select().from(briefings).orderBy(desc(briefings.created_at)).limit(1);

if (!row) {
  console.log('No briefing rows found');
  process.exit(0);
}

console.log('snapshot_id:', row.snapshot_id);
console.log('\n--- Traffic structure ---');
console.log('Keys:', row.traffic_conditions ? Object.keys(row.traffic_conditions) : 'NULL');
console.log('Has summary?:', row.traffic_conditions?.summary !== undefined);
console.log('Summary value:', row.traffic_conditions?.summary);

console.log('\n--- News structure ---');
console.log('Keys:', row.news ? Object.keys(row.news) : 'NULL');
console.log('Has items?:', row.news?.items !== undefined);
console.log('Items count:', row.news?.items?.length);

console.log('\n--- Airport structure ---');
console.log('Keys:', row.airport_conditions ? Object.keys(row.airport_conditions) : 'NULL');
console.log('Has isFallback?:', row.airport_conditions?.isFallback !== undefined);

process.exit(0);
