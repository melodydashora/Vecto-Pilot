// 2026-05-02: Workstream 6 Step 1 — extracted from briefing-service.js (commit 2/11).
// Pure cache-staleness predicates used by getOrGenerateBriefing's caching strategy.
// No I/O, no side effects — just date math + structural checks against a briefing row.

import { briefingLog, OP } from '../../../logger/workflow.js';

/**
 * Check if daily briefing is stale (different calendar day in user's timezone).
 * Daily briefing = news, closures, construction (refreshes at midnight).
 * @param {object} briefing - Briefing row from database
 * @param {string} timezone - User's IANA timezone (REQUIRED - no fallback)
 * @returns {boolean} True if briefing is from a different calendar day
 */
export function isDailyBriefingStale(briefing, timezone) {
  // NO FALLBACK - timezone is required for accurate date comparison
  if (!timezone) {
    briefingLog.warn(1, 'isDailyBriefingStale called without timezone - treating as stale', OP.CACHE);
    return true;
  }
  if (!briefing?.updated_at) return true;

  const updatedAt = new Date(briefing.updated_at);
  const now = new Date();

  // Get calendar date strings in user's timezone
  const briefingDate = updatedAt.toLocaleDateString('en-US', { timeZone: timezone });
  const todayDate = now.toLocaleDateString('en-US', { timeZone: timezone });

  // Stale if it's a different calendar day
  return briefingDate !== todayDate;
}

/**
 * Check if events data is stale (older than 4 hours).
 * Events need more frequent refresh than other daily data because:
 * - Event schedules change (cancellations, time changes)
 * - New events get announced
 * - "Tonight" events need accurate verification
 * @param {object} briefing - Briefing row from database
 * @returns {boolean} True if events are older than 4 hours
 */
export function isEventsStale(briefing) {
  if (!briefing?.updated_at) return true;

  const updatedAt = new Date(briefing.updated_at);
  const now = new Date();
  const ageMs = now - updatedAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  // Events stale after 4 hours (vs 24h for news/closures)
  const EVENTS_CACHE_HOURS = 4;
  return ageHours > EVENTS_CACHE_HOURS;
}

/**
 * Traffic always needs refresh (no caching).
 * Traffic conditions change rapidly and any incidents need immediate visibility.
 * @returns {boolean} Always true - traffic must be fresh on every call
 */
export function isTrafficStale() {
  return true; // Traffic always needs refresh - no caching
}

/**
 * Check if events are empty/missing - triggers immediate fetch.
 * Events are critical for rideshare demand, so empty = fetch now.
 * @param {object} briefing - Briefing row from database
 * @returns {boolean} True if events array is empty or missing
 */
export function areEventsEmpty(briefing) {
  if (!briefing?.events) return true;

  // Handle array format
  if (Array.isArray(briefing.events)) {
    return briefing.events.length === 0;
  }

  // Handle {items: [], reason: string} format
  if (briefing.events?.items && Array.isArray(briefing.events.items)) {
    return briefing.events.items.length === 0;
  }

  return true;
}
