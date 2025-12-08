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
 * Parse JSON field safely - handles both string and object formats
 */
function parseJsonField(field) {
  if (!field) return null;
  if (typeof field === 'string') {
    try {
      return JSON.parse(field);
    } catch {
      return null;
    }
  }
  return field;
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
    
    // Step 2: Fetch briefing row from DB (raw JSON, not summarized)
    const [briefingRow] = await db.select().from(briefings)
      .where(eq(briefings.snapshot_id, snapshotId)).limit(1);
    
    // Parse raw briefing JSON fields
    const trafficData = parseJsonField(briefingRow?.traffic_conditions);
    const eventsData = parseJsonField(briefingRow?.events);
    const newsData = parseJsonField(briefingRow?.news);
    const weatherData = parseJsonField(briefingRow?.weather_current);
    const closuresData = parseJsonField(briefingRow?.school_closures);
    
    console.log(`[consolidator] 📊 Briefing data: traffic=${!!trafficData}, events=${!!eventsData}, news=${!!newsData}, weather=${!!weatherData}, closures=${!!closuresData}`);
    
    // Step 3: Fetch full snapshot for context
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
    
    // Step 4: Build Tactical Dispatcher prompt with RAW briefing JSON
    const prompt = `You are a TACTICAL DISPATCHER for rideshare drivers. Synthesize the intelligence below into a clear, actionable "Strategy for Now."

=== DRIVER CONTEXT ===
Location: ${userAddress}
Coordinates: ${ctx.lat}, ${ctx.lng}
City: ${cityDisplay}, ${ctx.state || ''}
Time: ${localTime}
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : '[WEEKDAY]'}
Day Part: ${dayPart}
${ctx.is_holiday ? `HOLIDAY: ${ctx.holiday}` : ''}

=== FULL SNAPSHOT DATA ===
${JSON.stringify(ctx, null, 2)}

=== STRATEGIC ASSESSMENT (from Claude Sonnet) ===
${minstrategy}

=== CURRENT_TRAFFIC_DATA ===
${JSON.stringify(trafficData, null, 2)}

=== CURRENT_EVENTS_DATA ===
${JSON.stringify(eventsData, null, 2)}

=== CURRENT_NEWS_DATA ===
${JSON.stringify(newsData, null, 2)}

=== CURRENT_WEATHER_DATA ===
${JSON.stringify(weatherData, null, 2)}

=== SCHOOL_CLOSURES_DATA ===
${JSON.stringify(closuresData, null, 2)}

=== YOUR TASK ===
Synthesize ALL the above into a clear "Strategy for Now" for this driver.

CRITICAL: Reference SPECIFIC details from the data above (traffic incidents by name, event venues, closure streets).

Output 3-5 paragraphs:
1. Current situation: "Right now in ${cityDisplay}..."
2. Reference specific traffic incidents/conditions from CURRENT_TRAFFIC_DATA
3. Call out events happening today from CURRENT_EVENTS_DATA
4. Hazards or avoid-zones
5. Clear RECOMMENDATION: "Your best move right now is..."
6. Timing guidance

STYLE: Direct, conversational (like a dispatcher). Be specific about locations, streets, times. No bullet points. No generic advice.

DO NOT: List venues, give vague advice, repeat minstrategy verbatim, output JSON.`;

    console.log(`[consolidator] 📝 Prompt size: ${prompt.length} chars`);
    
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
