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
    
    const systemInstruction = `You are a rideshare intelligence briefing analyst for the Dallas-Fort Worth area. Analyze the current date/time and location to generate real-time intelligence for the next 60 minutes within a 15-mile radius.

CRITICAL: Identify any holidays based on the date provided (e.g., October 31 = Halloween, December 31 = New Year's Eve, July 4 = Independence Day).

RESPONSE FORMAT (JSON only):
{
  "events": ["concerts ending at 10pm", "game starting at 8pm", "bar crawls in Uptown"],
  "holidays": ["Halloween", "New Year's Eve"],
  "traffic": ["I-35 construction", "downtown closures", "event-related congestion"],
  "news": ["airport delays", "weather alerts", "major incidents"]
}

Return empty arrays [] if no intelligence for that category.`;

    // Format date/time prominently so Gemini recognizes holidays
    const currentTime = new Date(ctx.created_at);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = dayNames[currentTime.getDay()];
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
    
    const formattedDateTime = `${dayName}, ${monthName} ${dayNum}, ${year} at ${timeStr}`;

    const userPrompt = `SNAPSHOT CONTEXT:
Location: ${ctx.formatted_address}
City/State: ${ctx.city}, ${ctx.state}
Current Date & Time: ${formattedDateTime}
Day Part: ${ctx.day_part_key}
Weather: ${ctx.weather?.tempF || '?'}°F, ${ctx.weather?.conditions || 'unknown'}
Airport: ${ctx.airport_context?.airport_code || 'none'} ${ctx.airport_context?.has_delays ? `(${ctx.airport_context.delay_minutes} min delays)` : ''}

Generate real-time intelligence briefing for the next 60 minutes in the 15-mile radius. Return JSON only.`;

    // Call model-agnostic briefer role
    const result = await callModel("briefer", {
      system: systemInstruction,
      user: userPrompt
    });

    if (!result.ok) {
      throw new Error('Briefer model call failed');
    }

    // Parse JSON response
    let briefing = null;
    let parsed = null;
    
    // Defensive parsing with multiple fallback strategies
    try {
      // Strategy 1: Direct parse
      parsed = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
      console.log(`[briefing] ✅ Direct JSON parse successful`);
    } catch (parseError) {
      console.warn(`[briefing] Direct JSON parse failed, trying extraction...`);
      
      // Strategy 2: Extract JSON substring between first '{' and last '}'
      const responseStr = String(result.output);
      const start = responseStr.indexOf('{');
      const end = responseStr.lastIndexOf('}');
      
      if (start !== -1 && end !== -1 && end > start) {
        const candidate = responseStr.slice(start, end + 1);
        try {
          parsed = JSON.parse(candidate);
          console.log(`[briefing] ✅ Extracted JSON parse successful`);
        } catch (extractError) {
          console.error(`[briefing] ❌ Extraction parse failed:`, extractError.message);
        }
      }
    }
    
    // Normalize parsed data to ensure consistent shape
    if (parsed) {
      briefing = normalizeBriefingShape(parsed);
      // Add fallback holiday if present
      if (holiday && (!briefing.holidays || briefing.holidays.length === 0)) {
        briefing.holidays = [holiday];
      }
    } else {
      // Last resort: Return default shape with holiday if available
      briefing = normalizeBriefingShape({});
      if (holiday) briefing.holidays = [holiday];
      console.warn(`[briefing] ⚠️ Using default empty shape with holiday=${holiday || 'none'}`);
    }
    
    console.log(`[briefing] Final briefing: events=${briefing.events.length}, holidays=${briefing.holidays.length}, traffic=${briefing.traffic.length}, news=${briefing.news.length}`);

    // Extract first holiday for the dedicated holiday column (for UI banner)
    const holidayName = briefing.holidays && briefing.holidays.length > 0 
      ? briefing.holidays[0] 
      : null;

    // Write to single JSONB field AND dedicated holiday column
    await db.update(strategies).set({
      briefing,
      holiday: holidayName,  // Write first holiday to dedicated column for UI banner
      strategy_timestamp: new Date(),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[briefing] ✅ Complete for ${snapshotId} (events:${briefing.events?.length || 0}, holidays:${briefing.holidays?.length || 0}, traffic:${briefing.traffic?.length || 0}, news:${briefing.news?.length || 0}, holiday column:${holidayName || 'none'})`);
  } catch (error) {
    console.error(`[briefing] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
