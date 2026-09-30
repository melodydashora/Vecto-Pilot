// server/bootstrap/workers.js
// Background worker spawning and management

import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Track spawned child processes for graceful shutdown
const children = new Map();

// 2026-02-17: eventSyncJob removed — events sync per-snapshot via briefing pipeline
let isShuttingDown = false;
const workerLogPath = path.join(os.tmpdir(), 'worker.log');

// Both output modes share one lifecycle. A child error and its subsequent exit
// are one failure, and old child callbacks cannot delete or replace a new child.
const positiveInteger = (value, fallback) => /^\d+$/.test(value || '') && Number(value) > 0 ? Number(value) : fallback;
const MAX_WORKER_RESTARTS = positiveInteger(process.env.MAX_WORKER_RESTARTS, 10);
const RESTART_BACKOFF_MS = positiveInteger(process.env.RESTART_BACKOFF_MS, 5000);
const workers = new Map();

function spawnManaged(name, command, args, env, useLogFile) {
  if (isShuttingDown) return null;
  let record = workers.get(name);
  if (record?.child || record?.timer) return record.child || null;
  if (!record) { record = { child: null, timer: null, failures: 0 }; workers.set(name, record); }
  if (record.failures >= MAX_WORKER_RESTARTS) return null;

  let child, descriptor;
  let settled = false;
  const finish = (code, error) => {
    if (settled || workers.get(name) !== record || record.child !== child) return;
    settled = true;
    record.child = null;
    if (children.get(name) === child) children.delete(name);
    if (isShuttingDown) return;
    if (code === 0 && !error) { record.failures = 0; return; }
    record.failures += 1;
    console.error(`[GATEWAY] ${name} stopped unexpectedly (failure ${record.failures}/${MAX_WORKER_RESTARTS})`);
    if (record.failures >= MAX_WORKER_RESTARTS) return;
    record.timer = setTimeout(() => {
      record.timer = null;
      if (!isShuttingDown && workers.get(name) === record && !record.child) {
        spawnManaged(name, command, args, env, useLogFile);
      }
    }, RESTART_BACKOFF_MS);
    record.timer.unref?.();
  };
  try {
    if (useLogFile) descriptor = openSync(workerLogPath, 'a', 0o600);
    child = spawn(command, args, { env: { ...process.env, ...env },
      stdio: useLogFile ? ['ignore', descriptor, descriptor] : ['ignore', 'pipe', 'pipe'] });
    record.child = child; children.set(name, child);
    child.stdout?.on('data', data => console.log(`[${name}] ${data.toString().trim()}`));
    child.stderr?.on('data', data => console.error(`[${name}] ${data.toString().trim()}`));
    child.on('error', error => finish(null, error));
    child.on('exit', code => finish(code));
    return child;
  } catch (error) {
    // Synchronous spawn/open failures use the same bounded restart policy.
    child = null; record.child = null; finish(null, error);
    return null;
  } finally {
    // Child inherited the descriptor; the parent must not leak one per restart.
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function spawnChild(name, command, args, env = {}) {
  return spawnManaged(name, command, args, env, false);
}

export function startStrategyWorker({ useLogFile = false } = {}) {
  return spawnManaged('strategy-worker', 'node', ['strategy-generator.js'], {}, useLogFile);
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
  for (const record of workers.values()) {
    if (record.timer) clearTimeout(record.timer);
    record.timer = null;
  }
  children.forEach((child, name) => {
    console.log(`[GATEWAY] Stopping ${name}...`);
    child.kill(signal);
  });

  // 2026-02-17: eventSyncJob cleanup removed — no longer runs on server start
}





