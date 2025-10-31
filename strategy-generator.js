#!/usr/bin/env node
// strategy-generator.js - Triad Worker Entry Point
// Runs the background strategy generation loop independently

import { processTriadJobs } from './server/jobs/triad-worker.js';

console.log('[strategy-generator] 🚀 Triad worker starting...');
console.log('[strategy-generator] Environment:');
console.log(`  NODE_ENV=${process.env.NODE_ENV}`);
console.log(`  DATABASE_URL=${process.env.DATABASE_URL ? '***configured***' : 'MISSING'}`);
console.log(`  ENABLE_BACKGROUND_WORKER=${process.env.ENABLE_BACKGROUND_WORKER}`);

// Start the worker loop
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

console.log('[strategy-generator] ✅ Worker loop started');
