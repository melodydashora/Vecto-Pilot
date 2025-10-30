#!/usr/bin/env node
/**
 * test-health-endpoints.mjs
 * 
 * Validates that health endpoints respond instantly with 200 OK
 * Tests both GET and HEAD requests to ensure load balancer compatibility
 * 
 * Usage:
 *   node scripts/test-health-endpoints.mjs [port]
 * 
 * Exit codes:
 *   0 = All tests passed
 *   1 = One or more tests failed
 */

import http from 'node:http';

const PORT = process.argv[2] || process.env.PORT || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Test configuration
const TESTS = [
  { method: 'GET', path: '/', expectedStatus: 200, expectedBody: 'OK' },
  { method: 'HEAD', path: '/', expectedStatus: 200, expectedBody: null },
  { method: 'GET', path: '/health', expectedStatus: 200, expectedBody: 'OK' },
  { method: 'GET', path: '/healthz', expectedStatus: 200, expectedJson: { ok: true } },
  { method: 'GET', path: '/ready', expectedStatus: 200, expectedJson: { ok: true } },
  { method: 'GET', path: '/api/health', expectedStatus: 200, expectedJson: { ok: true, port: Number(PORT) } },
];

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function makeRequest(method, path) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const req = http.request(
      `${BASE_URL}${path}`,
      { method, timeout: 5000 },
      (res) => {
        const latency = Date.now() - startTime;
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: body || null,
            latency,
          });
        });
      }
    );
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

async function runTest(test) {
  const { method, path, expectedStatus, expectedBody, expectedJson } = test;
  
  try {
    const result = await makeRequest(method, path);
    
    // Check status code
    if (result.status !== expectedStatus) {
      return {
        passed: false,
        message: `Status mismatch: got ${result.status}, expected ${expectedStatus}`,
        latency: result.latency,
      };
    }
    
    // Check body (if expected)
    if (expectedBody !== undefined && expectedBody !== null) {
      if (result.body !== expectedBody) {
        return {
          passed: false,
          message: `Body mismatch: got "${result.body}", expected "${expectedBody}"`,
          latency: result.latency,
        };
      }
    }
    
    // Check JSON (if expected)
    if (expectedJson) {
      let parsedBody;
      try {
        parsedBody = JSON.parse(result.body);
      } catch (e) {
        return {
          passed: false,
          message: `Invalid JSON response: ${result.body}`,
          latency: result.latency,
        };
      }
      
      // Check required fields
      for (const [key, value] of Object.entries(expectedJson)) {
        if (parsedBody[key] !== value) {
          return {
            passed: false,
            message: `JSON field mismatch: ${key}=${parsedBody[key]}, expected ${value}`,
            latency: result.latency,
          };
        }
      }
    }
    
    // Check latency (should be < 100ms for health endpoints)
    if (result.latency > 100) {
      return {
        passed: true, // Still passes, but warn
        message: `⚠️  High latency: ${result.latency}ms (should be <100ms)`,
        latency: result.latency,
      };
    }
    
    return {
      passed: true,
      message: 'OK',
      latency: result.latency,
    };
  } catch (err) {
    return {
      passed: false,
      message: `Request failed: ${err.message}`,
      latency: null,
    };
  }
}

async function main() {
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}  Vecto Pilot™ Health Endpoint Test Suite${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}Testing server at:${colors.reset} ${BASE_URL}`);
  console.log(`${colors.blue}Total tests:${colors.reset} ${TESTS.length}`);
  console.log('');
  
  let passed = 0;
  let failed = 0;
  const results = [];
  
  for (const test of TESTS) {
    const testName = `${test.method} ${test.path}`;
    process.stdout.write(`  ${testName.padEnd(25)}`);
    
    const result = await runTest(test);
    results.push({ test: testName, ...result });
    
    if (result.passed) {
      passed++;
      const latencyColor = result.latency < 50 ? colors.green : result.latency < 100 ? colors.yellow : colors.red;
      console.log(`${colors.green}✓${colors.reset} ${latencyColor}${result.latency}ms${colors.reset} ${result.message !== 'OK' ? result.message : ''}`);
    } else {
      failed++;
      console.log(`${colors.red}✗${colors.reset} ${result.message}`);
    }
  }
  
  console.log('');
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}Results:${colors.reset}`);
  console.log(`  ${colors.green}Passed:${colors.reset} ${passed}/${TESTS.length}`);
  console.log(`  ${colors.red}Failed:${colors.reset} ${failed}/${TESTS.length}`);
  
  // Calculate average latency for passed tests
  const passedResults = results.filter(r => r.passed && r.latency !== null);
  if (passedResults.length > 0) {
    const avgLatency = passedResults.reduce((sum, r) => sum + r.latency, 0) / passedResults.length;
    const maxLatency = Math.max(...passedResults.map(r => r.latency));
    console.log(`  ${colors.blue}Avg latency:${colors.reset} ${avgLatency.toFixed(1)}ms`);
    console.log(`  ${colors.blue}Max latency:${colors.reset} ${maxLatency}ms`);
  }
  
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
  
  if (failed > 0) {
    console.log(`${colors.red}❌ Health check tests FAILED${colors.reset}`);
    console.log(`${colors.yellow}   Server may not be ready for Cloud Run deployment${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`${colors.green}✅ All health check tests PASSED${colors.reset}`);
    console.log(`${colors.green}   Server is ready for Cloud Run deployment${colors.reset}`);
    process.exit(0);
  }
}

main();
