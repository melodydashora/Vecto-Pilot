// server/lib/providers/briefing.js
// Briefer provider - model-agnostic (uses callModel adapter)

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callModel } from '../adapters/index.js';
import { normalizeBriefingShape } from '../strategy-utils.js';

/**
 * Run briefing generation using Gemini
 * Writes to strategies.briefing (single JSONB field)
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runBriefing(snapshotId) {
  console.log(`[briefing] Starting for snapshot ${snapshotId}`);
  
  try {
    const ctx = await getSnapshotContext(snapshotId);
    
    // Extract holiday from news_briefing if present
    const holiday = ctx.news_briefing?.briefing?.holiday || null;
    
    const systemInstruction = `You are a traffic, news and events controller. Provide strategic rideshare briefings to help drivers maximize earnings.

Focus strictly on traffic conditions, incidents, closures, enforcement, construction, and news/events affecting rideshare drivers. 
Do not list venues or curb locations.
Use live web search to get current information.
Prioritize driver leaving now.

Return a strategic paragraph summary for the next 30 minutes.`;

    // CRITICAL: Use snapshot's authoritative day_of_week (NOT recomputed from created_at)
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const currentTime = new Date(ctx.created_at);
    const monthName = monthNames[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    const year = currentTime.getFullYear();
    
    const timeStr = currentTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
      timeZone: ctx.timezone || 'America/Chicago'
    });
    
    // Use snapshot's authoritative day_of_week, not recomputed
    const formattedDateTime = `${ctx.day_of_week}, ${monthName} ${dayNum}, ${year} at ${timeStr}`;

    const userPrompt = `snapshot_id: ${ctx.snapshot_id}
created_at: ${ctx.created_at} (UTC)

GPS Location:
lat: ${ctx.lat}
lng: ${ctx.lng}
accuracy_m: ${ctx.accuracy_m || 'unknown'} meters
coord_source: ${ctx.coord_source || 'gps'}

Address Resolution:
formatted_address: "${ctx.formatted_address}"
city: ${ctx.city}
state: ${ctx.state}
country: ${ctx.country}

Temporal Data (Authoritative):
timezone: ${ctx.timezone}
local_iso: ${ctx.local_iso} (local time)
dow: ${ctx.dow} (${ctx.day_of_week})
hour: ${ctx.hour} (${ctx.hour % 12 || 12} ${ctx.hour >= 12 ? 'PM' : 'AM'} local)
day_part_key: ${ctx.day_part_key}

Weather Data:
${JSON.stringify(ctx.weather, null, 2)}

Air Quality:
${JSON.stringify(ctx.air, null, 2)}

Airport Context (${ctx.airport_context?.distance_miles || '?'} miles away):
${JSON.stringify(ctx.airport_context, null, 2)}

Provide me a strategic rideshare briefing so that I can make the most money in the next 30-min as a summary paragraph use live web search. Focus strictly on traffic conditions, incidents, closures, enforcement, construction, and news/events affecting rideshare drivers. Do not list venues or curb locations. (Prioritize driver leaving now)`;

    // Call model-agnostic briefer role
    const result = await callModel("briefer", {
      system: systemInstruction,
      user: userPrompt
    });

    if (!result.ok) {
      throw new Error('Briefer model call failed');
    }

    // Store paragraph text (GPT-5 returns strategic paragraph, not JSON)
    const briefingText = typeof result.output === 'string' ? result.output.trim() : String(result.output).trim();
    
    // Store as JSONB with text field for compatibility
    const briefing = {
      text: briefingText,
      type: 'paragraph',
      generated_at: new Date().toISOString()
    };
    
    console.log(`[briefing] Strategic paragraph: ${briefingText.slice(0, 150)}...`);

    // Write to single JSONB field (keep holiday from news_briefing if present)
    await db.update(strategies).set({
      briefing,
      holiday: holiday,  // Write holiday from news_briefing to dedicated column for UI banner
      strategy_timestamp: new Date(),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[briefing] ✅ Complete for ${snapshotId} (${briefingText.length} chars, holiday column:${holiday || 'none'})`);
  } catch (error) {
    console.error(`[briefing] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
