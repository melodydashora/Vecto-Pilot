// server/lib/location/get-snapshot-context.js
// Two variants: minimal context for minstrategy, full snapshot for consolidator/briefing

import { db } from '../../db/drizzle.js';
import { snapshots, users } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Strategy context: Fields needed for minstrategy prompt
 * Includes: location, time, weather, airport - everything the strategist needs
 * Used by: minstrategy
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

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dow = snapshot.dow;
  const day_of_week = dow != null ? dayNames[dow] : 'Unknown';
  const is_weekend = dow === 0 || dow === 6;

  if (!snapshot?.formatted_address) {
    throw new Error(`[getSnapshotContext] CRITICAL: Missing formatted_address from snapshot ${snapshotId}`);
  }

  const ctx = {
    snapshot_id: snapshot.snapshot_id,
    // Location
    formatted_address: snapshot.formatted_address,
    city: snapshot.city,
    state: snapshot.state,
    lat: snapshot.lat,
    lng: snapshot.lng,
    timezone: snapshot.timezone,
    // Time
    dow,
    day_of_week,
    is_weekend,
    hour: snapshot.hour,
    day_part_key: snapshot.day_part_key,
    local_iso: snapshot.local_iso,
    created_at: snapshot.created_at,
    // Holiday
    holiday: snapshot.holiday,
    is_holiday: snapshot.is_holiday,
    // Conditions (needed for strategist prompt)
    weather: snapshot.weather,
    airport_context: snapshot.airport_context
  };

  console.log('[getSnapshotContext] ✅ Retrieved snapshot context:', {
    snapshot_id: ctx.snapshot_id,
    formatted_address: ctx.formatted_address,
    city: ctx.city,
    state: ctx.state,
    lat: ctx.lat,
    lng: ctx.lng,
    hour: ctx.hour,
    day_part_key: ctx.day_part_key,
    is_holiday: ctx.is_holiday,
    weather: ctx.weather ? { tempF: ctx.weather.tempF, conditions: ctx.weather.conditions } : null,
    airport: ctx.airport_context?.airport_code || null
  });

  return ctx;
}

/**
 * FULL snapshot: Complete row with weather, air, airport, briefing data
 * Used by: consolidator, briefing service, venue generator
 */
export async function getFullSnapshot(snapshotId) {
  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.snapshot_id, snapshotId))
    .limit(1);

  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dow = snapshot.dow;
  const day_of_week = dow != null ? dayNames[dow] : 'Unknown';
  const is_weekend = dow === 0 || dow === 6;

  if (!snapshot?.formatted_address) {
    throw new Error(`[getFullSnapshot] CRITICAL: Missing formatted_address from snapshot ${snapshotId}`);
  }
  
  const ctx = {
    snapshot_id: snapshot.snapshot_id,
    user_id: snapshot.user_id,
    // Location
    formatted_address: snapshot.formatted_address,
    user_address: snapshot.formatted_address,
    city: snapshot.city,
    state: snapshot.state,
    country: snapshot.country,
    lat: snapshot.lat,
    lng: snapshot.lng,
    accuracy_m: snapshot.accuracy_m,
    timezone: snapshot.timezone,
    
    // Date/time
    dow,
    day_of_week,
    is_weekend,
    hour: snapshot.hour,
    day_part_key: snapshot.day_part_key,
    local_iso: snapshot.local_iso,
    iso_timestamp: snapshot.created_at?.toISOString(),
    created_at: snapshot.created_at,
    
    // Holiday
    holiday: snapshot.holiday,
    is_holiday: snapshot.is_holiday,
    
    // Enriched data
    weather: snapshot.weather,
    air: snapshot.air,
    airport_context: snapshot.airport_context,
    news_briefing: snapshot.news_briefing
  };
  
  console.log('[getFullSnapshot] ✅ Retrieved FULL snapshot:', {
    snapshot_id: ctx.snapshot_id,
    city: ctx.city,
    state: ctx.state,
    lat: ctx.lat,
    lng: ctx.lng,
    timezone: ctx.timezone,
    weather: ctx.weather ? { tempF: ctx.weather.tempF, conditions: ctx.weather.conditions } : null,
    air: ctx.air ? { aqi: ctx.air.aqi } : null,
    airport_context: ctx.airport_context ? { code: ctx.airport_context.airport_code } : null
  });
  
  return ctx;
}
