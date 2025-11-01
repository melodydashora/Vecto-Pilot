#!/usr/bin/env node
// strategy-generator.js - Triad Worker Entry Point
// Runs the background strategy generation loop independently

console.log('[strategy-generator] 🚀 Triad worker starting...');
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

// Now start the worker loop
import { processTriadJobs } from './server/jobs/triad-worker.js';
import { startConsolidationListener } from './server/lib/strategy-consolidator.js';

console.log('[strategy-generator] ✅ Starting consolidation listener first...');

// Start the consolidation listener FIRST (before worker loop)
try {
  await startConsolidationListener();
  console.log('[strategy-generator] ✅ Consolidation listener started successfully');
} catch (err) {
  console.error('[strategy-generator] ❌ Consolidation listener error:', err.message);
  console.error(err.stack);
}

console.log('[strategy-generator] ✅ Starting worker loop...');

// Start the worker loop (this is an infinite loop, so it never returns)
processTriadJobs()
  .catch(err => {
    console.error('[strategy-generator] ❌ Fatal error:', err.message);
    console.error(err.stack);
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
  console.log('[strategy-generator] ❤️ Worker heartbeat - still running...');
}, 10000);
