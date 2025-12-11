// server/lib/providers/consolidator.js
// Consolidator provider - Gemini 3 Pro Preview as "Tactical Dispatcher"
// OPTIMIZED: Reads from two tables (no snapshot re-read needed):
//   - strategies: minstrategy + location/time context (written by minstrategy provider)
//   - briefings: events, traffic, news, weather, closures (written by briefing provider)
// Includes Claude Opus 4.5 fallback when Gemini fails

import { db } from '../../../db/drizzle.js';
import { strategies, briefings } from '../../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { callAnthropic } from '../adapters/anthropic-adapter.js';
import { triadLog } from '../../../logger/workflow.js';

// Claude Opus fallback configuration
const FALLBACK_MODEL = 'claude-opus-4-5-20251101';
const FALLBACK_MAX_TOKENS = 8000;
const FALLBACK_TEMPERATURE = 0.3;

/**
 * Call GPT-5.1 to generate immediate strategy from consolidated output
 */
async function callGPT5ForImmediateStrategy({ consolidatedStrategy, userAddress, cityDisplay, timestamp }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[consolidator] ⚠️ OPENAI_API_KEY not configured, skipping immediate strategy');
    return { strategy: '' };
  }

  try {
    const prompt = `You are a tactical rideshare coach. Based on the consolidated daily strategy below, generate a focused "Strategy for RIGHT NOW" (next 1 hour).

CONSOLIDATED DAILY STRATEGY:
${consolidatedStrategy}

LOCATION: ${userAddress} (${cityDisplay})
TIME: ${timestamp}

Generate ONLY a concise 2-3 sentence tactical instruction for what the driver should do RIGHT NOW to maximize earnings in the next hour. Be specific to the location and time. Reference details from the consolidated strategy above.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.1',
        messages: [
          { role: 'user', content: prompt }
        ],
        // GPT-5.1: Do NOT include temperature or reasoning_effort - just let it run fast
        max_completion_tokens: 500
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[consolidator] ⚠️ GPT-5.1 failed (${response.status}): ${errText.substring(0, 100)}`);
      return { strategy: '' };
    }

    const data = await response.json();
    const strategy = data.choices?.[0]?.message?.content || '';
    
    if (strategy) {
      console.log(`[consolidator] ✅ GPT-5.1 returned immediate strategy: ${strategy.substring(0, 100)}...`);
      return { strategy };
    }
    
    console.warn('[consolidator] ⚠️ GPT-5.1 returned empty response');
    return { strategy: '' };
  } catch (error) {
    console.warn(`[consolidator] ⚠️ GPT-5.1 call failed:`, error.message);
    return { strategy: '' };
  }
}

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
  triadLog.phase(3, `Starting for ${snapshotId.slice(0, 8)}`);

  try {
    // TWO PARALLEL QUERIES - avoids race condition from minstrategy/briefing parallel writes
    // 1. strategies: minstrategy + location/time context (written by minstrategy provider)
    // 2. briefings: events, traffic, news, weather, closures (written by briefing provider)
    const [[strategyRow], [briefingRow]] = await Promise.all([
      db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1),
      db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1)
    ]);

    if (!strategyRow) {
      throw new Error(`Strategy row not found for snapshot ${snapshotId}`);
    }

    if (!briefingRow) {
      throw new Error(`Briefing row not found for snapshot ${snapshotId}`);
    }

    // Check if already consolidated
    if (strategyRow?.consolidated_strategy && strategyRow?.status === 'ok') {
      console.log(`[consolidator] ⏭️ Already consolidated (status=ok) - skipping for ${snapshotId}`);
      return { ok: true, skipped: true, reason: 'already_consolidated' };
    }

    // Get minstrategy from STRATEGIES table (written by minstrategy provider)
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

    // Parse raw briefing JSON fields from BRIEFINGS table (written by briefing provider)
    const trafficData = parseJsonField(briefingRow.traffic_conditions);
    const eventsData = parseJsonField(briefingRow.events);
    const newsData = parseJsonField(briefingRow.news);
    const weatherData = parseJsonField(briefingRow.weather_current);
    const closuresData = parseJsonField(briefingRow.school_closures);

    console.log(`[consolidator] 📊 Briefing data: traffic=${!!trafficData}, events=${!!eventsData}, news=${!!newsData}, weather=${!!weatherData}, closures=${!!closuresData}`);

    // Get location/time context from STRATEGIES table (written by minstrategy provider)
    const userAddress = strategyRow.user_resolved_address || 'Unknown location';
    const cityDisplay = strategyRow.user_resolved_city || 'your area';
    const stateDisplay = strategyRow.user_resolved_state || '';
    const lat = strategyRow.lat;
    const lng = strategyRow.lng;

    // Format time context from strategies table
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dow = strategyRow.dow;
    const dayOfWeek = dow != null ? dayNames[dow] : 'Unknown';
    const isWeekend = dow === 0 || dow === 6;
    const localTime = strategyRow.local_iso ? new Date(strategyRow.local_iso).toLocaleString('en-US', {
      timeZone: strategyRow.timezone || 'America/Chicago',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) : 'Unknown time';
    const dayPart = strategyRow.day_part_key || 'unknown';
    const isHoliday = strategyRow.is_holiday || false;
    const holiday = strategyRow.holiday || null;

    console.log(`[consolidator] 📍 Location: ${userAddress} (from strategies table)`);
    console.log(`[consolidator] 🕐 Time: ${localTime} (${dayPart})`);
    
    // Step 4: Build Daily Strategy prompt with RAW briefing JSON
    // This is the DAILY STRATEGY (8-12 hours) that goes to the Briefing Tab
    // NOTE: No full snapshot needed - all context comes from strategies + briefings tables
    const prompt = `You are a STRATEGIC ADVISOR for rideshare drivers. Create a comprehensive "Daily Strategy" covering the next 8-12 hours.

=== DRIVER CONTEXT ===
Location: ${userAddress}
Coordinates: ${lat}, ${lng}
City: ${cityDisplay}, ${stateDisplay}
Current Time: ${localTime}
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : '[WEEKDAY]'}
Day Part: ${dayPart}
${isHoliday ? `HOLIDAY: ${holiday}` : ''}

=== STRATEGIC ASSESSMENT (from Claude) ===
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
Create a DAILY STRATEGY for this driver covering the next 8-12 hours. Think like a shift planner, not just immediate tactics.

CRITICAL: Reference SPECIFIC details from the data above (traffic incidents by name, event venues, closure streets, weather impacts).

Output 4-6 paragraphs covering:
1. Today's overview: "Today in ${cityDisplay} (${dayOfWeek})..." - What makes today unique?
2. Morning/Afternoon strategy: Where demand will be and when
3. Events impact: Specific events from CURRENT_EVENTS_DATA and their timing/surge windows
4. Traffic & hazards: Road closures, construction, areas to avoid
5. Weather considerations: How conditions affect rider behavior
6. Peak windows: "Your best earning windows today are..." with specific times and locations

STYLE: Strategic and forward-looking. Think 8-12 hours ahead. Be specific about times, locations, and events. No bullet points.

DO NOT: Focus only on "right now", list venues without context, repeat minstrategy verbatim, output JSON.`;

    console.log(`[consolidator] 📝 Prompt size: ${prompt.length} chars`);
    
    // Step 5: Call Gemini (with Claude Opus fallback)
    let result = await callGeminiConsolidator({
      prompt,
      maxTokens: 2048,
      temperature: 0.3
    });

    // If Gemini failed, try Claude Opus fallback
    if (!result.ok) {
      console.warn(`[consolidator] ⚠️ Gemini failed: ${result.error}`);
      console.log(`[consolidator] 🔄 Trying Claude Opus fallback...`);

      const fallbackResult = await callAnthropic({
        model: FALLBACK_MODEL,
        system: 'You are a strategic advisor for rideshare drivers. Create comprehensive daily strategies.',
        user: prompt,
        maxTokens: FALLBACK_MAX_TOKENS,
        temperature: FALLBACK_TEMPERATURE
      });

      if (fallbackResult.ok) {
        console.log(`[consolidator] ✅ Claude Opus fallback succeeded`);
        result = { ok: true, output: fallbackResult.output, usedFallback: true };
      } else {
        console.error(`[consolidator] ❌ Fallback also failed: ${fallbackResult.error}`);
        throw new Error(result.error || 'Gemini consolidator failed (fallback also failed)');
      }
    }

    const consolidatedStrategy = result.output;
    
    if (!consolidatedStrategy || consolidatedStrategy.length === 0) {
      throw new Error('Consolidator returned empty output');
    }
    
    console.log(`[consolidator] ✅ Got strategy: ${consolidatedStrategy.length} chars`);
    console.log(`[consolidator] 📖 Preview: ${consolidatedStrategy.substring(0, 150)}...`);
    
    // Step 6a: Call GPT-5.1 for immediate strategy from consolidated output + location
    console.log(`[consolidator] 🔄 Calling GPT-5.1 for immediate strategy...`);
    const immediateStrategyResult = await callGPT5ForImmediateStrategy({
      consolidatedStrategy,
      userAddress,
      cityDisplay,
      timestamp: localTime
    });
    
    const strategyForNow = immediateStrategyResult?.strategy || '';
    
    // Step 6b: Write to strategies table
    const totalDuration = Date.now() - startTime;
    
    await db.update(strategies).set({
      consolidated_strategy: consolidatedStrategy,
      strategy_for_now: strategyForNow,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    triadLog.done(3, `Saved strategy (${consolidatedStrategy.length} chars)`, totalDuration);

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
    triadLog.error(3, `Failed for ${snapshotId.slice(0, 8)} after ${totalDuration}ms`, error);
    
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
