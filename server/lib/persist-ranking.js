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
      const cols = [
        "ranking_id","name","place_id","category","rank",
        "distance_miles","drive_time_minutes","value_per_min","value_grade","surge"
      ];
      const rows = [];
      const args = [];
      let p = 1;
      for (const v of venues) {
        console.log(`📊 [${correlation_id}] Candidate ${v.rank}: ${v.name} - place_id: ${v.place_id}, dist: ${v.distance_miles} mi, time: ${v.drive_time_minutes} min, value_per_min: ${v.value_per_min}, grade: ${v.value_grade}`);
        rows.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
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
          v.surge ?? null
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
