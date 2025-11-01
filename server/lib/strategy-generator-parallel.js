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
 * NEW ARCHITECTURE: Run minstrategy + briefing providers in parallel
 * Each provider writes to its own model-agnostic column
 * Then triggers consolidation
 */
export async function runSimpleStrategyPipeline({ snapshotId, userId, userAddress, city, state, lat, lng, snapshot }) {
  console.log(`[runSimpleStrategyPipeline] Starting for snapshot ${snapshotId}`);
  
  try {
    // Ensure strategy row exists
    const [existing] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    if (!existing) {
      console.log(`[runSimpleStrategyPipeline] Creating initial strategy row for ${snapshotId}`);
      await db.insert(strategies).values({
        snapshot_id: snapshotId,
        user_id: userId,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date()
      });
    }
    
    // Import providers
    const { runMinStrategy } = await import('./providers/minstrategy.js');
    const { runBriefing } = await import('./providers/briefing.js');
    
    // Run both providers in parallel
    console.log(`[runSimpleStrategyPipeline] 🚀 Running minstrategy + briefing in parallel...`);
    const [minResult, briefingResult] = await Promise.allSettled([
      runMinStrategy(snapshotId),
      runBriefing(snapshotId)
    ]);
    
    if (minResult.status === 'rejected') {
      console.error(`[runSimpleStrategyPipeline] ❌ Minstrategy failed:`, minResult.reason?.message || minResult.reason);
    } else {
      console.log(`[runSimpleStrategyPipeline] ✅ Minstrategy complete`);
    }
    
    if (briefingResult.status === 'rejected') {
      console.error(`[runSimpleStrategyPipeline] ❌ Briefing failed:`, briefingResult.reason?.message || briefingResult.reason);
    } else {
      console.log(`[runSimpleStrategyPipeline] ✅ Briefing complete`);
    }
    
    // Check if at least one succeeded
    if (minResult.status === 'rejected' && briefingResult.status === 'rejected') {
      throw new Error('Both minstrategy and briefing providers failed');
    }
    
    // Fetch updated strategy row to get provider outputs
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    // Import validation helper
    const { hasRenderableBriefing } = await import('./strategy-utils.js');
    
    // Check if we have valid data for consolidation
    const hasMin = !!strategyRow.minstrategy && strategyRow.minstrategy.length > 0;
    const hasBriefing = hasRenderableBriefing(strategyRow.briefing);
    
    console.log(`[runSimpleStrategyPipeline] 📊 Consolidation inputs: minstrategy=${hasMin}, briefing=${hasBriefing}`);
    
    // Run consolidation if both fields exist
    if (hasMin && hasBriefing) {
      console.log(`[runSimpleStrategyPipeline] 🤖 Running GPT-5 consolidation...`);
      const { consolidateStrategy } = await import('./strategy-generator-parallel.js');
      await consolidateStrategy({
        snapshotId,
        claudeStrategy: strategyRow.minstrategy,
        briefing: strategyRow.briefing,
        snapshot,
        user: { userId, userAddress, city, state, lat, lng }
      });
    } else {
      console.warn(`[runSimpleStrategyPipeline] ⚠️ Skipping consolidation - missing data (minstrategy=${hasMin}, briefing=${hasBriefing})`);
      await db.update(strategies).set({
        status: 'running',
        error_message: `Waiting for ${!hasMin ? 'minstrategy' : 'briefing'} data`,
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
    }
    
    return { ok: true };
  } catch (err) {
    console.error(`[runSimpleStrategyPipeline] ❌ Pipeline failed:`, err.message);
    await db.update(strategies).set({
      error_message: `[simple-strategy] ${err.message?.slice(0, 800)}`,
      status: 'failed',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    return { ok: false, reason: err.message };
  }
}

/**
 * OLD ARCHITECTURE: Parallel provider writes - each lands independently
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
 * Includes retry logic with reduced max_tokens and fallback synthesis
 */
export async function consolidateStrategy({ snapshotId, claudeStrategy, briefing, user, snapshot, holiday }) {
  console.log(`[consolidation] Starting GPT-5 consolidation for snapshot ${snapshotId}`);

  try {
    // Extract briefing fields from single JSONB object
    const events = briefing?.events || [];
    const news = briefing?.news || [];
    const traffic = briefing?.traffic || [];
    const holidays = briefing?.holidays || [];
    
    // Retry logic with progressively reduced max_tokens
    const attempts = 3;
    const maxTokensSequence = [900, 600, 450]; // Reduced from 2000 to avoid length truncation
    let lastError = null;
    let finishReason = null;
    
    for (let i = 0; i < attempts; i++) {
      const maxTokens = maxTokensSequence[i];
      console.log(`[consolidation] Attempt ${i + 1}/${attempts} with max_tokens=${maxTokens}`);
      
      try {
        const consolidated = await consolidateWithGPT5ThinkingWithMetadata({
          plan: claudeStrategy,
          events,
          news,
          traffic,
          briefing,
          snapshot: snapshot || {},
          holiday: holiday || (holidays.length > 0 ? holidays[0] : null),
          maxTokens
        });

        finishReason = consolidated.finishReason;
        
        // Success: content present
        if (consolidated.ok && consolidated.strategy && consolidated.strategy.trim().length > 0) {
          await db.update(strategies).set({
            consolidated_strategy: consolidated.strategy,
            status: 'ok',
            updated_at: new Date()
          }).where(eq(strategies.snapshot_id, snapshotId));
          
          console.log(`[consolidation] ✅ Consolidation complete on attempt ${i + 1} (${consolidated.strategy.length} chars)`);
          return { ok: true };
        }
        
        // Length truncation - retry with smaller max_tokens
        if (finishReason === 'length') {
          lastError = new Error(`Consolidation truncated with finish_reason: length`);
          console.warn(`[consolidation] ⚠️ Attempt ${i + 1} truncated (finish_reason=length), retrying with reduced tokens...`);
          continue;
        }
        
        // Other failure - break retry loop
        lastError = new Error(consolidated.reason || 'No content from consolidator');
        break;
        
      } catch (attemptErr) {
        lastError = attemptErr;
        console.error(`[consolidation] Attempt ${i + 1} error:`, attemptErr.message);
        if (i < attempts - 1) continue;
        break;
      }
    }
    
    // All retries failed - synthesize fallback strategy
    console.warn(`[consolidation] ⚠️ All consolidation attempts failed, synthesizing fallback...`);
    const { synthesizeFallback } = await import('./strategy-utils.js');
    const fallbackStrategy = synthesizeFallback(claudeStrategy, briefing);
    
    await db.update(strategies).set({
      consolidated_strategy: fallbackStrategy,
      status: 'ok_partial',  // Differentiate from full consolidation
      error_message: `Fallback used: ${lastError?.message || 'Unknown error'}`,
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    
    console.log(`[consolidation] ⚠️ Fallback strategy synthesized (${fallbackStrategy.length} chars) - status: ok_partial`);
    return { ok: true, partial: true, reason: lastError?.message };
    
  } catch (err) {
    console.error(`[consolidation] ❌ Failed:`, err.message);
    await db.update(strategies).set({
      error_message: `[gpt5] ${err.message?.slice(0, 800)}`,
      status: 'error',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    return { ok: false, reason: err.message };
  }
}

/**
 * Call GPT-5 with metadata (finish_reason, tokens, etc.)
 */
async function consolidateWithGPT5ThinkingWithMetadata({ plan, events, news, traffic, briefing, snapshot, holiday, maxTokens = 900 }) {
  try {
    // Format date and time context
    const currentTime = snapshot?.created_at ? new Date(snapshot.created_at) : new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = dayNames[currentTime.getDay()];
    const monthName = monthNames[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    const year = currentTime.getFullYear();
    
    const timeStr = currentTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: snapshot?.timezone || 'America/Chicago'
    });
    
    const formattedDateTime = `${dayName}, ${monthName} ${dayNum}, ${year} at ${timeStr}`;
    const marketArea = snapshot?.city && snapshot?.state ? `${snapshot.city}, ${snapshot.state}` : 'local';
    
    // Compress inputs to reduce token usage
    const topEvents = (events || []).slice(0, 6);
    const topNews = (news || []).slice(0, 4);
    const topTraffic = (traffic || []).slice(0, 3);
    const topHolidays = (briefing?.holidays || []).slice(0, 2);
    
    const developerPrompt = `You are a rideshare strategy consolidator for the ${marketArea} market. Create concise, actionable positioning advice in 3-5 sentences. Keep under 350 tokens. Be specific about timing and location.`;
    
    const airportInfo = snapshot?.airport_context 
      ? `${snapshot.airport_context.airport_code || 'DFW'} (${snapshot.airport_context.distance_miles || '?'} mi)${snapshot.airport_context.has_delays ? ' - DELAYS' : ''}`
      : 'No airport data';
    
    const userPrompt = `DATE: ${formattedDateTime}${holiday ? `\n🎉 HOLIDAY: ${holiday}` : ''}
TIME: ${snapshot?.day_part_key || 'unknown'}

LOCATION: ${snapshot?.formatted_address || 'unknown'}
WEATHER: ${snapshot?.weather?.tempF || '?'}°F, ${snapshot?.weather?.conditions || 'unknown'}
AIRPORT: ${airportInfo}

INTELLIGENCE:
${holiday ? `Holiday: ${holiday}\n` : ''}Events: ${topEvents.join('; ') || 'none'}
News: ${topNews.join('; ') || 'none'}
Traffic: ${topTraffic.join('; ') || 'none'}

TACTICAL ANALYSIS:
${plan || 'No analysis available'}

Consolidate into 3-5 actionable sentences for the driver's next hour.`;
    
    // Call GPT-5 with custom max_tokens
    const result = await callGPT5({
      developer: developerPrompt,
      user: userPrompt,
      max_completion_tokens: maxTokens,
      reasoning_effort: 'medium'
    });
    
    // Note: We can't directly access finish_reason from the adapter
    // The adapter throws on empty content, so if we get here, content exists
    return {
      ok: true,
      strategy: result.text.trim(),
      finishReason: 'stop' // Assume stop if we got content
    };
  } catch (err) {
    // Check if error message indicates truncation
    const isLengthTruncation = err.message?.includes('No content in completion response');
    return {
      ok: false,
      reason: err.message || 'consolidation_failed',
      finishReason: isLengthTruncation ? 'length' : 'error'
    };
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
