/**
 * Strategy Status Constants
 *
 * 2026-01-10: S-004 FIX - Consolidated status enum to eliminate drift
 *
 * Single source of truth for all strategy-related status values.
 * Schema comment says `pending|ok|failed` but code evolved to need more states.
 *
 * State Machine:
 *   pending → running → ok
 *                    → pending_blocks → ok
 *                    → failed
 *
 * @see docs/plans/CONSOLIDATED_CLEANUP_2026-01-10.md (Issue S-004)
 */

/**
 * Strategy generation status values
 * @readonly
 * @enum {string}
 */
export const STRATEGY_STATUS = Object.freeze({
  /** Initial state - strategy not yet started */
  PENDING: 'pending',

  /** Strategy generation in progress (TRIAD pipeline running) */
  RUNNING: 'running',

  /** Strategy complete and ready to serve */
  OK: 'ok',

  /** Strategy complete, SmartBlocks generation in progress */
  PENDING_BLOCKS: 'pending_blocks',

  /** Strategy generation failed */
  FAILED: 'failed',
});

/**
 * Status values that indicate strategy content is available
 * Use for "should we serve cached strategy?" checks
 */
export const STRATEGY_READY_STATUSES = Object.freeze([
  STRATEGY_STATUS.OK,
  STRATEGY_STATUS.PENDING_BLOCKS,
]);

/**
 * Status values that indicate generation is in progress
 * Use for "is there already work happening?" checks
 */
export const STRATEGY_IN_PROGRESS_STATUSES = Object.freeze([
  STRATEGY_STATUS.PENDING,
  STRATEGY_STATUS.RUNNING,
]);

/**
 * Status values that indicate strategy is done (success or failure)
 * Use for "has generation completed?" checks
 */
export const STRATEGY_TERMINAL_STATUSES = Object.freeze([
  STRATEGY_STATUS.OK,
  STRATEGY_STATUS.FAILED,
]);

/**
 * Check if a status indicates strategy content is available
 * @param {string} status
 * @returns {boolean}
 */
export function isStrategyReady(status) {
  return STRATEGY_READY_STATUSES.includes(status);
}

/**
 * Check if a status indicates generation is in progress
 * @param {string} status
 * @returns {boolean}
 */
export function isStrategyInProgress(status) {
  return STRATEGY_IN_PROGRESS_STATUSES.includes(status);
}

/**
 * Check if a status indicates generation has completed (success or failure)
 * @param {string} status
 * @returns {boolean}
 */
export function isStrategyTerminal(status) {
  return STRATEGY_TERMINAL_STATUSES.includes(status);
}

// ============================================================================
// Job Queue Status (separate from strategy status)
// ============================================================================

/**
 * Job queue status values (triad_jobs, block_jobs)
 * @readonly
 * @enum {string}
 */
export const JOB_STATUS = Object.freeze({
  /** Job is queued, waiting to run */
  QUEUED: 'queued',

  /** Job is currently running */
  RUNNING: 'running',

  /** Job is being retried after a failure */
  RETRYING: 'retrying',

  /** Job completed successfully */
  SUCCEEDED: 'succeeded',

  /** Job failed permanently (max retries exceeded) */
  FAILED: 'failed',
});

/**
 * Job statuses that indicate the job is still active
 */
export const JOB_ACTIVE_STATUSES = Object.freeze([
  JOB_STATUS.QUEUED,
  JOB_STATUS.RUNNING,
  JOB_STATUS.RETRYING,
]);

// ============================================================================
// Legacy Compatibility
// ============================================================================

/**
 * @deprecated 'complete' was used historically but should be 'ok'
 * This constant exists only for backward compatibility during migration.
 * Do NOT use in new code - always use STRATEGY_STATUS.OK
 */
export const LEGACY_COMPLETE = 'complete';

/**
 * Check if status is 'ok' or legacy 'complete' (for backward compatibility)
 * @deprecated Use isStrategyReady() for new code
 * @param {string} status
 * @returns {boolean}
 */
export function isStrategyComplete(status) {
  return status === STRATEGY_STATUS.OK ||
         status === STRATEGY_STATUS.PENDING_BLOCKS ||
         status === LEGACY_COMPLETE;
}
