// server/bootstrap/routes.js
// Centralized route mounting for gateway-server.js

import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

/**
 * Mount a route with error handling and logging
 * @param {Express} app - Express app
 * @param {string} routePath - Route path
 * @param {string} modulePath - Module to import (relative to project root)
 * @param {string} description - Human-readable description
 */
async function mountRoute(app, routePath, modulePath, description) {
  try {
    console.log(`[gateway] Loading ${description}...`);
    const fullPath = path.join(rootDir, modulePath);
    const router = (await import(fullPath)).default;
    app.use(routePath, router);
    console.log(`[gateway] ✅ ${description} mounted at ${routePath}`);
    return true;
  } catch (e) {
    console.error(`[gateway] ❌ ${description} failed:`, e?.message);
    return false;
  }
}

/**
 * Mount all API routes in correct order
 * CRITICAL: Specific routes must be mounted BEFORE SDK catch-all router
 * @param {Express} app - Express app
 * @param {http.Server} server - HTTP server (for WebSocket routes)
 */
export async function mountRoutes(app, server) {
  const results = {
    mounted: [],
    failed: []
  };

  // Define routes in mount order (specific routes first, catch-all last)
  const routes = [
    // Diagnostic routes
    { path: '/api/diagnostics', module: './server/routes/diagnostics.js', desc: 'Diagnostics' },
    { path: '/api/diagnostic', module: './server/routes/diagnostic-identity.js', desc: 'Diagnostic Identity' },

    // Core API routes
    { path: '/api/chat', module: './server/routes/chat.js', desc: 'AI Strategy Coach' },
    { path: '/api/tts', module: './server/routes/tts.js', desc: 'TTS endpoint' },
    { path: '/api/realtime', module: './server/routes/realtime.js', desc: 'OpenAI Realtime voice' },
    { path: '/api/venues', module: './server/routes/venue-intelligence.js', desc: 'Venue Intelligence' },
    { path: '/api/briefing', module: './server/routes/briefing.js', desc: 'Briefing' },
    { path: '/api/auth', module: './server/routes/auth.js', desc: 'Auth' },
    { path: '/api/location', module: './server/routes/location.js', desc: 'Location' },
    { path: '/api/blocks-fast', module: './server/routes/blocks-fast.js', desc: 'Blocks Fast' },
    { path: '/api/blocks', module: './server/routes/content-blocks.js', desc: 'Content Blocks' },

    // SSE/Events routes
    { path: '/events', module: './server/routes/events.js', desc: 'Events SSE' },
  ];

  // Mount each route
  for (const route of routes) {
    const success = await mountRoute(app, route.path, route.module, route.desc);
    if (success) {
      results.mounted.push(route.path);
    } else {
      results.failed.push(route.path);
    }
  }

  // Mount Agent (requires server for WebSocket)
  try {
    console.log('[gateway] Loading Agent embed...');
    const agentPath = path.join(rootDir, 'server/agent/embed.js');
    const { mountAgent } = await import(agentPath);
    mountAgent({
      app,
      basePath: process.env.AGENT_PREFIX || '/agent',
      wsPath: '/agent/ws',
      server,
    });
    console.log('[gateway] ✅ Agent mounted at /agent');
    results.mounted.push('/agent');
  } catch (e) {
    console.error('[gateway] ❌ Agent embed failed:', e?.message);
    results.failed.push('/agent');
  }

  // Mount SDK catch-all router LAST
  try {
    console.log('[gateway] Loading SDK embed (catch-all fallback)...');
    const sdkPath = path.join(rootDir, 'sdk-embed.js');
    const createSdkRouter = (await import(sdkPath)).default;
    const sdkRouter = createSdkRouter({});
    app.use(process.env.API_PREFIX || '/api', sdkRouter);
    console.log('[gateway] ✅ SDK routes mounted at /api (catch-all fallback)');
    results.mounted.push('/api (SDK)');
  } catch (e) {
    console.error('[gateway] ❌ SDK embed failed:', e?.message);
    results.failed.push('/api (SDK)');
  }

  return results;
}

/**
 * Mount SSE strategy events (only for non-autoscale mode)
 * @param {Express} app - Express app
 */
export async function mountSSE(app) {
  try {
    console.log('[gateway] Loading SSE strategy events...');
    const ssePath = path.join(rootDir, 'server/strategy-events.js');
    const strategyEvents = (await import(ssePath)).default;
    app.use('/', strategyEvents);
    console.log('[gateway] ✅ SSE strategy events endpoint mounted');
    return true;
  } catch (e) {
    console.error('[gateway] ❌ SSE events failed:', e?.message);
    return false;
  }
}

/**
 * Mount unified capabilities routes
 * @param {Express} app - Express app
 */
export async function mountUnifiedCapabilities(app) {
  try {
    const unifiedPath = path.join(rootDir, 'server/routes/unified-capabilities.js');
    const { default: unifiedCapabilitiesRoutes } = await import(unifiedPath);
    unifiedCapabilitiesRoutes(app);
    console.log('[gateway] ✅ Unified capabilities routes mounted');
    return true;
  } catch (e) {
    console.error('[gateway] ❌ Unified capabilities routes failed:', e?.message);
    return false;
  }
}
