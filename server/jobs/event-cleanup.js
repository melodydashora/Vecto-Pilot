// server/jobs/event-cleanup.js
// Hourly day-end deactivation of discovered_events (Melody, todo #35: "events should
// deactivate/clear once their day is over").
//
// 2026-09-13 rewrite. The previous version called fn_cleanup_expired_events(), a legacy
// function that targeted a table (events_facts) that never existed on this schema; the
// "relation does not exist" error was caught and logged as "skipping", so the job was a
// permanent no-op — and it was never started from the gateway anyway
// (docs/architecture/audits/DB_SCHEMA_EVALUATION_2026-09-13.md §2.2).
//
// Now: calls fn_deactivate_ended_events() (migrations/20260913_schema_repair.sql), which
// flips is_active=false / deactivation_reason='event_ended' once the event's end has passed
// in the VENUE's timezone (venue_catalog.timezone via venue_id). Rows whose timezone cannot
// be resolved are never guessed — they are skipped and the count is logged loudly.
// Errors are NOT swallowed: they are logged at error level and rethrown to the caller.

import { getSharedPool } from '../db/pool.js';

const CLEANUP_INTERVAL_MS = parseInt(process.env.EVENT_CLEANUP_INTERVAL_MS || '3600000', 10); // default: 1 hour
const ENABLE_CLEANUP = process.env.EVENT_CLEANUP_ENABLED !== 'false'; // default: enabled

let cleanupInterval = null;
let isRunning = false;

/**
 * Deactivate every active event whose local end time has passed.
 * @returns {Promise<{ deactivated: number, skipped_no_timezone: number }>}
 * @throws on any DB error (fail loud — callers decide whether to continue)
 */
export async function cleanupExpiredEvents() {
  if (isRunning) {
    console.log('[event-cleanup] Run already in progress, skipping this tick');
    return { deactivated: 0, skipped_no_timezone: 0 };
  }
  const pool = getSharedPool();
  if (!pool) {
    throw new Error('[event-cleanup] shared pool not available');
  }

  isRunning = true;
  const startTime = Date.now();
  try {
    const { rows } = await pool.query('SELECT deactivated, skipped_no_timezone FROM fn_deactivate_ended_events()');
    const deactivated = Number(rows?.[0]?.deactivated ?? 0);
    const skipped = Number(rows?.[0]?.skipped_no_timezone ?? 0);
    const elapsed = Date.now() - startTime;

    if (deactivated > 0) {
      console.log(`[event-cleanup] ✅ Deactivated ${deactivated} ended event(s) in ${elapsed}ms`);
    } else {
      console.log(`[event-cleanup] No ended events to deactivate (${elapsed}ms)`);
    }
    if (skipped > 0) {
      // Not an error, but not silent either: these events cannot be aged out until their
      // venue has a timezone (venue_catalog.timezone) — see fn_deactivate_ended_events().
      console.warn(`[event-cleanup] ⚠️ ${skipped} active event(s) have no resolvable venue timezone and were left untouched`);
    }
    return { deactivated, skipped_no_timezone: skipped };
  } catch (err) {
    console.error('[event-cleanup] ❌ fn_deactivate_ended_events() failed:', err.message);
    throw err;
  } finally {
    isRunning = false;
  }
}

/**
 * Start the hourly loop (runs once immediately). Idempotent.
 */
export function startCleanupLoop() {
  if (!ENABLE_CLEANUP) {
    console.log('[event-cleanup] Disabled via EVENT_CLEANUP_ENABLED=false');
    return;
  }
  if (cleanupInterval) {
    console.log('[event-cleanup] Loop already running');
    return;
  }

  const intervalMinutes = Math.round(CLEANUP_INTERVAL_MS / 60000);
  console.log(`[event-cleanup] Starting day-end event deactivation loop (every ${intervalMinutes} minutes)`);

  const tick = () => cleanupExpiredEvents().catch(() => { /* already logged at error level */ });
  tick();
  cleanupInterval = setInterval(tick, CLEANUP_INTERVAL_MS);
  cleanupInterval.unref(); // never keep the process alive on its own
}

/**
 * Stop the loop.
 */
export function stopCleanupLoop() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[event-cleanup] Loop stopped');
  }
}

/**
 * @returns {{ enabled: boolean, running: boolean, intervalMs: number, isCleanupInProgress: boolean }}
 */
export function getCleanupStatus() {
  return {
    enabled: ENABLE_CLEANUP,
    running: cleanupInterval !== null,
    intervalMs: CLEANUP_INTERVAL_MS,
    isCleanupInProgress: isRunning,
  };
}
