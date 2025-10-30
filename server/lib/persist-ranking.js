// server/lib/persist-ranking.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL
});

export async function persistRankingTx({ snapshot_id, user_id, city, model_name, correlation_id, venues }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(`🔐 [${correlation_id}] BEGIN TRANSACTION`);
    
    console.log(`📝 [${correlation_id}] INSERT rankings: { snapshot_id: ${snapshot_id}, user_id: ${user_id}, city: ${city}, model_name: ${model_name} }`);
    const r = await client.query(
      `INSERT INTO rankings (ranking_id, snapshot_id, user_id, city, model_name, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
       RETURNING ranking_id`,
      [snapshot_id, user_id || null, city || null, model_name]
    );
    const ranking_id = r.rows[0].ranking_id;
    console.log(`✅ [${correlation_id}] Ranking inserted with ID: ${ranking_id}`);

    if (venues?.length) {
      // UPSERT venues to catalog and bump metrics (atomic with ranking)
      for (const v of venues) {
        if (v.place_id) {
          try {
            // 1) Upsert to venue_catalog
            await client.query(`
              INSERT INTO venue_catalog (place_id, venue_name, address, lat, lng, category, city, metro, discovery_source, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'llm', NOW())
              ON CONFLICT (place_id) DO UPDATE
              SET venue_name = EXCLUDED.venue_name,
                  address = EXCLUDED.address,
                  lat = EXCLUDED.lat,
                  lng = EXCLUDED.lng,
                  category = EXCLUDED.category,
                  city = EXCLUDED.city,
                  metro = EXCLUDED.metro
            `, [v.place_id, v.name, '', v.lat, v.lng, v.category || 'unknown', city || null, null]);

            // 2) Upsert to venue_metrics (bump times_recommended)
            await client.query(`
              INSERT INTO venue_metrics (venue_id, times_recommended, times_chosen, positive_feedback, negative_feedback, reliability_score)
              SELECT venue_id, 1, 0, 0, 0, 0.5 FROM venue_catalog WHERE place_id = $1
              ON CONFLICT (venue_id) DO UPDATE SET times_recommended = venue_metrics.times_recommended + 1
            `, [v.place_id]);
          } catch (catalogErr) {
            console.warn(`⚠️ [${correlation_id}] Catalog/metrics upsert skipped for ${v.name}:`, catalogErr.message);
          }
        }
      }

      const cols = [
        "id","ranking_id","block_id","name","lat","lng","place_id","rank","exploration_policy",
        "distance_miles","drive_minutes","value_per_min","value_grade","not_worth","distance_source",
        "pro_tips","closed_reasoning","staging_tips","snapshot_id"
      ];
      const rows = [];
      const args = [];
      let p = 1;
      for (const v of venues) {
        console.log(`📊 [${correlation_id}] Candidate ${v.rank}: ${v.name} - place_id: ${v.place_id}, dist: ${v.distance_miles} mi, time: ${v.drive_time_minutes} min, value_per_min: ${v.value_per_min}, grade: ${v.value_grade}, source: ${v.distanceSource || v.distance_source || 'unknown'}`);
        rows.push(`(gen_random_uuid(),$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        args.push(
          ranking_id,
          v.place_id || `block_${v.rank}`,  // Use place_id as block_id (unique identifier)
          v.name,
          v.lat ?? 0,  // Required NOT NULL field
          v.lng ?? 0,  // Required NOT NULL field
          v.place_id || null,
          v.rank,
          'epsilon_greedy', // Default exploration policy
          v.distance_miles ?? null,
          v.drive_time_minutes || v.driveTimeMinutes || null,  // Column is drive_minutes
          v.value_per_min ?? null,
          v.value_grade ?? null,
          v.not_worth ?? false,
          v.distanceSource || v.distance_source || 'unknown', // Issue #30 Fix: Track distance source
          v.pro_tips || null,  // pro_tips is ARRAY type, insert directly
          v.closed_reasoning || null,  // Why recommend if closed
          v.staging_tips || null,  // Where to park/stage
          snapshot_id  // Link to snapshot for event research
        );
      }
      console.log(`📝 [${correlation_id}] INSERT ranking_candidates: ${venues.length} rows`);
      await client.query(
        `INSERT INTO ranking_candidates (${cols.join(",")}) VALUES ${rows.join(",")}`,
        args
      );
      console.log(`✅ [${correlation_id}] ${venues.length} candidates inserted`);
    }
    await client.query("COMMIT");
    console.log(`✅ [${correlation_id}] COMMIT SUCCESSFUL - Transaction complete`);
    return ranking_id;
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`❌ [${correlation_id}] ROLLBACK - Transaction failed:`, e.message);
    throw e;
  } finally {
    client.release();
  }
}
