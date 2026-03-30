// Temp script to dump latest briefing row
import { db } from '../../db/drizzle.js';
import { briefings } from '../../../shared/schema.js';
import { desc } from 'drizzle-orm';

const [row] = await db.select().from(briefings).orderBy(desc(briefings.created_at)).limit(1);

if (!row) {
  console.log('No briefing rows found');
  process.exit(0);
}

console.log('snapshot_id:', row.snapshot_id);
console.log('created_at:', row.created_at);
console.log('---');
console.log('traffic_conditions:', row.traffic_conditions ? 'EXISTS (' + JSON.stringify(row.traffic_conditions).length + ' chars)' : 'NULL');
console.log('news:', row.news ? 'EXISTS (' + (row.news.items?.length || 0) + ' items)' : 'NULL');
console.log('events:', row.events ? 'EXISTS (' + (Array.isArray(row.events) ? row.events.length : row.events?.items?.length || 0) + ' items)' : 'NULL');
console.log('school_closures:', row.school_closures ? 'EXISTS (' + (Array.isArray(row.school_closures) ? row.school_closures.length : row.school_closures?.items?.length || 0) + ' items)' : 'NULL');
console.log('airport_conditions:', row.airport_conditions ? 'EXISTS' : 'NULL');
console.log('weather_current:', row.weather_current ? 'EXISTS' : 'NULL');

process.exit(0);
