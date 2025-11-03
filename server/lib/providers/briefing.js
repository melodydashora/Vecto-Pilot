// server/lib/providers/briefing.js
// Briefer provider - Uses Perplexity API for comprehensive travel research

import { db } from '../../db/drizzle.js';
import { briefings, snapshots } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';

/**
 * Run briefing generation using Perplexity API
 * Comprehensive travel research: global/domestic/local + holidays + events within 50mi
 * Writes to briefings table (structured fields for Briefing page display)
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runBriefing(snapshotId) {
  console.log(`[briefing] 🔍 Starting Perplexity comprehensive travel research for snapshot ${snapshotId}`);
  
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
  "holidays": "Name of the holiday if today is a holiday (e.g., 'Thanksgiving', 'Independence Day'), otherwise empty string. Use the EXACT date/time and timezone provided in the user's request.",
  "rideshare_intel": "Rideshare-specific intelligence (surge zones, airport activity, demand patterns)"
}

CRITICAL: For the 'holidays' field, use the exact date, time, and timezone provided in the request to determine if today is a holiday in that specific location.

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
   - **CRITICAL: Is ${formattedDateTime} (${ctx.timezone}) a holiday in ${ctx.country}? If yes, provide the holiday name in the 'holidays' field.**
   - Nationwide events affecting travel
   - Major transportation disruptions
   
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

    // Call Perplexity API
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new Error('PERPLEXITY_API_KEY environment variable not set');
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 4000,
        temperature: 0.2,
        top_p: 0.9,
        search_recency_filter: 'day',
        return_images: false,
        return_related_questions: false,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const briefingText = result.choices?.[0]?.message?.content?.trim() || '';
    const citations = result.citations || [];
    
    if (!briefingText) {
      throw new Error('Perplexity returned empty response');
    }
    
    console.log(`[briefing] 📝 Perplexity response: ${briefingText.length} chars, ${citations.length} citations`);
    
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
        holidays: '',
        rideshare_intel: ''
      };
    }

    // Extract holiday name and determine if it's a holiday
    const holidayName = (briefingData.holidays || '').trim();
    const isHoliday = holidayName.length > 0;
    
    // Check if briefing already exists
    const [existing] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (existing) {
      // Update existing
      await db.update(briefings).set({
        global_travel: briefingData.global_travel || '',
        domestic_travel: briefingData.domestic_travel || '',
        local_traffic: briefingData.local_traffic || '',
        weather_impacts: briefingData.weather_impacts || '',
        events_nearby: briefingData.events_nearby || '',
        holidays: holidayName,
        rideshare_intel: briefingData.rideshare_intel || '',
        citations: citations,
        updated_at: new Date()
      }).where(eq(briefings.snapshot_id, snapshotId));
      
      console.log(`[briefing] ✅ Updated briefing for ${snapshotId}`);
    } else {
      // Insert new
      await db.insert(briefings).values({
        snapshot_id: snapshotId,
        global_travel: briefingData.global_travel || '',
        domestic_travel: briefingData.domestic_travel || '',
        local_traffic: briefingData.local_traffic || '',
        weather_impacts: briefingData.weather_impacts || '',
        events_nearby: briefingData.events_nearby || '',
        holidays: holidayName,
        rideshare_intel: briefingData.rideshare_intel || '',
        citations: citations,
        created_at: new Date(),
        updated_at: new Date()
      });
      
      console.log(`[briefing] ✅ Created briefing for ${snapshotId}`);
    }
    
    // ALSO write holiday info to snapshots table for UI banner/greeting
    await db.update(snapshots).set({
      holiday: holidayName || null,
      is_holiday: isHoliday
    }).where(eq(snapshots.snapshot_id, snapshotId));
    
    console.log(`[briefing] 📊 Structured data: global=${!!briefingData.global_travel}, domestic=${!!briefingData.domestic_travel}, local=${!!briefingData.local_traffic}, weather=${!!briefingData.weather_impacts}, events=${!!briefingData.events_nearby}, holidays="${holidayName}" (is_holiday=${isHoliday})`);
    console.log(`[briefing] 🎉 Holiday info written to snapshots table: holiday="${holidayName}", is_holiday=${isHoliday}`);
  } catch (error) {
    console.error(`[briefing] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
