// server/lib/providers/minstrategy.js
// Claude provider for initial strategic analysis (model-agnostic naming)

import { db } from '../../db/drizzle.js';
import { strategies } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { getSnapshotContext } from '../snapshot/get-snapshot-context.js';
import { createAnthropicClient } from '../anthropic-extended.js';

/**
 * Run minimal strategy generation using Claude
 * Writes to strategies.minstrategy (model-agnostic field)
 * @param {string} snapshotId - UUID of snapshot
 */
export async function runMinStrategy(snapshotId) {
  console.log(`[minstrategy] Starting for snapshot ${snapshotId}`);
  
  try {
    const ctx = await getSnapshotContext(snapshotId);
    
    // Call Claude for initial strategic analysis with full snapshot context
    const claude = createAnthropicClient(process.env.ANTHROPIC_API_KEY);
    
    const systemPrompt = `You are a rideshare strategy analyst. Analyze the driver's current location, time, weather, and conditions to provide a brief strategic assessment (2-3 sentences). Focus on positioning opportunities and demand patterns.`;
    
    const userPrompt = `SNAPSHOT CONTEXT:
Location: ${ctx.formatted_address}
City/State: ${ctx.city}, ${ctx.state}
Time: ${new Date(ctx.created_at).toLocaleString('en-US', { timeZone: ctx.timezone })}
Day Part: ${ctx.day_part_key}
Weather: ${ctx.weather?.tempF || '?'}°F, ${ctx.weather?.conditions || 'unknown'}
Airport: ${ctx.airport_context?.airport_code || 'none'} ${ctx.airport_context?.distance_miles ? `(${ctx.airport_context.distance_miles} mi)` : ''}

Provide a brief strategic assessment of positioning opportunities for the next hour.`;

    const response = await claude.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = response.content?.[0]?.text || null;
    
    // Write to model-agnostic field
    await db.update(strategies).set({
      minstrategy: text,
      user_resolved_address: ctx.formatted_address,
      user_resolved_city: ctx.city,
      user_resolved_state: ctx.state,
      strategy_timestamp: new Date(),
      updated_at: new Date()
    }).where(eq(strategies.snapshot_id, snapshotId));

    console.log(`[minstrategy] ✅ Complete for ${snapshotId} (${text?.length || 0} chars)`);
  } catch (error) {
    console.error(`[minstrategy] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
