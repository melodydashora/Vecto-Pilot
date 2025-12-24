// server/lib/providers/consolidator.js
// Strategy generator - generates strategy_for_now from snapshot context + briefing

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callModel } from '../adapters/index.js';

/**
 * Generate strategy_for_now from snapshot context and briefing data
 *
 * ARCHITECTURE: Event-driven, idempotent
 * - Input: { snapshotId } only
 * - DB reads: strategies table (briefing) + snapshots table (context)
 * - Output: strategy_for_now
 *
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runConsolidator(snapshotId) {
  const startTime = Date.now();
  console.log(`[consolidator] 🚀 Starting for snapshot ${snapshotId}`);

  try {
    // Step 1: Fetch strategy row to get briefing
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);

    if (!strategyRow) {
      throw new Error(`Strategy row not found for snapshot ${snapshotId}`);
    }

    // IDEMPOTENCE: If already has strategy_for_now with status=ok, skip
    if (strategyRow.strategy_for_now && strategyRow.status === 'ok') {
      console.log(`[consolidator] ⏭️  Already has strategy (status=ok) - skipping for ${snapshotId}`);
      return { ok: true, skipped: true, reason: 'already_has_strategy' };
    }

    // Get briefing data (should already be populated by briefing provider)
    const briefing = strategyRow.briefing;

    // Briefing is optional - we can generate strategy from context alone
    const hasBriefing = briefing && Object.keys(briefing).length > 0;

    // Step 2: Fetch snapshot context
    const ctx = await getSnapshotContext(snapshotId);
    const userAddress = ctx.formatted_address || 'Unknown location';

    // Extract temporal context
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
    const cityDisplay = ctx.city || 'your area';

    console.log(`[consolidator] 📊 Context ready: ${cityDisplay}, ${dayOfWeek} ${dayPart}, briefing=${hasBriefing}`);

    // Step 3: Build prompt
    const systemPrompt = `You are a rideshare strategy advisor.
Analyze the driver's current context and provide a quick, actionable strategy.
Keep it 2-3 sentences answering "where should I go right now?"
CRITICAL: Use the exact day of week and time provided.
IMPORTANT: Reference only city/area, not full addresses.`;

    let userPrompt = `CONTEXT:
Day: ${dayOfWeek} ${isWeekend ? '[WEEKEND]' : ''}
Time: ${localTime}
Day Part: ${dayPart}
Location: ${cityDisplay}
`;

    if (hasBriefing) {
      const briefingStr = JSON.stringify(briefing, null, 2);
      userPrompt += `
BRIEFING DATA:
${briefingStr}
`;
    }

    userPrompt += `
Task: Provide a quick positioning strategy for this driver right now.`;

    const promptSize = systemPrompt.length + userPrompt.length;
    console.log(`[consolidator] 📝 Prompt size: ${promptSize} chars`);

    // Step 4: Call model
    const modelCallStart = Date.now();
    const result = await callModel("strategist", {
      system: systemPrompt,
      user: userPrompt
    });
    const modelCallDuration = Date.now() - modelCallStart;

    if (!result.ok) {
      const errorMsg = result.error || 'strategist_failed';
      console.error(`[consolidator] ❌ Model call failed after ${modelCallDuration}ms:`, errorMsg);
      throw new Error(errorMsg);
    }

    const strategyForNow = result.output.trim();

    if (!strategyForNow || strategyForNow.length === 0) {
      throw new Error('Strategist returned empty output');
    }

    const totalDuration = Date.now() - startTime;

    // Step 5: Write strategy_for_now to DB
    await db.update(strategies).set({
      strategy_for_now: strategyForNow,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[consolidator] ✅ Complete for ${snapshotId}`, {
      output_length: strategyForNow.length,
      model_call_ms: modelCallDuration,
      total_ms: totalDuration
    });

    return {
      ok: true,
      strategy: strategyForNow,
      metrics: {
        outputLength: strategyForNow.length,
        durationMs: totalDuration
      }
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[consolidator] ❌ Error for ${snapshotId} after ${totalDuration}ms:`, error.message);

    await db.update(strategies).set({
      status: 'error',
      error_code: 'strategy_failed',
      error_message: error.message.slice(0, 500),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    throw error;
  }
}
