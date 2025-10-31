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

// Load mono-mode.env (but override DATABASE_URL on Replit to use built-in DB)
const isReplit = !!process.env.REPL_ID;
const replitDatabaseUrl = process.env.DATABASE_URL; // Save Replit's DB URL before loading mono-mode.env

try {
  const envFile = readFileSync('mono-mode.env', 'utf-8');
  envFile.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#') && !line.startsWith('export') && line.includes('=')) {
      const [key, ...valueParts] = line.split('=');
      const keyTrimmed = key.trim();
      const value = valueParts.join('=').replace(/^["']|["']$/g, '');
      process.env[keyTrimmed] = value.trim();
    }
  });
  console.log('[boot] ✅ Loaded mono-mode.env');
  
  // On Replit, override DATABASE_URL to use built-in PostgreSQL instead of Neon
  if (isReplit && replitDatabaseUrl) {
    process.env.DATABASE_URL = replitDatabaseUrl;
    delete process.env.DATABASE_URL_UNPOOLED; // Remove Neon unpooled URL
    console.log('[boot] 🗄️  Overriding to Replit PostgreSQL:', replitDatabaseUrl.substring(0, 50) + '...');
  }
} catch (err) {
  console.warn('[boot] ⚠️  Could not load mono-mode.env:', err.message);
}

// Ensure deterministic env and port
process.env.PORT = process.env.PORT || '5000';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const PORT = process.env.PORT;

console.log('[boot] Starting Vecto Pilot gateway...');
console.log(`[boot] PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}`);
console.log(`[boot] ENABLE_BACKGROUND_WORKER=${process.env.ENABLE_BACKGROUND_WORKER}`);

// Start gateway server
const server = spawn('node', ['gateway-server.js'], {
  stdio: 'inherit',
  env: process.env
});

server.on('error', (err) => {
  console.error('[boot:error] Failed to spawn gateway:', err.message);
  process.exit(1);
});

server.on('exit', (code) => {
  console.error(`[boot:exit] Gateway exited with code ${code}`);
  process.exit(code || 1);
});

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
});

process.on('SIGINT', () => {
  console.log('[boot] SIGINT received, shutting down...');
  server.kill();
});
