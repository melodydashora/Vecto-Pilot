#!/usr/bin/env node
// strategy-generator.js - Triad Worker Entry Point
// Runs the consolidation listener only (LISTEN mode, no hot polling)

// Load environment contract (if not already loaded by parent process)
import { loadEnvironment } from './server/lib/load-env.js';
if (!process.env._ENV_LOADED) {
  loadEnvironment();
  process.env._ENV_LOADED = '1';
}

// Force unbuffered console output for child process
if (process.stdout._handle) process.stdout._handle.setBlocking(true);
if (process.stderr._handle) process.stderr._handle.setBlocking(true);

console.log('[strategy-generator] 🚀 Triad worker starting (LISTEN-only mode)...');
console.log('[strategy-generator] Environment:');
console.log(`  NODE_ENV=${process.env.NODE_ENV}`);
console.log(`  DATABASE_URL=${process.env.DATABASE_URL ? '***configured***' : 'MISSING'}`);
console.log(`  ENABLE_BACKGROUND_WORKER=${process.env.ENABLE_BACKGROUND_WORKER}`);

// Test database connection first
import { db } from './server/db/drizzle.js';
import { sql } from 'drizzle-orm';

console.log('[strategy-generator] Testing database connection...');
try {
  await db.execute(sql`SELECT 1 as test`);
  console.log('[strategy-generator] ✅ Database connection OK');
} catch (err) {
  console.error('[strategy-generator] ❌ Database connection FAILED:', err.message);
  process.exit(1);
}

// Import the LISTEN-only worker
import { startConsolidationListener } from './server/jobs/triad-worker.js';

console.log('[strategy-generator] ✅ Starting consolidation listener...');

try {
  await startConsolidationListener();
  console.log('[strategy-generator] ✅ Consolidation listener started successfully');
} catch (err) {
  console.error('[strategy-generator] ❌ Consolidation listener error:', err.message);
  console.error(err.stack);
  process.exit(1);
}

// Top-level error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[strategy-generator] ❌ UNHANDLED REJECTION:', reason);
  console.error('Promise:', promise);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[strategy-generator] ❌ UNCAUGHT EXCEPTION:', error);
  console.error(error.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[strategy-generator] 🛑 SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[strategy-generator] 🛑 SIGINT received, shutting down...');
  process.exit(0);
});

// Log every 10 seconds to prove worker is alive
setInterval(() => {
  console.log('[strategy-generator] ❤️ Listener heartbeat - still running...');
}, 10000);
