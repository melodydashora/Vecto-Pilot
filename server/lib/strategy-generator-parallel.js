// server/lib/strategy-generator-parallel.js
// Parallel multi-model strategy orchestration: Claude + Gemini → GPT-5 consolidation
import { randomUUID } from 'crypto';
import { db } from '../db/drizzle.js';
import { snapshots, strategies } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { callClaude45Raw } from './adapters/anthropic-sonnet45.js';
import { callGeminiGenerateContent } from './adapters/gemini-2.5-pro.js';
import { callGPT5 } from './adapters/openai-gpt5.js';

// Feature flag - set to true to enable parallel orchestration
const MULTI_STRATEGY_ENABLED = process.env.MULTI_STRATEGY_ENABLED === 'true';

/**
 * Call Claude for core strategic plan (no venues)
 */
async function callClaudeCore({ snapshotId, userAddress, city, state, snapshot }) {
  console.log(`[callClaudeCore] ENTER - snapshot ${snapshotId}, city=${city}`);
  try {
    const systemPrompt = `You are a senior rideshare strategist. Analyze the driver's location, time, and conditions to provide strategic positioning advice. Focus on general patterns: time-of-day demand, weather impact, typical hotspots for this area. Return a 3-5 sentence strategy ONLY.`;

    const userPrompt = `Driver Location: ${userAddress || 'unknown'}
City: ${city || 'unknown'}, ${state || 'unknown'}
Time: ${snapshot.day_part_key || 'unknown'} on ${snapshot.dow !== null ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][snapshot.dow] : 'unknown'}
Weather: ${snapshot.weather?.tempF || 'unknown'}°F, ${snapshot.weather?.conditions || 'unknown'}
Air Quality: AQI ${snapshot.air?.aqi || 'unknown'}

Provide strategic positioning advice for a rideshare driver right now.`;

    const result = await callClaude45Raw({
      system: systemPrompt,
      user: userPrompt
    });

    return {
      ok: true,
      plan: result.trim()
    };
  } catch (err) {
    console.error(`[parallel-strategy] Claude core call failed:`, err.message);
    return {
      ok: false,
      reason: err.message || 'claude_failed'
    };
  }
}

/**
 * Call Gemini for events, news, traffic feeds
 */
async function callGeminiFeeds({ userAddress, city, state }) {
  console.log(`[callGeminiFeeds] ENTER - city=${city}, state=${state}`);
  try {
    const systemPrompt = `You are a local intelligence researcher for rideshare drivers. Research real-time events, news, and traffic for ${city}, ${state}.

Return JSON with arrays:
{
  "events": ["event 1", "event 2"],
  "news": ["news item 1", "news item 2"],
  "traffic": ["traffic update 1", "traffic update 2"]
}`;

    const userPrompt = `Research for ${city}, ${state} (near ${userAddress}):
1. Major events happening in the next 2 hours
2. Breaking local news affecting transportation
3. Traffic incidents, construction, road closures

Return JSON with events[], news[], traffic[] arrays.`;

    const result = await callGeminiGenerateContent({
      systemInstruction: systemPrompt,
      userText: userPrompt,
      maxOutputTokens: 2048
    });

    // Robust JSON parsing with fallback to empty arrays
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (parseErr) {
      console.warn(`[parallel-strategy] JSON parse failed, trying to extract:`, result?.substring(0, 200));
      // Try to extract JSON from markdown or text
      const jsonMatch = result?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        console.error(`[parallel-strategy] No valid JSON found, returning empty arrays`);
        return { ok: true, events: [], news: [], traffic: [] };
      }
    }

    return {
      ok: true,
      events: parsed.events || [],
      news: parsed.news || [],
      traffic: parsed.traffic || []
    };
  } catch (err) {
    console.error(`[parallel-strategy] Gemini feeds call failed:`, err.message);
    return {
      ok: false,
      events: [],
      news: [],
      traffic: [],
      reason: err.message || 'gemini_failed'
    };
  }
}

