#!/usr/bin/env node
import pg from "pg";
const LAT = 33.12855399613802;
const LNG = -96.87550973624359;
const USER_ID = process.env.TEST_USER_ID || "97b62815-2fbd-4f64-9338-7744bb62ae7c";
const ORIGIN = `{"lat":${LAT},"lng":${LNG},"userId":"${USER_ID}"}`;
const BASE = process.env.BASE_URL || "http://localhost:5000";

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  console.log("=== SNAPSHOT START ===");
  // 1) create snapshot
  const snap = await post("/api/location/snapshot", { lat: LAT, lng: LNG, userId: USER_ID });
  const snapshot_id = snap.json?.snapshot_id || snap.json?.id;
  if (!snapshot_id) throw new Error("no snapshot_id");
  console.log("snapshot_id:", snapshot_id);

  // 2) kick /api/blocks until strategy exists
  let corr=null, blocks=null;
  for (let i=0;i<20;i++){
    const res = await post("/api/blocks", { lat: LAT, lng: LNG, userId: USER_ID, snapshot_id, origin: { lat: LAT, lng: LNG } });
    corr = res.json?.correlationId || corr;
    if (res.status === 202) { console.log("pending_strategy…"); await sleep(1000); continue; }
    if (res.status === 200 && Array.isArray(res.json?.blocks)) { blocks = res.json.blocks; break; }
    await sleep(1000);
  }
  if (!blocks) throw new Error("blocks never ready");

  // 3) sanity: show first venue miles/time/source
  const v = blocks[0];
  console.log("first venue:", { name: v.name, placeId: v.placeId, miles: v.estimated_distance_miles, minutes: v.driveTimeMinutes, src: v.distanceSource });

  // 4) DB reads
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_CONNECTION_URL
  });
  await client.connect();

  const srows = (await client.query("SELECT snapshot_id, user_id, lat, lng, city, state, formatted_address, timezone, day_part_key FROM snapshots WHERE snapshot_id=$1", [snapshot_id])).rows;
  console.log("snapshots row:", srows[0]);

  const strats = (await client.query("SELECT id, snapshot_id, status, latency_ms, tokens, created_at FROM strategies WHERE snapshot_id=$1 ORDER BY created_at DESC LIMIT 1", [snapshot_id])).rows;
  console.log("strategy row:", strats[0]);

  const ranks = (await client.query("SELECT ranking_id, snapshot_id, user_id, city, model_name, created_at FROM rankings WHERE snapshot_id=$1 ORDER BY created_at DESC LIMIT 1", [snapshot_id])).rows;
  const ranking_id = ranks[0]?.ranking_id;
  console.log("ranking row:", ranks[0]);

  if (ranking_id) {
    const cand = (await client.query(
      "SELECT name, place_id, category, rank, distance_miles, drive_time_minutes, value_per_min, value_grade, surge FROM ranking_candidates WHERE ranking_id=$1 ORDER BY rank ASC",
      [ranking_id]
    )).rows;
    console.log("candidates[0..2]:", cand.slice(0,2));
  }

  await client.end();
  console.log("=== SNAPSHOT END ===");
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
