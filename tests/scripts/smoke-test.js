#!/usr/bin/env node
/**
 * Quick deployment smoke test — verifies critical endpoints respond.
 *
 * Usage: node tests/scripts/smoke-test.js
 * Requires: Running server (default http://localhost:5000)
 * Override: BASE_URL=https://your-app.replit.dev node tests/scripts/smoke-test.js
 *
 * 2026-04-14: Rewritten for current architecture (Pass 7, Issue AV)
 */

import http from 'node:http';
import https from 'node:https';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const transport = urlObj.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// Endpoints to verify. Any listed status code counts as "responding."
// We don't require 200 — a 401 or 400 still proves the route is mounted and the server is running.
const endpoints = [
  { name: '/health',             path: '/health',                     ok: [200] },
  { name: '/api/auth',           path: '/api/auth/status',            ok: [200, 401, 403] },
  { name: '/api/blocks-fast',    path: '/api/blocks-fast',            ok: [200, 400, 401, 403, 405] },
  { name: '/api/briefing',       path: '/api/briefing/weather/test',  ok: [200, 400, 401, 403, 404] },
  { name: '/api/strategy/events',path: '/events/strategy',            ok: [200, 401, 403, 404] },
];

let passed = 0;
let failed = 0;

console.log(`\nSmoke Test — ${BASE_URL}\n${'='.repeat(50)}`);

for (const ep of endpoints) {
  try {
    const res = await httpGet(`${BASE_URL}${ep.path}`);
    if (ep.ok.includes(res.status)) {
      console.log(`  PASS  ${ep.name} (${res.status})`);
      passed++;
    } else {
      console.log(`  FAIL  ${ep.name} — got ${res.status}, expected one of [${ep.ok}]`);
      failed++;
    }
  } catch (err) {
    console.log(`  FAIL  ${ep.name} — ${err.message}`);
    failed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
