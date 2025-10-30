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

// Ensure deterministic env and port
process.env.PORT = process.env.PORT || '5000';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const PORT = process.env.PORT;

console.log('[boot] Starting Vecto Pilot gateway...');
console.log(`[boot] PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}`);

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
