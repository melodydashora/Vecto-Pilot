// server/lib/snapshot/get-snapshot-context.js
// Get full snapshot context including resolved address, weather, FAA, time/day/holiday

import { db } from '../../db/drizzle.js';
import { snapshots, users } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Get complete snapshot context for AI providers
 * Includes: address, city/state, lat/lng, weather, airport, timezone, day_part, created_at
 * Location data is pulled from users table (authoritative source) via user_id FK
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

  // Fetch location data from users table (source of truth)
  let userData = null;
  if (snapshot.user_id) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.user_id, snapshot.user_id))
      .limit(1);
    userData = user;
  }

  // CRITICAL: Compute day_of_week string from dow number for date propagation
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Use user data if available (from users table), fallback to snapshot legacy fields
  const dow = userData?.dow ?? snapshot.dow;
  const day_of_week = dow != null ? dayNames[dow] : 'Unknown';
  const is_weekend = dow === 0 || dow === 6;

  // Return full context with ALL fields providers need
  // CRITICAL DATE PROPAGATION: dow, day_of_week, hour, local_iso, iso_timestamp
  // These fields are authoritative and must be passed to all providers
  
  // CRITICAL FIX: Reject if formatted_address missing - fail hard instead of silently using fallback
  // This alerts LLM pipeline to missing location data rather than silently using generic "Unknown location"
  if (!userData?.formatted_address) {
    console.error('[getSnapshotContext] ❌ CRITICAL: Missing formatted_address from users table', {
      snapshot_id: snapshot.snapshot_id,
      user_id: snapshot.user_id,
      userData: userData ? { city: userData.city, state: userData.state } : null
    });
  }
  
  const formattedAddress = userData?.formatted_address || `${userData?.city || 'Unknown'}, ${userData?.state || 'Area'}`;
  
  return {
    snapshot_id: snapshot.snapshot_id,
    user_id: snapshot.user_id,
    // Location data from users table (authoritative source)
    formatted_address: formattedAddress,
    user_address: formattedAddress, // alias for compatibility
    city: userData?.city || snapshot.city,
    state: userData?.state || snapshot.state,
    country: userData?.country || snapshot.country,
    // CRITICAL FIX Finding #6: Dual lat/lng columns during migration
    // new_lat/new_lng: Current write target (set by GPS refresh via /api/location/resolve)
    // lat/lng: Legacy columns - being phased out after all existing data migrated
    // Priority: 1) new_lat/new_lng if populated, 2) lat/lng fallback, 3) snapshot historical data
    lat: userData?.new_lat ?? userData?.lat ?? snapshot.lat,
    lng: userData?.new_lng ?? userData?.lng ?? snapshot.lng,
    accuracy_m: userData?.accuracy_m ?? snapshot.accuracy_m,
    timezone: userData?.timezone || snapshot.timezone,
    
    // CRITICAL: Date/time fields from users table (authority for all downstream providers)
    dow: dow, // 0=Sunday, 1=Monday, etc. (authoritative)
    day_of_week, // Computed string: "Sunday", "Monday", etc.
    is_weekend, // Computed flag
    hour: userData?.hour ?? snapshot.hour, // Hour of day (0-23)
    day_part_key: userData?.day_part_key || snapshot.day_part_key, // "morning", "afternoon", "evening", "night"
    local_iso: userData?.local_iso || snapshot.local_iso, // Local timestamp without timezone
    iso_timestamp: snapshot.created_at?.toISOString(), // ISO timestamp with timezone
    created_at: snapshot.created_at, // Full timestamp object
    
    // Holiday information (populated by Perplexity briefing)
    holiday: snapshot.holiday, // Holiday name if today is a holiday (e.g., "Thanksgiving")
    is_holiday: snapshot.is_holiday, // Boolean: true if today is a holiday
    
    // API-enriched data from snapshots
    weather: snapshot.weather,
    airport_context: snapshot.airport_context,
    news_briefing: snapshot.news_briefing // includes holiday from Gemini
  };
}
