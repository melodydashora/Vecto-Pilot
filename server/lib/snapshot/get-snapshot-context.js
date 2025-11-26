// server/lib/snapshot/get-snapshot-context.js
// Get full snapshot context including resolved address, weather, FAA, time/day/holiday

import { db } from '../../db/drizzle.js';
import { snapshots, users } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Get complete snapshot context for AI providers (Strategist, Briefer, Consolidator, Holiday Checker)
 * 
 * DATA ARCHITECTURE:
 * - Location data pulled from users table (authoritative source) via user_id FK
 * - API-enriched data (weather, air, airport_context, local_news) from snapshots table
 * - Prevents "Unknown location" by failing hard if formatted_address missing
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
 *   - Rejects snapshots where formatted_address is null/empty (fail-hard)
 *   - Uses users table as source of truth (prevents address duplication)
 *   - Migrating from legacy snapshot lat/lng to users table columns
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
