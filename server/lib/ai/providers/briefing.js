// server/lib/providers/briefing.js
// Briefer provider - Uses Gemini 3.0 Pro for all briefing data (events, traffic, weather, news, closures)

import { db } from '../../../db/drizzle.js';
import { snapshots } from '../../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateAndStoreBriefing } from '../../briefing/briefing-service.js';

/**
 * Generate comprehensive briefing using Gemini 3.0 Pro
 *
 * DATA COVERAGE:
 * - Events (Gemini 3.0 Pro with Google Search)
 * - Traffic (Gemini 3.0 Pro with Google Search)
 * - Weather (Google Weather API)
 * - Rideshare News (Gemini 3.0 Pro with Google Search)
 * - School Closures (Gemini 3.0 Pro with Google Search)
 *
 * @param {string} snapshotId - UUID of snapshot
 * @param {Object} options - Optional parameters
 * @param {Object} options.snapshot - Pre-fetched snapshot to avoid redundant DB reads
 * @returns {Promise<void>}
 * @throws {Error} If snapshot not found or briefing generation fails
 */
export async function runBriefing(snapshotId, options = {}) {
  try {
    // Use pre-fetched snapshot if provided, otherwise fetch from DB
    let snapshot = options.snapshot;
    if (!snapshot) {
      const [row] = await db.select().from(snapshots)
        .where(eq(snapshots.snapshot_id, snapshotId)).limit(1);
      snapshot = row;
    }

    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Use briefing-service which handles all Gemini calls in parallel
    const result = await generateAndStoreBriefing({
      snapshotId,
      snapshot
    });
    
    if (!result.success) {
      console.warn(`[briefing] ⚠️ Briefing generation returned success=false:`, result.error);
      throw new Error(result.error || 'Briefing generation failed');
    }
    
    console.log(`[briefing] ✅ Briefing generated for ${snapshotId}`);
  } catch (error) {
    console.error(`[briefing] ❌ Error for ${snapshotId}:`, error.message);
    throw error;
  }
}
