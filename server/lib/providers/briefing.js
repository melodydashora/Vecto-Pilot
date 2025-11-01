// server/lib/providers/briefing.js
// Gemini provider for city briefing (model-agnostic naming)

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callGemini } from '../adapters/google-gemini.js';

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

Generate real-time intelligence briefing for the next 60 minutes in the 15-mile radius.`;

    const response = await callGemini({
      systemInstruction,
      user: userPrompt,
      max_output_tokens: 4000,
      responseMimeType: 'application/json'
    });

    // Parse JSON response
    let briefing = { events: [], holidays: [], traffic: [], news: [] };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        briefing = {
          events: Array.isArray(parsed.events) ? parsed.events : [],
          holidays: Array.isArray(parsed.holidays) ? parsed.holidays : (holiday ? [holiday] : []),
          traffic: Array.isArray(parsed.traffic) ? parsed.traffic : [],
          news: Array.isArray(parsed.news) ? parsed.news : []
        };
      }
    } catch (parseError) {
      console.warn(`[briefing] JSON parse error for ${snapshotId}, using defaults`);
      if (holiday) briefing.holidays = [holiday];
    }

    // Write to single JSONB field
    await db.update(strategies).set({
      briefing,
      strategy_timestamp: new Date(),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[briefing] ✅ Complete for ${snapshotId} (events:${briefing.events?.length || 0}, holidays:${briefing.holidays?.length || 0}, traffic:${briefing.traffic?.length || 0}, news:${briefing.news?.length || 0})`);
  } catch (error) {
    console.error(`[briefing] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
