#!/usr/bin/env node

import pg from 'pg';
import { config } from 'dotenv';
import { randomUUID } from 'crypto';

config();

const { Client } = pg;

const LAT = 33.12855399613802;
const LNG = -96.87550973624359;
const USER_ID = process.env.TEST_USER_ID || '97b62815-2fbd-4f64-9338-7744bb62ae7c';
const BASE = process.env.BASE_URL || 'http://localhost:5000';

// Helper functions
async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return r.json();
}

async function post(path, body, headers = {}) {
  const r = await fetch(`${BASE}${path}`, { 
    method: 'POST', 
    headers: { 'content-type': 'application/json', ...headers }, 
    body: JSON.stringify(body) 
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildTimeContext(tz) {
  const now = new Date();
  const dow = now.getDay(); // 0-6
  const hour = tz ? parseInt(new Intl.DateTimeFormat("en-US", { 
    timeZone: tz, 
    hour: "numeric", 
    hour12: false 
  }).format(now)) : now.getHours();
  
  // Classify day part
  let dayPartKey = 'afternoon';
  if (hour >= 0 && hour < 5) dayPartKey = 'overnight';
  else if (hour >= 5 && hour < 12) dayPartKey = 'morning';
  else if (hour >= 12 && hour < 15) dayPartKey = 'late_morning_noon';
  else if (hour >= 15 && hour < 17) dayPartKey = 'afternoon';
  else if (hour >= 17 && hour < 21) dayPartKey = 'early_evening';
  else dayPartKey = 'evening';
  
  return {
    local_iso: now.toISOString(),
    dow,
    hour,
    day_part_key: dayPartKey,
    timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 COMPLETE WORKFLOW ANALYSIS: GPS → API → DB → Models → UI');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log();

console.log('🔷 STEP 1: GPS COORDINATES FROM DEVICE');
console.log(`   📍 Latitude: ${LAT}`);
console.log(`   📍 Longitude: ${LNG}`);
console.log(`   👤 User ID: ${USER_ID}`);
console.log();

console.log('🔷 STEP 2: FETCH LOCATION DATA (APIs)');
console.log(`   📡 Calling /api/location/resolve`);

const resolved = await get(`/api/location/resolve?lat=${LAT}&lng=${LNG}`);
console.log(`   ✅ City: ${resolved.city}, ${resolved.state}`);
console.log(`   ✅ Timezone: ${resolved.timeZone}`);
console.log();

console.log('🔷 STEP 3: FETCH WEATHER & AIR QUALITY (optional)');
const weather = await get(`/api/location/weather?lat=${LAT}&lng=${LNG}`);
const air = await get(`/api/location/airquality?lat=${LAT}&lng=${LNG}`);

if (weather.available) {
  console.log(`   🌤️  Weather: ${weather.temperature}°F, ${weather.conditions}`);
}
if (air.available) {
  console.log(`   🌫️  AQI: ${air.aqi} (${air.category})`);
}
console.log();

console.log('🔷 STEP 4: BUILD SNAPSHOTV1 OBJECT');
const snapshot_id = randomUUID();
const device_id = randomUUID();  // Must be valid UUID
const session_id = randomUUID(); // Must be valid UUID

const snapshotV1 = {
  schema_version: 1,
  snapshot_id,
  user_id: USER_ID,
  device_id,
  session_id,
  created_at: new Date().toISOString(),
  coord: {
    lat: LAT,
    lng: LNG,
    accuracyMeters: 10,
    source: 'gps'
  },
  resolved: {
    city: resolved.city,
    state: resolved.state,
    country: resolved.country,
    timezone: resolved.timeZone,
    formattedAddress: resolved.formattedAddress
  },
  time_context: buildTimeContext(resolved.timeZone),
  weather: weather.available ? {
    tempF: weather.temperature,
    conditions: weather.conditions,
    description: weather.description
  } : undefined,
  air: air.available ? {
    aqi: air.aqi,
    category: air.category
  } : undefined,
  device: {
    ua: 'node-test-script',
    platform: 'test'
  },
  permissions: {
    geolocation: 'granted'
  }
};

console.log(`   ✅ Snapshot ID: ${snapshot_id}`);
console.log(`   ✅ Time: ${snapshotV1.time_context.day_part_key} (${snapshotV1.time_context.hour}:00)`);
console.log();

console.log('🔷 STEP 5: SAVE SNAPSHOT TO DATABASE');
const snapResponse = await post('/api/location/snapshot', snapshotV1);

if (snapResponse.status !== 200 && snapResponse.status !== 201) {
  console.error('❌ Failed to save snapshot:', snapResponse);
  process.exit(1);
}

console.log(`   ✅ Snapshot saved to database`);
console.log();

console.log('🔷 STEP 6: TRIGGER WORKFLOW - POST /api/blocks (with polling)');
console.log(`   📤 Request: {origin: {lat, lng}, userId}`);
console.log();

let correlationId = null;
let blocks = null;
let attempts = 0;
const maxAttempts = 20;

// Poll until strategy exists and blocks are ready
for (let i = 0; i < maxAttempts; i++) {
  attempts++;
  const res = await post('/api/blocks', { 
    origin: { lat: LAT, lng: LNG },
    userId: USER_ID
  }, {
    'x-snapshot-id': snapshot_id  // Include snapshot ID in header
  });
  
  correlationId = res.json?.correlationId || correlationId;
  
  if (res.status === 202) { 
    console.log(`   ⏳ Attempt ${attempts}: Strategy pending, retrying in 2s...`);
    await sleep(2000);
    continue;
  }
  
  if (res.status === 200 && Array.isArray(res.json?.blocks)) { 
    blocks = res.json.blocks;
    correlationId = res.json.correlationId;
    console.log(`   ✅ Blocks ready after ${attempts} attempts`);
    break;
  }
  
  if (res.status === 400) {
    console.error(`   ❌ Bad request (400):`, res.json);
    process.exit(1);
  }
  
  console.log(`   ⚠️ Attempt ${attempts}: Unexpected response (status ${res.status}), retrying in 2s...`);
  await sleep(2000);
}

if (!blocks) {
  console.error('❌ Blocks never became ready after', maxAttempts, 'attempts');
  process.exit(1);
}

console.log(`   ✅ Correlation ID: ${correlationId}`);
console.log(`   ✅ Received ${blocks.length} blocks`);
console.log();

// Validate first venue has non-zero distance/time
const firstVenue = blocks[0];
console.log('🔷 STEP 7: VALIDATE FIRST VENUE (Routes API data)');
console.log(`   📍 Name: ${firstVenue.name}`);
console.log(`   🆔 Place ID: ${firstVenue.placeId}`);
console.log(`   📏 Distance: ${firstVenue.estimated_distance_miles} mi`);
console.log(`   ⏱️  Drive Time: ${firstVenue.driveTimeMinutes} min`);
console.log(`   📡 Source: ${firstVenue.distanceSource}`);
console.log();

if (!firstVenue.estimated_distance_miles || firstVenue.estimated_distance_miles === 0) {
  console.error('❌ VALIDATION FAILED: Distance is 0 or missing!');
  process.exit(1);
}

if (!firstVenue.driveTimeMinutes || firstVenue.driveTimeMinutes === 0) {
  console.error('❌ VALIDATION FAILED: Drive time is 0 or missing!');
  process.exit(1);
}

console.log('   ✅ VALIDATION PASSED: Distance and time are non-zero');
console.log();

// Connect to database
const client = new Client({
  connectionString: process.env.DATABASE_URL
});

await client.connect();

console.log();
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('💾 DATABASE OPERATIONS & WORKFLOW TRACE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log();

// 1. Check snapshot table
console.log('🔷 STEP 8: DB WRITE → snapshots table');
const snapshotResult = await client.query(
  'SELECT * FROM snapshots WHERE snapshot_id = $1',
  [snapshot_id]
);

if (snapshotResult.rows.length > 0) {
  const snapshot = snapshotResult.rows[0];
  console.log('   💾 Table: snapshots');
  console.log('   ✅ Record:', {
    snapshot_id: snapshot.snapshot_id,
    city: snapshot.city,
    state: snapshot.state,
    timezone: snapshot.timezone,
    lat: snapshot.lat,
    lng: snapshot.lng,
    h3_r8: snapshot.h3_r8,
    weather: snapshot.weather
  });
  console.log();
} else {
  console.warn('⚠️ No snapshot found in database');
  console.log();
}

// 2. Check strategy table
console.log('🔷 STEP 9: CLAUDE SONNET 4.5 STRATEGIC ANALYSIS');
console.log('   🧠 Model: claude-sonnet-4-5-20250929 (Strategist)');
console.log('   📤 Input: snapshot context (GPS, weather, time, airport status)');
console.log('   📥 Output: strategy text, pro tips, earnings estimate');
console.log();

const strategyResult = await client.query(
  'SELECT * FROM strategies WHERE snapshot_id = $1 ORDER BY created_at DESC LIMIT 1',
  [snapshot_id]
);

if (strategyResult.rows.length > 0) {
  const strategy = strategyResult.rows[0];
  console.log('🔷 STEP 9B: DB WRITE → strategies table');
  console.log('   💾 Table: strategies');
  console.log('   ✅ Record:', {
    snapshot_id: strategy.snapshot_id,
    status: strategy.status,
    strategy_length: strategy.strategy?.length || 0,
    latency_ms: strategy.latency_ms,
    tokens: strategy.tokens,
    attempt: strategy.attempt
  });
  console.log();
} else {
  console.warn('⚠️ No strategy found in database');
  console.log();
}

// 3. Check rankings table
console.log('🔷 STEP 10: GPT-5 TACTICAL PLANNING');
console.log('   🧠 Model: gpt-5-preview (Planner)');
console.log('   📤 Input: Claude strategy + venue catalog');
console.log('   📥 Output: ranked venues with timing & value scores');
console.log();

const rankingResult = await client.query(
  'SELECT * FROM rankings WHERE correlation_id = $1',
  [correlationId]
);

if (rankingResult.rows.length > 0) {
  const ranking = rankingResult.rows[0];
  console.log('🔷 STEP 10B: DB WRITE → rankings table');
  console.log('   💾 Table: rankings');
  console.log('   ✅ Record:', {
    ranking_id: ranking.ranking_id,
    correlation_id: ranking.correlation_id,
    snapshot_id: ranking.snapshot_id
  });
  console.log();

  // 4. Check ranking_candidates table
  console.log('🔷 STEP 11: DB WRITE → ranking_candidates table');
  const candidatesResult = await client.query(
    'SELECT * FROM ranking_candidates WHERE ranking_id = $1',
    [ranking.ranking_id]
  );
  
  console.log(`   💾 Table: ranking_candidates (${candidatesResult.rows.length} records)`);
  if (candidatesResult.rows.length > 0) {
    const first = candidatesResult.rows[0];
    console.log('   ✅ First Candidate:', {
      name: first.name,
      place_id: first.place_id,
      lat: first.lat,
      lng: first.lng,
      estimated_distance_miles: first.estimated_distance_miles,
      drive_time_minutes: first.drive_time_minutes,
      distance_source: first.distance_source
    });
  }
  console.log();
} else {
  console.warn('⚠️ No ranking found in database');
  console.log();
}

// 5. Display Routes API enrichment
console.log('🔷 STEP 12: GOOGLE ROUTES API ENRICHMENT');
console.log('   📡 Google Routes API: traffic-aware distance & ETA');
console.log(`   📤 Input: origin (${LAT}, ${LNG}) → destination coords`);
console.log('   📥 Output: estimated_distance_miles, driveTimeMinutes');
console.log();

console.log('🔷 STEP 13: GEMINI 2.5 PRO JSON VALIDATION');
console.log('   🧠 Model: gemini-2.5-pro (Validator)');
console.log('   📤 Input: GPT-5 ranking + Routes API data');
console.log('   📥 Output: validated JSON with ≥6 venues');
console.log();

// 6. Display final blocks
console.log('🔷 STEP 14: FINAL BLOCKS TO UI');
console.log(`   📦 ${blocks.length} venues ready for display`);
console.log();

blocks.forEach((block, i) => {
  console.log(`   ${i + 1}. ${block.name}`);
  console.log(`      Distance: ${block.estimated_distance_miles} mi`);
  console.log(`      Drive Time: ${block.driveTimeMinutes} min`);
  console.log(`      Value/Min: $${block.value_per_min?.toFixed(2) || '0.00'}`);
  console.log(`      Grade: ${block.value_grade || 'N/A'}`);
  console.log(`      Earnings: $${block.estimatedEarningsPerRide || 0}`);
  console.log();
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ WORKFLOW COMPLETE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await client.end();
process.exit(0);