/**
 * Call GPT-5 to consolidate Claude plan + Gemini feeds
 */
async function consolidateWithGPT5Thinking({ plan, events, news, traffic, snapshot, holiday }) {
  try {
    // Format date and time context
    const currentTime = snapshot?.created_at ? new Date(snapshot.created_at) : new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = dayNames[currentTime.getDay()];
    const monthName = monthNames[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    const year = currentTime.getFullYear();
    const hour = currentTime.getHours();
    
    const timeStr = currentTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: snapshot?.timezone || 'America/Chicago'
    });
    
    // Format: "Friday, October 31, 2025 at 6:45 PM"
    const formattedDateTime = `${dayName}, ${monthName} ${dayNum}, ${year} at ${timeStr}`;
    
    // Build dynamic market reference from snapshot
    const marketArea = snapshot?.city && snapshot?.state 
      ? `${snapshot.city}, ${snapshot.state}` 
      : 'local';
    
    const developerPrompt = `You are a rideshare strategy consolidator for the ${marketArea} market. Create a time-aware, location-specific, actionable strategy that references TODAY's date, holiday status, weather, and events. Be conversational, urgent, and specific about timing (e.g., "tonight's game", "this ${dayName} evening", "in the next hour"). Keep it 3-5 sentences.`;

    // Format airport context
    const airportInfo = snapshot?.airport_context 
      ? `${snapshot.airport_context.airport_code || 'DFW'} airport (${snapshot.airport_context.distance_miles || '?'} mi away)${snapshot.airport_context.has_delays ? ' - DELAYS: ' + (snapshot.airport_context.delay_reason || 'unknown reason') + ' (' + (snapshot.airport_context.delay_minutes || '?') + ' min)' : ''}`
      : 'No airport data';

    const userPrompt = `CURRENT DATE & TIME: ${formattedDateTime}
DAY OF WEEK: ${dayName}${holiday ? `\n🎉 HOLIDAY ALERT: ${holiday}! Special demand patterns expected.` : ''}
TIME OF DAY: ${snapshot?.day_part_key || 'unknown'}

DRIVER LOCATION:
Address: ${snapshot?.formatted_address || 'unknown'}
City: ${snapshot?.city || 'unknown'}, ${snapshot?.state || 'unknown'}
Coordinates: ${snapshot?.lat || '?'}, ${snapshot?.lng || '?'}

CURRENT CONDITIONS:
Weather: ${snapshot?.weather?.tempF || '?'}°F, ${snapshot?.weather?.conditions || 'unknown'} - ${snapshot?.weather?.description || 'no details'}
Airport: ${airportInfo}

REAL-TIME INTELLIGENCE (Next 60 Minutes):
${holiday ? `🎉 HOLIDAY: ${holiday} - Expect increased demand for travel, dining, entertainment, and family gatherings.\n` : ''}Events: ${events.length > 0 ? events.join('; ') : 'none'}
Airport News: ${news.length > 0 ? news.join('; ') : 'none'}
Traffic: ${traffic.length > 0 ? traffic.join('; ') : 'none'}

Generate a strategy that:
1. Opens with the date/holiday if applicable (e.g., "It's ${holiday ? holiday + ' - ' : ''}${dayName} evening")
2. References specific locations near the driver's address
3. Integrates weather conditions if relevant (rain, heat, cold)
4. Mentions airport delays/demand if applicable
5. Provides actionable positioning advice for the NEXT HOUR with specific street names, venues, or zones`;

    // Log the full prompt being sent to GPT-5 for verification
    console.log(`[GPT-5] === FULL CONTEXT SENT ===`);
    console.log(`[GPT-5] Market: ${marketArea}`);
    console.log(`[GPT-5] Date/Time: ${formattedDateTime}`);
    console.log(`[GPT-5] Holiday: ${holiday || 'none'}`);
    console.log(`[GPT-5] Location: ${snapshot?.formatted_address || 'unknown'}`);
    console.log(`[GPT-5] Weather: ${snapshot?.weather?.tempF || '?'}°F`);
    console.log(`[GPT-5] Airport: ${airportInfo}`);
    console.log(`[GPT-5] Events: ${events.length}, News: ${news.length}, Traffic: ${traffic.length}`);
    console.log(`[GPT-5] === END CONTEXT ===`);

    const result = await callGPT5({
      developer: developerPrompt,
      user: userPrompt,
      max_completion_tokens: 2000,
      reasoning_effort: 'medium'
    });

    return {
      ok: true,
      strategy: result.text.trim()
    };
  } catch (err) {
    console.error(`[parallel-strategy] GPT-5 consolidation failed:`, err.message);
    return {
      ok: false,
      reason: err.message || 'consolidation_failed'
    };
  }
}

