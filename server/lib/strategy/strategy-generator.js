// server/lib/strategy-generator.js
// Orchestrator for parallel multi-model strategy generation
// Routes to strategy-generator-parallel.js for all strategy generation
import { db } from '../../db/drizzle.js';
import { snapshots, users } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateMultiStrategy } from './strategy-generator-parallel.js';

/**
 * Generate strategy for a snapshot using parallel multi-model orchestration
 * This is the single authoritative path for all strategy generation
 *
 * CRITICAL: Pass the full snapshot object to avoid redundant DB fetches
 * The snapshot MUST have formatted_address - LLMs cannot reverse geocode
 *
 * @param {string} snapshot_id - UUID of snapshot
 * @param {Object} options - Optional parameters
 * @param {Object} options.snapshot - Pre-fetched snapshot row (RECOMMENDED to avoid DB fetch)
 * @returns {Promise<string|null>} - Strategy text or null if failed
 */
export async function generateStrategyForSnapshot(snapshot_id, options = {}) {
  try {
    // Use pre-fetched snapshot if provided, otherwise fetch from DB
    let snap = options.snapshot;
    if (!snap) {
      console.log(`[strategy-generator] ⚠️ No snapshot passed, fetching from DB (prefer passing snapshot)`);
      const [row] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id));
      snap = row;
    }

    if (!snap) {
      console.error(`[strategy-generator] Snapshot not found: ${snapshot_id}`);
      return null;
    }

    // CRITICAL: Validate formatted_address exists - LLMs cannot reverse geocode
    if (!snap.formatted_address) {
      console.error(`[strategy-generator] ❌ CRITICAL: Missing formatted_address in snapshot ${snapshot_id}`);
      console.error(`[strategy-generator] Snapshot has: city=${snap.city}, state=${snap.state}, lat=${snap.lat}, lng=${snap.lng}`);
      return null;
    }

    console.log(`[strategy-generator] 📍 Using snapshot with resolved address:`, {
      snapshot_id: snap.snapshot_id,
      formatted_address: snap.formatted_address,
      city: snap.city,
      state: snap.state,
      timezone: snap.timezone
    });

    // Run parallel multi-model strategy generation with FULL snapshot
    // No need to separately fetch user location - snapshot already has it
    const strategyResult = await generateMultiStrategy({
      snapshotId: snapshot_id,
      userId: snap.user_id || null,
      userAddress: snap.formatted_address,  // From snapshot, already resolved
      city: snap.city,
      state: snap.state,
      snapshot: snap  // Pass FULL snapshot row
    });

    if (strategyResult.ok) {
      return strategyResult.strategy;
    } else {
      console.error(`[strategy-generator] Strategy generation failed: ${strategyResult.reason}`);
      return null;
    }
  } catch (error) {
    console.error(`[strategy-generator] Error:`, error.message);
    return null;
  }
}
