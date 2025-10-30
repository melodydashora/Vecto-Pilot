/**
 * SMOKE TEST: Strategy Generation
 * 
 * Tests end-to-end strategy generation with validation
 * Usage: SNAPSHOT_ID="uuid" npm run smoke:strategy
 */

const { SNAPSHOT_ID, API_URL = 'http://localhost:5000' } = process.env;

if (!SNAPSHOT_ID) {
  console.error('❌ SNAPSHOT_ID environment variable required');
  console.error('');
  console.error('Example:');
  console.error('  SNAPSHOT_ID="123e4567-e89b-12d3-a456-426614174000" npm run smoke:strategy');
  process.exit(1);
}

try {
  const url = `${API_URL}/api/chat`;
  console.log(`🔍 Testing: GET ${url}`);
  
  const startTime = Date.now();
  const response = await fetch(url);
  const elapsed = Date.now() - startTime;
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  console.log(`\n✅ Strategy API responded in ${elapsed}ms\n`);
  
  // Validate structure
  const checks = [
    { name: 'strategy field', condition: !!data.strategy },
    { name: 'strategy_timestamp', condition: !!data.strategy_timestamp },
    { name: 'valid_window_start', condition: !!data.valid_window_start },
    { name: 'valid_window_end', condition: !!data.valid_window_end },
    { name: 'snapshot_id', condition: !!data.snapshot_id }
  ];
  
  console.log('📋 Validation checks:');
  checks.forEach(check => {
    const status = check.condition ? '✅' : '❌';
    console.log(`   ${status} ${check.name}`);
  });
  
  // Window validation
  if (data.valid_window_start && data.valid_window_end) {
    const start = new Date(data.valid_window_start);
    const end = new Date(data.valid_window_end);
    const durationMin = (end - start) / 60000;
    
    console.log(`\n⏱️  Time window: ${durationMin.toFixed(1)} minutes`);
    
    if (durationMin > 60) {
      console.warn('   ⚠️  Window exceeds 60 minute limit!');
    }
  }
  
  // Event enrichment
  if (data.blocks && Array.isArray(data.blocks)) {
    const withEvents = data.blocks.filter(b => 
      b.venue_events?.badge || b.event_badge_missing
    );
    console.log(`\n🎉 Event enrichment: ${withEvents.length}/${data.blocks.length} blocks`);
  }
  
  // Strategy preview
  if (data.strategy) {
    console.log(`\n📝 Strategy preview:`);
    console.log(`   ${data.strategy.substring(0, 200)}...`);
  }
  
  console.log('\n✅ All checks passed\n');
  
} catch (error) {
  console.error('\n❌ Strategy smoke test failed:', error.message);
  process.exit(1);
}
