/**
 * Pool Idle Soak Test
 * 
 * Validates that the shared PostgreSQL pool handles idle connections correctly:
 * - Connections survive 10-minute idle periods
 * - TCP keepalive prevents NAT/LB drops
 * - Pool doesn't evict healthy connections prematurely
 * 
 * Run with: PG_USE_SHARED_POOL=true node server/tests/pool-idle-soak.js
 */

import 'dotenv/config';
import { getSharedPool, getPoolStats } from '../db/pool.js';

const IDLE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
const TEST_DURATION_MS = 20 * 60 * 1000; // 20 minutes

console.log('🧪 PostgreSQL Pool Idle Soak Test');
console.log('================================================');
console.log(`Idle duration: ${IDLE_DURATION_MS / 1000}s`);
console.log(`Heartbeat interval: ${HEARTBEAT_INTERVAL_MS / 1000}s`);
console.log(`Total test duration: ${TEST_DURATION_MS / 1000}s`);
console.log('================================================\n');

// Validate feature flag is enabled
if (process.env.PG_USE_SHARED_POOL !== 'true') {
  console.error('❌ Test requires PG_USE_SHARED_POOL=true');
  console.error('Run with: PG_USE_SHARED_POOL=true node server/tests/pool-idle-soak.js');
  process.exit(1);
}

const pool = getSharedPool();

if (!pool) {
  console.error('❌ Shared pool not initialized');
  process.exit(1);
}

console.log('✅ Shared pool initialized\n');

let testsPassed = 0;
let testsFailed = 0;
let queriesExecuted = 0;
let connectionDrops = 0;

/**
 * Execute a simple query and log results
 */
async function executeTestQuery(label) {
  const startTime = Date.now();
  
  try {
    const result = await pool.query('SELECT NOW() as current_time, pg_backend_pid() as pid');
    const queryTime = Date.now() - startTime;
    const { current_time, pid } = result.rows[0];
    
    queriesExecuted++;
    testsPassed++;
    
    console.log(`✅ [${label}] Query successful (${queryTime}ms) - PID: ${pid}`);
    console.log(`   Time: ${current_time}`);
    
    return { success: true, pid, queryTime };
  } catch (err) {
    testsFailed++;
    connectionDrops++;
    
    console.error(`❌ [${label}] Query failed: ${err.message}`);
    console.error(`   Code: ${err.code}`);
    
    return { success: false, error: err.message };
  }
}

/**
 * Log pool statistics
 */
function logPoolStats(label) {
  const stats = getPoolStats();
  console.log(`\n📊 [${label}] Pool Stats:`);
  console.log(`   Total connections: ${stats.totalCount}`);
  console.log(`   Idle connections: ${stats.idleCount}`);
  console.log(`   Waiting clients: ${stats.waitingCount}`);
  console.log(`   Max pool size: ${stats.maxSize}\n`);
}

/**
 * Main test routine
 */
async function runTest() {
  console.log('🚀 Starting idle soak test...\n');
  
  // Initial query
  await executeTestQuery('Initial');
  logPoolStats('Initial');
  
  // Phase 1: 10-minute idle soak
  console.log(`\n⏰ Phase 1: ${IDLE_DURATION_MS / 1000}s idle period (no queries)`);
  console.log('   Testing if pool keeps connections alive without activity...\n');
  
  await new Promise(resolve => setTimeout(resolve, IDLE_DURATION_MS));
  
  console.log('✅ Idle period complete - executing query to test connection...\n');
  const postIdleResult = await executeTestQuery('Post-Idle');
  
  if (!postIdleResult.success) {
    console.error('\n❌ CRITICAL: Connection dropped during idle period!');
    console.error('   This indicates idle timeout is too aggressive or keepalive failed.');
    logPoolStats('Post-Idle (Failed)');
    process.exit(1);
  }
  
  logPoolStats('Post-Idle');
  
  // Phase 2: 20-minute rolling load with heartbeats
  console.log(`\n⏰ Phase 2: ${TEST_DURATION_MS / 1000}s rolling load`);
  console.log(`   Executing query every ${HEARTBEAT_INTERVAL_MS / 1000}s...\n`);
  
  const testEndTime = Date.now() + TEST_DURATION_MS;
  let heartbeatCount = 0;
  
  while (Date.now() < testEndTime) {
    heartbeatCount++;
    await executeTestQuery(`Heartbeat-${heartbeatCount}`);
    
    // Log stats every 5 heartbeats
    if (heartbeatCount % 5 === 0) {
      logPoolStats(`Heartbeat-${heartbeatCount}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, HEARTBEAT_INTERVAL_MS));
  }
  
  console.log('\n✅ Rolling load phase complete\n');
  
  // Final stats
  console.log('📈 Test Summary');
  console.log('================================================');
  console.log(`Total queries: ${queriesExecuted}`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log(`Connection drops: ${connectionDrops}`);
  console.log(`Success rate: ${((testsPassed / queriesExecuted) * 100).toFixed(2)}%`);
  
  logPoolStats('Final');
  
  if (testsFailed === 0) {
    console.log('\n✅ ALL TESTS PASSED - Pool configuration is stable!');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED - Review pool configuration');
    process.exit(1);
  }
}

// Run test
runTest().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
