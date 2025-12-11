// server/lib/ai/providers/consolidator.js
// Strategy generation provider
//
// TWO FUNCTIONS:
//   1. runImmediateStrategy() - GPT-5.1 generates "strategy_for_now" (1-hour tactical)
//      - Called by blocks-fast.js during initial pipeline
//      - Uses snapshot + briefing data directly (no minstrategy)
//
//   2. runConsolidator() - Gemini 3 Pro generates "consolidated_strategy" (8-12hr daily)
//      - Called on-demand via POST /api/strategy/daily/:snapshotId
//      - Uses snapshot + briefing data directly (no minstrategy)
//      - Includes Claude Opus 4.5 fallback when Gemini fails

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
 * Call GPT-5.1 to generate immediate strategy from snapshot + briefing data
 * NO minstrategy required - GPT-5.1 has all the context it needs
 * @param {Object} snapshot - Full snapshot row from DB
 * @param {Object} briefing - Briefing data { traffic, events, weather }
 */
async function callGPT5ForImmediateStrategy({ snapshot, briefing }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[immediate-strategy] ⚠️ OPENAI_API_KEY not configured');
    return { strategy: '' };
  }

  // Format time from snapshot
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = snapshot.dow != null ? dayNames[snapshot.dow] : 'Unknown';
  const isWeekend = snapshot.dow === 0 || snapshot.dow === 6;
  const localTime = snapshot.local_iso ? new Date(snapshot.local_iso).toLocaleString('en-US', {
    timeZone: snapshot.timezone || 'America/Chicago',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }) : 'Unknown time';

  try {
    const prompt = `You are a TACTICAL RIDESHARE COACH. Generate a focused "GO NOW" strategy for the next 1 hour.

=== DRIVER SNAPSHOT ===
Location: ${snapshot.formatted_address}
City: ${snapshot.city}, ${snapshot.state}
Coordinates: ${snapshot.lat}, ${snapshot.lng}
Current Time: ${localTime}
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : '[WEEKDAY]'}
Day Part: ${snapshot.day_part_key}
${snapshot.is_holiday ? `HOLIDAY: ${snapshot.holiday}` : ''}

=== WEATHER ===
${JSON.stringify(snapshot.weather, null, 2)}

=== CURRENT TRAFFIC ===
${JSON.stringify(briefing.traffic, null, 2)}

=== CURRENT EVENTS ===
${JSON.stringify(briefing.events, null, 2)}

=== YOUR TASK ===
Generate a concise 2-3 sentence tactical instruction for what the driver should do RIGHT NOW.
Be specific: name locations, reference events/traffic from the data above.
Focus on the NEXT 1 HOUR only.

Format: Start with "HEAD TO..." or "POSITION AT..." or "STAY NEAR..." - be directive and actionable.`;

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
        max_completion_tokens: 500
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[immediate-strategy] ⚠️ GPT-5.1 failed (${response.status}): ${errText.substring(0, 100)}`);
      return { strategy: '' };
    }

    const data = await response.json();
    const strategy = data.choices?.[0]?.message?.content || '';

    if (strategy) {
      console.log(`[immediate-strategy] ✅ GPT-5.1 returned: ${strategy.substring(0, 100)}...`);
      return { strategy };
    }

    console.warn('[immediate-strategy] ⚠️ GPT-5.1 returned empty response');
    return { strategy: '' };
  } catch (error) {
    console.warn(`[immediate-strategy] ⚠️ GPT-5.1 call failed:`, error.message);
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
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
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
 * Generates 8-12 hour daily strategy from snapshot + briefing data
 * Writes to strategies.consolidated_strategy
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {Object} options - Optional parameters
 * @param {Object} options.snapshot - Pre-fetched snapshot row to avoid redundant DB reads
 */
export async function runConsolidator(snapshotId, options = {}) {
  const startTime = Date.now();
  triadLog.phase(3, `Starting for ${snapshotId.slice(0, 8)}`);

  try {
    // Use pre-fetched snapshot if provided, otherwise fetch from DB
    let snapshot = options.snapshot;
    if (!snapshot) {
      const { snapshots } = await import('../../../../shared/schema.js');
      const [row] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      snapshot = row;
    }

    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    // Fetch strategy row and briefing
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
      console.log(`[consolidator] ⏭️ Already consolidated - skipping`);
      return { ok: true, skipped: true, reason: 'already_consolidated' };
    }

    // Parse briefing JSON fields
    const trafficData = parseJsonField(briefingRow.traffic_conditions);
    const eventsData = parseJsonField(briefingRow.events);
    const newsData = parseJsonField(briefingRow.news);
    const weatherData = parseJsonField(briefingRow.weather_current);
    const closuresData = parseJsonField(briefingRow.school_closures);

    console.log(`[consolidator] 📊 Briefing: traffic=${!!trafficData}, events=${!!eventsData}, news=${!!newsData}, weather=${!!weatherData}`);

    // Get location/time context from SNAPSHOT (not strategies table)
    const userAddress = snapshot.formatted_address || 'Unknown location';
    const cityDisplay = snapshot.city || 'your area';
    const stateDisplay = snapshot.state || '';
    const lat = snapshot.lat;
    const lng = snapshot.lng;

    // Format time context from snapshot
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dow = snapshot.dow;
    const dayOfWeek = dow != null ? dayNames[dow] : 'Unknown';
    const isWeekend = dow === 0 || dow === 6;
    const localTime = snapshot.local_iso ? new Date(snapshot.local_iso).toLocaleString('en-US', {
      timeZone: snapshot.timezone || 'America/Chicago',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) : 'Unknown time';
    const dayPart = snapshot.day_part_key || 'unknown';
    const isHoliday = snapshot.is_holiday || false;
    const holiday = snapshot.holiday || null;

    console.log(`[consolidator] 📍 Location: ${userAddress}`);
    console.log(`[consolidator] 🕐 Time: ${localTime} (${dayPart})`);

    // Step 4: Build Daily Strategy prompt with RAW briefing JSON
    // This is the DAILY STRATEGY (8-12 hours) that goes to the Briefing Tab
    // NOTE: All context comes from snapshot + briefings tables (no minstrategy)
    const prompt = `You are a STRATEGIC ADVISOR for rideshare drivers. Create a comprehensive "Daily Strategy" covering the next 8-12 hours.

=== DRIVER CONTEXT ===
Location: ${userAddress}
Coordinates: ${lat}, ${lng}
City: ${cityDisplay}, ${stateDisplay}
Current Time: ${localTime}
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : '[WEEKDAY]'}
Day Part: ${dayPart}
${isHoliday ? `HOLIDAY: ${holiday}` : ''}

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

