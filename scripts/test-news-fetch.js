#!/usr/bin/env node
/**
 * Test script for dual-model news fetch
 * 2026-01-05: Tests fetchRideshareNews with Gemini + GPT-5.2 parallel fetch
 *
 * Usage: node scripts/test-news-fetch.js <city> <state> <timezone>
 * Example: node scripts/test-news-fetch.js "Dallas" "TX" "America/Chicago"
 */

import { fetchRideshareNews } from '../server/lib/briefing/briefing-service.js';

async function main() {
  // 2026-02-13: Removed hardcoded Frisco/TX/America_Chicago defaults (NO FALLBACKS rule)
  const city = process.argv[2];
  const state = process.argv[3];
  const timezone = process.argv[4];

  if (!city || !state || !timezone) {
    console.error('Usage: node scripts/test-news-fetch.js <city> <state> <timezone>');
    console.error('Example: node scripts/test-news-fetch.js "Dallas" "TX" "America/Chicago"');
    process.exit(1);
  }

  console.log(`\nTesting dual-model news fetch for ${city}, ${state}\n`);
  console.log('═'.repeat(60));

  // Create a mock snapshot with the test location
  const mockSnapshot = {
    city,
    state,
    timezone,
    local_iso: new Date().toISOString()
  };

  const startTime = Date.now();

  try {
    const result = await fetchRideshareNews({ snapshot: mockSnapshot });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\nNEWS FETCH RESULT');
    console.log('═'.repeat(60));
    console.log(`Provider(s): ${result.provider}`);
    console.log(`Items: ${result.items?.length || 0}`);
    console.log(`Raw count (before dedup): ${result.rawCount || 'N/A'}`);
    console.log(`Duration: ${duration}s`);

    if (result.reason) {
      console.log(`Reason: ${result.reason}`);
    }

    if (result.items?.length > 0) {
      console.log('\n📋 NEWS ITEMS:');
      console.log('─'.repeat(60));

      for (const item of result.items) {
        console.log(`\n📌 ${item.title}`);
        console.log(`   📅 Date: ${item.published_date || 'N/A'}`);
        console.log(`   🏷️  Category: ${item.category || 'N/A'}`);
        console.log(`   ⚡ Impact: ${item.impact || 'N/A'}`);
        console.log(`   Source: ${item.source || 'N/A'}`);
        console.log(`   📝 ${item.summary?.substring(0, 100)}${item.summary?.length > 100 ? '...' : ''}`);
        if (item._provider) {
          console.log(`   Provider: ${item._provider}`);
        }
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('Test complete\n');

    // Output raw JSON for debugging
    console.log('\n📄 RAW JSON OUTPUT:');
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    console.error('\nError:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
