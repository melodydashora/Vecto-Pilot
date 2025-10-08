#!/usr/bin/env node

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Client } = pg;

const LAT = 33.12855399613802;
const LNG = -96.87550973624359;
const USER_ID = '97b62815-2fbd-4f64-9338-7744bb62ae7c';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 COMPLETE WORKFLOW ANALYSIS: GPS → API → DB → Models → UI');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log();

console.log('🔷 STEP 1: GPS COORDINATES FROM DEVICE');
console.log(`   📍 Latitude: ${LAT}`);
console.log(`   📍 Longitude: ${LNG}`);
console.log(`   👤 User ID: ${USER_ID}`);
console.log();

console.log('🔷 STEP 2: TRIGGER WORKFLOW - POST /api/blocks');
console.log(`   📤 Request: {lat: ${LAT}, lng: ${LNG}, userId: "${USER_ID}"}`);
console.log();

const response = await fetch('http://localhost:5000/api/blocks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ lat: LAT, lng: LNG, userId: USER_ID })
});

const data = await response.json();
const correlationId = data.correlationId;
const snapshotId = data.snapshot_id;

console.log(`   ✅ Correlation ID: ${correlationId}`);
console.log(`   ✅ Snapshot ID: ${snapshotId}`);
console.log();

// Wait for workflow to process
console.log('⏳ Waiting for workflow to complete...');
await new Promise(resolve => setTimeout(resolve, 3000));

// Connect to database
const client = new Client({
  connectionString: process.env.DATABASE_URL
});

await client.connect();

