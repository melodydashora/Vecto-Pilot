
#!/usr/bin/env node

import { callPerplexity } from '../server/lib/adapters/perplexity-adapter.js';

// Sample snapshot (you can replace this with actual data)
const sampleSnapshot = {
  snapshot_id: 'test-snapshot-123',
  city: 'Frisco',
  state: 'TX',
  country: 'United States',
  lat: 33.1285,
  lng: -96.8756,
  formatted_address: '6058 Midnight Moon Dr, Frisco, TX 75036, USA',
  timezone: 'America/Chicago',
  date: new Date().toISOString().split('T')[0],
  dow: new Date().getDay(),
  hour: new Date().getHours(),
  day_part_key: 'afternoon'
};

console.log('🔍 Testing Perplexity Comprehensive Research');
console.log('📍 Location:', `${sampleSnapshot.city}, ${sampleSnapshot.state}`);
console.log('📅 Date:', sampleSnapshot.date);
console.log('');

async function testPerplexityBriefing() {
  const { city, state, date, lat, lng } = sampleSnapshot;
  
  // Test each field individually
  const fields = [
    {
      name: 'global_travel',
      prompt: `What are the current global travel conditions affecting the ${city}, ${state} region today (${date})? Include flight delays, international travel alerts, or global events impacting this area. Be concise (2-3 sentences).`
    },
    {
      name: 'domestic_travel',
      prompt: `What are the current domestic (US) travel conditions affecting ${city}, ${state} today (${date})? Include airline delays, TSA issues, or national events affecting travel. Be concise (2-3 sentences).`
    },
    {
      name: 'local_traffic',
      prompt: `What are the current local traffic conditions, road construction, and incidents in ${city}, ${state} today (${date})? Focus on major roads and highways affecting rideshare drivers. Be specific and concise (2-3 sentences).`
    },
    {
      name: 'weather_impacts',
      prompt: `How is current weather impacting travel and rideshare operations in ${city}, ${state} today (${date})? Include any weather alerts or conditions affecting driving. Be concise (2-3 sentences).`
    },
    {
      name: 'events_nearby',
      prompt: `What major events (concerts, games, festivals) are happening TODAY within 50 miles of ${city}, ${state} (${lat}, ${lng}) on ${date}? List specific venues, times, and expected attendance if available. Be concise.`
    },
    {
      name: 'holidays',
      prompt: `Is today (${date}) a holiday in ${city}, ${state}? If yes, state the holiday name and how it affects rideshare demand. If no, just say "No holiday today". Be brief (1 sentence).`
    },
    {
      name: 'rideshare_intel',
      prompt: `What rideshare-specific intelligence is relevant for drivers in ${city}, ${state} today (${date})? Include surge zones, driver incentives, or platform updates. Be concise (2-3 sentences).`
    }
  ];

  const results = {};
  
  for (const field of fields) {
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
        results[field.name] = response.output;
        console.log(`✅ ${field.name}:`, response.output.substring(0, 100) + '...');
        
        if (response.citations && response.citations.length > 0) {
          console.log(`   📚 Citations: ${response.citations.length}`);
        }
      } else {
        console.error(`❌ ${field.name} failed:`, response.error);
        results[field.name] = null;
      }
    } catch (error) {
      console.error(`❌ ${field.name} error:`, error.message);
      results[field.name] = null;
    }
    
    // Rate limiting - wait 1 second between calls
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n\n📊 FINAL RESULTS:');
  console.log('='.repeat(80));
  
  for (const [fieldName, value] of Object.entries(results)) {
    console.log(`\n${fieldName.toUpperCase()}:`);
    console.log(value || 'NULL');
    console.log('-'.repeat(80));
  }

  console.log('\n\n💾 Database INSERT format:');
  console.log(JSON.stringify({
    snapshot_id: sampleSnapshot.snapshot_id,
    formatted_address: sampleSnapshot.formatted_address,
    city: sampleSnapshot.city,
    state: sampleSnapshot.state,
    ...results,
    citations: [] // Would be populated from response.citations
  }, null, 2));
}

testPerplexityBriefing().catch(console.error);
