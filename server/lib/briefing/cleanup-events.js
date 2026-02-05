import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { briefingLog, OP } from '../../logger/workflow.js';

/**
 * Truncate old discovered events
 * Removes events that have ended based on current date and time.
 * 
 * Logic:
 * - Delete if event_end_date < Today (yesterday or older)
 * - Delete if event_end_date == Today AND event_end_time < Now (ended earlier today)
 * 
 * @param {string} userTimeZone - Timezone to calculate "Today" and "Now" (default: 'America/Chicago')
 * @returns {Promise<number>} Number of events deleted
 */
export async function truncateOldEvents(userTimeZone = 'America/Chicago') {
  try {
    // Calculate Today (YYYY-MM-DD) and Now (HH:MM) in the target timezone
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: userTimeZone }); // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString('en-GB', { timeZone: userTimeZone, hour: '2-digit', minute: '2-digit' }); // HH:MM

    briefingLog.phase(1, `Truncating events older than ${todayStr} ${timeStr}`, OP.DB);

    // Execute parameterized delete query
    // Using raw SQL for efficiency and precise OR logic
    const result = await db.execute(sql`
      DELETE FROM discovered_events
      WHERE 
        event_end_date < ${todayStr}
        OR (event_end_date = ${todayStr} AND event_end_time < ${timeStr})
    `);

    // Drizzle execute result structure varies by driver, usually .rowCount or .count
    const deletedCount = result.rowCount || result.count || 0;
    
    if (deletedCount > 0) {
      briefingLog.done(1, `Truncated ${deletedCount} old events`, OP.DB);
    } else {
      briefingLog.info(`No old events to truncate`, OP.DB);
    }

    return deletedCount;
  } catch (error) {
    briefingLog.error(1, `Failed to truncate events: ${error.message}`, error, OP.DB);
    return 0;
  }
}
