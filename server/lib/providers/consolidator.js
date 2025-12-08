// server/lib/providers/consolidator.js
// Consolidator provider - Gemini 3 Pro Preview as "Tactical Dispatcher"
// NEW ARCHITECTURE: Synthesizes minstrategy + snapshot + Type A briefing JSON
// No deep research - just consolidation of existing data into actionable strategy

import { db } from '../../db/drizzle.js';
import { strategies, briefings } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getFullSnapshot } from '../snapshot/get-snapshot-context.js';

/**
 * Call Gemini 3 Pro Preview with Google Search tool and Retry Logic
 * Handles 503/429 overload errors with exponential backoff
 */
async function callGeminiConsolidator({ prompt, maxTokens = 4096, temperature = 0.2 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[consolidator] ❌ GEMINI_API_KEY not configured');
    return { ok: false, error: 'GEMINI_API_KEY not configured' };
  }

  // RETRY CONFIGURATION: 3 attempts with 2s, 4s, 8s delays
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;
  const callStart = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[consolidator] ⏳ Retry attempt ${attempt-1}/${MAX_RETRIES} due to overload...`);
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ],
            generationConfig: {
              thinkingConfig: {
                thinkingLevel: "MEDIUM"
              },
              temperature,
              maxOutputTokens: maxTokens
            }
          })
        }
      );

      // Handle Overloaded (503) or Rate Limited (429)
      if (response.status === 503 || response.status === 429) {
        const errText = await response.text();
        console.warn(`[consolidator] ⚠️ Gemini Busy (Status ${response.status}): ${errText.substring(0, 100)}`);
        
        if (attempt <= MAX_RETRIES) {
          // Wait before retrying (Exponential Backoff)
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[consolidator] ⏸️ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry loop
        }
        return { ok: false, error: `Gemini Overloaded after ${MAX_RETRIES} retries` };
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[consolidator] Gemini API Error ${response.status}: ${errText.substring(0, 500)}`);
        
        if (response.status === 400 && errText.includes('API key expired')) {
          return { ok: false, error: 'GEMINI_API_KEY expired - update in Secrets' };
        }
        
        return { ok: false, error: `API error ${response.status}` };
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.warn('[consolidator] Empty response from Gemini');
        return { ok: false, error: 'Empty response' };
      }

      const elapsed = Date.now() - callStart;
      console.log(`[consolidator] ✅ Gemini returned ${text.length} chars in ${elapsed}ms`);
      return { ok: true, output: text.trim(), durationMs: elapsed };

    } catch (error) {
      console.error(`[consolidator] Network error (Attempt ${attempt}):`, error.message);
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[consolidator] ⏸️ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const elapsed = Date.now() - callStart;
      console.error(`[consolidator] Failed after ${elapsed}ms and ${MAX_RETRIES} retries:`, error.message);
      return { ok: false, error: error.message };
    }
  }
}

/**
 * Format Type A briefing data for the prompt
 * Extracts and formats news, events, traffic, weather from briefings table
 */
function formatBriefingContext(briefing) {
  if (!briefing) return 'No briefing data available yet.';
  
  const sections = [];
  
  if (briefing.weather_current) {
    const w = typeof briefing.weather_current === 'string' 
      ? JSON.parse(briefing.weather_current) 
      : briefing.weather_current;
    sections.push(`WEATHER: ${w.temperature || w.tempF || 'N/A'}°F, ${w.conditions || w.description || 'N/A'}`);
  }
  
  if (briefing.traffic_conditions) {
    const t = typeof briefing.traffic_conditions === 'string'
      ? JSON.parse(briefing.traffic_conditions)
      : briefing.traffic_conditions;
    if (t.summary) {
      sections.push(`TRAFFIC: ${t.summary}`);
    }
    if (t.incidents && Array.isArray(t.incidents) && t.incidents.length > 0) {
      const incidentList = t.incidents.slice(0, 3).map(i => `- ${i.description || i.title || i}`).join('\n');
      sections.push(`TRAFFIC INCIDENTS:\n${incidentList}`);
    }
  }
  
  if (briefing.events) {
    const events = typeof briefing.events === 'string'
      ? JSON.parse(briefing.events)
      : briefing.events;
    if (Array.isArray(events) && events.length > 0) {
      const eventList = events.slice(0, 5).map(e => 
        `- ${e.title || e.name}: ${e.summary || ''} (Impact: ${e.impact || 'unknown'})`
      ).join('\n');
      sections.push(`LOCAL EVENTS:\n${eventList}`);
    }
  }
  
  if (briefing.news) {
    const newsData = typeof briefing.news === 'string'
      ? JSON.parse(briefing.news)
      : briefing.news;
    
    // Handle nested structure: { items: [], filtered: [] } or direct array
    let newsItems = [];
    if (Array.isArray(newsData)) {
      newsItems = newsData;
    } else if (newsData && Array.isArray(newsData.items)) {
      newsItems = newsData.items;
    } else if (newsData && Array.isArray(newsData.filtered)) {
      newsItems = newsData.filtered;
    }
    
    if (newsItems.length > 0) {
      const newsList = newsItems.slice(0, 3).map(n => 
        `- ${n.title || n.headline}: ${n.summary || n.description || ''}`
      ).join('\n');
      sections.push(`RIDESHARE NEWS:\n${newsList}`);
    }
  }
  
  if (briefing.school_closures) {
    const closures = typeof briefing.school_closures === 'string'
      ? JSON.parse(briefing.school_closures)
      : briefing.school_closures;
    if (Array.isArray(closures) && closures.length > 0) {
      const closureList = closures.slice(0, 3).map(c => 
        `- ${c.name || c.school}: ${c.reason || c.status || 'Closed'}`
      ).join('\n');
      sections.push(`SCHOOL CLOSURES:\n${closureList}`);
    } else if (closures && closures.status) {
      sections.push(`SCHOOL STATUS: ${closures.status}`);
    }
  }
  
  // Log what sections were included for debugging
  console.log(`[consolidator] 📊 Briefing sections included: ${sections.map(s => s.split(':')[0]).join(', ')}`);
  
  return sections.length > 0 ? sections.join('\n\n') : 'Briefing data is empty.';
}

