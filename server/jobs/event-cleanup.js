// server/jobs/event-cleanup.js
// Scheduled job to clean up expired events from events_facts table
// Runs fn_cleanup_expired_events() on a configurable interval

import { getSharedPool } from '../db/pool.js';

// Configuration
const CLEANUP_INTERVAL_MS = parseInt(process.env.EVENT_CLEANUP_INTERVAL_MS || '3600000', 10); // Default: 1 hour
const ENABLE_CLEANUP = process.env.EVENT_CLEANUP_ENABLED !== 'false'; // Default: enabled

// State
let cleanupInterval = null;
let isRunning = false;

/**
 * Run cleanup of expired events
 * Calls the fn_cleanup_expired_events() database function
 * @returns {Promise<number>} - Number of events deleted
 */
export async function cleanupExpiredEvents() {
  if (isRunning) {
    console.log('[event-cleanup] Cleanup already in progress, skipping');
    return 0;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    const pool = getSharedPool();
    if (!pool) {
      console.log('[event-cleanup] Shared pool not available, skipping cleanup');
      return 0;
    }

    // Use raw pg query - more reliable than Drizzle for function calls
    const result = await pool.query('SELECT fn_cleanup_expired_events() as deleted_count');
    const deletedCount = result.rows?.[0]?.deleted_count || 0;
    const elapsed = Date.now() - startTime;

    if (deletedCount > 0) {
      console.log(`[event-cleanup] ✅ Cleaned up ${deletedCount} expired events in ${elapsed}ms`);
    } else {
      console.log(`[event-cleanup] No expired events to clean up (${elapsed}ms)`);
    }

    return deletedCount;
  } catch (err) {
    // Handle specific error cases gracefully
    if (err.message?.includes('does not exist')) {
      if (err.message.includes('events_facts')) {
        console.log('[event-cleanup] events_facts table not found, skipping cleanup');
      } else if (err.message.includes('fn_cleanup_expired_events')) {
        console.log('[event-cleanup] Cleanup function not found, skipping');
      }
      return 0;
    }
    console.error('[event-cleanup] ❌ Cleanup failed:', err.message);
    return 0;
  } finally {
    isRunning = false;
  }
}

/**
 * Start the cleanup loop
 * Runs cleanup at configured interval
 */
export function startCleanupLoop() {
  if (!ENABLE_CLEANUP) {
    console.log('[event-cleanup] Cleanup disabled via EVENT_CLEANUP_ENABLED=false');
    return;
  }

  if (cleanupInterval) {
    console.log('[event-cleanup] Cleanup loop already running');
    return;
  }

  const intervalMinutes = Math.round(CLEANUP_INTERVAL_MS / 60000);
  console.log(`[event-cleanup] Starting cleanup loop (every ${intervalMinutes} minutes)`);

  // Run immediately on startup
  cleanupExpiredEvents().catch(err => {
    console.error('[event-cleanup] Initial cleanup failed:', err.message);
  });

  // Schedule periodic cleanup
  cleanupInterval = setInterval(() => {
    cleanupExpiredEvents().catch(err => {
      console.error('[event-cleanup] Scheduled cleanup failed:', err.message);
    });
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent process from exiting
  cleanupInterval.unref();
}

/**
 * Stop the cleanup loop
 */
export function stopCleanupLoop() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[event-cleanup] Cleanup loop stopped');
  }
}

/**
 * Get cleanup status
 * @returns {Object} - Current status
 */
export function getCleanupStatus() {
  return {
    enabled: ENABLE_CLEANUP,
    running: cleanupInterval !== null,
    intervalMs: CLEANUP_INTERVAL_MS,
    isCleanupInProgress: isRunning
  };
}
