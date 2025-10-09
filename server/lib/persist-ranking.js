// server/lib/persist-ranking.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL
});

export async function persistRankingTx({ snapshot_id, user_id, city, model_name, correlation_id, venues }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO rankings (ranking_id, snapshot_id, user_id, city, model_name)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING ranking_id`,
      [snapshot_id, user_id || null, city || null, model_name]
    );
    const ranking_id = r.rows[0].ranking_id;

    if (venues?.length) {
      const cols = [
        "ranking_id","name","place_id","category","rank",
        "distance_miles","drive_time_minutes","value_per_min","value_grade","surge"
      ];
      const rows = [];
      const args = [];
      let p = 1;
      for (const v of venues) {
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
      await client.query(
        `INSERT INTO ranking_candidates (${cols.join(",")}) VALUES ${rows.join(",")}`,
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
