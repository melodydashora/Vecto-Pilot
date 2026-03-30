
import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { desc } from 'drizzle-orm';
import { writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Write the last strategy row to strategy-last-row.txt
 * Called after strategy generation to capture state for debugging
 */
export async function dumpLastStrategyRow() {
  try {
    // Order by updated_at to get the most recently POPULATED strategy
    // (not just created - strategies are created as placeholders then updated with data)
    const [lastStrategy] = await db.select()
      .from(strategies)
      .orderBy(desc(strategies.updated_at))
      .limit(1);

    if (!lastStrategy) {
      console.log('[DumpStrategy] No strategy rows found');
      return;
    }

    // Format the output nicely
    const output = `✅ Last Strategy Record
================================================================================

id:
  "${lastStrategy.id}"

snapshot_id:
  "${lastStrategy.snapshot_id}"

user_id:
  "${lastStrategy.user_id || '(null)'}"

status:
  "${lastStrategy.status}"

phase:
  "${lastStrategy.phase || '(null)'}"

phase_started_at:
  "${lastStrategy.phase_started_at || '(null)'}"

error_message:
  "${lastStrategy.error_message || '(null)'}"

strategy_for_now:
  ${lastStrategy.strategy_for_now ? JSON.stringify(lastStrategy.strategy_for_now, null, 2) : '(null)'}

consolidated_strategy:
  ${lastStrategy.consolidated_strategy ? JSON.stringify(lastStrategy.consolidated_strategy, null, 2) : '(null)'}

created_at:
  "${lastStrategy.created_at}"

updated_at:
  "${lastStrategy.updated_at}"

-- NOTE: Columns dropped in 20260114_lean_strategies_table.sql:
-- strategy_id, correlation_id, strategy, error_code, attempt, next_retry_at,
-- latency_ms, tokens, model_name, trigger_reason, valid_window_start,
-- valid_window_end, strategy_timestamp

`;

    const filePath = join(process.cwd(), 'strategy-last-row.txt');
    await writeFile(filePath, output, 'utf-8');
    console.log('[DumpStrategy] ✅ Written to strategy-last-row.txt');
  } catch (err) {
    console.error('[DumpStrategy] ❌ Failed to dump strategy:', err.message);
  }
}
