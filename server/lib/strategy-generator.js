// server/lib/strategy-generator.js
// Orchestrator for parallel multi-model strategy generation
// Routes to strategy-generator-parallel.js for all strategy generation
import { db } from '../db/drizzle.js';
import { snapshots, users } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateMultiStrategy } from './strategy-generator-parallel.js';

/**
 * Generate strategy for a snapshot using parallel multi-model orchestration
 * This is the single authoritative path for all strategy generation
 * @param {string} snapshot_id - UUID of snapshot
 * @returns {Promise<string|null>} - Strategy text or null if failed
 */
export async function generateStrategyForSnapshot(snapshot_id) {
  try {
    // Fetch snapshot and user location data
    const [snap] = await db.select().from(snapshots).where(eq(snapshots.snapshot_id, snapshot_id));
    
    if (!snap) {
      console.error(`[strategy-generator] Snapshot not found: ${snapshot_id}`);
      return null;
    }
    
    // Fetch user location data from users table
    let userLocation = { city: null, state: null, formatted_address: null };
    if (snap.user_id) {
      const [userData] = await db.select().from(users).where(eq(users.user_id, snap.user_id));
      if (userData) {
        userLocation = {
          city: userData.city,
          state: userData.state,
          formatted_address: userData.formatted_address
        };
      }
    }
    
    // Run parallel multi-model strategy generation
    const strategyResult = await generateMultiStrategy({
      snapshotId: snapshot_id,
      userId: snap.user_id || null,
      userAddress: userLocation.formatted_address,
      city: userLocation.city,
      state: userLocation.state,
      snapshot: snap
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