/**
 * Save strategy with full context to database
 */
async function saveStrategy(row) {
  try {
    await db.insert(strategies).values({
      snapshot_id: row.snapshot_id,
      user_id: row.user_id,
      user_address: row.user_address,
      city: row.city,
      state: row.state,
      lat: row.lat,
      lng: row.lng,
      events: row.events,
      news: row.news,
      traffic: row.traffic,
      strategy_for_now: row.consolidated_strategy,
      status: 'ok',
      model_name: 'claude-4.5→gemini-2.5→gpt-5',
      created_at: new Date(),
      updated_at: new Date()
    }).onConflictDoUpdate({
      target: strategies.snapshot_id,
      set: {
        user_id: row.user_id,
        user_address: row.user_address,
        city: row.city,
        state: row.state,
        lat: row.lat,
        lng: row.lng,
        events: row.events,
        news: row.news,
        traffic: row.traffic,
        strategy_for_now: row.consolidated_strategy,
        status: 'ok',
        model_name: 'claude-4.5→gemini-2.5→gpt-5',
        updated_at: new Date()
      }
    });

    return { ok: true };
  } catch (err) {
    console.error(`[parallel-strategy] DB save failed:`, err.message);
    return { ok: false, reason: err.message || 'db_insert_failed' };
  }
}

/**
 * Parallel provider writes - each lands independently
 * GPT-5 consolidation happens via event-driven worker when all fields present
 */
