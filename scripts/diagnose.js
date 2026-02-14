#!/usr/bin/env node
/**
 * Network & Server Diagnostic Script
 * Run: node scripts/diagnose.js
 * Output: /tmp/diagnose.log (also printed to console)
 */
import http from 'node:http';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const LOG_FILE = '/tmp/diagnose.log';
const lines = [];

function log(msg) {
  console.log(msg);
  lines.push(msg);
}

function section(title) {
  log('');
  log(`═══ ${title} ${'═'.repeat(Math.max(0, 60 - title.length))}`);
}

function run(cmd) {
  try {
    return execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch {
    return '(command failed)';
  }
}

async function checkHttp(url, label) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        log(`  ${label}: ${res.statusCode} (${body.slice(0, 100)})`);
        resolve(true);
      });
    });
    req.on('error', (e) => {
      log(`  ${label}: FAILED - ${e.message}`);
      resolve(false);
    });
    req.on('timeout', () => {
      log(`  ${label}: TIMEOUT`);
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  log(`Vecto Pilot Diagnostics — ${new Date().toISOString()}`);
  log(`PID: ${process.pid}`);

  // ── Replit Environment
  section('Replit Environment');
  const replitVars = [
    'REPLIT_DEV_DOMAIN', 'REPL_SLUG', 'REPL_OWNER', 'REPL_ID',
    'REPLIT_DEPLOYMENT', 'REPLIT_DB_URL', 'HOSTNAME',
    'PORT', 'HOST', 'NODE_ENV'
  ];
  for (const v of replitVars) {
    log(`  ${v}=${process.env[v] || '(empty)'}`);
  }

  // ── Port Configuration
  section('Port Configuration');
  log(`  gateway-server.js PORT: ${process.env.PORT || '5000 (default)'}`);
  log(`  GATEWAY_PORT: ${process.env.GATEWAY_PORT || '(not set)'}`);

  // Check .replit ports section
  try {
    const replit = readFileSync('.replit', 'utf-8');
    const portLines = replit.split('\n').filter(l => l.includes('Port') || l.includes('port') || l.includes('[[ports'));
    log(`  .replit port config:`);
    portLines.forEach(l => log(`    ${l.trim()}`));
  } catch {
    log(`  .replit: not readable`);
  }

  // ── Process Check
  section('Running Processes');
  const procs = run("ps aux | grep -E 'gateway|start-replit|vite|node.*server' | grep -v grep | grep -v diagnose");
  procs.split('\n').filter(Boolean).forEach(p => {
    const parts = p.trim().split(/\s+/);
    log(`  PID=${parts[1]} CPU=${parts[2]}% MEM=${parts[3]}% CMD=${parts.slice(10).join(' ').slice(0, 80)}`);
  });

  // ── Port Listeners
  section('Port Listeners');
  const listeners = run("lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E '5000|3000|3001|8080|80' || echo '(none found)'");
  listeners.split('\n').filter(Boolean).forEach(l => log(`  ${l.trim()}`));

  // ── HTTP Health Checks
  section('HTTP Health Checks');
  await checkHttp('http://localhost:5000/health', 'localhost:5000/health');
  await checkHttp('http://localhost:5000/api/health', 'localhost:5000/api/health');
  await checkHttp('http://0.0.0.0:5000/health', '0.0.0.0:5000/health');
  await checkHttp('http://127.0.0.1:5000/health', '127.0.0.1:5000/health');
  await checkHttp('http://localhost:3000/health', 'localhost:3000/health');
  await checkHttp('http://localhost:80/health', 'localhost:80/health');

  // ── Concierge Token Test (unauthenticated - should get 401)
  section('Concierge API Check');
  await checkHttp('http://localhost:5000/api/concierge/token', 'GET /api/concierge/token (expect 401)');

  // ── Client Build Check
  section('Client Build');
  const indexExists = existsSync('client/dist/index.html');
  log(`  client/dist/index.html: ${indexExists ? 'EXISTS' : 'MISSING'}`);
  if (indexExists) {
    const indexHtml = readFileSync('client/dist/index.html', 'utf-8');
    log(`  index.html size: ${indexHtml.length} chars`);
    const scriptTags = (indexHtml.match(/<script/g) || []).length;
    log(`  script tags: ${scriptTags}`);
  }

  // ── Server Startup Logs (last 30 lines)
  section('Server Logs (last 30 lines)');
  for (const logPath of ['/tmp/server.log', '/tmp/worker.log', '/tmp/worker-output.log']) {
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, 'utf-8');
      const last = content.split('\n').slice(-15).join('\n');
      log(`  --- ${logPath} ---`);
      log(last);
    }
  }

  // ── Network Interfaces
  section('Network Interfaces');
  const ifaces = run("ip addr show 2>/dev/null | grep 'inet ' || hostname -I 2>/dev/null || echo '(unknown)'");
  ifaces.split('\n').filter(Boolean).forEach(l => log(`  ${l.trim()}`));

  // ── Summary
  section('Summary');
  log(`  Diagnostics saved to: ${LOG_FILE}`);
  log(`  Timestamp: ${new Date().toISOString()}`);

  // Write to file
  writeFileSync(LOG_FILE, lines.join('\n') + '\n');
  console.log(`\n📋 Full log written to ${LOG_FILE}`);
}

main().catch(e => {
  console.error('Diagnostic error:', e);
  process.exit(1);
});
