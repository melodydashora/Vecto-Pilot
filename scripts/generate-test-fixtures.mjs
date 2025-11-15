
#!/usr/bin/env node
// scripts/generate-test-fixtures.mjs
// Generate realistic test fixtures for development

import fs from 'fs/promises';
import path from 'path';

const fixtures = {
  snapshots: [
    {
      snapshot_id: 'test-frisco-morning',
      city: 'Frisco',
      state: 'TX',
      lat: 33.1507,
      lng: -96.8236,
      day_part_key: 'morning',
      weather: { tempF: 69, conditions: 'Clear' },
      air: { aqi: 76, category: 'Moderate' }
    }
  ],
  venues: [
    {
      name: 'Legacy Hall',
      lat: 33.0777,
      lng: -96.8252,
      category: 'entertainment',
      placeId: 'ChIJtest123'
    }
  ],
  events: [
    {
      title: 'Dallas Mavericks vs Lakers',
      venue_name: 'American Airlines Center',
      start_time_iso: new Date(Date.now() + 3600000).toISOString(),
      impact_hint: 'high'
    }
  ]
};

async function generateFixtures() {
  const fixturesDir = path.join(process.cwd(), 'tests/fixtures');
  await fs.mkdir(fixturesDir, { recursive: true });
  
  await fs.writeFile(
    path.join(fixturesDir, 'snapshots.json'),
    JSON.stringify(fixtures.snapshots, null, 2)
  );
  
  await fs.writeFile(
    path.join(fixturesDir, 'venues.json'),
    JSON.stringify(fixtures.venues, null, 2)
  );
  
  await fs.writeFile(
    path.join(fixturesDir, 'events.json'),
    JSON.stringify(fixtures.events, null, 2)
  );
  
  console.log('✅ Test fixtures generated in tests/fixtures/');
}

generateFixtures().catch(console.error);
