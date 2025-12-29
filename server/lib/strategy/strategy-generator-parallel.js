// server/lib/strategy-generator-parallel.js
// Parallel multi-model strategy orchestration: Model-agnostic role-based pipeline
import { randomUUID } from 'crypto';
import { db } from '../../db/drizzle.js';
import { snapshots, strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { callModel } from '../ai/adapters/index.js';
import { validateConditions } from '../location/weather-traffic-validator.js';
import { triadLog, aiLog, dbLog, briefingLog, OP } from '../../logger/workflow.js';
// Dump last strategy row to file for debugging
import { dumpLastStrategyRow } from './dump-last-strategy.js';

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
    triadLog.error(1, `Strategist call failed`, err, OP.AI);
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
      triadLog.warn(2, `Briefer JSON parse failed, extracting...`, OP.AI);
      // Try to extract JSON from markdown or text
      const jsonMatch = result.output?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        triadLog.warn(2, `No valid JSON from Briefer, using empty arrays`, OP.AI);
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
    triadLog.error(2, `Briefer feeds call failed`, err, OP.AI);
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
      triadLog.error(3, `Consolidator failed: ${errorMsg}`, null, OP.AI);
      return { ok: false, reason: errorMsg };
    }

    return {
      ok: true,
      strategy: result.output.trim()
    };
  } catch (err) {
    triadLog.error(3, `Consolidator failed`, err, OP.AI);
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
    // Set phase='complete' explicitly to avoid NULL phase issues in production
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
      phase: 'complete',
      model_name: modelName,
      created_at: new Date(),
      updated_at: new Date()
    }).onConflictDoNothing();

    return { ok: true };
  } catch (err) {
    triadLog.error(4, `DB save failed`, err, OP.DB);
    return { ok: false, reason: err.message || 'db_insert_failed' };
  }
}

/**
 * NEW ARCHITECTURE: Briefing + Immediate Strategy (NO minstrategy)
 * 1. Run briefing provider (Gemini) to get events, traffic, news
 * 2. Run immediate strategy (GPT-5.2) with snapshot + briefing
 *
 * Daily consolidated_strategy is user-request only (not part of this pipeline)
 */
export async function runSimpleStrategyPipeline({ snapshotId, userId, snapshot }) {
  try {
    // Build model name for audit trail
    const briefer = process.env.STRATEGY_BRIEFER || 'gemini-3-pro';
    const immediateModel = 'gpt-5.2';
    const modelChain = `${briefer}→${immediateModel}`;

    // GLOBAL DEDUPLICATION: Check if strategy already running for this snapshot
    const [existingStrategy] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    if (existingStrategy && existingStrategy.status === 'running') {
      const elapsedMs = Date.now() - new Date(existingStrategy.updated_at).getTime();
      if (elapsedMs < 30000) { // Less than 30 seconds old
        triadLog.info(`Strategy already running for ${snapshotId.slice(0, 8)} (${elapsedMs}ms old), skipping`);
        return { ok: true, status: 'deduplicated', reason: 'strategy_already_running' };
      }
    }

    // Create initial strategy row - ensures exactly ONE row per snapshot
    // CRITICAL: Set phase='starting' on insert to avoid NULL phase race condition in prod
    const [insertedStrategy] = await db.insert(strategies).values({
      snapshot_id: snapshotId,
      user_id: userId,
      status: 'running',
      phase: 'starting',
      model_name: modelChain,
      created_at: new Date(),
      updated_at: new Date()
    }).onConflictDoNothing().returning();

    // If row already existed, another process is handling it
    if (!insertedStrategy) {
      triadLog.info(`Another process already handling strategy for ${snapshotId.slice(0, 8)}, skipping`);
      return { ok: true, status: 'deduplicated', reason: 'race_condition_detected' };
    }

    triadLog.start(`${snapshotId.slice(0, 8)} (${snapshot.city}, ${snapshot.state})`);
    triadLog.phase(1, `Location: ${snapshot.formatted_address}`);

    // Phase: resolving - location context ready
    await db.update(strategies).set({
      phase: 'resolving',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    // Step 1: Run briefing provider (events, traffic, news)
    const { runBriefing } = await import('./providers/briefing.js');

    // Phase: analyzing - briefing/context gathering
    await db.update(strategies).set({
      phase: 'analyzing',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    try {
      triadLog.ai(2, 'Briefer', `events/traffic/news`);
      await runBriefing(snapshotId, { snapshot });
      triadLog.done(2, `Briefing generated`, OP.AI);
    } catch (briefingErr) {
      triadLog.warn(2, `Briefing failed (non-blocking): ${briefingErr.message}`, OP.AI);
      // Continue - immediate strategy can still work with snapshot weather data
    }

    // Step 2: Run immediate strategy (GPT-5.2 with snapshot + briefing)
    const { runImmediateStrategy } = await import('../ai/providers/consolidator.js');

    // Phase: immediate - AI strategy generation
    await db.update(strategies).set({
      phase: 'immediate',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    try {
      triadLog.ai(3, 'Consolidator', `immediate strategy`);
      await runImmediateStrategy(snapshotId, { snapshot });
      triadLog.done(3, `Immediate strategy generated`, OP.AI);
    } catch (immediateErr) {
      triadLog.error(3, `Immediate strategy failed`, immediateErr, OP.AI);
      throw immediateErr;
    }

    // Phase: venues - strategy ready, moving to venue generation
    await db.update(strategies).set({
      phase: 'venues',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    return { ok: true };
  } catch (err) {
    triadLog.error(4, `Pipeline failed`, err);
    await db.update(strategies).set({
      error_message: err.message?.slice(0, 800),
      status: 'failed',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    return { ok: false, reason: err.message };
  }
}

// NOTE: consolidateStrategy function REMOVED Dec 2025 - dead code
// The active pipeline uses runImmediateStrategy from consolidator.js instead

/**
 * Legacy main function - kept for backwards compatibility
 */
export async function generateMultiStrategy(ctx) {
  const startTime = Date.now();

  // Feature flag check
  if (!MULTI_STRATEGY_ENABLED) {
    triadLog.info(`Multi-strategy feature disabled`);
    return { ok: false, reason: 'feature_disabled' };
  }

  const { snapshotId, userId, userAddress, city, state, snapshot } = ctx;
  const strategyId = randomUUID();

  triadLog.start(`${snapshotId.slice(0, 8)} (parallel orchestration)`);

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
    triadLog.error(1, `Strategist failed: ${reason}`, null, OP.AI);
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

  triadLog.done(1, `Strategist: ${plan.substring(0, 80)}...`, OP.AI);
  triadLog.done(2, `Briefer: events=${events.length} news=${news.length} traffic=${traffic.length}`, OP.AI);

  // GPT-5 CONSOLIDATION
  const consolidated = await consolidateWithGPT5Thinking({ plan, events, news, traffic });

  if (!consolidated.ok) {
    triadLog.error(3, `Consolidation failed: ${consolidated.reason}`, null, OP.AI);
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
    triadLog.error(4, `DB insert failed: ${save.reason}`, null, OP.DB);
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
  triadLog.complete(`${snapshot.city}, ${snapshot.state}`, OP.DB);

    // Dump last strategy row to file for debugging
    dumpLastStrategyRow().catch(err => 
      console.warn(`[Strategy] ⚠️ Failed to dump strategy: ${err.message}`)
    );

    return {
      ok: true,
      strategy: consolidated.strategy
    };
  }

  triadLog.complete(`Parallel orchestration complete`, totalMs);

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