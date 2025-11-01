// server/lib/providers/briefing.js
// Gemini provider for news/events/traffic briefing (model-agnostic naming)

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callGemini } from '../adapters/google-gemini.js';

/**
 * Run briefing generation using Gemini
 * Writes to strategies.briefing_news/events/traffic (model-agnostic fields)
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runBriefing(snapshotId) {
  console.log(`[briefing] Starting for snapshot ${snapshotId}`);
  
  try {
    const ctx = await getSnapshotContext(snapshotId);
    
    // Extract holiday from news_briefing if present
    const holiday = ctx.news_briefing?.briefing?.holiday || null;
    
    const systemInstruction = `You are a rideshare intelligence briefing analyst. Generate a JSON object with real-time intelligence for the next 60 minutes.

RESPONSE FORMAT (JSON only, no markdown):
{
  "news": ["airport delays", "weather alerts"],
  "events": ["concerts ending", "games starting"],
  "traffic": ["construction", "closures"]
}

Return empty arrays [] if no intelligence for that category.`;

    const userPrompt = `SNAPSHOT CONTEXT:
Location: ${ctx.formatted_address}
City/State: ${ctx.city}, ${ctx.state}
Time: ${new Date(ctx.created_at).toLocaleString('en-US', { timeZone: ctx.timezone })}
Day Part: ${ctx.day_part_key}${holiday ? `\nHoliday: ${holiday}` : ''}
Weather: ${ctx.weather?.tempF || '?'}°F, ${ctx.weather?.conditions || 'unknown'}
Airport: ${ctx.airport_context?.airport_code || 'none'} ${ctx.airport_context?.has_delays ? `(${ctx.airport_context.delay_minutes} min delays)` : ''}

Generate real-time intelligence briefing for the next 60 minutes.`;

    const response = await callGemini({
      systemInstruction,
      user: userPrompt,
      max_output_tokens: 2048
    });

    // Parse JSON response
    let briefing = { news: [], events: [], traffic: [] };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        briefing = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.warn(`[briefing] JSON parse error for ${snapshotId}, using empty arrays`);
    }

    // Write to model-agnostic fields (allow empty arrays)
    await db.update(strategies).set({
      briefing_news: Array.isArray(briefing.news) ? briefing.news : [],
      briefing_events: Array.isArray(briefing.events) ? briefing.events : [],
      briefing_traffic: Array.isArray(briefing.traffic) ? briefing.traffic : [],
      strategy_timestamp: new Date(),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[briefing] ✅ Complete for ${snapshotId} (news:${briefing.news?.length || 0}, events:${briefing.events?.length || 0}, traffic:${briefing.traffic?.length || 0})`);
  } catch (error) {
    console.error(`[briefing] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
