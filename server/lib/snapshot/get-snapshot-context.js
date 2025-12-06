// server/lib/snapshot/get-snapshot-context.js
// Get full snapshot context including resolved address, weather, FAA, time/day/holiday

import { db } from '../../db/drizzle.js';
import { snapshots, users } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Get complete snapshot context for AI providers (Strategist, Briefer, Consolidator, Holiday Checker)
 * 
 * DATA ARCHITECTURE:
 * - ALL location, time, weather data stored in snapshots table at snapshot creation
 * - Snapshots table is authoritative source (denormalized for reliability)
 * - No joins needed - single query retrieves everything providers need
 * 
 * REQUIRED BY LLMs:
 *   - formatted_address: Full street address (e.g., "1000 N Dallas Parkway, Carrollton, TX")
 *   - city, state, country: Address components for geographic context
 *   - lat, lng: Coordinates for distance calculations
 *   - timezone: IANA identifier for local time context
 *   - dow, hour, day_part_key: Time context in driver's timezone (not UTC)
 *   - weather, air: Real-time environmental conditions
 *   - airport_context: FAA delays, closures for demand signals
 *   - local_news: Perplexity briefing for local events/context
 *   - holiday, is_holiday: Special event detection
 * 
 * CRITICAL BEHAVIOR:
 *   - Snapshots store complete context at creation time (no joins)
 *   - Fails hard if formatted_address missing (prevents "Unknown location" fallback)
 * 
 * @param {string} snapshotId - UUID of snapshot to resolve
 * @returns {Promise<Object>} Full context ready for AI provider pipeline
 * @throws {Error} If snapshot not found or formatted_address missing
 */
export async function getSnapshotContext(snapshotId) {
  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId))
    .limit(1);

  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  // CRITICAL: Compute day_of_week string from dow number for date propagation
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Use snapshot as authority for time context (it's immutable and captures the moment)
  const dow = snapshot.dow;
  const day_of_week = dow != null ? dayNames[dow] : 'Unknown';
  const is_weekend = dow === 0 || dow === 6;

  // CRITICAL FIX: Fail hard if formatted_address missing - don't use fallback
  if (!snapshot?.formatted_address) {
    throw new Error(`[getSnapshotContext] CRITICAL: Missing formatted_address from snapshot ${snapshotId}. Cannot proceed without location data.`);
  }
  
  const ctx = {
    snapshot_id: snapshot.snapshot_id,
    user_id: snapshot.user_id,
    // Location data (stored in snapshot at creation - denormalized for reliability)
    formatted_address: snapshot.formatted_address,
    user_address: snapshot.formatted_address, // alias for compatibility
    city: snapshot.city,
    state: snapshot.state,
    country: snapshot.country,
    // Coordinates from snapshot
    lat: snapshot.lat,
    lng: snapshot.lng,
    accuracy_m: snapshot.accuracy_m,
    timezone: snapshot.timezone,
    
    // Date/time fields from snapshot (immutable at snapshot creation)
    dow: dow, // 0=Sunday, 1=Monday, etc.
    day_of_week, // Computed string: "Sunday", "Monday", etc.
    is_weekend, // Computed flag
    hour: snapshot.hour, // Hour of day (0-23) 
    day_part_key: snapshot.day_part_key, // "morning", "afternoon", "evening", "night"
    local_iso: snapshot.local_iso, // Local timestamp
    iso_timestamp: snapshot.created_at?.toISOString(),
    created_at: snapshot.created_at,
    
    // Holiday information
    holiday: snapshot.holiday,
    is_holiday: snapshot.is_holiday,
    
    // API-enriched data
    weather: snapshot.weather,
    air: snapshot.air,
    airport_context: snapshot.airport_context,
    news_briefing: snapshot.news_briefing
  };
  
  console.log('[getSnapshotContext] ✅ Retrieved FULL snapshot context:', {
    snapshot_id: ctx.snapshot_id,
    formatted_address: ctx.formatted_address,
    lat: ctx.lat,
    lng: ctx.lng,
    city: ctx.city,
    state: ctx.state,
    timezone: ctx.timezone,
    hour: ctx.hour,
    dow: ctx.dow,
    day_part_key: ctx.day_part_key,
    weather: ctx.weather ? { tempF: ctx.weather.tempF, conditions: ctx.weather.conditions } : null,
    air: ctx.air ? { aqi: ctx.air.aqi, category: ctx.air.category } : null,
    airport_context: ctx.airport_context ? { code: ctx.airport_context.airport_code, delays: ctx.airport_context.delay_minutes } : null,
    holiday: ctx.holiday,
    is_holiday: ctx.is_holiday
  });
  
  return ctx;
}