export async function runParallelProviders({ snapshotId, user, snapshot }) {
  const { lat, lng, city, state, user_address, user_id } = user;

  console.log(`[SIMPLE-STRATEGY] Starting Gemini → GPT-5 pipeline for snapshot ${snapshotId}`);
  console.log(`[SIMPLE-STRATEGY] Input:`, { city, state, user_address });

  try {
    // Step 1: Fetch snapshot to get existing news briefing with holiday info
    console.log(`[SIMPLE-STRATEGY] 📍 Fetching snapshot ${snapshotId} for briefing data...`);
    const [snapshotData] = await db.select().from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
    
    if (!snapshotData) {
      throw new Error('Snapshot not found');
    }
    
    // Extract briefing from snapshot (includes holiday field)
    const newsBriefing = snapshotData.news_briefing?.briefing || {};
    const holiday = newsBriefing.holiday || null;
    const geminiResult = {
      ok: true,
      holiday: holiday,
      news: newsBriefing.airports || [],
      events: newsBriefing.major_events || [],
      traffic: newsBriefing.traffic_construction || []
    };

    console.log(`[SIMPLE-STRATEGY] ✅ Briefings extracted from snapshot (holiday=${holiday || 'none'}, news=${geminiResult.news.length}, events=${geminiResult.events.length}, traffic=${geminiResult.traffic.length})`);

    // Step 2: Send FULL snapshot data to GPT-5 for contextual strategy
    console.log(`[SIMPLE-STRATEGY] 🚀 Sending FULL snapshot + briefings to GPT-5...`);
    const consolidated = await consolidateWithGPT5Thinking({
      plan: null,  // No Claude plan needed
      events: geminiResult.events || [],
      news: geminiResult.news || [],
      traffic: geminiResult.traffic || [],
      snapshot: {
        // FULL snapshot data for complete context
        snapshot_id: snapshotData.snapshot_id,
        created_at: snapshotData.created_at,
        formatted_address: snapshotData.formatted_address || user_address,
        city: city,
        state: state,
        lat: lat,
        lng: lng,
        timezone: snapshotData.timezone,
        day_part_key: snapshotData.day_part_key,
        weather: snapshotData.weather,
        airport_context: snapshotData.airport_context,
        user_id: user_id
      },
      holiday: geminiResult.holiday
    });

    if (!consolidated.ok) {
      throw new Error(consolidated.reason || 'GPT-5 consolidation failed');
    }

    console.log(`[SIMPLE-STRATEGY] ✅ GPT-5 strategy generated (${consolidated.strategy.length} chars)`);

    // Step 3: Write everything to database including holiday
    await db.update(strategies).set({
      holiday: geminiResult.holiday,
      briefing_news: geminiResult.news ?? [],
      briefing_events: geminiResult.events ?? [],
      briefing_traffic: geminiResult.traffic ?? [],
      consolidated_strategy: consolidated.strategy || '',
      lat, lng, city, state, user_address,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[SIMPLE-STRATEGY] ✅ Strategy complete and saved to consolidated_strategy`);
    
    // Step 4: Generate Enhanced Smart Blocks - GPT-5 venue planner
    console.log(`[SMART-BLOCKS] 🎯 Generating enhanced smart blocks with GPT-5 venue planner...`);
    try {
      const { generateEnhancedSmartBlocks } = await import('./enhanced-smart-blocks.js');
      await generateEnhancedSmartBlocks({
        snapshotId,
        strategy: consolidated.strategy,
        snapshot: {
          ...snapshot,
          formatted_address: user_address,
          city,
          state,
          lat,
          lng
        },
        user_id
      });
      console.log(`[SMART-BLOCKS] ✅ Enhanced smart blocks generated and saved`);
    } catch (blocksErr) {
      console.error(`[SMART-BLOCKS] ⚠️ Failed to generate blocks (non-blocking):`, blocksErr.message);
      // Don't fail the entire pipeline if blocks generation fails
    }
    
    return { ok: true };
  } catch (err) {
    console.error(`[SIMPLE-STRATEGY] ❌ Pipeline failed:`, err.message);
    await db.update(strategies).set({
      error_message: `[simple-strategy] ${err.message?.slice(0, 800)}`,
      status: 'failed',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    return { ok: false, reason: err.message };
  }
}

/**
 * GPT-5 consolidation - called by event-driven worker
 */
export async function consolidateStrategy({ snapshotId, claudeStrategy, geminiNews, geminiEvents, geminiTraffic, user, snapshot, holiday }) {
  console.log(`[consolidation] Starting GPT-5 consolidation for snapshot ${snapshotId}`);

  try {
    const consolidated = await consolidateWithGPT5Thinking({
      plan: claudeStrategy,
      events: geminiEvents || [],
      news: geminiNews || [],
      traffic: geminiTraffic || [],
      snapshot: snapshot || {},
      holiday: holiday || null
    });

    if (!consolidated.ok) {
      throw new Error(consolidated.reason || 'GPT-5 consolidation failed');
    }

    await db.update(strategies).set({
      consolidated_strategy: consolidated.strategy || '',  // GENERIC: model-agnostic column
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[consolidation] ✅ Consolidation complete (${consolidated.strategy.length} chars)`);
    return { ok: true };
  } catch (err) {
    console.error(`[consolidation] ❌ Failed:`, err.message);
    await db.update(strategies).set({
      error_message: `[gpt5] ${err.message?.slice(0, 800)}`,
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    return { ok: false, reason: err.message };
  }
}

/**
 * Legacy main function - kept for backwards compatibility
 */
export async function generateMultiStrategy(ctx) {
  const startTime = Date.now();
  
  // Feature flag check
  if (!MULTI_STRATEGY_ENABLED) {
    console.log('[parallel-strategy] Feature disabled (multi_strategy_enabled=false)');
    return { ok: false, reason: 'feature_disabled' };
  }

  const { snapshotId, userId, userAddress, city, state, snapshot } = ctx;
  const strategyId = randomUUID();

  console.log(`[parallel-strategy] Starting parallel orchestration for snapshot ${snapshotId}`);

  // PARALLEL EXECUTION: Claude (core plan) + Gemini (feeds)
  const [claude, gemini] = await Promise.allSettled([
    callClaudeCore({ snapshotId, userAddress, city, state, snapshot }),
    callGeminiFeeds({ userAddress, city, state })
  ]);

  const claudeOk = claude.status === 'fulfilled' && claude.value?.ok;
  const geminiOk = gemini.status === 'fulfilled' && gemini.value?.ok;

  // HARD FAIL: Claude is required
  if (!claudeOk) {
    const reason = claude.value?.reason || 'claude_failed';
    console.error(`[parallel-strategy] Claude failed: ${reason}`);
    return {
      ok: false,
      reason,
      audits: {
        claude_call: 'fail',
        gemini_call: geminiOk ? 'ok' : 'fail',
        gpt5_consolidation: 'not_attempted',
        db_insert: 'not_attempted'
      }
    };
  }

  // SOFT FAIL: Gemini is optional - use empty arrays if it fails
  const plan = claude.value.plan;
  const events = geminiOk ? gemini.value.events : [];
  const news = geminiOk ? gemini.value.news : [];
  const traffic = geminiOk ? gemini.value.traffic : [];

  console.log(`[parallel-strategy] Claude: ${plan.substring(0, 100)}...`);
  console.log(`[parallel-strategy] Gemini: events=${events.length} news=${news.length} traffic=${traffic.length}`);

  // GPT-5 CONSOLIDATION
  const consolidated = await consolidateWithGPT5Thinking({ plan, events, news, traffic });

  if (!consolidated.ok) {
    console.error(`[parallel-strategy] GPT-5 consolidation failed: ${consolidated.reason}`);
    return {
      ok: false,
      reason: 'consolidation_failed',
      audits: {
        claude_call: 'ok',
        gemini_call: geminiOk ? 'ok' : 'fail',
        gpt5_consolidation: 'fail',
        db_insert: 'not_attempted'
      }
    };
  }

  // PERSIST TO DB
  const save = await saveStrategy({
    snapshot_id: snapshotId,
    user_id: userId,
    user_address: userAddress,
    city,
    state,
    lat: snapshot.lat,
    lng: snapshot.lng,
    events,
    news,
    traffic,
    consolidated_strategy: consolidated.strategy
  });

  if (!save.ok) {
    console.error(`[parallel-strategy] DB insert failed: ${save.reason}`);
    return {
      ok: false,
      reason: 'db_insert_failed',
      audits: {
        claude_call: 'ok',
        gemini_call: geminiOk ? 'ok' : 'fail',
        gpt5_consolidation: 'ok',
        db_insert: 'fail'
      }
    };
  }

  const totalMs = Date.now() - startTime;
  console.log(`[parallel-strategy] ✅ Complete in ${totalMs}ms`);

  return {
    ok: true,
    strategyId,
    strategy: consolidated.strategy,
    audits: {
      claude_call: 'ok',
      gemini_call: geminiOk ? 'ok' : 'fail',
      gpt5_consolidation: 'ok',
      db_insert: 'ok'
    },
    timing: {
      total_ms: totalMs
    }
  };
}