/**
 * Run consolidation using Gemini 3 Pro Preview as "Tactical Dispatcher"
 * Synthesizes minstrategy + snapshot + Type A briefing data
 * Writes to strategies.consolidated_strategy
 * 
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runConsolidator(snapshotId) {
  const startTime = Date.now();
  console.log(`[consolidator] 🚀 Starting Gemini Tactical Dispatcher for snapshot ${snapshotId}`);
  
  try {
    // Step 1: Fetch strategy row to get minstrategy
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    if (!strategyRow) {
      throw new Error(`Strategy row not found for snapshot ${snapshotId}`);
    }
    
    // IDEMPOTENCE: If already consolidated with status=ok, skip
    if (strategyRow.consolidated_strategy && strategyRow.status === 'ok') {
      console.log(`[consolidator] ⏭️ Already consolidated (status=ok) - skipping for ${snapshotId}`);
      return { ok: true, skipped: true, reason: 'already_consolidated' };
    }
    
    const minstrategy = strategyRow.minstrategy;
    
    // PREREQUISITE VALIDATION: Only minstrategy required
    if (!minstrategy || minstrategy.trim().length === 0) {
      console.warn(`[consolidator] ⚠️ Missing minstrategy for ${snapshotId}`);
      await db.update(strategies).set({
        status: 'missing_prereq',
        error_message: 'Minstrategy output is missing or empty',
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
      throw new Error('Missing minstrategy (strategist output is empty)');
    }
    
    console.log(`[consolidator] ✅ Minstrategy ready (${minstrategy.length} chars)`);
    
    // Step 2: Fetch Type A briefing data from DB
    const [briefingRow] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    
    // VERIFICATION: Log briefing field integrity before consolidator processes
    if (briefingRow) {
      console.log(`[consolidator] 🔍 BRIEFING FIELDS VERIFICATION (before consolidator):`);
      console.log(`   - weather_current: ${briefingRow.weather_current ? 'present (' + (typeof briefingRow.weather_current === 'string' ? briefingRow.weather_current.substring(0, 50) : JSON.stringify(briefingRow.weather_current).substring(0, 50)) + '...)' : 'NULL ⚠️'}`);
      console.log(`   - traffic_conditions: ${briefingRow.traffic_conditions ? 'present (' + (typeof briefingRow.traffic_conditions === 'string' ? briefingRow.traffic_conditions.substring(0, 100) : JSON.stringify(briefingRow.traffic_conditions).substring(0, 100)) + '...)' : 'NULL ⚠️'}`);
      console.log(`   - news: ${briefingRow.news ? 'present (' + (typeof briefingRow.news === 'string' ? briefingRow.news.substring(0, 50) : JSON.stringify(briefingRow.news).substring(0, 50)) + '...)' : 'NULL ⚠️'}`);
      console.log(`   - events: ${briefingRow.events ? 'present (' + (typeof briefingRow.events === 'string' ? briefingRow.events.substring(0, 50) : JSON.stringify(briefingRow.events).substring(0, 50)) + '...)' : 'NULL ⚠️'}`);
      console.log(`   - school_closures: ${briefingRow.school_closures ? 'present (' + (typeof briefingRow.school_closures === 'string' ? briefingRow.school_closures.substring(0, 50) : JSON.stringify(briefingRow.school_closures).substring(0, 50)) + '...)' : 'NULL ⚠️'}`);
    } else {
      console.warn(`[consolidator] ⚠️ NO BRIEFING ROW FOUND for snapshot ${snapshotId}`);
    }
    
    const briefingContext = formatBriefingContext(briefingRow);
    console.log(`[consolidator] 📋 Briefing context formatted: ${briefingContext.length} chars`);
    
    // Log detailed briefing context to ensure traffic/events are included
    if (briefingContext.includes('TRAFFIC')) {
      console.log(`[consolidator] ✅ TRAFFIC DATA INCLUDED in briefing context`);
    } else {
      console.warn(`[consolidator] ⚠️ TRAFFIC DATA MISSING from briefing context`);
    }
    if (briefingContext.includes('LOCAL EVENTS') || briefingContext.includes('EVENT')) {
      console.log(`[consolidator] ✅ EVENT DATA INCLUDED in briefing context`);
    } else {
      console.warn(`[consolidator] ⚠️ EVENT DATA MISSING from briefing context`);
    }
    
    // Step 3: Fetch snapshot for location/time context
    const ctx = await getFullSnapshot(snapshotId);
    const userAddress = ctx.formatted_address;
    const cityDisplay = ctx.city || 'your area';
    
    // Format time context
    const dayOfWeek = ctx.day_of_week;
    const isWeekend = ctx.is_weekend;
    const localTime = ctx.local_iso ? new Date(ctx.local_iso).toLocaleString('en-US', { 
      timeZone: ctx.timezone || 'America/Chicago',
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) : 'Unknown time';
    const dayPart = ctx.day_part_key || 'unknown';
    
    console.log(`[consolidator] 📍 Location: ${userAddress}`);
    console.log(`[consolidator] 🕐 Time: ${localTime} (${dayPart})`);
    
    // Step 4: Build Tactical Dispatcher prompt with explicit briefing data
    const prompt = `You are a TACTICAL DISPATCHER for rideshare drivers. Your job is to synthesize intelligence into a clear, actionable "Strategy for Now."

Your PRIMARY task is to synthesize the data provided below. You have access to Google Search only for final sanity check on breaking news.

=== DRIVER CONTEXT ===
Location: ${userAddress}
Coordinates: ${ctx.lat}, ${ctx.lng}
City: ${cityDisplay}, ${ctx.state || ''}
Time: ${localTime}
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : '[WEEKDAY]'}
Day Part: ${dayPart}
${ctx.is_holiday ? `🎉 HOLIDAY: ${ctx.holiday}` : ''}
${ctx.airport_context?.airport_code ? `Nearby Airport: ${ctx.airport_context.airport_code} (${ctx.airport_context.distance_miles} mi)` : ''}

=== STRATEGIC ASSESSMENT (from Claude Sonnet) ===
${minstrategy}

=== LIVE BRIEFING DATA (Real-time from Gemini + Google APIs - USE THIS DATA) ===
${briefingContext}

=== YOUR TASK ===
Synthesize ALL the above into a clear, immediate "Strategy for Now" for this driver.

CRITICAL: You MUST reference the live briefing data (traffic incidents, events, news) in your strategy.

Your output should be 3-5 paragraphs that:
1. START with the current situation: "Right now in ${cityDisplay}..."
2. Reference specific traffic incidents/conditions from the briefing data
3. Call out events/venues happening today that impact demand
4. Highlight any hazards or avoid-zones (closures, congestion, enforcement)
5. Give a clear RECOMMENDATION: "Your best move right now is..."
6. End with timing guidance: how long this window lasts

STYLE REQUIREMENTS:
- Write in direct, conversational language (like a dispatcher on the radio)
- Be specific about locations, street names, events, and times
- Use details from the briefing data (mention incidents like "Eastbound Main St closed")
- No bullet points - use flowing paragraphs
- No generic advice - make it specific to THIS driver at THIS moment

DO NOT:
- List venues (that's handled by Smart Blocks)
- Give vague advice like "be safe"
- Repeat the minstrategy verbatim
- Output JSON - just plain text paragraphs`;

    console.log(`[consolidator] 📝 Prompt size: ${prompt.length} chars`);
    console.log(`[consolidator] 📄 Briefing context being sent:\n${briefingContext}`);
    
    // Step 5: Call Gemini
    const result = await callGeminiConsolidator({
      prompt,
      maxTokens: 2048,
      temperature: 0.3
    });
    
    if (!result.ok) {
      throw new Error(result.error || 'Gemini consolidator failed');
    }
    
    const consolidatedStrategy = result.output;
    
    if (!consolidatedStrategy || consolidatedStrategy.length === 0) {
      throw new Error('Consolidator returned empty output');
    }
    
    console.log(`[consolidator] ✅ Got strategy: ${consolidatedStrategy.length} chars`);
    console.log(`[consolidator] 📖 Preview: ${consolidatedStrategy.substring(0, 150)}...`);
    
    // Step 6: Write to strategies table
    const totalDuration = Date.now() - startTime;
    
    await db.update(strategies).set({
      consolidated_strategy: consolidatedStrategy,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[consolidator] ✅ SAVED consolidated_strategy for ${snapshotId}`);
    console.log(`[consolidator] ⏱️ Total time: ${totalDuration}ms`);
    
    return { 
      ok: true, 
      strategy: consolidatedStrategy,
      metrics: {
        strategyLength: consolidatedStrategy.length,
        geminiDurationMs: result.durationMs || 0,
        totalDurationMs: totalDuration
      }
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[consolidator] ❌ Error for ${snapshotId} after ${totalDuration}ms:`, error.message);
    
    // Write error to DB
    await db.update(strategies).set({
      status: 'error',
      error_code: 'consolidator_failed',
      error_message: error.message.slice(0, 500),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    
    throw error;
  }
}
