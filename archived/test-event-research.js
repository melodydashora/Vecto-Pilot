// Test Event Research Feature
import { researchMultipleVenueEvents } from './server/lib/venue-event-research.js';

const testVenues = [
  { name: 'Riders Field (Frisco RoughRiders)', city: 'Frisco', place_id: 'ChIJDWJUqn4glkQRlBsBm9bVywg' },
  { name: 'Comerica Center', city: 'Frisco', place_id: 'ChIJB0QnN307TIYRBoGKZ4u0uvE' },
  { name: 'Stonebriar Centre', city: 'Frisco', place_id: 'ChIJC8kAM5g9TIYRFVdzqUOkio0' }
];

console.log('🎪 Testing Event Intelligence Feature...\n');
console.log(`Researching events for ${testVenues.length} venues in Frisco, TX\n`);

const results = await researchMultipleVenueEvents(testVenues);

console.log('\n📊 RESULTS:\n');

for (const result of results) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Venue: ${result.venue_name}`);
  console.log(`Has Events: ${result.has_events ? '✅ YES' : '❌ NO'}`);
  
  if (result.has_events) {
    console.log(`Badge: ${result.badge}`);
    console.log(`Impact Level: ${result.impact_level.toUpperCase()}`);
    console.log(`Summary: ${result.summary.substring(0, 200)}...`);
    console.log(`Citations: ${result.citations?.length || 0} sources`);
  } else {
    console.log(`Summary: ${result.summary}`);
  }
  
  if (result.error) {
    console.log(`⚠️ Error: ${result.error}`);
  }
}

console.log(`\n${'='.repeat(70)}\n`);

// Show what would be stored in database
console.log('💾 DATABASE PREVIEW (venue_events JSONB field):\n');
console.log(JSON.stringify(results[0], null, 2));

process.exit(0);
