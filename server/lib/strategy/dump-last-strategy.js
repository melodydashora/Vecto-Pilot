
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
    const [lastStrategy] = await db.select()
      .from(strategies)
      .orderBy(desc(strategies.created_at))
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

strategy_id:
  "${lastStrategy.strategy_id || '(null)'}"

correlation_id:
  "${lastStrategy.correlation_id || '(null)'}"

user_id:
  "${lastStrategy.user_id || '(null)'}"

status:
  "${lastStrategy.status}"

phase:
  "${lastStrategy.phase || '(null)'}"

trigger_reason:
  "${lastStrategy.trigger_reason || '(null)'}"

model_name:
  "${lastStrategy.model_name || '(null)'}"

strategy_for_now:
  ${lastStrategy.strategy_for_now ? JSON.stringify(lastStrategy.strategy_for_now, null, 2) : '(null)'}

consolidated_strategy:
  ${lastStrategy.consolidated_strategy ? JSON.stringify(lastStrategy.consolidated_strategy, null, 2) : '(null)'}

error_code:
  ${lastStrategy.error_code || '(null)'}

error_message:
  "${lastStrategy.error_message || '(null)'}"

attempt:
  ${lastStrategy.attempt}

latency_ms:
  ${lastStrategy.latency_ms || '(null)'}

tokens:
  ${lastStrategy.tokens || '(null)'}

phase_started_at:
  "${lastStrategy.phase_started_at || '(null)'}"

strategy_timestamp:
  "${lastStrategy.strategy_timestamp || '(null)'}"

valid_window_start:
  "${lastStrategy.valid_window_start || '(null)'}"

valid_window_end:
  "${lastStrategy.valid_window_end || '(null)'}"

created_at:
  "${lastStrategy.created_at}"

updated_at:
  "${lastStrategy.updated_at}"

next_retry_at:
  "${lastStrategy.next_retry_at || '(null)'}"

`;

    const filePath = join(process.cwd(), 'strategy-last-row.txt');
    await writeFile(filePath, output, 'utf-8');
    console.log('[DumpStrategy] ✅ Written to strategy-last-row.txt');
  } catch (err) {
    console.error('[DumpStrategy] ❌ Failed to dump strategy:', err.message);
  }
}
