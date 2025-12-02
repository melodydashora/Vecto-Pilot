// server/lib/places-cache.js
import { getSharedPool } from '../db/pool.js';
const pool = getSharedPool();

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
