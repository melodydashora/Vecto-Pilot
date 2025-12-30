// Test script to verify briefing API returns data correctly
import { db } from '../../db/drizzle.js';
import { briefings } from '../../../shared/schema.js';
import { desc, eq } from 'drizzle-orm';
import { getBriefingBySnapshotId } from './briefing-service.js';

// Get most recent briefing
const [row] = await db.select().from(briefings).orderBy(desc(briefings.created_at)).limit(1);

if (!row) {
  console.log('No briefing rows found');
  process.exit(0);
}

const snapshotId = row.snapshot_id;
console.log('Testing with snapshotId:', snapshotId);

// Simulate what the API does
const briefing = await getBriefingBySnapshotId(snapshotId);

console.log('\n--- API would return: ---');
console.log('Traffic endpoint:', {
  success: !!briefing?.traffic_conditions,
  traffic: briefing?.traffic_conditions ? {
    summary: briefing.traffic_conditions.summary?.slice(0, 50) + '...',
    congestionLevel: briefing.traffic_conditions.congestionLevel
  } : null
});

console.log('\nNews endpoint:', {
  success: !!briefing?.news,
  news: briefing?.news ? {
    itemsCount: briefing.news.items?.length || 0
  } : null
});

console.log('\nAirport endpoint:', {
  success: !!briefing?.airport_conditions,
  airport_conditions: briefing?.airport_conditions ? {
    airportsCount: briefing.airport_conditions.airports?.length || 0,
    isFallback: briefing.airport_conditions.isFallback
  } : null
});

process.exit(0);
