// server/lib/places-cache.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL
});

/**
 * Upsert place coordinates and address into places table
 * Separates stable data (coords/address) from volatile data (hours in places_cache)
 */
export async function upsertPlace({ place_id, name, formatted_address, lat, lng }) {
  if (!place_id) return;
  
  try {
    await pool.query(
      `INSERT INTO places (place_id, name, formatted_address, lat, lng, coords_verified_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (place_id) DO UPDATE SET
         name = EXCLUDED.name,
         formatted_address = EXCLUDED.formatted_address,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         coords_verified_at = now()`,
      [place_id, name || null, formatted_address || null, lat, lng]
    );
    console.log(`[Places Cache] ✅ Upserted place_id: ${place_id}`);
  } catch (e) {
    console.error(`[Places Cache] ⚠️ Upsert failed for ${place_id}:`, e.message);
  }
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
