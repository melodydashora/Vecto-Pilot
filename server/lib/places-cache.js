// server/lib/places-cache.js
import { getSharedPool } from '../db/pool.js';
const pool = getSharedPool();

/**
 * Upsert place coordinates and address into places_cache table
 * NOTE: The 'places' table doesn't exist - all data goes into places_cache
 * This function is deprecated and should not be used.
 */
export async function upsertPlace({ place_id, name, formatted_address, lat, lng }) {
  if (!place_id) return;
  
  // DEPRECATED: 'places' table doesn't exist in schema
  // All place data is stored in places_cache
  console.warn(`[Places Cache] ⚠️ upsertPlace is deprecated - 'places' table doesn't exist. Use places_cache only.`);
  return;
}

/**
 * Upsert business hours into places_cache table
 */
export async function upsertPlaceHours({ place_id, formatted_hours }) {
  if (!place_id || !formatted_hours) return;
  
  try {
    await pool.query(
      `INSERT INTO places_cache (place_id, formatted_hours, cached_at, access_count)
       VALUES ($1, $2, now(), 1)
       ON CONFLICT (place_id) DO UPDATE SET
         formatted_hours = EXCLUDED.formatted_hours,
         cached_at = now(),
         access_count = places_cache.access_count + 1`,
      [place_id, JSON.stringify(formatted_hours)]
    );
    console.log(`[Places Cache] ✅ Upserted hours for place_id: ${place_id}`);
  } catch (e) {
    console.error(`[Places Cache] ⚠️ Hours upsert failed for ${place_id}:`, e.message);
  }
}
