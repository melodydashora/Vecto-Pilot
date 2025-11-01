/**
 * REPLIT BOOT SCRIPT - Canonical Entry Point
 *
 * Ensures:
 * - Deterministic PORT binding (5000)
 * - Health gate before preview resolves
 * - Clean environment setup
 * - Fast-fail on boot errors
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Load mono-mode.env
try {
  const envFile = readFileSync('mono-mode.env', 'utf-8');
  envFile.split('\n').forEach(line => {
    line = line.trim();
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) return;

    // Remove 'export ' prefix if present
    if (line.startsWith('export ')) {
      line = line.substring(7);
    }

    // Parse KEY=value
    if (line.includes('=')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').replace(/^["']|["']$/g, '');
      process.env[key.trim()] = value.trim();
    }
  });
  console.log('[boot] ✅ Loaded mono-mode.env');
} catch (err) {
  console.warn('[boot] ⚠️  Could not load mono-mode.env:', err.message);
}

// Ensure deterministic env and port
process.env.PORT = process.env.PORT || '5000';

// Force explicit value to survive shell quirks; allow override via FORCE_DEV
if (process.env.FORCE_DEV === '1') {
  process.env.NODE_ENV = 'development';
} else {
  process.env.NODE_ENV = 'production';
}

process.env.WORKER_ID = process.env.WORKER_ID || `replit:${process.pid}`;

const PORT = process.env.PORT;

// Kill any existing process on port 5000 to prevent conflicts
import { execSync } from 'node:child_process';
try {
  execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  console.log(`[boot] ✅ Cleared port ${PORT}`);
} catch (err) {
  // Port already free, continue
}

console.log('[boot] Starting Vecto Pilot in MONO mode...');
console.log(`[boot] PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}`);
console.log(`[boot] ENABLE_BACKGROUND_WORKER=${process.env.ENABLE_BACKGROUND_WORKER}`);
console.log(`[boot] REPL_ID=${process.env.REPL_ID ? 'set' : 'not set'}`);

const fs = require('fs');
const path = require('path');

// Verify client build exists
const clientDistPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
if (!fs.existsSync(clientDistPath)) {
  console.error('❌ [boot] Client build missing! Building now...');
  const { execSync } = require('child_process');
  try {
    execSync('cd client && npm install && npm run build', { stdio: 'inherit' });
    console.log('✅ [boot] Client build complete');
  } catch (err) {
    console.error('❌ [boot] Client build failed:', err.message);
    process.exit(1);
  }
}

// Start gateway server
const server = spawn('node', ['gateway-server.js'], {
  stdio: 'inherit',
  env: { ...process.env } // ensure explicit env propagation
});

server.on('error', (err) => {
  console.error('[boot:error] Failed to spawn gateway:', err.message);
  process.exit(1);
});

server.on('exit', (code) => {
  console.error(`[boot:exit] Gateway exited with code ${code}`);
  process.exit(code || 1);
});

// Start triad worker (only if enabled)
let worker = null;
if (process.env.ENABLE_BACKGROUND_WORKER === 'true') {
  console.log('[boot] ⚡ Starting triad worker...');
  worker = spawn('node', ['strategy-generator.js'], {
    stdio: 'inherit',
    env: { ...process.env } // ensure explicit env propagation
  });

  worker.on('error', (err) => {
    console.error('[boot:worker:error] Failed to spawn worker:', err.message);
  });

  worker.on('exit', (code) => {
    console.error(`[boot:worker:exit] Worker exited with code ${code}`);
  });

  console.log(`[boot] ✅ Triad worker started (PID: ${worker.pid})`);
} else {
  console.log('[boot] ⏸️  Background worker disabled');
}

// Health gate: Wait for server to be ready before declaring success
function waitHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => {
        if (res.statusCode === 200) {
          console.log('[boot] ✅ Health check passed');
          return resolve();
        }
        if (Date.now() > deadline) {
          return reject(new Error('health timeout'));
        }
        setTimeout(tick, 500);
      }).on('error', () => {
        if (Date.now() > deadline) {
          return reject(new Error('health timeout'));
        }
        setTimeout(tick, 500);
      });
    };

    // Start polling after 1s to give server time to bind
    setTimeout(tick, 1000);
  });
}

const healthUrl = `http://localhost:${PORT}/api/health`;

waitHealth(healthUrl)
  .then(() => {
    console.log(`[boot] ✅ Server ready at http://localhost:${PORT}`);
  })
  .catch((e) => {
    console.error('[boot] ❌ Health check failed:', e.message);
    server.kill();
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[boot] SIGTERM received, shutting down...');
  server.kill();
  if (worker) worker.kill();
});

process.on('SIGINT', () => {
  console.log('[boot] SIGINT received, shutting down...');
  server.kill();
  if (worker) worker.kill();
});