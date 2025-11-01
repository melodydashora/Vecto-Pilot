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

  // Return full context with all fields providers need
  return {
    snapshot_id: snapshot.snapshot_id,
    formatted_address: snapshot.formatted_address,
    user_address: snapshot.formatted_address, // alias for compatibility
    city: snapshot.city,
    state: snapshot.state,
    lat: snapshot.lat,
    lng: snapshot.lng,
    timezone: snapshot.timezone,
    day_part_key: snapshot.day_part_key,
    weather: snapshot.weather,
    airport_context: snapshot.airport_context,
    created_at: snapshot.created_at,
    news_briefing: snapshot.news_briefing // includes holiday from Gemini
  };
}
