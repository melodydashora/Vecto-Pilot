import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const ping = await pool.query("SELECT 1 as ok");
    console.log("✅ Ping:", ping.rows[0]);

    const ext = await pool.query("SELECT extname FROM pg_extension WHERE extname='vector'");
    console.log("✅ pgvector installed:", ext.rows.length > 0);

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
    );
    console.log("✅ Tables:", tables.rows.map(r => r.table_name));

    const cols = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='documents'"
    );
    if (cols.rows.length > 0) {
      console.log("✅ documents columns:", cols.rows);
    } else {
      console.log("⚠️  documents table not found");
    }

    const indexes = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename='documents'"
    );
    if (indexes.rows.length > 0) {
      console.log("✅ documents indexes:", indexes.rows.map(r => r.indexname));
    }

  } catch (e) {
    console.error("❌ DB doctor error:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
