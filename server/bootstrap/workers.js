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

// 2026-02-25: Restart limits (ported from start-replit.js during Phase 6 refactor)
// Prevents infinite restart loops that exhaust DB connection pool
const MAX_WORKER_RESTARTS = parseInt(process.env.MAX_WORKER_RESTARTS || '10', 10);
const RESTART_BACKOFF_MS = parseInt(process.env.RESTART_BACKOFF_MS || '5000', 10);
let consecutiveFailures = 0;

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
 * Start strategy generator worker with restart limits.
 *
 * 2026-02-25: Added MAX_WORKER_RESTARTS guard (ported from start-replit.js).
 * Without this, a crashing worker creates an infinite restart loop that
 * exhausts the DB connection pool and cascades failures to auth queries.
 *
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
        scheduleWorkerRestart(options);
      });

      worker.on('exit', (code, signal) => {
        children.delete('strategy-worker');
        if (isShuttingDown) {
          console.log(`[gateway] strategy-worker stopped (${signal || code})`);
          return;
        }
        if (code === 0) {
          console.warn('[gateway] strategy-worker exited cleanly (code 0) - not restarting');
          consecutiveFailures = 0;
          return;
        }
        console.error(`[gateway:worker:exit] Worker exited with code ${code ?? 'null'}`);
        scheduleWorkerRestart(options);
      });

      children.set('strategy-worker', worker);
      console.log(`[gateway] ✅ Worker started (PID: ${worker.pid})`);
      console.log(`[gateway] Worker logs: ${workerLogPath}`);
      console.log(`[gateway] 🔄 Auto-restart enabled (max ${MAX_WORKER_RESTARTS} consecutive failures)`);
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
 * Schedule a worker restart with backoff and failure limit.
 * Prevents infinite restart loops that exhaust DB connections.
 *
 * 2026-02-25: Extracted from start-replit.js during Phase 6 refactor.
 */
function scheduleWorkerRestart(options) {
  if (isShuttingDown) return;

  consecutiveFailures++;

  if (consecutiveFailures >= MAX_WORKER_RESTARTS) {
    console.error(`[gateway] ❌ Worker hit ${MAX_WORKER_RESTARTS} consecutive failures — stopping restarts`);
    console.error('[gateway] ❌ Strategy generation is OFFLINE — manual intervention required');
    console.error('[gateway] ❌ Check /tmp/worker.log for crash details');
    return;
  }

  console.log(`[gateway:worker:restart] Restarting in ${RESTART_BACKOFF_MS}ms (failures: ${consecutiveFailures}/${MAX_WORKER_RESTARTS})`);
  setTimeout(() => {
    // 2026-02-26: Do NOT reset consecutiveFailures here — only reset on code=0 exit (line 109).
    // Previous bug: resetting here meant the counter never reached MAX, causing infinite restarts.
    startStrategyWorker(options);
  }, RESTART_BACKOFF_MS);
}

/**
 * Determine if strategy worker should start based on capability flags.
 *
 * 2026-02-25: Simplified to explicit opt-in only (Phase 6 Autoscale Refactor).
 * - Removed implicit mono-mode branch that started workers without ENABLE_BACKGROUND_WORKER
 * - Autoscale detection checks BOTH CLOUD_RUN_AUTOSCALE and REPLIT_AUTOSCALE
 * - Worker ONLY starts when ENABLE_BACKGROUND_WORKER === 'true'
 *
 * @param {object} options
 * @param {boolean} options.isAutoscaleMode - Whether running in autoscale mode
 * @returns {{ shouldStart: boolean, useLogFile: boolean, reason: string }}
 */
export function shouldStartWorker({ isAutoscaleMode }) {
  // Safety guardrail — autoscale environments MUST NOT run embedded workers
  if (isAutoscaleMode) {
    return {
      shouldStart: false,
      useLogFile: false,
      reason: 'AUTOSCALE GUARDRAIL: Background workers disabled — deploy workers as separate services'
    };
  }

  // Explicit opt-in only — no implicit worker spawning
  if (process.env.ENABLE_BACKGROUND_WORKER === 'true') {
    return {
      shouldStart: true,
      useLogFile: true,
      reason: 'ENABLE_BACKGROUND_WORKER=true (explicit opt-in)'
    };
  }

  return {
    shouldStart: false,
    useLogFile: false,
    reason: 'Worker disabled (set ENABLE_BACKGROUND_WORKER=true to enable)'
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





