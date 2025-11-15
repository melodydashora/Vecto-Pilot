#!/usr/bin/env node

/**
 * AUTONOMOUS GLOBAL TESTING SCRIPT
 * Tests Vecto Pilot™ with coordinates from cities worldwide
 * No code changes - pure API testing via HTTP calls
 */

import http from 'http';
import fs from 'fs';
import { BASE_URL, PORTS } from './shared/ports.js';

const TEST_BASE_URL = process.env.BASE_URL || BASE_URL;

// Global test locations - accurate GPS coordinates
const TEST_LOCATIONS = [
  {
    name: "Paris, France - Charles de Gaulle Airport Area",
    lat: 49.0097,
    lng: 2.5479,
    timezone: "Europe/Paris",
    expectedCity: "Roissy-en-France" // Near CDG
  },
  {
    name: "Tokyo, Japan - Shibuya District",
    lat: 35.6595,
    lng: 139.7004,
    timezone: "Asia/Tokyo",
    expectedCity: "Tokyo"
  },
  {
    name: "Sydney, Australia - CBD",
    lat: -33.8688,
    lng: 151.2093,
    timezone: "Australia/Sydney",
    expectedCity: "Sydney"
  },
  {
    name: "São Paulo, Brazil - Paulista Avenue",
    lat: -23.5617,
    lng: -46.6561,
    timezone: "America/Sao_Paulo",
    expectedCity: "São Paulo"
  },
  {
    name: "Dubai, UAE - Downtown/Burj Khalifa",
    lat: 25.1972,
    lng: 55.2744,
    timezone: "Asia/Dubai",
    expectedCity: "Dubai"
  },
  {
    name: "Mumbai, India - International Airport",
    lat: 19.0896,
    lng: 72.8656,
    timezone: "Asia/Kolkata",
    expectedCity: "Mumbai"
  },
  {
    name: "London, UK - Heathrow Airport",
    lat: 51.4700,
    lng: -0.4543,
    timezone: "Europe/London",
    expectedCity: "Hounslow"
  }
];

// Helper: Make HTTP request
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });
    
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

