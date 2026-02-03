import fs from "fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node run-sql-migration.js <file.sql>");
  process.exit(1);
}

const sql = fs.readFileSync(file, "utf8");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    await pool.query(sql);
    console.log("✅ migration applied:", file);
  } catch (e) {
    console.error("❌ migration failed:", e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