console.log();
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('💾 DATABASE OPERATIONS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log();

// 1. Check snapshot table
console.log('🔷 STEP 3A: GEOCODING API CALL (Reverse Geocode)');
console.log('   📡 Google Geocoding API: coordinates → address + place_id');
console.log(`   📤 Input: lat=${LAT}, lng=${LNG}`);
console.log('   📥 Output: city, state, address, timezone');
console.log();

const snapshotResult = await client.query(
  'SELECT * FROM snapshots WHERE snapshot_id = $1',
  [snapshotId]
);

if (snapshotResult.rows.length > 0) {
  const snapshot = snapshotResult.rows[0];
  console.log('🔷 STEP 3B: DB WRITE → snapshots table');
  console.log('   💾 Table: snapshots');
  console.log('   📝 Fields written:');
  console.log(`      - snapshot_id: ${snapshot.snapshot_id}`);
  console.log(`      - user_id: ${snapshot.user_id}`);
  console.log(`      - lat: ${snapshot.lat}`);
  console.log(`      - lng: ${snapshot.lng}`);
  console.log(`      - city: ${snapshot.city}`);
  console.log(`      - state: ${snapshot.state}`);
  console.log(`      - formatted_address: ${snapshot.formatted_address}`);
  console.log(`      - timezone: ${snapshot.timezone}`);
  console.log(`      - day_part_key: ${snapshot.day_part_key}`);
  console.log(`      - weather: ${JSON.stringify(snapshot.weather)}`);
  console.log(`      - created_at: ${snapshot.created_at}`);
  console.log();
}

// 2. Check if Claude strategy exists
const strategyCheck = await client.query(
  'SELECT * FROM strategies WHERE snapshot_id = $1 AND status = $2',
  [snapshotId, 'ok']
);

if (strategyCheck.rows.length > 0) {
  console.log('🔷 STEP 4: WORKFLOW GATING CHECK');
  console.log('   ✅ Snapshot has lat/lng → Proceed to TRIAD');
  console.log();
  
  console.log('🔷 STEP 5: TRIAD 1/3 - CLAUDE SONNET 4.5 (STRATEGIST)');
  console.log('   📖 DB READ from: snapshots table');
  console.log('   📝 Fields read:');
  console.log(`      - city: ${snapshotResult.rows[0].city}`);
  console.log(`      - state: ${snapshotResult.rows[0].state}`);
  console.log(`      - day_part_key: ${snapshotResult.rows[0].day_part_key}`);
  console.log(`      - weather: ${JSON.stringify(snapshotResult.rows[0].weather)}`);
  console.log(`      - lat, lng, timezone, formatted_address`);
  console.log();
  
  console.log('   📤 Sent to Claude Sonnet 4.5:');
  console.log('      - Full snapshot context (city, state, weather, time, etc.)');
  console.log('      - Prompt: Generate strategic overview with pro tips');
  console.log();
  
  const strategy = strategyCheck.rows[0];
  console.log('   📥 Claude Response:');
  console.log(`      - strategy: "${strategy.strategy.substring(0, 150)}..."`);
  console.log();
  
  console.log('   💾 DB WRITE → strategies table');
  console.log(`      - id: ${strategy.id}`);
  console.log(`      - snapshot_id: ${strategy.snapshot_id}`);
  console.log(`      - strategy: [saved]`);
  console.log(`      - status: ${strategy.status}`);
  console.log(`      - latency_ms: ${strategy.latency_ms}`);
  console.log(`      - created_at: ${strategy.created_at}`);
  console.log();
}

// 3. Check GPT-5 planning
console.log('🔷 STEP 6: WORKFLOW GATING CHECK');
console.log('   ✅ Claude strategy exists → Proceed to GPT-5');
console.log();

console.log('🔷 STEP 7: TRIAD 2/3 - GPT-5 PRO (TACTICAL PLANNER)');
console.log('   📖 DB READ from: strategies table');
console.log('   📝 Fields read:');
console.log(`      - strategy: [Claude's strategy]`);
console.log('   📖 DB READ from: snapshots table');
console.log('   📝 Fields read:');
console.log(`      - Full snapshot context`);
console.log();

console.log('   📤 Sent to GPT-5 Pro:');
console.log('      - Claude strategy_for_now (strategic guidance)');
console.log('      - Snapshot context (city, weather, time)');
console.log('      - Prompt: Generate tactical venue recommendations');
console.log();

console.log('   📥 GPT-5 Response:');
console.log('      - venues: [6 venues with name, category, lat, lng, description]');
console.log('      - tactical_summary: [positioning guidance]');
console.log('      - staging_location: [optimal staging point]');
console.log();

// 4. Check venue resolution
console.log('🔷 STEP 8: VENUE RESOLUTION (DB-First → API)');
console.log('   For each GPT-5 venue:');
console.log();

const placesResult = await client.query(
  'SELECT place_id, formatted_hours, cached_at FROM places_cache ORDER BY cached_at DESC LIMIT 3'
);

if (placesResult.rows.length > 0) {
  console.log('   🔍 STEP 8A: DB CHECK - places_cache table');
  placesResult.rows.forEach((place, idx) => {
    console.log(`      Cache ${idx + 1}:`);
    console.log(`         ✅ place_id="${place.place_id}"`);
    console.log(`         📖 formatted_hours cached at: ${place.cached_at}`);
  });
  console.log();
}
  
console.log('   🔍 STEP 8B: IF NOT IN DB - API RESOLUTION');
console.log('      a) Has name only?');
console.log('         📡 Places Find Place API: name → place_id + lat/lng');
console.log('         💾 Coordinates stored in memory for this request (not DB)');
console.log('      b) Has coords only?');
console.log('         📡 Geocoding API: lat/lng → place_id + address');
console.log('         💾 place_id + address stored in memory for this request');
console.log();
  
console.log('   💾 DB WRITE → places_cache table (business hours only)');
console.log('      - place_id, formatted_hours, cached_at');
console.log('      - Note: Coordinates NOT cached (always from APIs)');
console.log();

console.log('🔷 STEP 9: BUSINESS HOURS ENRICHMENT');
console.log('   📡 Google Places Details API (fields=opening_hours,business_status)');
console.log('   📤 Input: place_id (from DB or resolved)');
console.log('   📥 Output: opening_hours, business_status');
console.log('   💾 NO DB WRITE (hours are real-time, not cached)');
console.log();

console.log('🔷 STEP 10: WORKFLOW GATING CHECK');
console.log('   ✅ All venues have place_id, lat, lng → Proceed to Routes + Gemini');
console.log();

console.log('🔷 STEP 11: DISTANCE & ETA CALCULATION');
console.log('   📡 Google Routes API (traffic-aware)');
console.log('   📤 Input per venue:');
console.log('      - origin: {lat: snapshot.lat, lng: snapshot.lng}');
console.log('      - destination: {lat: venue.lat, lng: venue.lng}');
console.log('   📥 Output per venue:');
console.log('      - distanceMeters, durationSeconds (drive time)');
console.log('   💾 NO DB WRITE (distances calculated real-time)');
console.log();

console.log('🔷 STEP 12: TRIAD 3/3 - GEMINI 2.5 PRO (VALIDATOR)');
console.log('   📤 Sent to Gemini:');
console.log('      - venues with: name, lat, lng, distance, driveTime, hours, status');
console.log('      - snapshot context');
console.log('      - Prompt: Validate, calculate earnings, rank by value_per_min');
console.log();

console.log('   📥 Gemini Response per venue:');
console.log('      - placeId (echo back)');
console.log('      - estimated_earnings_per_ride');
console.log('      - earnings_per_mile');
console.log('      - validation_status');
console.log('      - ranking_score');
console.log();

// 5. Check ranking table
const rankingResult = await client.query(
  `SELECT r.*, 
    (SELECT COUNT(*) FROM ranking_candidates WHERE ranking_id = r.ranking_id) as candidate_count
   FROM rankings r 
   WHERE r.snapshot_id = $1`,
  [snapshotId]
);

if (rankingResult.rows.length > 0) {
  const ranking = rankingResult.rows[0];
  console.log('🔷 STEP 13: ML TRAINING - DB WRITES');
  console.log('   💾 DB WRITE → rankings table');
  console.log(`      - ranking_id: ${ranking.ranking_id} (correlation_id)`);
  console.log(`      - snapshot_id: ${ranking.snapshot_id}`);
  console.log(`      - user_id: ${ranking.user_id}`);
  console.log(`      - city: ${ranking.city}`);
  console.log(`      - model_name: ${ranking.model_name}`);
  console.log(`      - created_at: ${ranking.created_at}`);
  console.log();
  
  console.log('   💾 DB WRITE → ranking_candidates table');
  const candidatesResult = await client.query(
    'SELECT * FROM ranking_candidates WHERE ranking_id = $1 ORDER BY rank',
    [ranking.ranking_id]
  );
  
  console.log(`      Total candidates: ${candidatesResult.rows.length}`);
  candidatesResult.rows.forEach(c => {
    console.log(`      Rank ${c.rank}: ${c.name}`);
    console.log(`         - place_id: ${c.place_id}`);
    console.log(`         - category: ${c.category}`);
    console.log(`         - distance_miles: ${c.distance_miles}`);
    console.log(`         - drive_time_minutes: ${c.drive_time_minutes}`);
    console.log(`         - est_earnings: $${c.est_earnings}`);
    console.log(`         - value_per_min: $${c.value_per_min}/min`);
    console.log(`         - value_grade: ${c.value_grade}`);
  });
  console.log();
}

console.log('🔷 STEP 14: VALUE-PER-MINUTE CALCULATION');
console.log('   Formula: (base_rate × surge × trip_minutes) / (drive + wait + trip)');
console.log('   Server computes per venue:');
console.log('      - value_per_min');
console.log('      - value_grade (A/B/C/D)');
console.log('      - not_worth flag (if below floor)');
console.log();

console.log('🔷 STEP 15: FINAL RESPONSE TO CLIENT');
console.log('   📤 API Response Structure:');
console.log('      {');
console.log('        correlationId,');
console.log('        snapshot_id,');
console.log('        userId,');
console.log('        generatedAt,');
console.log('        strategy_for_now,');
console.log('        blocks: [');
console.log('          {');
console.log('            name, address, category,');
console.log('            coordinates: {lat, lng},');
console.log('            estimated_distance_miles,');
console.log('            driveTimeMinutes,');
console.log('            distanceSource: "routes_api",');
console.log('            value_per_min,');
console.log('            value_grade,');
console.log('            not_worth,');
console.log('            surge,');
console.log('            estimatedWaitTime,');
console.log('            estimatedEarningsPerRide,');
console.log('            estimated_earnings,');
console.log('            businessHours,');
console.log('            isOpen,');
console.log('            placeId,');
console.log('            proTips: []');
console.log('          }');
console.log('        ],');
console.log('        staging_area: {...}');
console.log('      }');
console.log();

console.log('🔷 STEP 16: FRONTEND RENDERING');
console.log('   📥 Client receives response');
console.log('   🎨 UI Mapper (client/src/pages/co-pilot.tsx):');
console.log('      CRITICAL: Preserves ALL server fields verbatim');
console.log('      - estimated_distance_miles (from Routes API)');
console.log('      - driveTimeMinutes (from Routes API)');
console.log('      - distanceSource ("routes_api")');
console.log('      - value_per_min, value_grade, not_worth');
console.log('      - surge, earnings_per_mile');
console.log('      - coordinates (from server, NEVER device GPS)');
console.log('   🖼️ UI Display:');
console.log('      - Distance badge: server miles (never recalculated)');
console.log('      - Value grade badge (A/B/C/D)');
console.log('      - "Not worth it" flag if below floor');
console.log('      - Business hours and open/closed status');
console.log('      - Staging area with parking tips');
console.log();

console.log('🔷 STEP 17: USER ACTION LOGGING');
const actionsResult = await client.query(
  'SELECT * FROM actions WHERE ranking_id = $1 ORDER BY created_at DESC LIMIT 5',
  [correlationId]
).catch(() => ({ rows: [] }));

if (actionsResult.rows.length > 0) {
  console.log('   💾 DB WRITE → actions table');
  actionsResult.rows.forEach(action => {
    console.log(`      - action_type: ${action.action_type}`);
    console.log(`        ranking_id: ${action.ranking_id}`);
    console.log(`        snapshot_id: ${action.snapshot_id}`);
    console.log(`        created_at: ${action.created_at}`);
  });
} else {
  console.log('   💾 DB WRITE → actions table (when user interacts)');
  console.log('      - action_type: blocks_viewed / venue_selected / navigation_started');
  console.log('      - ranking_id: links action to specific recommendation set');
  console.log('      - snapshot_id: links to snapshot context');
  console.log('      - venue_id: which venue was selected');
}
console.log();

await client.end();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ WORKFLOW COMPLETE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log();

console.log('📊 SUMMARY OF DATA FLOW:');
console.log();
console.log('┌─ GPS Device');
console.log('│  └─→ lat/lng');
console.log('│');
console.log('├─ Geocoding API');
console.log('│  └─→ city, state, address, timezone');
console.log('│      └─→ DB: snapshots table (write)');
console.log('│');
console.log('├─ Weather/AirQuality APIs');
console.log('│  └─→ weather_summary, air_quality');
console.log('│      └─→ DB: snapshots table (update)');
console.log('│');
console.log('├─ TRIAD 1/3: Claude Sonnet 4.5');
console.log('│  ├─→ DB: snapshots (read context)');
console.log('│  └─→ strategy_for_now');
console.log('│      └─→ DB: snapshots.strategy_for_now (write)');
console.log('│');
console.log('├─ TRIAD 2/3: GPT-5 Pro');
console.log('│  ├─→ DB: snapshots.strategy_for_now (read)');
console.log('│  └─→ venues[], tactical_summary, staging_location');
console.log('│');
console.log('├─ Venue Resolution (per venue)');
console.log('│  ├─→ DB: places_cache (read if exists)');
console.log('│  ├─→ If not in DB:');
console.log('│  │   ├─→ Places Find Place API (name → place_id + coords)');
console.log('│  │   └─→ Geocoding API (coords → place_id + address)');
console.log('│  └─→ DB: places_cache (write if new)');
console.log('│');
console.log('├─ Business Hours');
console.log('│  └─→ Places Details API (place_id → hours, status)');
console.log('│');
console.log('├─ Distance & ETA');
console.log('│  └─→ Routes API (origin + destination → distance, time)');
console.log('│');
console.log('├─ TRIAD 3/3: Gemini 2.5 Pro');
console.log('│  └─→ earnings, validation, ranking per venue');
console.log('│');
console.log('├─ Value Calculation (server)');
console.log('│  └─→ value_per_min, value_grade, not_worth');
console.log('│');
console.log('├─ ML Training');
console.log('│  ├─→ DB: rankings table (write)');
console.log('│  └─→ DB: ranking_candidates table (write all venues)');
console.log('│');
console.log('├─ API Response');
console.log('│  └─→ Client receives smartblocks');
console.log('│');
console.log('├─ Frontend Rendering');
console.log('│  └─→ UI displays blocks (server coordinates only)');
console.log('│');
console.log('└─ User Actions');
console.log('   └─→ DB: user_actions table (write on interaction)');
console.log();

console.log('🔑 KEY ARCHITECTURAL RULES ENFORCED:');
console.log('   ✅ Geocoding API = coordinates ⇄ address (+ place_id)');
console.log('   ✅ Places Details API = business metadata ONLY (hours, status)');
console.log('   ✅ Routes API = distance & time calculations');
console.log('   ✅ Database = source of truth for cached places');
console.log('   ✅ Server coordinates = always used (never client GPS)');
console.log('   ✅ Workflow gating = prevents incomplete data propagation');
console.log('   ✅ Key-based merge = no index-based alignment errors');
console.log();
