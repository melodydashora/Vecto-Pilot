// server/lib/providers/consolidator.js
// Consolidator provider - model-agnostic (uses callModel adapter)
// ROLE-PURE: Only receives strategist + briefer outputs + user address

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callModel } from '../adapters/index.js';

/**
 * Run consolidation using configured consolidator model
 * Fetches strategist + briefer outputs from DB, then consolidates
 * Writes to strategies.consolidated_strategy
 * 
 * ARCHITECTURE: Event-driven, idempotent, role-pure
 * - Input: { snapshotId } only
 * - DB reads: strategies table (strategist + briefer) + snapshots table (address)
 * - Output: consolidated_strategy + metadata
 * 
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runConsolidator(snapshotId) {
  const startTime = Date.now();
  console.log(`[consolidator] 🚀 Starting for snapshot ${snapshotId}`);
  
  try {
    // Step 1: Fetch strategy row to get strategist + briefer outputs
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
    const briefing = strategyRow.briefing;
    
    // PREREQUISITE VALIDATION: Check that both inputs exist
    if (!minstrategy || minstrategy.trim().length === 0) {
      console.warn(`[consolidator] ⚠️  Missing strategist output for ${snapshotId}`);
      await db.update(strategies).set({
        status: 'missing_prereq',
        error_message: 'Strategist output (minstrategy) is missing or empty',
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
      throw new Error('Missing strategist output (minstrategy field is empty)');
    }
    
    if (!briefing) {
      console.warn(`[consolidator] ⚠️  Missing briefer output for ${snapshotId}`);
      await db.update(strategies).set({
        status: 'missing_prereq',
        error_message: 'Briefer output (briefing) is missing',
        updated_at: new Date()
      }).where(eq(strategies.snapshot_id, snapshotId));
      throw new Error('Missing briefer output (briefing field is null)');
    }
    
    // Step 2: Fetch snapshot to get user address + date/time context (role-pure: location + temporal metadata)
    const ctx = await getSnapshotContext(snapshotId);
    const userAddress = ctx.formatted_address || 'Unknown location';
    
    // CRITICAL: Extract AUTHORITATIVE date/time from snapshot (never recompute)
    // This is the single source of truth for all temporal context
    const dayOfWeek = ctx.day_of_week; // Authoritative from snapshot
    const isWeekend = ctx.is_weekend; // Authoritative from snapshot
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
    
    // OBSERVABILITY: Log input sizes and metadata for auditability
    const briefingStr = JSON.stringify(briefing, null, 2);
    const inputMetrics = {
      snapshot_id: snapshotId,
      strategist_length: minstrategy.length,
      briefer_length: briefingStr.length,
      user_address: userAddress,
      // CRITICAL: Authoritative temporal context from snapshot
      snapshot_day_of_week: dayOfWeek, // Trusting snapshot, not recomputing
      snapshot_dow: ctx.dow, // Raw day number from snapshot
      snapshot_is_weekend: isWeekend,
      snapshot_hour: ctx.hour,
      snapshot_local_time: localTime,
      snapshot_day_part: dayPart,
      snapshot_timezone: ctx.timezone,
      strategist_model: process.env.STRATEGY_STRATEGIST || 'unknown',
      briefer_model: process.env.STRATEGY_BRIEFER || 'unknown',
      consolidator_model: process.env.STRATEGY_CONSOLIDATOR || 'unknown'
    };
    
    console.log(`[consolidator] 📊 Inputs ready (temporal context from snapshot - AUTHORITATIVE):`, inputMetrics);
    
    // Step 3: Build prompts for consolidation
    const systemPrompt = `You are a rideshare strategy consolidator.
Merge the strategist's initial plan with the briefer's real-time intelligence into one final actionable strategy.
Keep it 3–5 sentences, urgent, time-aware, and specific.
CRITICAL: Use the exact day of week and time provided in the user prompt - do not infer or recompute dates.
IMPORTANT: Do NOT include full street addresses in your output. Reference only city/area (e.g., "${ctx.city || 'your area'}")`;

    // Extract city without street address for display
    const cityDisplay = ctx.city || 'your area';

    const userPrompt = `CRITICAL DATE & TIME (from snapshot - AUTHORITATIVE, do not recompute):
Day of Week: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : ''}
Date & Time: ${localTime}
Day Part: ${dayPart}
Hour: ${ctx.hour}:00

USER LOCATION (for context only - do NOT include street address in output):
City/Area: ${cityDisplay}
Full Address (internal only): ${userAddress}

STRATEGIST OUTPUT:
${minstrategy}

BRIEFER OUTPUT:
${briefingStr}

Task: Merge these into a final consolidated strategy for ${cityDisplay}. 
CRITICAL REQUIREMENTS:
1. Use the exact day of week (${dayOfWeek}) provided above - this is authoritative
2. Start with the day and time context (e.g., "${dayOfWeek} ${dayPart} in ${cityDisplay}")
3. Do NOT include full street addresses - reference only "${cityDisplay}"`;

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
    
    // METADATA TRACKING: Build model chain for traceability
    const modelChain = `${inputMetrics.strategist_model}→${inputMetrics.briefer_model}→${inputMetrics.consolidator_model}`;
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
