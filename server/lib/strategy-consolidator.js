// server/lib/strategy-consolidator.js
// LISTEN/NOTIFY consolidator - waits for minstrategy + briefing, then consolidates
// ROLE-PURE: receives ONLY strategist + briefer outputs (no raw snapshot context)

import { db } from '../db/drizzle.js';
import { strategies } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getListenClient } from './db-client.js';
import { callModel } from './adapters/index.js';

/**
 * Generate advisory lock key from snapshot ID
 */
function key(snapshotId) {
  return BigInt.asUintN(64, BigInt('0x' + crypto.createHash('sha1').update('consolidate:' + snapshotId).digest('hex').slice(0, 16)));
}

/**
 * Consolidate strategy using GPT-5 when minstrategy + briefing are ready
 * Uses advisory lock to prevent duplicate consolidations
 */
async function maybeConsolidate(snapshotId) {
  const [row] = await db.select().from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
  if (!row) return;

  // Check if ready: need minstrategy + non-empty briefing
  const strategistOutput = row.minstrategy?.trim();
  const brieferOutput = row.briefing && JSON.stringify(row.briefing) !== '{}' ? JSON.stringify(row.briefing, null, 2) : null;
  const already = !!(row.consolidated_strategy && row.consolidated_strategy.trim().length);

  if (!strategistOutput || !brieferOutput) {
    console.warn(`[consolidation] skip ${snapshotId} — missing strategist/briefing`);
    await db.execute(sql`
      UPDATE strategies
      SET status = 'pending', error_message = 'missing role outputs'
      WHERE snapshot_id = ${snapshotId}
    `);
    return;
  }

  if (already) {
    console.log(`[consolidation] skip ${snapshotId} — already consolidated`);
    return;
  }

  console.log(`[consolidation] 🎯 Ready to consolidate ${snapshotId}`);

  // Advisory lock to guarantee single consolidation per snapshot
  const client = await getListenClient();
  const lk = await client.query('SELECT pg_try_advisory_lock($1::bigint)', [key(snapshotId)]);
  if (!lk?.rows?.[0]?.pg_try_advisory_lock) {
    console.log(`[consolidation] ⏭️ Lock held by another worker for ${snapshotId}`);
    return;
  }

  try {
    // ROLE-PURE PROMPTS: Only use strategist + briefer outputs
    const systemPrompt = `You are a rideshare strategy consolidator.
Merge the strategist's initial plan with the briefer's real-time intelligence into one final actionable strategy.
Keep it 3–5 sentences, urgent, time-aware, and specific.`;

    const userPrompt = `STRATEGIST OUTPUT:
${strategistOutput}

BRIEFER OUTPUT:
${brieferOutput}

Task: Merge these into a final consolidated strategy.`;

    console.log(`[consolidation] 🚀 Calling consolidator role for ${snapshotId}...`);

    const res = await callModel("consolidator", { system: systemPrompt, user: userPrompt });

    if (res?.ok && res.output?.trim()) {
      await db.execute(sql`
        UPDATE strategies
        SET consolidated_strategy = ${res.output.trim()}, status = 'ok', updated_at = NOW()
        WHERE snapshot_id = ${snapshotId}
      `);
      console.log(`[consolidation] ✅ saved ${snapshotId} (${res.output.length} chars)`);
    } else {
      console.warn(`[consolidation] ⚠️ empty consolidator output for ${snapshotId}`);
      // Safe fallback to unblock UI: use strategist output
      await db.execute(sql`
        UPDATE strategies
        SET consolidated_strategy = ${strategistOutput}, status = 'ok', updated_at = NOW()
        WHERE snapshot_id = ${snapshotId}
      `);
      console.log(`[consolidation] ✅ fallback to strategist output for ${snapshotId}`);
    }
  } catch (err) {
    console.error(`[consolidation] ❌ ${snapshotId}:`, err?.message || err);
    await db.execute(sql`
      UPDATE strategies
      SET status = 'failed', error_message = ${String(err?.message || err)}, updated_at = NOW()
      WHERE snapshot_id = ${snapshotId}
    `);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [key(snapshotId)]);
  }
}

/**
 * Start LISTEN/NOTIFY consolidation listener
 * Automatically consolidates when minstrategy + briefing are ready
 */
export async function startConsolidationListener() {
  console.log('[consolidator] 🎧 Starting LISTEN/NOTIFY consolidation listener...');
  
  const client = await getListenClient();

  // Listen to both channels for safety
  await client.query(`LISTEN strategy_progress`);
  await client.query(`LISTEN strategy_ready`);

  console.log('[consolidator] ✅ LISTEN mode active on: strategy_progress, strategy_ready');

  client.on('notification', async (msg) => {
    if (!['strategy_progress', 'strategy_ready'].includes(msg.channel)) return;
    
    try {
      const payload = JSON.parse(msg.payload || '{}');
      const snapshotId = payload.snapshot_id || payload.snapshotId || null;
      
      if (snapshotId) {
        console.log(`[consolidator] 📬 NOTIFY received for ${snapshotId}`);
        await maybeConsolidate(snapshotId);
      }
    } catch (error) {
      console.error(`[consolidator] Parse error:`, error.message);
    }
  });

  // One-time catch-up: consolidate any pending rows
  console.log('[consolidator] 🔄 Running catch-up for pending strategies...');
  const rs = await db.select({ sid: strategies.snapshot_id }).from(strategies)
    .where(eq(strategies.status, 'pending'));
  
  console.log(`[consolidator] Found ${rs.length} pending strategies`);
  for (const r of rs) {
    await maybeConsolidate(r.sid);
  }
  
  console.log('[consolidator] 🎉 Consolidation listener ready!');
}
