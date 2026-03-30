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
import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SIMULATION MODE: Run workflow simulation and exit
// This must be checked FIRST, before any server setup
// 2026-02-25: Fixed race condition — process.exit(0) was killing child before its event handlers fired
const isSimulation = process.env.SIMULATE === '1';
if (isSimulation) {
  console.log('[boot] 📊 Simulation mode detected - running workflow simulation');
  
  const simulationEnv = {
    ...process.env,
    LOG_FILE: process.env.LOG_FILE || '/tmp/workflow.ndjson',
    SNAPSHOT_ID: process.env.SNAPSHOT_ID || 'sim-0001',
    CLIENT_ID: process.env.CLIENT_ID || 'client-dev',
    SIM_DELAY_MS: process.env.SIM_DELAY_MS || '300',
  };

  const child = spawn('node', ['scripts/simulate-workflow.js'], {
    stdio: 'inherit',
    env: simulationEnv
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error('[boot:simulation:error]', err.message);
    process.exit(1);
  });

  // Simulation handles its own lifecycle
  // Child process event handlers (exit/error above) will handle termination
  // Don't continue with normal boot - process will exit via child handlers above
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  
  // Child process event handlers (exit/error) will call process.exit()
  // Do NOT call process.exit(0) here — it races with the child process
}

// Guard: skip normal boot when running simulation
if (!isSimulation) {

// Helper function to load env files
function loadEnvFile(filename) {
  try {
    const envFile = readFileSync(filename, 'utf-8');
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
        const trimmedKey = key.trim();
        const value = valueParts.join('=').replace(/^["']|["']$/g, '').trim();
        
        // Skip if key already exists (preserves Replit Secrets)
        if (process.env[trimmedKey]) {
          return;
        }
        
        // Skip variable references like ${VAR_NAME}
        if (value.startsWith('${') && value.endsWith('}')) {
          return;
        }
        
        process.env[trimmedKey] = value;
      }
    });
    console.log(`[boot] ✅ Loaded ${filename}`);
    return true;
  } catch (err) {
    console.warn(`[boot] ⚠️  Could not load ${filename}:`, err.message);
    return false;
  }
}

// Reserved VM deployment - always run full application, never autoscale mode
// Canonical pattern for deployment detection (standardized across all entry points)
const isDeployment = process.env.REPLIT_DEPLOYMENT === "1" || process.env.REPLIT_DEPLOYMENT === "true";

// Debug logging for deployment detection
console.log('[boot] 🔍 Deployment detection:');
console.log('[boot]   REPLIT_DEPLOYMENT:', process.env.REPLIT_DEPLOYMENT);
console.log('[boot]   HOSTNAME:', process.env.HOSTNAME);
console.log('[boot]   Reserved VM mode - running full application');

// Skip autoscale mode entirely - always run the full app for Reserved VM

// REGULAR MODE: Full mono-mode bootstrap with worker process
console.log('[boot] Local development mode - full bootstrap');

// Load .env (contains AI model configs, API keys not in Replit Secrets)
// 2026-02-25: .env.local is sourced by .replit shell command before this script runs
// gateway-server.js loadEnvironment() will load .env.local again for completeness
loadEnvFile('.env');

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
const isCloudRun = false; // Already checked above

// Skip expensive checks in Cloud Run/Autoscale (need fast startup for health checks)
if (!isCloudRun) {
  // Strategy env validation now handled by validateOrExit() in gateway-server.js

  // Kill any existing process on port 5000 to prevent conflicts
  try {
    execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
    console.log(`[boot] ✅ Cleared port ${PORT}`);
  } catch (err) {
    // Port already free, continue
  }
  
  // Verify client build exists
  const clientDistPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  if (!existsSync(clientDistPath)) {
    console.error('❌ [boot] Client build missing! Building now...');
    try {
      execSync('cd client && npm install && npm run build', { stdio: 'inherit' });
      console.log('✅ [boot] Client build complete');
    } catch (err) {
      console.error('❌ [boot] Client build failed:', err.message);
      process.exit(1);
    }
  }
}

console.log('[boot] Starting Vecto Pilot in MONO mode...');
console.log(`[boot] PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}`);
console.log(`[boot] ENABLE_BACKGROUND_WORKER=${process.env.ENABLE_BACKGROUND_WORKER}`);
console.log(`[boot] REPL_ID=${process.env.REPL_ID ? 'set' : 'not set'}`);

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

// SDK server disabled - all routes embedded in gateway via sdk-embed.js
// No separate SDK process needed in mono mode
console.log('[boot] ⏩ SDK routes embedded in gateway (no separate SDK process)');

// 2026-02-25: Worker lifecycle delegated exclusively to gateway-server.js (Phase 6 Refactor)
// Eliminates dual-spawn bug where both start-replit.js AND gateway-server.js
// independently spawned strategy-generator.js processes, causing DB race conditions.
// gateway-server.js reads ENABLE_BACKGROUND_WORKER and makes the single decision.
console.log('[boot] Worker lifecycle delegated to gateway-server.js');

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

const healthUrl = `http://localhost:${PORT}/health`;

waitHealth(healthUrl)
  .then(() => {
    console.log(`[boot] ✅ Server ready at http://0.0.0.0:${PORT}`);
  })
  .catch((e) => {
    console.error('[boot] ❌ Health check failed:', e.message);
    server.kill();
    process.exit(1);
  });

// Graceful shutdown
// 2026-02-25: Only kill gateway — worker lifecycle managed by gateway's killAllChildren()
process.on('SIGTERM', () => {
  console.log('[boot] SIGTERM received, shutting down...');
  server.kill();
});

process.on('SIGINT', () => {
  console.log('[boot] SIGINT received, shutting down...');
  server.kill();
});

} // end if (!isSimulation)