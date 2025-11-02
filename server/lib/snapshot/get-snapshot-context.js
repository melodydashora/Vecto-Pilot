// server/lib/snapshot/get-snapshot-context.js
// Get full snapshot context including resolved address, weather, FAA, time/day/holiday

import { db } from '../../db/drizzle.js';
import { snapshots } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Get complete snapshot context for AI providers
 * Includes: address, city/state, lat/lng, weather, airport, timezone, day_part, created_at
 * @param {string} snapshotId - UUID of snapshot
 * @returns {Promise<Object>} Full snapshot context
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
  const day_of_week = snapshot.dow != null ? dayNames[snapshot.dow] : 'Unknown';
  const is_weekend = snapshot.dow === 0 || snapshot.dow === 6;

  // Return full context with ALL fields providers need
  // CRITICAL DATE PROPAGATION: dow, day_of_week, hour, local_iso, iso_timestamp
  // These fields are authoritative and must be passed to all providers
  return {
    snapshot_id: snapshot.snapshot_id,
    formatted_address: snapshot.formatted_address,
    user_address: snapshot.formatted_address, // alias for compatibility
    city: snapshot.city,
    state: snapshot.state,
    lat: snapshot.lat,
    lng: snapshot.lng,
    timezone: snapshot.timezone,
    
    // CRITICAL: Date/time fields (authority for all downstream providers)
    dow: snapshot.dow, // 0=Sunday, 1=Monday, etc. (authoritative)
    day_of_week, // Computed string: "Sunday", "Monday", etc.
    is_weekend, // Computed flag
    hour: snapshot.hour, // Hour of day (0-23)
    day_part_key: snapshot.day_part_key, // "morning", "afternoon", "evening", "night"
    local_iso: snapshot.local_iso, // Local timestamp without timezone
    iso_timestamp: snapshot.created_at?.toISOString(), // ISO timestamp with timezone
    created_at: snapshot.created_at, // Full timestamp object
    
    weather: snapshot.weather,
    airport_context: snapshot.airport_context,
    news_briefing: snapshot.news_briefing // includes holiday from Gemini
  };
}
