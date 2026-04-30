#!/usr/bin/env node
/**
 * Pre-deployment environment check — verifies DB connectivity and schema accessibility.
 *
 * Usage: node tests/scripts/preflight-check.js
 * Requires: DATABASE_URL set (Replit auto-injects this)
 *
 * 2026-04-14: Rewritten for current architecture (Pass 7, Issue AV)
 *   - Queries actual table count from information_schema (was hardcoded to 19)
 *   - Verifies shared/schema.js can be imported
 *   - Checks server health endpoint
 */

import { execSync } from 'node:child_process';
import http from 'node:http';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

let passed = 0;
let failed = 0;
let warnings = 0;

function report(result, name, detail) {
  const tag = result === 'pass' ? 'PASS' : result === 'warn' ? 'WARN' : 'FAIL';
  console.log(`  ${tag}  ${name}${detail ? ' — ' + detail : ''}`);
  if (result === 'pass') passed++;
  else if (result === 'warn') warnings++;
  else failed++;
}

console.log(`\nPreflight Check\n${'='.repeat(50)}`);

// 1. DATABASE_URL
console.log('\n1. Environment');
if (process.env.DATABASE_URL) {
  report('pass', 'DATABASE_URL is set');
} else {
  report('fail', 'DATABASE_URL is not set');
}

// 2. Schema definition imports
console.log('\n2. Schema Definition');
try {
  execSync('node -e "await import(\'./shared/schema.js\')"', { stdio: 'pipe', timeout: 15000 });
  report('pass', 'shared/schema.js imports without error');
} catch {
  report('fail', 'shared/schema.js import failed');
}

// 3. Database table count (dynamic query, not hardcoded)
console.log('\n3. Database Tables');
if (process.env.DATABASE_URL) {
  try {
    // Use pg (existing project dependency) via a subprocess to keep this script's imports minimal.
    const script = [
      "import pg from 'pg';",
      "const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });",
      "const r = await pool.query(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'\");",
      "console.log(r.rows[0].count);",
      "await pool.end();",
    ].join(' ');
    const count = parseInt(
      execSync(`node --input-type=module -e "${script}"`, { encoding: 'utf8', timeout: 15000 }).trim()
    );
    if (count >= 40) {
      report('pass', `${count} tables found (expected 40+)`);
    } else {
      report('warn', `${count} tables found (expected 40+, check for missing migrations)`);
    }
  } catch {
    report('fail', 'Database query failed');
  }
} else {
  report('fail', 'Database check skipped (no DATABASE_URL)');
}

// 4. Server health endpoint
console.log('\n4. Server Health');
try {
  const status = await new Promise((resolve, reject) => {
    const urlObj = new URL(`${BASE_URL}/health`);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: '/health',
      method: 'GET',
      timeout: 5000,
    }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
  if (status === 200) {
    report('pass', 'Health endpoint responding');
  } else {
    report('warn', `Health endpoint returned ${status}`);
  }
} catch {
  report('warn', 'Server not running (health check skipped)');
}

// Summary
console.log(`\n${'='.repeat(50)}`);
if (failed > 0) {
  console.log(`\nFAILED — ${failed} critical, ${warnings} warnings, ${passed} passed\n`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\nPASSED WITH WARNINGS — ${warnings} warnings, ${passed} passed\n`);
  process.exit(0);
} else {
  console.log(`\nALL CHECKS PASSED — ${passed} passed\n`);
  process.exit(0);
}
