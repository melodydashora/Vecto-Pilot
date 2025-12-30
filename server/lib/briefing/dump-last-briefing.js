
import { db } from '../../db/drizzle.js';
import { briefings } from '../../../shared/schema.js';
import { desc } from 'drizzle-orm';
import { writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Write the last briefing row to briefing-last-row.txt
 * Called after briefing generation to capture state for debugging
 */
export async function dumpLastBriefingRow() {
  try {
    // Order by updated_at to get the most recently POPULATED briefing
    // (not just created - briefings are created as placeholders then updated with data)
    const [lastBriefing] = await db.select()
      .from(briefings)
      .orderBy(desc(briefings.updated_at))
      .limit(1);

    if (!lastBriefing) {
      console.log('[DumpBriefing] No briefing rows found');
      return;
    }

    // Format the output nicely
    const output = `✅ Last Briefing Record
================================================================================

id:
  "${lastBriefing.id}"

snapshot_id:
  "${lastBriefing.snapshot_id}"

news:
  ${lastBriefing.news ? JSON.stringify(lastBriefing.news, null, 2) : '(null)'}

weather_current:
  ${lastBriefing.weather_current ? JSON.stringify(lastBriefing.weather_current, null, 2) : '(null)'}

weather_forecast:
  ${lastBriefing.weather_forecast ? JSON.stringify(lastBriefing.weather_forecast, null, 2) : '(null)'}

traffic_conditions:
  ${lastBriefing.traffic_conditions ? JSON.stringify(lastBriefing.traffic_conditions, null, 2) : '(null)'}

events:
  ${lastBriefing.events ? JSON.stringify(lastBriefing.events, null, 2) : '(null)'}

school_closures:
  ${lastBriefing.school_closures ? JSON.stringify(lastBriefing.school_closures, null, 2) : '(null)'}

airport_conditions:
  ${lastBriefing.airport_conditions ? JSON.stringify(lastBriefing.airport_conditions, null, 2) : '(null)'}

created_at:
  "${lastBriefing.created_at}"

updated_at:
  "${lastBriefing.updated_at}"

`;

    const filePath = join(process.cwd(), 'briefing-last-row.txt');
    await writeFile(filePath, output, 'utf-8');
    console.log('[DumpBriefing] ✅ Written to briefing-last-row.txt');
  } catch (err) {
    console.error('[DumpBriefing] ❌ Failed to dump briefing:', err.message);
  }
}
