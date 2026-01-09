/**
 * Centralized storage keys for localStorage and sessionStorage
 *
 * RULE: Never use raw strings for storage keys - always import from here.
 * This prevents key mismatch bugs that have broken production before.
 *
 * @see LESSONS_LEARNED.md - Token key mismatch incident
 * @created 2026-01-06 (P4-F audit remediation)
 */

// Prefix for all keys - ensures no collisions with other apps
export const STORAGE_PREFIX = 'vectopilot_';
export const LEGACY_PREFIX = 'vecto_'; // For backward compatibility

/**
 * localStorage keys - persist across sessions
 */
export const STORAGE_KEYS = {
  // Authentication
  AUTH_TOKEN: 'vectopilot_auth_token',
  USER_ID: 'vecto_user_id', // Legacy key, keep for backward compat

  // Device identification
  DEVICE_ID: 'vecto_device_id',

  // Strategy persistence (survives app switches)
  PERSISTENT_STRATEGY: 'vecto_persistent_strategy',
  STRATEGY_SNAPSHOT_ID: 'vecto_strategy_snapshot_id',
} as const;

/**
 * sessionStorage keys - cleared when tab closes
 */
export const SESSION_KEYS = {
  // Snapshot data for resume
  SNAPSHOT: 'vecto_snapshot',

  // Resume reason flag (consumed by CoPilotContext)
  RESUME_REASON: 'vecto_resume_reason',
} as const;

/**
 * Resume reason values
 */
export const RESUME_REASONS = {
  INIT: 'init',
  MANUAL_REFRESH: 'manual_refresh',
  RESUME: 'resume',
} as const;

// Type exports for TypeScript consumers
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
export type SessionKey = typeof SESSION_KEYS[keyof typeof SESSION_KEYS];
export type ResumeReason = typeof RESUME_REASONS[keyof typeof RESUME_REASONS];
