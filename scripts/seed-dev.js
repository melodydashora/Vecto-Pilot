// scripts/seed-dev.js
// Development seed script for Block Schema Contract testing
// Creates test snapshots with complete strategies for immediate testing

import crypto from 'crypto';
import { db } from "../server/db/drizzle.js";
import { snapshots, strategies, briefings } from "../shared/schema.js";
import { randomUUID } from 'crypto';

async function seed() {
  console.log('🌱 Seeding development data...');

  const userId = randomUUID();
  const deviceId = randomUUID();
  const sessionId = randomUUID();
  const testSnapshotId = process.env.TEST_SNAPSHOT_ID || crypto.randomUUID();

  try {
    // 1. Insert snapshot with realistic location data
    console.log(`📍 Creating snapshot: ${testSnapshotId}`);
    await db.insert(snapshots)
      .values({
        snapshot_id: testSnapshotId,
        user_id: userId,
        device_id: deviceId,
        session_id: sessionId,
        lat: 37.7749,
        lng: -122.4194,
        accuracy_m: 10.5,
        coord_source: 'gps',
        city: 'San Francisco',
        state: 'CA',
        country: 'US',
        formatted_address: '123 Market St, San Francisco, CA 94103',
        timezone: 'America/Los_Angeles',
        local_iso: new Date(),
        dow: new Date().getDay(),
        hour: new Date().getHours(),
        day_part_key: 'morning',
        h3_r8: '882830829ffffff',
        weather: {
          temp_f: 65,
          condition: 'Partly Cloudy',
          wind_mph: 10
        },
        air: {
          aqi: 45,
          category: 'Good'
        },
        created_at: new Date(),
        is_holiday: false
      })
      .onConflictDoNothing();

    // 2. Insert strategy with complete consolidated text
    console.log('📝 Creating strategy with consolidated text...');
    const strategyText = `Morning Strategy for Airport Zone

Focus on the airport corridor during peak departure hours. Business travelers departing between 6-9 AM create consistent demand.

Key Recommendations:
- Stage near Terminal 1 departures level
- Priority zones: Hotels near airport, BART stations
- Avoid downtown due to construction delays on Market St
- Weather is favorable - no rain expected until afternoon

Tactical Tips:
- Best staging: Cell phone lot or hotel pickup areas
- Average wait time: 5-8 minutes
- Expected earnings: $25-35 per ride to airport
- Traffic alert: Highway 101 northbound slow near airport exit

This strategy is valid for the next 60 minutes based on current conditions.`;

    await db.insert(strategies)
      .values({
        snapshot_id: testSnapshotId,
        user_id: userId,
        status: 'complete',
        phase: 'complete',
        strategy_for_now: strategyText,
        consolidated_strategy: strategyText,
        strategy_timestamp: new Date(),
        valid_window_start: new Date(),
        valid_window_end: new Date(Date.now() + 60 * 60 * 1000), // 60 minutes from now
        model_name: 'test-seeded-strategy',
        prompt_version: 'v1-seed',
        lat: 37.7749,
        lng: -122.4194,
        city: 'San Francisco',
        state: 'CA',
        attempt: 1,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflictDoNothing();

    // 3. Insert briefing data (Gemini + Google Search)
    // Location (city, state) available via snapshot_id JOIN to snapshots table
    console.log('📰 Creating briefing data...');
    await db.insert(briefings)
      .values({
        snapshot_id: testSnapshotId,
        news: {
          items: [
            { title: 'Airport corridor showing 2.5x surge', summary: 'Downtown SF has standard rates', impact: 'high' }
          ]
        },
        weather_current: { tempF: 65, conditions: 'Clear', humidity: 55 },
        weather_forecast: [],
        traffic_conditions: {
          summary: 'Highway 101 northbound experiencing delays near airport exit',
          congestionLevel: 'medium',
          incidents: [{ description: 'Allow extra 5-10 minutes for airport routes', severity: 'medium' }]
        },
        events: [
          { title: 'Giants vs. Dodgers', venue: 'Oracle Park', event_time: '7:00 PM', impact: 'high' }
        ],
        school_closures: [],
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflictDoNothing();

    console.log('✅ Seed complete!');
    console.log('');
    console.log('📋 Test Data Created:');
    console.log(`   Snapshot ID: ${testSnapshotId}`);
    console.log(`   User ID: ${userId}`);
    console.log('');
    console.log('🧪 Test Endpoints:');
    console.log(`   GET /api/strategy/${testSnapshotId}`);
    console.log(`   GET /api/blocks/strategy/${testSnapshotId}`);
    console.log('');
    console.log('💡 To run tests:');
    console.log(`   TEST_SNAPSHOT_ID=${testSnapshotId} NODE_OPTIONS='--experimental-vm-modules' npx jest tests/blocksApi.test.js`);
    console.log('');

  } catch (error) {
    console.error('❌ Seed failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

// Run seed
seed();