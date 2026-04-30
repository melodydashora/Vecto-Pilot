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
 * - Deactivate if event_end_date < Today (yesterday or older)
 * - Deactivate if event_end_date == Today AND event_end_time < Now (ended earlier today)
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
    // Calculate "today" and "now" in the driver's local timezone
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }); // HH:MM

    const result = await db.execute(sql`
      UPDATE discovered_events
      SET is_active = false,
          deactivated_at = NOW(),
          updated_at = NOW()
      WHERE is_active = true
        AND (
          event_end_date < ${todayStr}
          OR (event_end_date = ${todayStr} AND event_end_time < ${timeStr})
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
