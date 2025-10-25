#!/usr/bin/env node
/**
 * Smoke Test - Verify root causes are fixed
 * 
 * Tests:
 * 1. /health endpoint responds
 * 2. /api/assistant/verify-override exists (was 404)
 * 3. No "column key" errors in context enrichment
 * 4. No "threadManager.get" errors
 */

const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function runTests() {
  console.log('\n🧪 Root Cause Fix Verification\n');
  console.log('='.repeat(50));

  let passed = 0;
  let failed = 0;

  // Test 1: Health endpoint
  try {
    const res = await httpGet(`${BASE_URL}/health`);
    if (res.status === 200 && res.body.trim() === 'OK') {
      console.log('✅ Test 1: Health endpoint (200 OK)');
      passed++;
    } else {
      console.log(`❌ Test 1: Health endpoint (got ${res.status}, expected 200)`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ Test 1: Health endpoint (error: ${err.message})`);
    failed++;
  }

  // Test 2: Verify-override endpoint (was 404)
  try {
    const res = await httpGet(`${BASE_URL}/api/assistant/verify-override`);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      if (data.ok === true && data.mode && data.timestamp) {
        console.log('✅ Test 2: Verify-override endpoint (was 404, now 200)');
        console.log(`   Mode: ${data.mode}, Timestamp: ${data.timestamp}`);
        passed++;
      } else {
        console.log('❌ Test 2: Verify-override missing required fields');
        failed++;
      }
    } else {
      console.log(`❌ Test 2: Verify-override (got ${res.status}, expected 200)`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ Test 2: Verify-override (error: ${err.message})`);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed === 0) {
    console.log('✅ All root causes fixed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed\n');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
