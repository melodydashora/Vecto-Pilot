// server/lib/providers/briefing.js
// BRIEFING_* roles provider - All briefing data (events, traffic, weather, news, closures)

import { db } from '../../../db/drizzle.js';
import { snapshots } from '../../../../shared/schema.js';
import { eq } from 'drizzle-orm';
import { generateAndStoreBriefing } from '../../briefing/briefing-service.js';
import { briefingLog, OP } from '../../../logger/workflow.js';

/**
 * Generate comprehensive briefing using BRIEFING_* roles
 *
 * DATA COVERAGE:
 * - Events (BRIEFING_EVENTS_DISCOVERY role with Google Search)
 * - Traffic (BRIEFING_TRAFFIC role with Google Search)
 * - Weather (Google Weather API)
 * - Rideshare News (BRIEFING_NEWS role with Google Search)
 * - School Closures (BRIEFING_CLOSURES role with Google Search)
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
      briefingLog.warn(2, `Generation returned success=false: ${result.error}`);
      throw new Error(result.error || 'Briefing generation failed');
    }

    briefingLog.done(2, `[briefing.js] Briefing stored for ${snapshotId.slice(0, 8)}`, OP.DB);
  } catch (error) {
    briefingLog.error(2, `Briefing failed for ${snapshotId.slice(0, 8)}`, error);
    throw error;
  }
}
