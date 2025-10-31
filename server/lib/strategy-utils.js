// server/lib/strategy-utils.js
// Strategy-first gating utilities

import { db } from '../db/drizzle.js';
import { strategies } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Check if consolidated strategy is ready for a snapshot
 * Used by blocks-fast to gate rendering until strategy exists
 * 
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<{ready: boolean, strategy?: string}>}
 */
export async function isStrategyReady(snapshotId) {
  if (!snapshotId) {
    return { ready: false };
  }

  try {
    const [strategyRow] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);

    if (!strategyRow) {
      return { ready: false };
    }

    // Ready when strategy_for_now exists (GPT-5 consolidated output)
    const ready = Boolean(strategyRow.strategy_for_now);
    
    return {
      ready,
      strategy: strategyRow.strategy_for_now,
      status: strategyRow.status
    };
  } catch (error) {
    console.error('[isStrategyReady] Error:', error);
    return { ready: false, error: error.message };
  }
}

/**
 * Get strategy context for venue/event planners
 * Returns all fields needed by planners
 * 
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<{snapshot, strategy, ready: boolean}>}
 */
export async function getStrategyContext(snapshotId) {
  const { ready, strategy, status } = await isStrategyReady(snapshotId);
  
  if (!ready) {
    return { ready: false, strategy: null, snapshot: null };
  }

  // Fetch snapshot with full context
  const { snapshots } = await import('../../shared/schema.js');
  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId))
    .limit(1);

  return {
    ready: true,
    strategy,
    status,
    snapshot,
    // Planner inputs
    inputs: {
      snapshot_id: snapshotId,
      user_address: snapshot?.formatted_address,
      city: snapshot?.city,
      state: snapshot?.state,
      lat: snapshot?.lat,
      lng: snapshot?.lng,
      timezone: snapshot?.timezone,
      strategy_text: strategy
    }
  };
}
