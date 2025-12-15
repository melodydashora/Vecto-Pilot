// server/bootstrap/workers.js
// Background worker spawning and management

import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

// Track spawned child processes for graceful shutdown
const children = new Map();

// Track in-process jobs
let eventSyncJob = null;

/**
 * Spawn a child process with auto-restart on crash
 * @param {string} name - Process name for logging
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {object} env - Additional environment variables
 * @returns {ChildProcess} The spawned child process
 */
export function spawnChild(name, command, args, env = {}) {
  console.log(`[gateway] Starting ${name}...`);

  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data) =>
    console.log(`[${name}] ${data.toString().trim()}`)
  );

  child.stderr.on('data', (data) =>
    console.error(`[${name}] ${data.toString().trim()}`)
  );

  child.on('exit', (code) => {
    console.error(`❌ [gateway] ${name} exited with code ${code}, restarting...`);
    children.delete(name);
    setTimeout(() => spawnChild(name, command, args, env), 2000);
  });

  children.set(name, child);
  return child;
}

/**
 * Start strategy generator worker
 * Consolidates the two different spawn patterns from original gateway-server.js
 * @param {object} options
 * @param {boolean} options.useLogFile - Write output to /tmp/worker.log instead of stdout
 */
export function startStrategyWorker(options = {}) {
  const { useLogFile = false } = options;

  console.log('[gateway] 🚀 Starting strategy generator worker...');

  try {
    if (useLogFile) {
      const workerLogFd = openSync('/tmp/worker.log', 'a');

      const worker = spawn('node', ['strategy-generator.js'], {
        stdio: ['ignore', workerLogFd, workerLogFd],
        env: { ...process.env },
      });

      worker.on('error', (err) => {
        console.error('[gateway:worker:error] Failed to spawn worker:', err.message);
      });

      worker.on('exit', (code) => {
        console.error(`[gateway:worker:exit] Worker exited with code ${code}, restarting...`);
        setTimeout(() => startStrategyWorker(options), 5000);
      });

      children.set('strategy-worker', worker);
      console.log(`[gateway] ✅ Worker started (PID: ${worker.pid})`);
      console.log(`[gateway] 📋 Worker logs: /tmp/worker.log`);
      return worker;
    } else {
      // Use spawnChild for auto-restart with stdout/stderr piped
      return spawnChild('strategy-generator', 'node', ['strategy-generator.js'], {});
    }
  } catch (e) {
    console.error('[gateway] ❌ Failed to start worker:', e?.message);
    return null;
  }
}

/**
 * Determine if strategy worker should start based on environment
 * Consolidates the multiple condition checks from original gateway-server.js
 * @param {object} options
 * @param {string} options.mode - Application mode (mono/distributed)
 * @param {boolean} options.isAutoscaleMode - Whether running in autoscale mode
 * @returns {{ shouldStart: boolean, useLogFile: boolean, reason: string }}
 */
export function shouldStartWorker({ mode, isAutoscaleMode }) {
  // Autoscale mode - no background workers
  if (isAutoscaleMode) {
    return {
      shouldStart: false,
      useLogFile: false,
      reason: 'Autoscale mode detected - background workers disabled'
    };
  }

  // Explicit enable flag takes precedence
  if (process.env.ENABLE_BACKGROUND_WORKER === 'true') {
    return {
      shouldStart: true,
      useLogFile: true,
      reason: 'ENABLE_BACKGROUND_WORKER=true'
    };
  }

  // Mono mode with spawning enabled
  const disableSpawnSdk = process.env.DISABLE_SPAWN_SDK === '1';
  const disableSpawnAgent = process.env.DISABLE_SPAWN_AGENT === '1';

  if (mode === 'mono' && !disableSpawnSdk && !disableSpawnAgent) {
    return {
      shouldStart: true,
      useLogFile: false,
      reason: 'Mono mode with spawning enabled'
    };
  }

  return {
    shouldStart: false,
    useLogFile: false,
    reason: 'No worker start conditions met'
  };
}

/**
 * Get all tracked child processes
 * @returns {Map<string, ChildProcess>}
 */
export function getChildren() {
  return children;
}

/**
 * Kill all child processes gracefully
 * @param {string} signal - Signal to send (SIGINT or SIGTERM)
 */
export function killAllChildren(signal = 'SIGTERM') {
  children.forEach((child, name) => {
    console.log(`[gateway] Stopping ${name}...`);
    child.kill(signal);
  });

  // Stop in-process jobs
  if (eventSyncJob) {
    eventSyncJob.stop();
    eventSyncJob = null;
  }
}

/**
 * Start the daily event sync job
 * Runs in-process (not spawned) for simplicity
 */
export async function startEventSyncJob() {
  try {
    const { startEventSyncJob: startJob } = await import('../jobs/event-sync-job.js');
    eventSyncJob = startJob();
    console.log('[gateway] ✅ Event sync job started');
    return eventSyncJob;
  } catch (err) {
    console.error('[gateway] ❌ Failed to start event sync job:', err.message);
    return null;
  }
}
