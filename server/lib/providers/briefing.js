// server/lib/providers/briefing.js
// Briefer provider - Uses Perplexity API for comprehensive travel research

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';

/**
 * Run briefing generation using Perplexity API
 * Comprehensive travel research: global/domestic/local + holidays + events within 50mi
 * Writes to strategies.briefing (JSONB field for Briefing page display)
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runBriefing(snapshotId) {
  console.log(`[briefing] 🔍 Starting Perplexity comprehensive travel research for snapshot ${snapshotId}`);
  
  try {
    const ctx = await getSnapshotContext(snapshotId);
    
    // Extract holiday from news_briefing if present
    const holiday = ctx.news_briefing?.briefing?.holiday || null;
    
    const systemInstruction = `You are a comprehensive travel intelligence researcher. Provide detailed briefings covering all factors affecting travel and rideshare operations.

Research and report on:
1. Global travel conditions affecting this region
2. Domestic (national) travel conditions 
3. Local area conditions
4. Current holidays (if today is a holiday)
5. Major events within 50 miles (80 km) of the driver's location
6. Traffic incidents, construction, road closures
7. Weather impacts on travel
8. Any other factors affecting rideshare operations

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

CURRENT DATE & TIME:
${formattedDateTime}
Timezone: ${ctx.timezone}

DRIVER LOCATION:
Coordinates: ${ctx.lat}, ${ctx.lng} (±${ctx.accuracy_m || '?'}m)
Address: ${ctx.formatted_address}
City: ${ctx.city}, ${ctx.state}, ${ctx.country}

SEARCH RADIUS: 50 miles (80 kilometers)

Please research and provide a comprehensive briefing covering:

1. GLOBAL TRAVEL CONDITIONS affecting ${ctx.country}
   - International events impacting domestic travel
   - Global weather systems affecting the region
   
2. DOMESTIC/NATIONAL TRAVEL CONDITIONS for ${ctx.country}
   - National holidays (Is today a holiday?)
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
        model: 'llama-3.1-sonar-large-128k-online',
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
    
    if (!briefingText) {
      throw new Error('Perplexity returned empty response');
    }
    
    console.log(`[briefing] 📝 Perplexity response: ${briefingText.length} chars, ${result.citations?.length || 0} citations`);
    
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
