// server/lib/strategy-generator-parallel.js
// Parallel multi-model strategy orchestration: Model-agnostic role-based pipeline
import { randomUUID } from 'crypto';
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { callModel } from '../ai/adapters/index.js';
import { validateConditions } from '../location/weather-traffic-validator.js';

// Feature flag - set to true to enable parallel orchestration
const MULTI_STRATEGY_ENABLED = process.env.MULTI_STRATEGY_ENABLED === 'true';

/**
 * Call Claude for core strategic plan (no venues)
 */
async function callClaudeCore({ snapshotId, userAddress, city, state, snapshot }) {
  try {
    const systemPrompt = `You are a senior rideshare strategist. Analyze the driver's location, time, and conditions to provide strategic positioning advice. Focus on general patterns: time-of-day demand, weather impact, typical hotspots for this area. Return a 3-5 sentence strategy ONLY.`;

    const userPrompt = `Driver Location: ${userAddress || 'unknown'}
City: ${city || 'unknown'}, ${state || 'unknown'}
Time: ${snapshot.day_part_key || 'unknown'} on ${snapshot.dow !== null ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][snapshot.dow] : 'unknown'}
Weather: ${snapshot.weather?.tempF || 'unknown'}°F, ${snapshot.weather?.conditions || 'unknown'}
Air Quality: AQI ${snapshot.air?.aqi || 'unknown'}

Provide strategic positioning advice for a rideshare driver right now.`;

    const result = await callModel("strategist", {
      system: systemPrompt,
      user: userPrompt
    });

    if (!result.ok) {
      return { ok: false, reason: 'strategist_failed' };
    }

    return {
      ok: true,
      plan: result.output.trim()
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

    const result = await callModel("briefer", {
      system: systemPrompt,
      user: userPrompt
    });

    if (!result.ok) {
      return { ok: false, events: [], news: [], traffic: [], reason: 'briefer_failed' };
    }

    // Robust JSON parsing with fallback to empty arrays
    let parsed;
    try {
      parsed = JSON.parse(result.output);
    } catch (parseErr) {
      console.warn(`[parallel-strategy] JSON parse failed, trying to extract:`, result.output?.substring(0, 200));
      // Try to extract JSON from markdown or text
      const jsonMatch = result.output?.match(/\{[\s\S]*\}/);
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
 * Call GPT-5 to consolidate strategist + briefer outputs
 * ROLE-PURE: Only receives address + strategist output + briefer output
 */
async function consolidateWithGPT5Thinking({ plan, briefing, userAddress, city, state }) {
  try {
    const developerPrompt = `You are a rideshare strategy consolidator.
Merge the strategist's initial plan with the briefer's real-time intelligence into one final actionable strategy for the driver's current location.
Keep it 3–5 sentences, urgent, time-aware, and specific. Reference the precise location in your analysis.`;

    const userPrompt = `DRIVER'S PRECISE LOCATION:
Address: ${userAddress || 'Unknown location'}
City: ${city || 'Unknown'}, ${state || 'Unknown'}

STRATEGIST OUTPUT:
${plan || 'No strategist output'}

BRIEFER OUTPUT:
${briefing ? JSON.stringify(briefing, null, 2) : 'No briefer output'}

Task: Merge these into a final consolidated strategy considering the driver's specific address and local conditions.`;

    const result = await callModel("consolidator", {
      system: developerPrompt,
      user: userPrompt
    });

    if (!result.ok) {
      const errorMsg = result.error || 'consolidator_failed';
      console.error(`[consolidate] Model call failed:`, errorMsg);
      return { ok: false, reason: errorMsg };
    }

    return {
      ok: true,
      strategy: result.output.trim()
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
    // Build dynamic model name from environment variables
    const strategist = process.env.STRATEGY_STRATEGIST || 'unknown';
    const briefer = process.env.STRATEGY_BRIEFER || 'unknown';
    const consolidator = process.env.STRATEGY_CONSOLIDATOR || 'unknown';
    const modelName = `${strategist}→${briefer}→${consolidator}`;

    // CRITICAL: Use onConflictDoNothing to preserve the FIRST insert with model_name
    // If row already exists (race condition), don't overwrite - first writer wins
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
      model_name: modelName,
      created_at: new Date(),
      updated_at: new Date()
    }).onConflictDoNothing();

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
  try {
    // Build dynamic model name from environment variables (full 3-step chain)
    const strategist = process.env.STRATEGY_STRATEGIST || 'unknown';
    const briefer = process.env.STRATEGY_BRIEFER || 'unknown';
    const consolidator = process.env.STRATEGY_CONSOLIDATOR || 'unknown';
    const fullModelChain = `${strategist}→${briefer}→${consolidator}`;
    
    // GLOBAL DEDUPLICATION: Check if strategy already running for this snapshot
    const [existingStrategy] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    if (existingStrategy && existingStrategy.status === 'running') {
      const elapsedMs = Date.now() - new Date(existingStrategy.updated_at).getTime();
      if (elapsedMs < 30000) { // Less than 30 seconds old
        console.log(`[strategy-pipeline] 🛑 Strategy already running for ${snapshotId} (${elapsedMs}ms old), aborting duplicate run`);
        return { ok: true, status: 'deduplicated', reason: 'strategy_already_running' };
      }
    }

    // Create initial strategy row with model_name - ensures exactly ONE row per snapshot
    // Using onConflictDoNothing to handle race conditions (first writer wins)
    const [insertedStrategy] = await db.insert(strategies).values({
      snapshot_id: snapshotId,
      user_id: userId,
      status: 'pending',
      model_name: fullModelChain,
      created_at: new Date(),
      updated_at: new Date()
    }).onConflictDoNothing().returning();
    
    // If row already existed, another process is handling it
    if (!insertedStrategy) {
      console.log(`[strategy-pipeline] 🛑 Another process already handling strategy for ${snapshotId}, aborting`);
      return { ok: true, status: 'deduplicated', reason: 'race_condition_detected' };
    }
    
    // Set status to running to mark this process as active
    await db.update(strategies).set({
      status: 'running',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    
    // Import providers
    const { runMinStrategy } = await import('./providers/minstrategy.js');
    const { runBriefing } = await import('./providers/briefing.js');
    
    // Run minstrategy and briefing providers in parallel
    // Briefing uses Gemini 3.0 Pro with Google Search for events, traffic, news
    const [minResult, briefingResult] = await Promise.allSettled([
      runMinStrategy(snapshotId),
      runBriefing(snapshotId)
    ]);
    
    // Log briefing result
    if (briefingResult.status === 'rejected') {
      console.warn(`[strategy-pipeline] Briefing generation failed (non-blocking):`, briefingResult.reason?.message);
    } else {
      console.log(`[strategy-pipeline] ✅ Briefing generated successfully for ${snapshotId}`);
    }
    
    // Check results - briefing failure is non-blocking
    const minFailed = minResult?.status === 'rejected';
    
    if (minFailed) {
      console.error(`[strategy-pipeline] Minstrategy failed:`, minResult.reason?.message || minResult.reason);
    }
    
    // Strategist is required
    if (minFailed) {
      throw new Error('Strategist provider failed');
    }
    
    // Fetch updated strategy row to get strategist output
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    // Check if we have strategist output for consolidation
    const hasMin = !!strategyRow.minstrategy && strategyRow.minstrategy.length > 0;
    
    // Run consolidation if strategist output exists
    if (hasMin) {
      const { runConsolidator } = await import('./providers/consolidator.js');
      
      try {
        await runConsolidator(snapshotId);
      } catch (consolidatorErr) {
        console.error(`[strategy-pipeline] Consolidator failed:`, consolidatorErr.message);
        
        // Use strategist output as fallback if consolidator fails
        await db.update(strategies).set({
          consolidated_strategy: strategyRow.minstrategy,
          status: 'ok_partial',
          error_message: `Fallback: ${consolidatorErr.message}`,
          updated_at: new Date()
        }).where(eq(strategies.snapshot_id, snapshotId));
      }
    } else {
      await db.update(strategies).set({
        status: 'running',
        error_message: 'Waiting for strategist',
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
    }
    
    return { ok: true };
  } catch (err) {
    console.error(`[strategy-pipeline] Failed:`, err.message);
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
    // CRITICAL: Validate weather and traffic conditions FIRST - reject bad strategies early
    console.log(`[consolidation] Validating weather and traffic conditions...`);
    const conditions = await validateConditions(snapshot);
    
    if (!conditions.valid) {
      console.warn(`[consolidation] ❌ REJECTING STRATEGY - Bad conditions detected:`, {
        weather: conditions.weather,
        traffic: conditions.traffic,
        reason: conditions.rejectionReason
      });
      
      await db.update(strategies).set({
        consolidated_strategy: null,
        status: 'rejected',
        error_message: `Strategy rejected due to unsafe conditions: ${conditions.rejectionReason}`,
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
      
      return { ok: false, reason: 'bad_conditions', details: conditions };
    }
    
    console.log(`[consolidation] ✅ Weather and traffic conditions validated - proceeding with strategy`);
    
    // Extract briefing fields from single JSONB object
    let events = briefing?.events || [];
    const news = briefing?.news || [];
    const traffic = briefing?.traffic || [];
    const holidays = briefing?.holidays || [];
    
    // BONUS: Include verified venue events in strategy context for higher demand awareness
    // Events from enrichment verification are high-confidence and relevant to tactics
    if (events.length === 0) {
      console.log(`[consolidation] 📅 No events in briefing - checking for venue events from enrichment...`);
    } else {
      console.log(`[consolidation] 📅 Using ${events.length} events from briefing`);
    }
    
    // Retry logic with progressively reduced max_tokens
    const attempts = 3;
    const maxTokensSequence = [900, 600, 450]; // Reduced from 2000 to avoid length truncation
    let lastError = null;
    let finishReason = null;
    
    for (let i = 0; i < attempts; i++) {
      const maxTokens = maxTokensSequence[i];
      console.log(`[consolidation] Attempt ${i + 1}/${attempts} with max_tokens=${maxTokens}`);
      
      try {
        const consolidated = await consolidateWithGPT5Thinking({
          plan: claudeStrategy,
          briefing: briefing,
          userAddress: user?.user_address || snapshot?.formatted_address || 'Unknown location',
          city: snapshot?.city,
          state: snapshot?.state
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

// Old consolidateWithGPT5ThinkingWithMetadata function DELETED - replaced with role-pure consolidateWithGPT5Thinking

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
