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
if (process.env.SIMULATE === '1') {
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

  // Exit early - simulation handles its own lifecycle
  // We use a dummy Promise to prevent the rest of the script from executing
  await new Promise(() => {});
}

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

// CRITICAL: Check for autoscale deployment FIRST before any heavy setup
// ONLY match actual deployments, not dev containers!
const isAutoscale = 
  process.env.REPLIT_DEPLOYMENT === "1" || 
  process.env.REPLIT_DEPLOYMENT === "true"

// Debug logging for deployment detection
console.log('[boot] 🔍 Deployment detection:');
console.log('[boot]   REPLIT_DEPLOYMENT:', process.env.REPLIT_DEPLOYMENT);
console.log('[boot]   REPL_DEPLOYMENT:', process.env.REPL_DEPLOYMENT);
console.log('[boot]   HOSTNAME:', process.env.HOSTNAME);
console.log('[boot]   isAutoscale:', isAutoscale);

if (isAutoscale) {
  // AUTOSCALE MODE: Start ultra-minimal health server inline
  console.log('[boot] ⚡ Autoscale deployment detected - inline health-only server');
  console.log('[boot] ⏱️ Timestamp:', new Date().toISOString());
  
  const PORT = parseInt(process.env.PORT || '5000', 10);
  console.log('[boot] 🔧 PORT:', PORT);
  
  try {
    // Create the absolute minimal HTTP server
    const server = http.createServer((req, res) => {
      try {
        // Health check endpoints - respond instantly
        if (req.url === '/' || req.url === '/health' || req.url === '/healthz' || req.url === '/ready') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
          return;
        }
        
        // Everything else gets 404
        res.writeHead(404);
        res.end('Not Found');
      } catch (err) {
        console.error('[boot] Request handler error:', err);
        res.writeHead(500);
        res.end('Error');
      }
    });
    
    // Prevent crashes from unhandled errors
    server.on('error', (err) => {
      console.error('[boot] ❌ FATAL Server error:', err);
      console.error('[boot] Error code:', err.code);
      console.error('[boot] Error message:', err.message);
      // Don't exit - just log it
    });
    
    // Start listening
    server.listen(PORT, '0.0.0.0', () => {
      console.log('[boot] ✅ Health server LISTENING on 0.0.0.0:' + PORT);
      console.log('[boot] 🚀 Ready for health checks at /, /health, /healthz, /ready');
      console.log('[boot] ⏱️ Ready time:', new Date().toISOString());
    });
    
    // Catch ANY unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[boot] ⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't exit - just log
    });
    
    // Catch ANY uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('[boot] ⚠️ Uncaught Exception:', err);
      // Don't exit - just log
    });
    
    console.log('[boot] 💚 Server created, process staying alive...');
    
    // Keep process alive with setInterval (more reliable than Promise)
    setInterval(() => {
      // Just keep the event loop alive
    }, 1000000);
    
    // Also use Promise as backup
    await new Promise(() => {});
    
  } catch (err) {
    console.error('[boot] ❌ FATAL: Failed to start health server:', err);
    console.error('[boot] Stack:', err.stack);
    process.exit(1);
  }
}

// REGULAR MODE: Full mono-mode bootstrap with worker process
console.log('[boot] Local development mode - full bootstrap');

// Load .env first (contains AI model configs)
loadEnvFile('.env');

// Load mono-mode.env (overrides deployment-specific settings)
loadEnvFile('mono-mode.env');

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
  // Validate required STRATEGY_* environment variables (fail-fast on missing config)
  const { validateStrategyEnv } = await import('../server/lib/validate-strategy-env.js');
  validateStrategyEnv();
  
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

// Start SDK server on port 3101 (health shim for supervisor probes)
console.log('[boot] ⚡ Starting SDK server on port 3101...');
const sdk = spawn('node', ['index.js', '--port=3101', '--host=0.0.0.0'], {
  stdio: 'inherit',
  env: { 
    ...process.env,
    EIDOLON_PORT: '3101',
    SKIP_AGENT: 'true'  // Gateway manages the agent
  }
});

sdk.on('error', (err) => {
  console.error('[boot:sdk:error] Failed to spawn SDK:', err.message);
  // Don't exit - SDK is optional, gateway can run without it
});

sdk.on('exit', (code) => {
  console.warn(`[boot:sdk:exit] SDK exited with code ${code}`);
  // Don't exit - SDK is optional
});

console.log('[boot] ✅ SDK server started on port 3101');

// Start triad worker (only if enabled AND not on Cloud Run)
// Cloud Run/Autoscale environments should NOT run background workers
const shouldStartWorker = process.env.ENABLE_BACKGROUND_WORKER === 'true' && !isCloudRun;

let worker = null;
if (shouldStartWorker) {
  console.log('[boot] ⚡ Starting triad worker...');
  
  // Open log file for worker output
  const { openSync } = await import('node:fs');
  const workerLogFd = openSync('/tmp/worker-output.log', 'a');
  
  worker = spawn('node', ['strategy-generator.js'], {
    stdio: ['ignore', workerLogFd, workerLogFd],
    env: { ...process.env } // ensure explicit env propagation
  });

  worker.on('error', (err) => {
    console.error('[boot:worker:error] Failed to spawn worker:', err.message);
  });

  worker.on('exit', (code) => {
    console.error(`[boot:worker:exit] Worker exited with code ${code}`);
  });

  console.log(`[boot] ✅ Triad worker started (PID: ${worker.pid})`);
  console.log(`[boot] 📋 Worker logs: /tmp/worker-output.log`);
} else if (isCloudRun) {
  console.log('[boot] ⏩ Skipping background worker (Cloud Run/Autoscale detected)');
} else {
  console.log('[boot] ⏸️  Background worker disabled (ENABLE_BACKGROUND_WORKER not set)');
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
process.on('SIGTERM', () => {
  console.log('[boot] SIGTERM received, shutting down...');
  server.kill();
  if (sdk) sdk.kill();
  if (worker) worker.kill();
});

process.on('SIGINT', () => {
  console.log('[boot] SIGINT received, shutting down...');
  server.kill();
  if (sdk) sdk.kill();
  if (worker) worker.kill();
});