// server/bootstrap/workers.js
// Background worker spawning and management

import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Track spawned child processes for graceful shutdown
const children = new Map();

// 2026-02-17: eventSyncJob removed — events sync per-snapshot via briefing pipeline
let isShuttingDown = false;
const workerLogPath = path.join(os.tmpdir(), 'worker.log');

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

  child.on('error', (err) => {
    console.error(`[gateway] ${name} spawn error:`, err.message);
    children.delete(name);
    if (!isShuttingDown) {
      setTimeout(() => spawnChild(name, command, args, env), 2000);
    }
  });

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (isShuttingDown) {
      console.log(`[gateway] ${name} stopped (${signal || code})`);
      return;
    }
    if (code === 0) {
      console.warn(`[gateway] ${name} exited cleanly (code 0) - not restarting`);
      return;
    }
    console.error(`[gateway] ${name} exited with code ${code ?? 'null'}, restarting...`);
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
      const workerLogFd = openSync(workerLogPath, 'a');

      const worker = spawn('node', ['strategy-generator.js'], {
        stdio: ['ignore', workerLogFd, workerLogFd],
        env: { ...process.env },
      });

      worker.on('error', (err) => {
        console.error('[gateway:worker:error] Failed to spawn worker:', err.message);
        if (!isShuttingDown) {
          setTimeout(() => startStrategyWorker(options), 5000);
        }
      });

      worker.on('exit', (code, signal) => {
        if (isShuttingDown) {
          console.log(`[gateway] strategy-worker stopped (${signal || code})`);
          return;
        }
        if (code === 0) {
          console.warn('[gateway] strategy-worker exited cleanly (code 0) - not restarting');
          return;
        }
        console.error(`[gateway:worker:exit] Worker exited with code ${code ?? 'null'}, restarting...`);
        setTimeout(() => startStrategyWorker(options), 5000);
      });

      children.set('strategy-worker', worker);
      console.log(`[gateway] ✅ Worker started (PID: ${worker.pid})`);
      console.log(`[gateway] Worker logs: ${workerLogPath}`);
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
  isShuttingDown = true;
  children.forEach((child, name) => {
    console.log(`[gateway] Stopping ${name}...`);
    child.kill(signal);
  });

  // 2026-02-17: eventSyncJob cleanup removed — no longer runs on server start
}