DO NOT: Focus only on "right now", list venues without context, output JSON.`;

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

    // Step 6: Write ONLY consolidated_strategy to strategies table
    // NOTE: strategy_for_now is handled separately by runImmediateStrategy
    const totalDuration = Date.now() - startTime;

    await db.update(strategies).set({
      consolidated_strategy: consolidatedStrategy,
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

/**
 * Run IMMEDIATE strategy only (no daily strategy)
 * Called by blocks-fast.js for fast initial load
 * Uses snapshot row + briefing data directly - NO minstrategy required
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {Object} options - Optional parameters
 * @param {Object} options.snapshot - Pre-fetched snapshot row to avoid redundant DB reads
 */
export async function runImmediateStrategy(snapshotId, options = {}) {
  const startTime = Date.now();
  console.log(`[immediate-strategy] 🚀 Starting for ${snapshotId.slice(0, 8)}`);

  try {
    // Use pre-fetched snapshot if provided, otherwise fetch from DB
    let snapshot = options.snapshot;
    if (!snapshot) {
      const { snapshots } = await import('../../../../shared/schema.js');
      const [row] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      snapshot = row;
    }

    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    // Fetch briefing data
    const [briefingRow] = await db.select().from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);

    if (!briefingRow) {
      throw new Error(`Briefing not found for snapshot ${snapshotId}`);
    }

    // Check if immediate strategy already exists
    const [strategyRow] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    if (strategyRow?.strategy_for_now && strategyRow?.status === 'ok') {
      console.log(`[immediate-strategy] ⏭️ Already exists - skipping`);
      return { ok: true, skipped: true, reason: 'already_exists' };
    }

    // Parse briefing data
    const briefing = {
      traffic: parseJsonField(briefingRow.traffic_conditions),
      events: parseJsonField(briefingRow.events),
      weather: parseJsonField(briefingRow.weather_current)
    };

    console.log(`[immediate-strategy] 📍 ${snapshot.formatted_address}`);
    console.log(`[immediate-strategy] 📊 Briefing: traffic=${!!briefing.traffic}, events=${!!briefing.events}`);

    // Call GPT-5.1 with snapshot + briefing (NO minstrategy)
    const result = await callGPT5ForImmediateStrategy({ snapshot, briefing });

    if (!result.strategy) {
      throw new Error('GPT-5.1 returned empty strategy');
    }

    // Write to strategies table
    const totalDuration = Date.now() - startTime;

    await db.update(strategies).set({
      strategy_for_now: result.strategy,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[immediate-strategy] ✅ Saved (${result.strategy.length} chars) in ${totalDuration}ms`);

    return {
      ok: true,
      strategy: result.strategy,
      durationMs: totalDuration
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[immediate-strategy] ❌ Failed after ${totalDuration}ms:`, error.message);

    // Write error to DB
    await db.update(strategies).set({
      status: 'error',
      error_code: 'immediate_failed',
      error_message: error.message.slice(0, 500),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    throw error;
  }
}
