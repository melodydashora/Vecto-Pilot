// server/lib/providers/briefing.js
// Briefer provider - Model-agnostic (uses callModel adapter)

import { db } from '../../db/drizzle.js';
import { briefings } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callModel } from '../adapters/index.js';

/**
 * Run briefing generation using model-agnostic briefer
 * Comprehensive travel research: global/domestic/local + holidays + events within 50mi
 * Writes to briefings table (structured fields for Briefing page display)
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runBriefing(snapshotId) {
  console.log(`[briefing] 🔍 Starting comprehensive travel research for snapshot ${snapshotId}`);
  
  try {
    const ctx = await getSnapshotContext(snapshotId);
    
    const systemInstruction = `You are a comprehensive travel intelligence researcher. Provide detailed briefings covering all factors affecting travel and rideshare operations.

Research and report on these specific categories. Return your response as JSON with these exact fields:
{
  "global_travel": "Global conditions affecting this region",
  "domestic_travel": "National/domestic travel conditions",
  "local_traffic": "Local traffic, construction, incidents, road closures",
  "weather_impacts": "Weather affecting travel",
  "events_nearby": "Events within 50 miles",
  "rideshare_intel": "Rideshare-specific intelligence (surge zones, airport activity, demand patterns)"
}

Be thorough and factual. Use live web search for current information.`;

    // Build comprehensive research prompt
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
    
    const formattedDateTime = `${ctx.day_of_week}, ${monthName} ${dayNum}, ${year} at ${timeStr}`;

    const userPrompt = `RESEARCH REQUEST - Comprehensive Travel Intelligence Briefing

⏰ CURRENT DATE & TIME (USE THIS FOR HOLIDAY DETECTION):
Date: ${formattedDateTime}
Timezone: ${ctx.timezone}
Day of Week: ${ctx.day_of_week}
Country: ${ctx.country}

📍 DRIVER LOCATION:
Coordinates: ${ctx.lat}, ${ctx.lng} (±${ctx.accuracy_m || '?'}m)
Address: ${ctx.formatted_address}
City: ${ctx.city}, ${ctx.state}, ${ctx.country}

SEARCH RADIUS: 50 miles (80 kilometers)

Please research and provide a comprehensive briefing covering:

1. GLOBAL TRAVEL CONDITIONS affecting ${ctx.country}
   - International events impacting domestic travel
   - Global weather systems affecting the region
   
2. DOMESTIC/NATIONAL TRAVEL CONDITIONS for ${ctx.country}
   - Nationwide events affecting travel
   - Major transportation disruptions
   - Airline/airport issues
   
3. LOCAL AREA CONDITIONS (${ctx.city}, ${ctx.state})
   - Current traffic conditions and incidents
   - Road closures and construction
   - Local weather impacts
   - Enforcement activities
   
4. MAJOR EVENTS within 50 miles of ${ctx.lat}, ${ctx.lng}
   - Concerts, sports, festivals, conferences
   - Any large gatherings affecting transportation
   
5. RIDESHARE-SPECIFIC INTELLIGENCE
   - Surge zones and demand patterns
   - Airport activity (nearest airport is ${ctx.airport_context?.distance_miles || '?'} miles away)
   - Any factors affecting rideshare operations

Use live web search to find current, factual information. Be comprehensive and organized.`;

    // Call model-agnostic briefer role
    const result = await callModel("briefer", {
      system: systemInstruction,
      user: userPrompt
    });

    if (!result.ok) {
      throw new Error('Briefer model call failed');
    }
    
    const briefingText = result.output?.trim() || '';
    const citations = result.citations || [];
    
    if (!briefingText) {
      throw new Error('Briefer returned empty response');
    }
    
    console.log(`[briefing] 📝 Response: ${briefingText.length} chars, ${citations.length} citations`);
    
    // Parse JSON response from Perplexity
    let briefingData;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = briefingText.match(/```json\s*([\s\S]*?)\s*```/) || briefingText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : briefingText;
      briefingData = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn(`[briefing] ⚠️  Failed to parse JSON, using fallback structure:`, parseErr.message);
      // Fallback: Store entire response as local_traffic
      briefingData = {
        global_travel: '',
        domestic_travel: '',
        local_traffic: briefingText,
        weather_impacts: '',
        events_nearby: '',
        rideshare_intel: ''
      };
    }

    // CRITICAL: Use ON CONFLICT to prevent duplicate API calls on concurrent requests
    // This ensures idempotency even if briefing is called multiple times
    await db.insert(briefings).values({
      snapshot_id: snapshotId,
      global_travel: briefingData.global_travel || '',
      domestic_travel: briefingData.domestic_travel || '',
      local_traffic: briefingData.local_traffic || '',
      weather_impacts: briefingData.weather_impacts || '',
      events_nearby: briefingData.events_nearby || '',
      rideshare_intel: briefingData.rideshare_intel || '',
      citations: citations
      // created_at and updated_at are set automatically via .defaultNow()
    }).onConflict().doUpdateSet({
      global_travel: briefingData.global_travel || '',
      domestic_travel: briefingData.domestic_travel || '',
      local_traffic: briefingData.local_traffic || '',
      weather_impacts: briefingData.weather_impacts || '',
      events_nearby: briefingData.events_nearby || '',
      rideshare_intel: briefingData.rideshare_intel || '',
      citations: citations,
      updated_at: new Date()
    });
    
    console.log(`[briefing] ✅ Briefing persisted for ${snapshotId}`);
    
    console.log(`[briefing] 📊 Structured data: global=${!!briefingData.global_travel}, domestic=${!!briefingData.domestic_travel}, local=${!!briefingData.local_traffic}, weather=${!!briefingData.weather_impacts}, events=${!!briefingData.events_nearby}, rideshare=${!!briefingData.rideshare_intel}`);
  } catch (error) {
    console.error(`[briefing] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
