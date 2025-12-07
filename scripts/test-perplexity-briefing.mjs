
#!/usr/bin/env node

import { callPerplexity } from '../server/lib/adapters/perplexity-adapter.js';

// Real snapshot from production
const sampleSnapshot = {
  snapshot_id: '80ff5804-1e34-4562-aa67-62ad673d85b6',
  user_id: '5b4f85db-eedd-40db-9a98-57ead2aadaed',
  city: 'Frisco',
  state: 'TX',
  country: 'United States',
  lat: 33.128422961960425,
  lng: -96.87565344906977,
  formatted_address: '6058 Midnight Moon Dr, Frisco, TX 75036, USA',
  timezone: 'America/Chicago',
  date: '2025-12-07',
  dow: 0, // Sunday
  hour: 11,
  day_part_key: 'morning',
  created_at: '2025-12-07T17:30:53.077Z',
  local_iso: '2025-12-07T17:30:53.077Z',
  weather: { tempF: 46, conditions: 'Mostly cloudy', description: 'Mostly cloudy' },
  air: { aqi: 71, category: 'Good air quality' },
  airport_context: {
    airport_code: 'DFW',
    airport_name: 'Dallas/Fort Worth International',
    distance_miles: 18.6,
    has_delays: false,
    has_closures: false
  }
};

console.log('🔍 Testing Perplexity Comprehensive Research + GPT-5 Tactical Fields');
console.log('📍 Location:', `${sampleSnapshot.formatted_address}`);
console.log('📅 Date & Time:', sampleSnapshot.date, 'at', new Date(sampleSnapshot.local_iso).toLocaleTimeString('en-US', { timeZone: sampleSnapshot.timezone }));
console.log('🌤️  Weather:', `${sampleSnapshot.weather.tempF}°F, ${sampleSnapshot.weather.conditions}`);
console.log('✈️  Airport:', `${sampleSnapshot.airport_context.airport_name} (${sampleSnapshot.airport_context.distance_miles} mi)`);
console.log('');

