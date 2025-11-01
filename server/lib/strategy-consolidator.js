// server/lib/strategy-consolidator.js
// LISTEN/NOTIFY consolidator - waits for minstrategy + briefing, then consolidates

import { db } from '../db/drizzle.js';
import { strategies } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getListenClient } from './db-client.js';
import { getSnapshotContext } from './snapshot/get-snapshot-context.js';
import { callGPT5 } from './adapters/openai-gpt5.js';

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
  const hasMin = !!(row.minstrategy && row.minstrategy.trim().length);
  const hasBriefing = !!(row.briefing && JSON.stringify(row.briefing) !== '{}');
  const ready = hasMin && hasBriefing;
  const already = !!(row.consolidated_strategy && row.consolidated_strategy.trim().length);

  if (!ready || already) return;

  console.log(`[consolidator] 🎯 Ready to consolidate ${snapshotId}`);

  // Advisory lock to guarantee single consolidation per snapshot
  const client = await getListenClient();
  const lk = await client.query('SELECT pg_try_advisory_lock($1::bigint)', [key(snapshotId)]);
  if (!lk?.rows?.[0]?.pg_try_advisory_lock) {
    console.log(`[consolidator] ⏭️ Lock held by another worker for ${snapshotId}`);
    return;
  }

  try {
    const ctx = await getSnapshotContext(snapshotId);
    
    // Extract briefing data (Gemini output)
    const briefing = row.briefing || { events: [], holidays: [], traffic: [], news: [] };
    const holiday = briefing.holidays?.[0] || ctx.news_briefing?.briefing?.holiday || null;
    
    // Format date/time context
    const currentTime = new Date(ctx.created_at);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = dayNames[currentTime.getDay()];
    const monthName = monthNames[currentTime.getMonth()];
    const dayNum = currentTime.getDate();
    const year = currentTime.getFullYear();
    
    const timeStr = currentTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: ctx.timezone || 'America/Chicago'
    });
    
    const formattedDateTime = `${dayName}, ${monthName} ${dayNum}, ${year} at ${timeStr}`;

    const developerPrompt = `You are a rideshare strategy consolidator for ${ctx.city}, ${ctx.state}. Combine the initial strategy with real-time intelligence into a final actionable strategy. Be conversational, urgent, and specific about timing. Keep it 3-5 sentences.`;

    const userPrompt = `CURRENT DATE & TIME: ${formattedDateTime}
DAY OF WEEK: ${dayName}${holiday ? `\n🎉 HOLIDAY: ${holiday}` : ''}
TIME OF DAY: ${ctx.day_part_key}

DRIVER LOCATION:
Address: ${row.user_resolved_address || ctx.formatted_address}
City: ${row.user_resolved_city || ctx.city}, ${row.user_resolved_state || ctx.state}

CURRENT CONDITIONS:
Weather: ${ctx.weather?.tempF || '?'}°F, ${ctx.weather?.conditions || 'unknown'}
Airport: ${ctx.airport_context?.airport_code || 'none'} ${ctx.airport_context?.has_delays ? `(${ctx.airport_context.delay_minutes} min delays)` : ''}

INITIAL STRATEGY:
${row.minstrategy}

REAL-TIME INTELLIGENCE:
${briefing.holidays?.length ? `🎉 HOLIDAYS: ${briefing.holidays.join(', ')}\n` : ''}${briefing.events?.length ? `Events: ${briefing.events.join('; ')}\n` : ''}${briefing.traffic?.length ? `Traffic: ${briefing.traffic.join('; ')}\n` : ''}${briefing.news?.length ? `News: ${briefing.news.join('; ')}` : ''}

Consolidate into a final strategy that integrates the intelligence with the strategic analysis.`;

    const consolidatorModel = process.env.STRATEGY_CONSOLIDATOR;
    if (!consolidatorModel) {
      throw new Error('Missing STRATEGY_CONSOLIDATOR environment variable');
    }
    
    console.log(`[consolidator] 🚀 Calling consolidator (${consolidatorModel}) for ${snapshotId}...`);

    const result = await callGPT5({
      model: consolidatorModel,
      developer: developerPrompt,
      user: userPrompt,
      max_completion_tokens: 2000,
      reasoning_effort: 'medium'
    });

    const consolidated = result.text?.trim() || null;

    // Write consolidated strategy
    await db.update(strategies).set({
      consolidated_strategy: consolidated,
      status: consolidated ? 'ok' : 'pending',
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[consolidator] ✅ Consolidated ${snapshotId} (${consolidated?.length || 0} chars)`);
  } catch (error) {
    console.error(`[consolidator] ❌ Error consolidating ${snapshotId}:`, error.message);
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
