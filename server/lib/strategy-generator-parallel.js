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

    const parsed = JSON.parse(result);
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
async function consolidateWithGPT5Thinking({ plan, events, news, traffic }) {
  try {
    const developerPrompt = `You are a rideshare strategy consolidator. Combine Claude's strategic plan with Gemini's real-time intelligence (events, news, traffic) into a single cohesive 3-5 sentence strategy. Keep it conversational, urgent, and action-oriented.`;

    const userPrompt = `CLAUDE STRATEGIC PLAN:
${plan}

GEMINI REAL-TIME INTELLIGENCE:
Events: ${events.length > 0 ? events.join('; ') : 'none'}
News: ${news.length > 0 ? news.join('; ') : 'none'}
Traffic: ${traffic.length > 0 ? traffic.join('; ') : 'none'}

Consolidate into a single strategy that naturally integrates the intelligence into the strategic analysis.`;

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
  const { lat, lng, city, state, user_address } = user;

  console.log(`[parallel-providers] Starting independent writes for snapshot ${snapshotId}`);

  // Fire both providers concurrently, let them resolve independently
  const claudePromise = callClaudeCore({ 
    snapshotId, 
    userAddress: user_address, 
    city, 
    state, 
    snapshot 
  }).then(async (result) => {
    try {
      if (result.ok) {
        await db
          .update(strategies)
          .set({
            claude_strategy: result.plan || null,
            lat, lng, city, state, user_address,
            status: 'partial',
            updated_at: new Date(),
          })
          .where(eq(strategies.snapshot_id, snapshotId));
        console.log(`[parallel-providers] ✅ Claude strategy written (${result.plan.length} chars)`);
      } else {
        throw new Error(result.reason || 'Claude call failed');
      }
    } catch (err) {
      await db.update(strategies).set({
        error_message: `[claude] ${err.message?.slice(0, 800)}`,
        status: 'partial',
        updated_at: new Date(),
      }).where(eq(strategies.snapshot_id, snapshotId));
      console.error(`[parallel-providers] ❌ Claude write failed:`, err.message);
    }
  }).catch(async (err) => {
    await db.update(strategies).set({
      error_message: `[claude] ${err.message?.slice(0, 800)}`,
      status: 'partial',
      updated_at: new Date(),
    }).where(eq(strategies.snapshot_id, snapshotId));
    console.error(`[parallel-providers] ❌ Claude promise rejected:`, err.message);
  });

  const geminiPromise = callGeminiFeeds({ 
    userAddress: user_address, 
    city, 
    state 
  }).then(async (result) => {
    try {
      if (result.ok) {
        await db
          .update(strategies)
          .set({
            gemini_news: result.news ?? [],
            gemini_events: result.events ?? [],
            gemini_traffic: result.traffic ?? [],
            lat, lng, city, state, user_address,
            status: 'partial',
            updated_at: new Date(),
          })
          .where(eq(strategies.snapshot_id, snapshotId));
        console.log(`[parallel-providers] ✅ Gemini feeds written (news=${result.news.length}, events=${result.events.length}, traffic=${result.traffic.length})`);
      } else {
        throw new Error(result.reason || 'Gemini call failed');
      }
    } catch (err) {
      await db.update(strategies).set({
        error_message: `[gemini] ${err.message?.slice(0, 800)}`,
        status: 'partial',
        updated_at: new Date(),
      }).where(eq(strategies.snapshot_id, snapshotId));
      console.error(`[parallel-providers] ❌ Gemini write failed:`, err.message);
    }
  }).catch(async (err) => {
    await db.update(strategies).set({
      error_message: `[gemini] ${err.message?.slice(0, 800)}`,
      status: 'partial',
      updated_at: new Date(),
    }).where(eq(strategies.snapshot_id, snapshotId));
    console.error(`[parallel-providers] ❌ Gemini promise rejected:`, err.message);
  });

  // Don't await - let them resolve independently
  // The LISTEN/NOTIFY trigger will fire consolidation when all fields present
  return { ok: true, note: 'Parallel writes initiated, consolidation will be triggered by db event' };
}

/**
 * GPT-5 consolidation - called by event-driven worker
 */
export async function consolidateStrategy({ snapshotId, claudeStrategy, geminiNews, geminiEvents, geminiTraffic, user }) {
  console.log(`[consolidation] Starting GPT-5 consolidation for snapshot ${snapshotId}`);

  try {
    const consolidated = await consolidateWithGPT5Thinking({
      plan: claudeStrategy,
      events: geminiEvents || [],
      news: geminiNews || [],
      traffic: geminiTraffic || []
    });

    if (!consolidated.ok) {
      throw new Error(consolidated.reason || 'GPT-5 consolidation failed');
    }

    await db.update(strategies).set({
      gpt5_consolidated: consolidated.strategy || '',
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[consolidation] ✅ GPT-5 consolidated (${consolidated.strategy.length} chars)`);
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
