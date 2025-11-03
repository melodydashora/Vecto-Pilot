// server/lib/providers/consolidator.js
// Consolidator provider - GPT-5 with reasoning + web search
// NEW ARCHITECTURE: Does briefing research AND consolidation in one step
// Takes strategist output + full snapshot context, does web research, consolidates

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callModel } from '../adapters/index.js';

/**
 * Run consolidation using GPT-5 reasoning mode with web search
 * Fetches strategist output from DB, does briefing research, consolidates
 * Writes to strategies.consolidated_strategy
 * 
 * NEW ARCHITECTURE: 2-step pipeline
 * - Input: { snapshotId } only
 * - DB reads: strategies table (strategist) + snapshots table (full context)
 * - AI does: Briefing research (traffic/news/construction) + consolidation
 * - Output: consolidated_strategy + metadata
 * 
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runConsolidator(snapshotId) {
  const startTime = Date.now();
  console.log(`[consolidator] 🚀 Starting GPT-5 reasoning + web search for snapshot ${snapshotId}`);
  
  try {
    // Step 1: Fetch strategy row to get strategist output
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    if (!strategyRow) {
      throw new Error(`Strategy row not found for snapshot ${snapshotId}`);
    }
    
    // IDEMPOTENCE: If already consolidated with status=ok, skip
    if (strategyRow.consolidated_strategy && strategyRow.status === 'ok') {
      console.log(`[consolidator] ⏭️  Already consolidated (status=ok) - skipping duplicate run for ${snapshotId}`);
      return { ok: true, skipped: true, reason: 'already_consolidated' };
    }
    
    const minstrategy = strategyRow.minstrategy;
    
    // PREREQUISITE VALIDATION: Check that strategist output exists
    if (!minstrategy || minstrategy.trim().length === 0) {
      console.warn(`[consolidator] ⚠️  Missing strategist output for ${snapshotId}`);
      await db.update(strategies).set({
        status: 'missing_prereq',
        error_message: 'Strategist output (minstrategy) is missing or empty',
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
      throw new Error('Missing strategist output (minstrategy field is empty)');
    }
    
    // Step 2: Fetch snapshot to get full context for briefing research
    const ctx = await getSnapshotContext(snapshotId);
    const userAddress = ctx.formatted_address || 'Unknown location';
    const cityDisplay = ctx.city || 'your area';
    
    // CRITICAL: Extract AUTHORITATIVE date/time from snapshot (never recompute)
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
    
    // OBSERVABILITY: Log input sizes and metadata
    const inputMetrics = {
      snapshot_id: snapshotId,
      strategist_length: minstrategy.length,
      user_address: userAddress,
      snapshot_day_of_week: dayOfWeek,
      snapshot_dow: ctx.dow,
      snapshot_is_weekend: isWeekend,
      snapshot_hour: ctx.hour,
      snapshot_local_time: localTime,
      snapshot_day_part: dayPart,
      snapshot_timezone: ctx.timezone,
      weather: ctx.weather,
      air_quality: ctx.air,
      strategist_model: process.env.STRATEGY_STRATEGIST || 'unknown',
      consolidator_model: process.env.STRATEGY_CONSOLIDATOR || 'unknown'
    };
    
    console.log(`[consolidator] 📊 GPT-5 will do briefing research + consolidation:`, inputMetrics);
    
    // Step 3: Build prompts for GPT-5 reasoning + web search
    const systemPrompt = `You are an expert rideshare strategy consolidator with web search capabilities.

Your task is to:
1. Take the strategist's initial assessment
2. Research current traffic, construction, incidents, news, and events via live web search
3. Consolidate both into a final actionable 30-minute strategy

Focus briefing research on: traffic conditions, road closures, construction, enforcement, incidents, and local news/events affecting rideshare drivers.

CRITICAL: Use the exact day of week and time provided in the user prompt - do not infer or recompute dates.
IMPORTANT: Do NOT include full street addresses in your output. Reference only city/area (e.g., "${cityDisplay}")`;

    const userPrompt = `CRITICAL DATE & TIME (from snapshot - AUTHORITATIVE, do not recompute):
Day of Week: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : ''}
Date & Time: ${localTime}
Day Part: ${dayPart}
Hour: ${ctx.hour}:00
Timezone: ${ctx.timezone}

DRIVER LOCATION (for context - do NOT include street address in final output):
City/Area: ${cityDisplay}
Internal Address: ${userAddress}
Coordinates: ${ctx.lat}, ${ctx.lng}

CURRENT CONDITIONS:
Weather: ${ctx.weather?.tempF || 'unknown'}°F, ${ctx.weather?.conditions || 'unknown'}
Air Quality: AQI ${ctx.air?.aqi || 'unknown'}

STRATEGIST'S INITIAL ASSESSMENT:
${minstrategy}

YOUR TASK:
1. Use live web search to find current traffic conditions, construction, incidents, road closures, enforcement, and news/events affecting rideshare drivers in ${cityDisplay} right now
2. Focus on the next 30 minutes - driver is leaving NOW
3. Merge the strategist's assessment with your real-time briefing research
4. Produce a consolidated 3-5 sentence strategy

CRITICAL REQUIREMENTS:
- Use exact day of week (${dayOfWeek}) provided above - this is authoritative
- Start with day and time context (e.g., "${dayOfWeek} ${dayPart} in ${cityDisplay}")
- Do NOT include full street addresses - reference only "${cityDisplay}"
- Focus on actionable intelligence for the next 30 minutes`;

    const promptSize = systemPrompt.length + userPrompt.length;
    console.log(`[consolidator] 📝 Prompt size: ${promptSize} chars`);
    console.log(`[consolidator] 🚀 Calling model: ${inputMetrics.consolidator_model}`);
    
    // Step 4: Call model-agnostic consolidator role
    const modelCallStart = Date.now();
    const result = await callModel("consolidator", {
      system: systemPrompt,
      user: userPrompt
    });
    const modelCallDuration = Date.now() - modelCallStart;

    if (!result.ok) {
      const errorMsg = result.error || 'consolidator_failed';
      console.error(`[consolidator] ❌ Model call failed after ${modelCallDuration}ms:`, errorMsg);
      throw new Error(errorMsg);
    }
    
    const consolidatedStrategy = result.output.trim();
    
    if (!consolidatedStrategy || consolidatedStrategy.length === 0) {
      throw new Error('Consolidator returned empty output');
    }
    
    // METADATA TRACKING: Build model chain for traceability (2-step pipeline)
    const modelChain = `${inputMetrics.strategist_model}→${inputMetrics.consolidator_model}`;
    const totalDuration = Date.now() - startTime;
    
    // Step 5: Write consolidated strategy + metadata to DB
    await db.update(strategies).set({
      consolidated_strategy: consolidatedStrategy,
      status: 'ok',
      model_name: modelChain,
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    // OBSERVABILITY: Emit completion event with full metrics
    console.log(`[consolidator] ✅ Complete for ${snapshotId}`, {
      model_chain: modelChain,
      output_length: consolidatedStrategy.length,
      model_call_ms: modelCallDuration,
      total_ms: totalDuration,
      prompt_size: promptSize
    });
    
    return { 
      ok: true, 
      strategy: consolidatedStrategy,
      metrics: {
        modelChain,
        outputLength: consolidatedStrategy.length,
        durationMs: totalDuration
      }
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[consolidator] ❌ Error for ${snapshotId} after ${totalDuration}ms:`, error.message);
    
    // Write error to DB with metadata
    await db.update(strategies).set({
      status: 'error',
      error_code: 'consolidator_failed',
      error_message: error.message.slice(0, 500),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));
    
    throw error;
  }
}
