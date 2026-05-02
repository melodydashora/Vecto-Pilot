import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';

/**
 * Deactivate past events in discovered_events.
 * Soft-deactivates (is_active = false) events that have ended, preserving
 * historical data for audit/analysis while preventing stale events from
 * appearing in briefings and AI Coach queries.
 *
 * 2026-02-17: Rewritten from DELETE to soft-deactivate for data preservation.
 * 2026-02-17: Removed default timezone — NO FALLBACKS rule (CLAUDE.md).
 * 2026-02-17: Added deactivated_at timestamp for lifecycle tracking.
 *
 * Logic:
 * - Computes cutoff = now - 2h (matches POST_EVENT_SURGE_MS in strategy-utils.js so
 *   the deactivation window aligns with the read-side freshness window — events
 *   stay visible for ~2hr post-end to capture driver pickup surge).
 * - Deactivate if event_end_date < cutoffDate
 * - Deactivate if event_end_date == cutoffDate AND event_end_time < cutoffTime
 * - Only targets events where is_active = true (skip already-deactivated)
 *
 * @param {string} timezone - IANA timezone (e.g. 'America/Chicago') — REQUIRED
 * @returns {Promise<number>} Number of events deactivated
 */
export async function deactivatePastEvents(timezone) {
  if (!timezone) {
    throw new Error('deactivatePastEvents requires timezone parameter — NO FALLBACKS');
  }

  try {
    // 2026-05-02: Workstream 6 commit 8.5 — apply 2-hour post-event surge buffer so
    // deactivation aligns with the read-side freshness window in strategy-utils.js
    // (POST_EVENT_SURGE_MS). Events stay is_active=true for 2 hours after their
    // event_end_time, giving drivers ride opportunities from attendees leaving.
    const POST_EVENT_BUFFER_MS = 2 * 60 * 60 * 1000;
    const now = new Date();
    const cutoff = new Date(now.getTime() - POST_EVENT_BUFFER_MS); // 2 hours before now
    // Derive date/time strings from cutoff, not now. Format guarantees:
    //   en-CA → "YYYY-MM-DD" (sortable as string)
    //   en-GB → "HH:MM" 24-hour with leading zeros (sortable as string,
    //     assumes event_end_time is also stored in 24-hour HH:MM format —
    //     pre-existing assumption upstream of this commit)
    const cutoffDateStr = cutoff.toLocaleDateString('en-CA', { timeZone: timezone });
    const cutoffTimeStr = cutoff.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });

    const result = await db.execute(sql`
      UPDATE discovered_events
      SET is_active = false,
          deactivated_at = NOW(),
          updated_at = NOW()
      WHERE is_active = true
        AND (
          event_end_date < ${cutoffDateStr}
          OR (event_end_date = ${cutoffDateStr} AND event_end_time < ${cutoffTimeStr})
        )
    `);

    const deactivatedCount = result.rowCount || result.count || 0;

    if (deactivatedCount > 0) {
      briefingLog.phase(1, `Deactivated ${deactivatedCount} past events (tz=${timezone})`, OP.DB);
    }

    return deactivatedCount;
  } catch (error) {
    // Non-fatal — cleanup failure shouldn't block event discovery
    briefingLog.error(1, `Failed to deactivate past events: ${error.message}`, error, OP.DB);
    return 0;
  }
}