async function testPerplexityBriefing() {
  const { city, state, date, lat, lng, formatted_address, hour, day_part_key } = sampleSnapshot;
  
  // Get day name from dow
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[sampleSnapshot.dow];
  
  // Format time
  const timeStr = new Date(sampleSnapshot.local_iso).toLocaleTimeString('en-US', { 
    timeZone: sampleSnapshot.timezone,
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // Test Perplexity comprehensive research fields (8 fields)
  const perplexityFields = [
    {
      name: 'global_travel',
      prompt: `What are the current global travel conditions affecting the ${city}, ${state} region today (${dayName}, ${date} at ${timeStr})? Include flight delays, international travel alerts, or global events impacting this area. Be concise (2-3 sentences).`
    },
    {
      name: 'domestic_travel',
      prompt: `What are the current domestic (US) travel conditions affecting ${city}, ${state} today (${dayName}, ${date})? Include airline delays at DFW airport (${sampleSnapshot.airport_context.distance_miles} miles away), TSA issues, or national events affecting travel. Be concise (2-3 sentences).`
    },
    {
      name: 'local_traffic',
      prompt: `What are the current local traffic conditions, road construction, and incidents in ${city}, ${state} today (${dayName}, ${date} at ${timeStr})? Focus on major roads and highways affecting rideshare drivers. Driver is at ${formatted_address}. Be specific and concise (2-3 sentences).`
    },
    {
      name: 'weather_impacts',
      prompt: `How is current weather (${sampleSnapshot.weather.tempF}°F, ${sampleSnapshot.weather.conditions}) impacting travel and rideshare operations in ${city}, ${state} today (${dayName}, ${date})? Include any weather alerts or conditions affecting driving. Be concise (2-3 sentences).`
    },
    {
      name: 'events_nearby',
      prompt: `What major events (concerts, games, festivals, sports) are happening TODAY (${dayName}, ${date}) within 50 miles of ${city}, ${state} (${lat}, ${lng})? List specific venues, times, and expected attendance if available. Focus on events happening NOW or in the next 6 hours. Be concise.`
    },
    {
      name: 'holidays',
      prompt: `Is today (${dayName}, ${date}) a holiday in ${city}, ${state}? If yes, state the holiday name and how it affects rideshare demand. If no, just say "No holiday today". Be brief (1 sentence).`
    },
    {
      name: 'rideshare_intel',
      prompt: `What rideshare-specific intelligence is relevant for drivers in ${city}, ${state} today (${dayName}, ${date} during ${day_part_key})? Include surge zones, driver incentives, or platform updates. Be concise (2-3 sentences).`
    }
  ];

  console.log('\n📊 PERPLEXITY COMPREHENSIVE RESEARCH (8 fields):');
  console.log('='.repeat(80));
  
  const perplexityResults = {};
  
  for (const field of perplexityFields) {
    console.log(`\n🔄 Fetching: ${field.name}...`);
    try {
      const response = await callPerplexity({
        model: 'sonar-pro',
        system: 'You are a rideshare driver intelligence assistant. Provide factual, concise information with sources.',
        user: field.prompt,
        maxTokens: 500,
        temperature: 0.2
      });

      if (response.ok) {
        perplexityResults[field.name] = response.output;
        console.log(`✅ ${field.name}:`);
        console.log(`   ${response.output}`);
        
        if (response.citations && response.citations.length > 0) {
          console.log(`   📚 Citations: ${response.citations.length} sources`);
          response.citations.slice(0, 2).forEach((url, i) => {
            console.log(`      ${i + 1}. ${url}`);
          });
        }
      } else {
        console.error(`❌ ${field.name} failed:`, response.error);
        perplexityResults[field.name] = null;
      }
    } catch (error) {
      console.error(`❌ ${field.name} error:`, error.message);
      perplexityResults[field.name] = null;
    }
    
    // Rate limiting - wait 1 second between calls
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Now test GPT-5 tactical fields (uses consolidator logic)
  console.log('\n\n📊 GPT-5 TACTICAL 30-MINUTE INTELLIGENCE (4 fields):');
  console.log('='.repeat(80));
  console.log('Note: These would normally be generated by the consolidator');
  console.log('Simulating GPT-5 web search for next 30 minutes...\n');

  // Mock strategist output for consolidator
  const mockStrategistOutput = `Strategic assessment for ${city}, ${state} on ${dayName} ${day_part_key}:
- Weather: ${sampleSnapshot.weather.tempF}°F, ${sampleSnapshot.weather.conditions} - moderate conditions for driving
- Time: ${timeStr} on ${dayName} - typical ${day_part_key} demand patterns expected
- Airport: DFW is ${sampleSnapshot.airport_context.distance_miles} miles away, no current delays
- Air Quality: ${sampleSnapshot.air.category} (AQI ${sampleSnapshot.air.aqi})`;

  console.log('Strategist Input (minstrategy):');
  console.log(mockStrategistOutput);
  console.log('\n' + '-'.repeat(80));
  
  // This is what consolidator would do:
  const consolidatorPrompt = `SNAPSHOT DATA:
Day of Week: ${dayName}
Date & Time: ${date} at ${timeStr}
Hour: ${hour}:00
Timezone: ${sampleSnapshot.timezone}

DRIVER'S EXACT LOCATION: ${formatted_address}
Coordinates: ${lat}, ${lng}

Weather: ${sampleSnapshot.weather.tempF}°F, ${sampleSnapshot.weather.conditions}
Air Quality: AQI ${sampleSnapshot.air.aqi}
Airport: ${sampleSnapshot.airport_context.airport_code} (${sampleSnapshot.airport_context.distance_miles} mi away)

STRATEGIST'S ASSESSMENT:
${mockStrategistOutput}

YOUR TASK:
Research current conditions near ${formatted_address} and return structured JSON with ALL 5 FIELDS:

1. tactical_traffic: Traffic/incidents for next 30 minutes (detailed)
2. tactical_closures: Closures/construction for next 30 minutes (detailed)
3. tactical_enforcement: Enforcement activity (checkpoints, patrols, detailed)
4. tactical_sources: Sources checked (list websites/URLs you searched)
5. summary: MANDATORY - Actionable 3-5 sentence summary that consolidates ALL tactical details`;

  console.log('\nConsolidator would send this prompt to GPT-5 with web search enabled');
  console.log('Expected output: JSON with tactical_traffic, tactical_closures, tactical_enforcement, tactical_sources, summary');

  console.log('\n\n📊 COMPLETE OUTPUT SUMMARY:');
  console.log('='.repeat(80));
  
  console.log('\n✅ PERPLEXITY FIELDS (would populate briefings table):');
  for (const [fieldName, value] of Object.entries(perplexityResults)) {
    const preview = value ? value.substring(0, 80) + '...' : 'NULL';
    console.log(`   ${fieldName}: ${preview}`);
  }
  
  console.log('\n✅ GPT-5 TACTICAL FIELDS (would populate briefings table):');
  console.log('   tactical_traffic: [Generated by consolidator with web search]');
  console.log('   tactical_closures: [Generated by consolidator with web search]');
  console.log('   tactical_enforcement: [Generated by consolidator with web search]');
  console.log('   tactical_sources: [List of sources checked by GPT-5]');
  console.log('   summary: [Consolidated summary → strategies.consolidated_strategy]');

  console.log('\n\n💾 DATABASE INSERT (briefings table):');
  console.log(JSON.stringify({
    snapshot_id: sampleSnapshot.snapshot_id,
    formatted_address: sampleSnapshot.formatted_address,
    city: sampleSnapshot.city,
    state: sampleSnapshot.state,
    // Perplexity comprehensive research
    global_travel: perplexityResults.global_travel,
    domestic_travel: perplexityResults.domestic_travel,
    local_traffic: perplexityResults.local_traffic,
    weather_impacts: perplexityResults.weather_impacts,
    events_nearby: perplexityResults.events_nearby,
    holidays: perplexityResults.holidays,
    rideshare_intel: perplexityResults.rideshare_intel,
    citations: [], // Would be populated from response.citations
    // GPT-5 tactical (filled by consolidator)
    tactical_traffic: '[Generated by consolidator]',
    tactical_closures: '[Generated by consolidator]',
    tactical_enforcement: '[Generated by consolidator]',
    tactical_sources: '[Generated by consolidator]'
  }, null, 2));
  
  console.log('\n💾 DATABASE INSERT (strategies table):');
  console.log(JSON.stringify({
    snapshot_id: sampleSnapshot.snapshot_id,
    minstrategy: mockStrategistOutput,
    consolidated_strategy: '[Summary field from GPT-5 consolidator output]'
  }, null, 2));
}

testPerplexityBriefing().catch(console.error);
