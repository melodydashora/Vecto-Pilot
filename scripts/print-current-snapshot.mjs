cat > scripts/print-current-snapshot-file.mjs <<'EOF'
import pg from "pg";
import { writeFile } from "fs/promises";
import path from "path";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const latestSnapshotSql = `
SELECT
  snapshot_id,
  created_at,
  session_id,
  h3_r8,
  weather,
  air,
  permissions,
  holiday,
  is_holiday,
  lat,
  lng,
  city,
  state,
  country,
  formatted_address,
  timezone,
  local_iso,
  dow,
  hour,
  day_part_key,
  date,
  coord_key,
  user_id,
  market,
  status
FROM snapshots
ORDER BY created_at DESC
LIMIT 1;
`;

function formatValue(value) {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function formatSnapshot(row) {
  const fields = [
    "snapshot_id",
    "created_at",
    "session_id",
    "h3_r8",
    "weather",
    "air",
    "permissions",
    "holiday",
    "is_holiday",
    "lat",
    "lng",
    "city",
    "state",
    "country",
    "formatted_address",
    "timezone",
    "local_iso",
    "dow",
    "hour",
    "day_part_key",
    "date",
    "coord_key",
    "user_id",
    "market",
    "status",
  ];

  const lines = [];

  lines.push("CURRENT SNAPSHOT");
  lines.push("════════════════════════════════════════════════════════════");

  for (const field of fields) {
    const value = formatValue(row[field]);
    const valueLines = value.split("\n");

    if (valueLines.length === 1) {
      lines.push(`  ${field.padEnd(18)} ${valueLines[0]}`);
    } else {
      lines.push(`  ${field.padEnd(18)} ┐`);
      for (const line of valueLines) {
        lines.push(`  ${"".padEnd(18)} │ ${line}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

try {
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL in Replit environment");
  }

  const result = await pool.query(latestSnapshotSql);

  if (!result.rows.length) {
    throw new Error("No snapshot row found");
  }

  const output = formatSnapshot(result.rows[0]);
  const outputPath = path.resolve("snapshot.txt");

  await writeFile(outputPath, output, "utf8");

  console.log(`[snapshot] wrote latest snapshot row to ${outputPath}`);
} catch (err) {
  console.error("[snapshot] failed to write snapshot.txt:", err.message);
} finally {
  await pool.end();
}
EOF