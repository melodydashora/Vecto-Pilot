import pg from "pg";

const pool = new pg.Pool({ 
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL 
});

/**
 * Atomically persist ranking and all candidates in a single transaction.
 * If any part fails, the entire operation is rolled back.
 * 
 * @param {Object} params
 * @param {string} params.snapshot_id - Snapshot ID this ranking belongs to
 * @param {string} [params.user_id] - Optional user ID
 * @param {string} [params.city] - City name
 * @param {string} params.model_name - Model pipeline name (e.g., "claude-sonnet-4-5→gpt-5→gemini-2.5-pro")
 * @param {Array} params.venues - Array of venue objects with ranking data
 * @param {string} [params.correlation_id] - Optional correlation ID for tracking
 * @returns {Promise<string>} ranking_id on success
 * @throws {Error} On any database error (transaction is rolled back)
 */
export async function persistRankingTx({ 
  snapshot_id, 
  user_id, 
  city, 
  model_name, 
  venues,
  correlation_id 
}) {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    // Insert ranking record
    const r = await client.query(
      `INSERT INTO rankings (ranking_id, snapshot_id, user_id, city, model_name, correlation_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING ranking_id`,
      [snapshot_id, user_id || null, city || null, model_name, correlation_id || null]
    );
    
    const ranking_id = r.rows[0].ranking_id;

    // Build bulk insert for all candidates
    if (venues && venues.length > 0) {
      const vals = [];
      const args = [];
      let p = 1;
      
      for (const v of venues) {
        vals.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
        );
        args.push(
          ranking_id,
          v.name,
          v.place_id || null,
          v.category || null,
          v.rank,
          v.distance_miles ?? null,
          v.drive_time_minutes ?? null,
          v.value_per_min ?? null,
          v.value_grade ?? null,
          v.surge ?? null,
          v.est_earnings ?? null
        );
      }

      await client.query(
        `INSERT INTO ranking_candidates
         (ranking_id, name, place_id, category, rank, distance_miles, drive_time_minutes, 
          value_per_min, value_grade, surge, est_earnings)
         VALUES ${vals.join(",")}`,
        args
      );
    }
    
    await client.query("COMMIT");
    return ranking_id;
    
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
