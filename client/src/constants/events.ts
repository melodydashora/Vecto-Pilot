/**
 * Centralized custom event names
 *
 * RULE: Never use raw strings for event names - always import from here.
 * Event names follow pattern: vecto-<domain>-<action>
 *
 * @created 2026-01-06 (P4-F audit remediation)
 */

/**
 * Custom DOM events used for cross-component communication
 */
export const EVENTS = {
  // Snapshot lifecycle
  SNAPSHOT_SAVED: 'vecto-snapshot-saved',
  STRATEGY_CLEARED: 'vecto-strategy-cleared',

  // Location/GPS
  MANUAL_REFRESH: 'vecto-manual-refresh',
  LOCATION_REFRESHED: 'vecto-location-refreshed',

  // Auth
  AUTH_ERROR: 'vecto-auth-error',
  AUTH_TOKEN_EXPIRED: 'auth-token-expired',

  // Snapshot ownership
  SNAPSHOT_OWNERSHIP_ERROR: 'snapshot-ownership-error',
} as const;

/**
 * Event detail types for TypeScript
 */
export interface SnapshotSavedDetail {
  snapshotId: string;
  holiday: string | null;
  is_holiday: boolean;
  reason?: 'init' | 'manual_refresh' | 'resume';
}

export interface AuthErrorDetail {
  error: string;
}

// Type exports
export type EventName = typeof EVENTS[keyof typeof EVENTS];
