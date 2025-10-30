/**
 * SMOKE TEST: Coach Context API
 * 
 * Tests /coach/context/:snapshotId endpoint
 * Usage: SNAPSHOT_ID="uuid" npm run smoke:coach
 */

const { SNAPSHOT_ID, API_URL = 'http://localhost:5000' } = process.env;

if (!SNAPSHOT_ID) {
  console.error('❌ SNAPSHOT_ID environment variable required');
  console.error('');
  console.error('Example:');
  console.error('  SNAPSHOT_ID="123e4567-e89b-12d3-a456-426614174000" npm run smoke:coach');
  process.exit(1);
}

try {
  const url = `${API_URL}/coach/context/${SNAPSHOT_ID}`;
  console.log(`🔍 Testing: GET ${url}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  console.log('\n✅ Coach context API responded successfully\n');
  console.log(JSON.stringify(data, null, 2));
  
  // Validate structure
  if (!data.snapshot_id) {
    console.warn('⚠️  Missing snapshot_id in response');
  }
  
  if (!data.items || !Array.isArray(data.items)) {
    console.warn('⚠️  Missing or invalid items array');
  } else {
    console.log(`\n📊 Summary: ${data.items.length} candidates`);
    
    const withEvents = data.items.filter(item => 
      item.venue_events?.badge || item.event_badge_missing
    );
    
    console.log(`   - ${withEvents.length} with event data`);
    console.log(`   - ${data.items.length - withEvents.length} without event data`);
  }
  
} catch (error) {
  console.error('\n❌ Coach context test failed:', error.message);
  process.exit(1);
}
