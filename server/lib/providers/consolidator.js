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
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runConsolidator(snapshotId) {
  console.log(`[consolidator] Starting for snapshot ${snapshotId}`);
  
  try {
    // Step 1: Fetch strategy row to get strategist + briefer outputs
    const [strategyRow] = await db.select().from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId)).limit(1);
    
    if (!strategyRow) {
      throw new Error(`Strategy row not found for snapshot ${snapshotId}`);
    }
    
    const minstrategy = strategyRow.minstrategy;
    const briefing = strategyRow.briefing;
    
    // Validate that both inputs exist
    if (!minstrategy || minstrategy.trim().length === 0) {
      throw new Error('Missing strategist output (minstrategy field is empty)');
    }
    
    if (!briefing) {
      throw new Error('Missing briefer output (briefing field is null)');
    }
    
    // Step 2: Fetch snapshot to get user address
    const ctx = await getSnapshotContext(snapshotId);
    const userAddress = ctx.formatted_address || 'Unknown location';
    
    console.log(`[consolidator] 📊 Inputs ready:`, {
      minstrategy_length: minstrategy.length,
      briefing_keys: Object.keys(briefing || {}),
      user_address: userAddress
    });
    
    // Step 3: Build prompts for consolidation
    const systemPrompt = `You are a rideshare strategy consolidator.
Merge the strategist's initial plan with the briefer's real-time intelligence into one final actionable strategy.
Keep it 3–5 sentences, urgent, time-aware, and specific.`;

    const userPrompt = `USER LOCATION:
${userAddress}

STRATEGIST OUTPUT:
${minstrategy}

BRIEFER OUTPUT:
${JSON.stringify(briefing, null, 2)}

Task: Merge these into a final consolidated strategy for this location.`;

    console.log(`[consolidator] 🚀 Calling model-agnostic consolidator role...`);
    
    // Step 4: Call model-agnostic consolidator role
    const result = await callModel("consolidator", {
      system: systemPrompt,
      user: userPrompt
    });

    if (!result.ok) {
      const errorMsg = result.error || 'consolidator_failed';
      console.error(`[consolidator] ❌ Model call failed:`, errorMsg);
      throw new Error(errorMsg);
    }
    
    const consolidatedStrategy = result.output.trim();
    
    if (!consolidatedStrategy || consolidatedStrategy.length === 0) {
      throw new Error('Consolidator returned empty output');
    }
    
    // Step 5: Write consolidated strategy to DB
    await db.update(strategies).set({
      consolidated_strategy: consolidatedStrategy,
      status: 'ok',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[consolidator] ✅ Complete for ${snapshotId} (${consolidatedStrategy.length} chars)`);
    
    return { ok: true, strategy: consolidatedStrategy };
  } catch (error) {
    console.error(`[consolidator] ❌ Error for ${snapshotId}:`, error.message);
    
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