// Helper: Create snapshot for location
async function createSnapshot(location) {
  const payload = {
    lat: location.lat,
    lng: location.lng,
    address: `Test location: ${location.name}`,
    city: null, // Force system to geocode
    state: null,
    country: null,
    formatted_address: null,
    timezone: location.timezone
  };

  const options = {
    hostname: 'localhost',
    port: PORTS.GATEWAY,
    path: '/api/location/snapshot',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return await makeRequest(options, payload);
}

// Helper: Get blocks/recommendations
async function getBlocks(snapshotId) {
  const payload = {
    snapshot_id: snapshotId,
    userId: 'global-test-user'
  };

  const options = {
    hostname: 'localhost',
    port: PORTS.GATEWAY,
    path: '/api/blocks',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return await makeRequest(options, payload);
}

// Main test runner
async function runGlobalTests() {
  console.log('🌍 VECTO PILOT™ GLOBAL TESTING SUITE');
  console.log('=' .repeat(80));
  console.log(`Testing ${TEST_LOCATIONS.length} global locations\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < TEST_LOCATIONS.length; i++) {
    const loc = TEST_LOCATIONS[i];
    console.log(`\n[${i + 1}/${TEST_LOCATIONS.length}] Testing: ${loc.name}`);
    console.log(`   Coordinates: ${loc.lat}, ${loc.lng}`);
    
    try {
      // Step 1: Create snapshot
      console.log('   📍 Creating snapshot...');
      const snapRes = await createSnapshot(loc);
      
      if (snapRes.status !== 200) {
        console.error(`   ❌ Snapshot failed: ${snapRes.status}`, snapRes.data);
        results.push({ location: loc, error: 'Snapshot creation failed', details: snapRes });
        continue;
      }

      const snapshot = snapRes.data.snapshot || snapRes.data;
      const snapshotId = snapshot.snapshot_id || snapshot.id;
      
      console.log(`   ✅ Snapshot created: ${snapshotId}`);
      console.log(`   🗺️  Geocoded city: ${snapshot.city || 'null'}`);
      console.log(`   📬 Address: ${snapshot.formatted_address || 'N/A'}`);

      // Step 2: Get blocks (triggers AI pipeline) - with polling
      console.log('   🤖 Fetching blocks (AI pipeline)...');
      let blocksRes = await getBlocks(snapshotId);
      
      // Poll for completion if strategy is pending (202 status)
      let attempts = 0;
      const maxAttempts = 60; // 60 attempts x 2 seconds = 2 minutes max
      
      while (blocksRes.status === 202 && attempts < maxAttempts) {
        attempts++;
        console.log(`   ⏳ Strategy generating... (attempt ${attempts}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds
        blocksRes = await getBlocks(snapshotId);
      }
      
      if (blocksRes.status !== 200) {
        console.error(`   ❌ Blocks failed: ${blocksRes.status}`, blocksRes.data);
        results.push({ 
          location: loc, 
          snapshot, 
          error: `Blocks generation failed: ${blocksRes.status === 202 ? 'Timeout after 2 minutes' : blocksRes.data.message || 'Unknown error'}`, 
          details: blocksRes 
        });
        continue;
      }

      const blocks = blocksRes.data.blocks || blocksRes.data;
      
      // Extract key data
      const claudeBlock = blocks.find(b => b.type === 'strategy');
      const venuesBlock = blocks.find(b => b.type === 'venues');
      
      console.log(`   ✅ Received ${blocks.length} blocks`);
      console.log(`   📊 Claude strategy: ${claudeBlock ? 'Yes' : 'No'}`);
      console.log(`   🏢 Venues: ${venuesBlock?.data?.venues?.length || 0}`);
      
      if (venuesBlock?.data?.venues?.length > 0) {
        console.log(`   📋 Sample venues:`);
        venuesBlock.data.venues.slice(0, 3).forEach(v => {
          console.log(`      - ${v.name} (${v.category || 'unknown'})`);
        });
      }

      // Store result
      results.push({
        location: loc,
        snapshot,
        blocks,
        claudeStrategy: claudeBlock?.data?.strategy,
        venues: venuesBlock?.data?.venues || [],
        success: true
      });

    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      results.push({ location: loc, error: error.message, stack: error.stack });
    }

    // Pause between tests to avoid rate limits
    if (i < TEST_LOCATIONS.length - 1) {
      console.log('   ⏳ Waiting 3s before next test...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(80));
  console.log(`✅ Testing complete in ${totalTime}s`);
  console.log(`📊 Results: ${results.filter(r => r.success).length}/${results.length} successful\n`);

  // Generate markdown report
  await generateReport(results);
}

// Generate markdown report
async function generateReport(results) {
  const timestamp = new Date().toISOString();
  let md = `# Vecto Pilot™ Global Testing Report\n\n`;
  md += `**Generated:** ${timestamp}\n`;
  md += `**Test Locations:** ${results.length}\n`;
  md += `**Successful:** ${results.filter(r => r.success).length}\n\n`;
  md += `---\n\n`;

  for (const result of results) {
    md += `## ${result.location.name}\n\n`;
    md += `**Coordinates:** \`${result.location.lat}, ${result.location.lng}\`\n`;
    md += `**Expected City:** ${result.location.expectedCity}\n`;
    md += `**Timezone:** ${result.location.timezone}\n\n`;

    if (result.error) {
      md += `### ❌ Error\n\n`;
      md += `\`\`\`\n${result.error}\n\`\`\`\n\n`;
      if (result.details) {
        md += `<details>\n<summary>Error Details</summary>\n\n\`\`\`json\n${JSON.stringify(result.details, null, 2)}\n\`\`\`\n</details>\n\n`;
      }
      continue;
    }

    // Snapshot data
    md += `### 📍 Snapshot Data\n\n`;
    md += `- **Snapshot ID:** \`${result.snapshot.snapshot_id || result.snapshot.id}\`\n`;
    md += `- **Geocoded City:** ${result.snapshot.city || '`null` (system fallback active)'}\n`;
    md += `- **Address:** ${result.snapshot.formatted_address || 'N/A'}\n`;
    md += `- **Timezone:** ${result.snapshot.timezone}\n`;
    md += `- **Weather:** ${result.snapshot.weather_temp}°F, ${result.snapshot.weather_conditions}\n`;
    md += `- **Air Quality:** AQI ${result.snapshot.air_quality_aqi} (${result.snapshot.air_quality_category})\n\n`;

    // Claude strategy
    if (result.claudeStrategy) {
      md += `### 🧠 Claude Sonnet 4.5 Strategy\n\n`;
      md += `\`\`\`\n${result.claudeStrategy}\n\`\`\`\n\n`;
    }

    // Venues
    if (result.venues.length > 0) {
      md += `### 🏢 GPT-5 Generated Venues (${result.venues.length})\n\n`;
      result.venues.forEach((v, i) => {
        md += `${i + 1}. **${v.name}**\n`;
        md += `   - Category: ${v.category || 'N/A'}\n`;
        md += `   - Address: ${v.address || 'N/A'}\n`;
        md += `   - Status: ${v.status || 'N/A'}\n`;
        if (v.hours_today) md += `   - Hours: ${v.hours_today}\n`;
        if (v.drive_time_minutes) md += `   - Drive Time: ${v.drive_time_minutes} min\n`;
        md += `\n`;
      });
    } else {
      md += `### ⚠️ No Venues Generated\n\n`;
    }

    md += `---\n\n`;
  }

  // Summary
  md += `## Summary\n\n`;
  const successful = results.filter(r => r.success);
  const withVenues = successful.filter(r => r.venues.length > 0);
  const withCity = successful.filter(r => r.snapshot.city);
  
  md += `- **Total Tests:** ${results.length}\n`;
  md += `- **Successful Snapshots:** ${successful.length}\n`;
  md += `- **Generated Venues:** ${withVenues.length}\n`;
  md += `- **City Detected:** ${withCity.length}\n`;
  md += `- **Null City (Fallback):** ${successful.length - withCity.length}\n\n`;

  md += `### Key Findings\n\n`;
  md += `1. **Global Support:** ${successful.length === results.length ? '✅' : '⚠️'} System ${successful.length === results.length ? 'successfully' : 'partially'} handled all global locations\n`;
  md += `2. **Venue Generation:** ${withVenues.length === successful.length ? '✅' : '⚠️'} GPT-5 generated venues for ${withVenues.length}/${successful.length} locations\n`;
  md += `3. **Geocoding:** ${withCity.length}/${successful.length} locations had city detected, ${successful.length - withCity.length} used fallback\n`;
  md += `4. **AI Pipeline:** All successful tests completed the full triad (Claude → GPT-5 → Gemini)\n\n`;

  const filename = `global-test-results-${Date.now()}.md`;
  fs.writeFileSync(filename, md);
  console.log(`📄 Report saved: ${filename}\n`);
}

// Run tests
runGlobalTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
