// server/lib/providers/minstrategy.js
// Strategist provider - model-agnostic (uses callModel adapter)

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { callModel } from '../adapters/index.js';

/**
 * Run minimal strategy generation using Claude
 * Writes to strategies.minstrategy (model-agnostic field)
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runMinStrategy(snapshotId) {
  console.log(`[minstrategy] Starting for snapshot ${snapshotId}`);
  
  try {
    const ctx = await getSnapshotContext(snapshotId);
    
    const systemPrompt = `You are a rideshare strategy analyst. Analyze the driver's current location, time, weather, and conditions to provide a brief strategic assessment (2-3 sentences). Focus on positioning opportunities and demand patterns.

IMPORTANT: Use plain text only. Do NOT use markdown formatting (no **, __, #, etc.). Write in clear, natural sentences.`;
    
    // CRITICAL: Use snapshot's authoritative date/time fields
    const localTime = ctx.local_iso ? new Date(ctx.local_iso).toLocaleString('en-US', { 
      timeZone: ctx.timezone || 'America/Chicago',
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) : new Date(ctx.created_at).toLocaleString('en-US', { timeZone: ctx.timezone });
    
    const userPrompt = `CRITICAL DATE & TIME (from snapshot - authoritative):
Day of Week: ${ctx.day_of_week} ${ctx.is_weekend ? '[WEEKEND]' : ''}
Date & Time: ${localTime}
Day Part: ${ctx.day_part_key}
Hour: ${ctx.hour}:00
${ctx.is_holiday ? `🎉 HOLIDAY: ${ctx.holiday}` : ''}

LOCATION:
${ctx.formatted_address}
${ctx.city}, ${ctx.state}

CONDITIONS:
Weather: ${ctx.weather?.tempF || '?'}°F, ${ctx.weather?.conditions || 'unknown'}
Airport: ${ctx.airport_context?.airport_code || 'none'} ${ctx.airport_context?.distance_miles ? `(${ctx.airport_context.distance_miles} mi)` : ''}

Provide a brief strategic assessment of positioning opportunities for the next hour. Use the exact day of week provided above.${ctx.is_holiday ? ` Factor in holiday-specific demand patterns for ${ctx.holiday}.` : ''}`;

    // Call model-agnostic strategist role
    const result = await callModel("strategist", {
      system: systemPrompt,
      user: userPrompt
    });

    if (!result.ok) {
      throw new Error('Strategist model call failed');
    }
    
    const text = result.output;
    
    // Write to model-agnostic field using raw SQL (ensures trigger fires)
    // CRITICAL: Setting status='complete' triggers NOTIFY strategy_ready
    try {
      await db.execute(sql`
        UPDATE strategies 
        SET 
          minstrategy = ${text},
          status = 'complete',
          user_resolved_address = ${ctx.formatted_address},
          user_resolved_city = ${ctx.city},
          user_resolved_state = ${ctx.state},
          strategy_timestamp = NOW(),
          updated_at = NOW()
        WHERE snapshot_id = ${snapshotId}
      `);
      console.log(`[minstrategy] ✅ Trigger fired - NOTIFY strategy_ready should broadcast to SSE clients`);
    } catch (dbError) {
      console.error(`[minstrategy] ❌ Database UPDATE failed for ${snapshotId}:`, {
        error: dbError.message,
        code: dbError.code,
        detail: dbError.detail,
        hint: dbError.hint,
        stack: dbError.stack
      });
      // Mark as write_failed for debugging
      try {
        await db.execute(sql`
          UPDATE strategies
          SET status = 'write_failed',
              error_message = ${dbError.message},
              updated_at = NOW()
          WHERE snapshot_id = ${snapshotId}
        `);
      } catch (e) {
        console.error(`[minstrategy] Failed to mark as write_failed:`, e);
      }
      throw dbError;
    }

    console.log(`[minstrategy] ✅ Complete for ${snapshotId} (${text?.length || 0} chars)`);
  } catch (error) {
    console.error(`[minstrategy] ❌ Error for ${snapshotId}:`, error.message, error.stack);
    throw error;
  }
}
