/**
 * Daily Event Discovery Sync Job
 *
 * Runs once per day to:
 * 1. Discover events for all active user locations
 * 2. Clean up past events from the database
 *
 * Started by bootstrap/workers.js in mono mode.
 */

import { db } from '../db/drizzle.js';
import { snapshots, discovered_events } from '../../shared/schema.js';
import { sql, lt, desc } from 'drizzle-orm';
import { syncEventsForLocation } from '../scripts/sync-events.mjs';

// Run daily at 6 AM (in ms from midnight)
const DAILY_RUN_HOUR = 6;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let isRunning = false;
let syncTimer = null;

/**
 * Get unique locations from recent snapshots (last 7 days)
 * These are the active user locations we need to sync events for
 */
async function getActiveLocations() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const locations = await db.execute(sql`
    SELECT DISTINCT city, state,
           ROUND(CAST(lat AS NUMERIC), 2) as lat,
           ROUND(CAST(lng AS NUMERIC), 2) as lng
    FROM snapshots
    WHERE created_at > ${sevenDaysAgo.toISOString()}
      AND city IS NOT NULL
      AND state IS NOT NULL
      AND lat IS NOT NULL
      AND lng IS NOT NULL
    ORDER BY city, state
  `);

  return locations.rows;
}

/**
 * Clean up past events (event_date < today)
 * Marks them as inactive rather than deleting for audit trail
 */
async function cleanupPastEvents() {
  const today = new Date().toISOString().split('T')[0];

  const result = await db
    .update(discovered_events)
    .set({ is_active: false })
    .where(lt(discovered_events.event_date, today));

  return result.rowCount || 0;
}

/**
 * Run the daily event sync for all active locations
 */
async function runDailySync() {
  if (isRunning) {
    console.log('[EventSync] Sync already in progress, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('[EventSync] DAILY EVENT SYNC STARTED');
  console.log(`[EventSync] Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    // Step 1: Clean up past events
    console.log('\n[EventSync] Step 1: Cleaning up past events...');
    const deactivated = await cleanupPastEvents();
    console.log(`[EventSync] Deactivated ${deactivated} past events`);

    // Step 2: Get active locations
    console.log('\n[EventSync] Step 2: Finding active user locations...');
    const locations = await getActiveLocations();
    console.log(`[EventSync] Found ${locations.length} unique locations`);

    if (locations.length === 0) {
      console.log('[EventSync] No active locations to sync');
      return;
    }

    // Step 3: Sync events for each location (daily mode = all models)
    console.log('\n[EventSync] Step 3: Syncing events for each location...');
    let totalInserted = 0;
    let totalSkipped = 0;

    for (const loc of locations) {
      console.log(`\n[EventSync] Syncing: ${loc.city}, ${loc.state}`);

      try {
        const result = await syncEventsForLocation({
          city: loc.city,
          state: loc.state,
          lat: parseFloat(loc.lat),
          lng: parseFloat(loc.lng)
        }, true); // isDaily = true (all models)

        totalInserted += result.inserted || 0;
        totalSkipped += result.skipped || 0;

        console.log(`[EventSync] ${loc.city}: +${result.inserted} new, ${result.skipped} duplicates`);
      } catch (err) {
        console.error(`[EventSync] Error syncing ${loc.city}, ${loc.state}:`, err.message);
      }

      // Small delay between locations to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[EventSync] DAILY SYNC COMPLETE');
    console.log(`[EventSync] Locations synced: ${locations.length}`);
    console.log(`[EventSync] Events inserted: ${totalInserted}`);
    console.log(`[EventSync] Duplicates skipped: ${totalSkipped}`);
    console.log(`[EventSync] Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (err) {
    console.error('[EventSync] Daily sync failed:', err);
  } finally {
    isRunning = false;
  }
}

/**
 * Calculate ms until next run time (default 6 AM)
 */
function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(DAILY_RUN_HOUR, 0, 0, 0);

  // If we've passed today's run time, schedule for tomorrow
  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Start the daily event sync scheduler
 */
export function startEventSyncJob() {
  console.log('[EventSync] Starting daily event sync job...');

  // Schedule first run
  const msToFirstRun = msUntilNextRun();
  const hoursToFirstRun = (msToFirstRun / ONE_HOUR_MS).toFixed(1);

  console.log(`[EventSync] Next sync in ${hoursToFirstRun} hours (at ${DAILY_RUN_HOUR}:00 AM)`);

  // Run initial sync if it's been requested or if we just started
  if (process.env.EVENT_SYNC_RUN_ON_START === 'true') {
    console.log('[EventSync] EVENT_SYNC_RUN_ON_START=true, running initial sync...');
    setTimeout(() => runDailySync(), 5000); // Small delay to let server fully start
  }

  // Schedule daily runs
  const scheduleNextRun = () => {
    const delay = msUntilNextRun();

    syncTimer = setTimeout(async () => {
      await runDailySync();
      scheduleNextRun(); // Schedule next day's run
    }, delay);
  };

  scheduleNextRun();

  return {
    runNow: runDailySync,
    stop: () => {
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
    }
  };
}

/**
 * Stop the event sync job
 */
export function stopEventSyncJob() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
    console.log('[EventSync] Daily event sync job stopped');
  }
}

// If run directly (for testing)
if (process.argv[1]?.endsWith('event-sync-job.js')) {
  console.log('[EventSync] Running in standalone mode...');
  runDailySync().then(() => {
    console.log('[EventSync] Standalone sync complete');
    process.exit(0);
  }).catch(err => {
    console.error('[EventSync] Standalone sync failed:', err);
    process.exit(1);
  });
}
