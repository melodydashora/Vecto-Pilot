#!/usr/bin/env node
/**
 * Conditional prebuild script
 * Skips expensive builds in autoscale deployments (already built in Docker image)
 */

const { execSync } = require('child_process');

// Skip prebuild in autoscale deployments (client already built in Docker layer)
if (process.env.REPLIT_DEPLOYMENT === '1') {
  console.log('[prebuild] ⏩ Skipping build in autoscale (already built in Docker image)');
  process.exit(0);
}

// In development/local: run the full prebuild
console.log('[prebuild] 🔨 Building client and agent...');
try {
  execSync('npm run build:client && npm run agent:build', { stdio: 'inherit' });
  console.log('[prebuild] ✅ Build complete');
} catch (err) {
  console.error('[prebuild] ❌ Build failed:', err.message);
  process.exit(1);
}
