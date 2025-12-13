// server/lib/ai/providers/consolidator.js
// Strategy generation provider
//
// TWO FUNCTIONS:
//   1. runImmediateStrategy() - GPT-5.2 generates "strategy_for_now" (1-hour tactical)
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
import { triadLog, aiLog, dbLog, OP } from '../../../logger/workflow.js';

// Claude Opus fallback configuration
const FALLBACK_MODEL = 'claude-opus-4-5-20251101';
const FALLBACK_MAX_TOKENS = 8000;
const FALLBACK_TEMPERATURE = 0.3;

/**
 * Call GPT-5.2 to generate immediate strategy from snapshot + briefing data
 * NO minstrategy required - GPT-5.2 has all the context it needs
 * @param {Object} snapshot - Full snapshot row from DB
 * @param {Object} briefing - Briefing data { traffic, events, weather }
 */
async function callGPT5ForImmediateStrategy({ snapshot, briefing }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    aiLog.warn(1, `OPENAI_API_KEY not configured for immediate strategy`);
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
    const prompt = `You are a rideshare strategist. Analyze the briefing data and tell the driver what to do RIGHT NOW.

=== DRIVER CONTEXT ===
Location: ${snapshot.formatted_address}
City: ${snapshot.city}, ${snapshot.state}
Time: ${localTime} (${snapshot.day_part_key})
${snapshot.is_holiday ? `HOLIDAY: ${snapshot.holiday}` : ''}

=== BRIEFING DATA ===
TRAFFIC:
${JSON.stringify(briefing.traffic, null, 2)}

EVENTS:
${JSON.stringify(briefing.events, null, 2)}

WEATHER: ${JSON.stringify(snapshot.weather)}

NEWS: ${JSON.stringify(briefing.news)}

SCHOOL CLOSURES: ${JSON.stringify(briefing.school_closures)}

AIRPORT CONDITIONS: ${JSON.stringify(briefing.airport)}

=== OUTPUT (500 chars max) ===
Based on ALL the data above, provide a strategic brief:

**GO:** [Area/zone to position - based on events, demand patterns]
**AVOID:** [Roads/areas with incidents from traffic data]
**WHEN:** [Timing window - when to be there, how long the opportunity lasts]
**WHY:** [1 sentence - which specific event/condition is driving this]
**IF NO PING:** [What to do if no rides come - how long to wait, backup move]

RULES:
- Reference SPECIFIC data (event names, road numbers, times from above)
- Use **bold** for area names and road names
- Be concise but complete - driver needs actionable intel
- Do NOT list specific venues (venue cards handle that separately)`;


    // GPT-5.2 with medium reasoning for strategic analysis
    // Note: GPT-5.2 requires max_completion_tokens and reasoning_effort
    // Use "developer" role instead of "system" for newer models
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        messages: [
          { role: 'developer', content: 'You are a rideshare strategy expert. Provide concise, actionable guidance.' },
          { role: 'user', content: prompt }
        ],
        reasoning_effort: 'medium',
        max_completion_tokens: 2000  // GPT-5.2 needs tokens for reasoning + output
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      aiLog.warn(1, `[GPT-5.2] Immediate strategy failed (${response.status}): ${errText.substring(0, 200)}`, OP.AI);
      return { strategy: '' };
    }

    const data = await response.json();
    const strategy = data.choices?.[0]?.message?.content || '';

    if (strategy) {
      aiLog.done(1, `[GPT-5.2] Immediate strategy (${strategy.length} chars)`, OP.AI);
      return { strategy };
    }

    aiLog.warn(1, `[GPT-5.2] Empty response. Response: ${JSON.stringify(data).substring(0, 300)}`, OP.AI);
    return { strategy: '' };
  } catch (error) {
    aiLog.warn(1, `Immediate strategy call failed: ${error.message}`, OP.AI);
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
    aiLog.error(1, `GEMINI_API_KEY not configured for consolidator`);
    return { ok: false, error: 'GEMINI_API_KEY not configured' };
  }

  // RETRY CONFIGURATION: 3 attempts with 2s, 4s, 8s delays
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;
  const callStart = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      if (attempt > 1) {
        aiLog.info(`Consolidator retry attempt ${attempt-1}/${MAX_RETRIES} due to overload...`);
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
        aiLog.warn(1, `Gemini consolidator busy (${response.status}): ${errText.substring(0, 100)}`);

        if (attempt <= MAX_RETRIES) {
          // Wait before retrying (Exponential Backoff)
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          aiLog.info(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry loop
        }
        return { ok: false, error: `Gemini Overloaded after ${MAX_RETRIES} retries` };
      }

      if (!response.ok) {
        const errText = await response.text();
        aiLog.error(1, `Gemini consolidator API error ${response.status}: ${errText.substring(0, 500)}`);

        if (response.status === 400 && errText.includes('API key expired')) {
          return { ok: false, error: 'GEMINI_API_KEY expired - update in Secrets' };
        }

        return { ok: false, error: `API error ${response.status}` };
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        aiLog.warn(1, `Gemini consolidator returned empty response`);
        return { ok: false, error: 'Empty response' };
      }

      const elapsed = Date.now() - callStart;
      aiLog.info(`Gemini consolidator: ${text.length} chars in ${elapsed}ms`);
      return { ok: true, output: text.trim(), durationMs: elapsed };

    } catch (error) {
      aiLog.error(1, `Consolidator network error (attempt ${attempt}): ${error.message}`);
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        aiLog.info(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const elapsed = Date.now() - callStart;
      aiLog.error(1, `Consolidator failed after ${elapsed}ms and ${MAX_RETRIES} retries: ${error.message}`);
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
      triadLog.info(`Already consolidated - skipping`);
      return { ok: true, skipped: true, reason: 'already_consolidated' };
    }

    // Parse briefing JSON fields
    const trafficData = parseJsonField(briefingRow.traffic_conditions);
    const eventsData = parseJsonField(briefingRow.events);
    const newsData = parseJsonField(briefingRow.news);
    const weatherData = parseJsonField(briefingRow.weather_current);
    const closuresData = parseJsonField(briefingRow.school_closures);
    const airportData = parseJsonField(briefingRow.airport_conditions);

    triadLog.phase(3, `Briefing data: traffic=${!!trafficData}, events=${!!eventsData}, news=${!!newsData}, weather=${!!weatherData}, airport=${!!airportData}`);

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

    triadLog.phase(3, `Location: ${userAddress}`);
    triadLog.phase(3, `Time: ${localTime} (${dayPart})`);

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

=== AIRPORT_CONDITIONS_DATA ===
${JSON.stringify(airportData, null, 2)}

=== YOUR TASK ===
Create a DAILY STRATEGY for this driver covering the next 8-12 hours. Think like a shift planner, not just immediate tactics.

CRITICAL: Reference SPECIFIC details from the data above (traffic incidents by name, event venues, closure streets, weather impacts, airport arrivals/departures).

Output 4-6 paragraphs covering:
1. Today's overview: "Today in ${cityDisplay} (${dayOfWeek})..." - What makes today unique?
2. Morning/Afternoon strategy: Where demand will be and when
3. Events impact: Specific events from CURRENT_EVENTS_DATA and their timing/surge windows
4. Traffic & hazards: Road closures, construction, areas to avoid
5. Weather considerations: How conditions affect rider behavior
6. Airport strategy: Peak arrival/departure times, which terminal to position at, expected delays
7. Peak windows: "Your best earning windows today are..." with specific times and locations

STYLE: Strategic and forward-looking. Think 8-12 hours ahead. Be specific about times, locations, and events. No bullet points.

DO NOT: Focus only on "right now", list venues without context, output JSON.`;

    aiLog.info(`Consolidator prompt size: ${prompt.length} chars`);
    
    // Step 5: Call Gemini (with Claude Opus fallback)
    let result = await callGeminiConsolidator({
      prompt,
      maxTokens: 2048,
      temperature: 0.3
    });

    // If Gemini failed, try Claude Opus fallback
    if (!result.ok) {
      aiLog.warn(1, `Gemini consolidator failed: ${result.error}`);
      aiLog.info(`Trying Claude Opus fallback...`);

      const fallbackResult = await callAnthropic({
        model: FALLBACK_MODEL,
        system: 'You are a strategic advisor for rideshare drivers. Create comprehensive daily strategies.',
        user: prompt,
        maxTokens: FALLBACK_MAX_TOKENS,
        temperature: FALLBACK_TEMPERATURE
      });

      if (fallbackResult.ok) {
        aiLog.info(`Claude Opus fallback succeeded`);
        result = { ok: true, output: fallbackResult.output, usedFallback: true };
      } else {
        aiLog.error(1, `Fallback also failed: ${fallbackResult.error}`);
        throw new Error(result.error || 'Gemini consolidator failed (fallback also failed)');
      }
    }

    const consolidatedStrategy = result.output;

    if (!consolidatedStrategy || consolidatedStrategy.length === 0) {
      throw new Error('Consolidator returned empty output');
    }

    triadLog.phase(3, `Got strategy: ${consolidatedStrategy.length} chars`);
    triadLog.info(`Preview: ${consolidatedStrategy.substring(0, 150)}...`);

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
  triadLog.phase(3, `[consolidator] Starting immediate strategy for ${snapshotId.slice(0, 8)}`);

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
      triadLog.info(`Immediate strategy already exists - skipping`);
      return { ok: true, skipped: true, reason: 'already_exists' };
    }

    // Parse ALL briefing data (not just traffic/events - include news, closures, and airport too)
    const briefing = {
      traffic: parseJsonField(briefingRow.traffic_conditions),
      events: parseJsonField(briefingRow.events),
      weather: parseJsonField(briefingRow.weather_current),
      news: parseJsonField(briefingRow.news),
      school_closures: parseJsonField(briefingRow.school_closures),
      airport: parseJsonField(briefingRow.airport_conditions)
    };

    triadLog.phase(3, `[consolidator] ${snapshot.formatted_address}`);
    triadLog.phase(3, `[consolidator] Briefing: traffic=${!!briefing.traffic}, events=${!!briefing.events}, news=${!!briefing.news}, closures=${!!briefing.school_closures}, airport=${!!briefing.airport}`);

    // Call GPT-5.2 with snapshot + briefing (NO minstrategy)
    const result = await callGPT5ForImmediateStrategy({ snapshot, briefing });

    if (!result.strategy) {
      throw new Error('GPT-5.2 returned empty strategy');
    }

    // Write to strategies table
    const totalDuration = Date.now() - startTime;

    await db.update(strategies).set({
      strategy_for_now: result.strategy,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    triadLog.done(3, `[consolidator] Immediate strategy saved (${result.strategy.length} chars)`, totalDuration);

    return {
      ok: true,
      strategy: result.strategy,
      durationMs: totalDuration
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    triadLog.error(3, `Immediate strategy failed after ${totalDuration}ms`, error);

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
