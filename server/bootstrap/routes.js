// server/bootstrap/routes.js
// Centralized route mounting for gateway-server.js

import { fileURLToPath, pathToFileURL } from 'url';
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
    const router = (await import(pathToFileURL(fullPath).href)).default;
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
  // Routes organized by domain in server/api/
  const routes = [
    // Health & Diagnostics (server/api/health/)
    { path: '/api/diagnostics', module: './server/api/health/diagnostics.js', desc: 'Diagnostics' },
    { path: '/api/diagnostic', module: './server/api/health/diagnostic-identity.js', desc: 'Diagnostic Identity' },
    { path: '/api/health', module: './server/api/health/health.js', desc: 'Health Check' },
    { path: '/api/ml-health', module: './server/api/health/ml-health.js', desc: 'ML Health' },
    { path: '/api/job-metrics', module: './server/api/health/job-metrics.js', desc: 'Job Metrics' },

    // Chat & Voice (server/api/chat/)
    { path: '/api/chat', module: './server/api/chat/chat.js', desc: 'AI Strategy Coach' },
    { path: '/api/tts', module: './server/api/chat/tts.js', desc: 'TTS endpoint' },
    { path: '/api/realtime', module: './server/api/chat/realtime.js', desc: 'OpenAI Realtime voice' },

    // Coach API (server/api/coach/) - Schema awareness, validation, notes CRUD
    // 2026-01-05: Added for AI Coach enhancements
    { path: '/api/coach', module: './server/api/coach/index.js', desc: 'Coach API (schema, validate, notes)' },

    // Venue Intelligence (server/api/venue/)
    { path: '/api/venues', module: './server/api/venue/venue-intelligence.js', desc: 'Venue Intelligence' },

    // Briefing (server/api/briefing/)
    { path: '/api/briefing', module: './server/api/briefing/briefing.js', desc: 'Briefing' },

    // Auth (server/api/auth/)
    { path: '/api/auth', module: './server/api/auth/auth.js', desc: 'Auth' },
    // 2026-02-03: Uber OAuth
    { path: '/api/auth/uber', module: './server/api/auth/uber.js', desc: 'Uber OAuth' },

    // Location (server/api/location/)
    { path: '/api/location', module: './server/api/location/location.js', desc: 'Location' },
    { path: '/api/snapshot', module: './server/api/location/snapshot.js', desc: 'Snapshot' },

    // Strategy (server/api/strategy/)
    { path: '/api/blocks-fast', module: './server/api/strategy/blocks-fast.js', desc: 'Blocks Fast' },
    { path: '/api/blocks', module: './server/api/strategy/content-blocks.js', desc: 'Content Blocks' },
    { path: '/api/strategy', module: './server/api/strategy/strategy.js', desc: 'Strategy' },
    { path: '/api/strategy/tactical-plan', module: './server/api/strategy/tactical-plan.js', desc: 'Tactical Plan' },

    // Feedback (server/api/feedback/)
    { path: '/api/feedback', module: './server/api/feedback/feedback.js', desc: 'Feedback' },
    { path: '/api/actions', module: './server/api/feedback/actions.js', desc: 'Actions' },

    // Research (server/api/research/)
    { path: '/api/research', module: './server/api/research/research.js', desc: 'Research' },
    { path: '/api/vector-search', module: './server/api/research/vector-search.js', desc: 'Vector Search' },

    // Platform Data (server/api/platform/)
    { path: '/api/platform', module: './server/api/platform/index.js', desc: 'Platform Data' },

    // Market Intelligence (server/api/intelligence/)
    { path: '/api/intelligence', module: './server/api/intelligence/index.js', desc: 'Market Intelligence' },

    // Vehicle Data (server/api/vehicle/)
    { path: '/api/vehicle', module: './server/api/vehicle/vehicle.js', desc: 'Vehicle Data' },

    // Concierge (server/api/concierge/) - 2026-02-13: QR code sharing + public event discovery
    { path: '/api/concierge', module: './server/api/concierge/concierge.js', desc: 'Concierge' },

    // External Hooks (server/api/hooks/)
    { path: '/api/hooks', module: './server/api/hooks/analyze-offer.js', desc: 'External Hooks (OCR/Signals)' },

    // 2026-01-09: Removed EventEmitter SSE - DB NOTIFY SSE is canonical (mountSSE)
    // The /events mount was duplicating /events/strategy, /events/blocks with EventEmitter
    // while mountSSE() mounts DB-backed versions at same paths. See LESSONS_LEARNED.md.
    // Phase updates (/events/phase) moved to strategy-events.js
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
    const { mountAgent } = await import(pathToFileURL(agentPath).href);
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
    const createSdkRouter = (await import(pathToFileURL(sdkPath).href)).default;
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
    const ssePath = path.join(rootDir, 'server/api/strategy/strategy-events.js');
    const strategyEvents = (await import(pathToFileURL(ssePath).href)).default;
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
    const unifiedPath = path.join(rootDir, 'server/api/health/unified-capabilities.js');
    const { default: unifiedCapabilitiesRoutes } = await import(pathToFileURL(unifiedPath).href);
    unifiedCapabilitiesRoutes(app);
    console.log('[gateway] ✅ Unified capabilities routes mounted');
    return true;
  } catch (e) {
    console.error('[gateway] ❌ Unified capabilities routes failed:', e?.message);
    return false;
  }
}
