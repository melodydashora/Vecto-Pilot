// gateway-server.js - Main application entry point
// Refactored: Bootstrap modules handle routes, middleware, workers, health
import http from 'node:http';
import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// 2026-04-27: Install console-tee FIRST so every subsequent log line is
// mirrored to logs/server-current.log for the mobile log-viewer endpoint.
// Must run before any other server output to capture the full session.
import { installFileTee } from './server/logger/file-tee.js';
installFileTee();

import { loadEnvironment } from './server/config/load-env.js';
import { validateOrExit } from './server/config/validate-env.js';
import { unifiedAI, UNIFIED_CAPABILITIES } from './server/lib/ai/unified-ai-capabilities.js';

// 2026-02-19: Suppress pg-connection-string SSL mode deprecation warning.
// 2026-02-26: SSL is now conditional (off for Helium dev, on for production).
// The warning about future pg v9.0 behavior only matters for production SSL connections.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function(warning, ...args) {
  if (typeof warning === 'string' && warning.includes("SSL modes 'prefer', 'require', and 'verify-ca'")) {
    return; // Suppress this specific informational warning
  }
  return originalEmitWarning.call(this, warning, ...args);
};

// Load and validate environment
loadEnvironment();
validateOrExit();

// Configuration
const MODE = (process.env.APP_MODE || 'mono').toLowerCase();
const PORT = Number(process.env.PORT || 5000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'client', 'dist');

// Deployment detection
const isDeployment = process.env.REPLIT_DEPLOYMENT === '1' || process.env.REPLIT_DEPLOYMENT === 'true';

// 2026-02-25: Autoscale detection — checks EITHER flag independently (Phase 6 Refactor)
// If either flag is set, the intent is clear: this is an autoscale environment.
// Workers, SSE, and snapshot observer are forcibly disabled to prevent duplication.
const isAutoscaleMode = process.env.CLOUD_RUN_AUTOSCALE === '1' || process.env.REPLIT_AUTOSCALE === '1';

// Safety guardrail: loud warning when autoscale is active
if (isAutoscaleMode) {
  console.warn('[GATEWAY] ═══════════════════════════════════════════════════════════════');
  console.warn('[GATEWAY]  AUTOSCALE MODE ACTIVE');
  console.warn('[GATEWAY]    Background workers: DISABLED (must deploy as separate services)');
  console.warn('[GATEWAY]    SSE: DISABLED | Snapshot observer: DISABLED');
  console.warn('[GATEWAY] ═══════════════════════════════════════════════════════════════');
}

// Exported app reference for tests/importers (live binding)
export let app = null;

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[GATEWAY] Uncaught exception:', err);
  if (process.env.NODE_ENV !== 'production') process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[GATEWAY] Unhandled rejection at:', promise, 'reason:', reason);
});

// Main bootstrap
(async function main() {
  try {
    const startTime = Date.now();
    console.log(`[GATEWAY] Starting bootstrap (PID: ${process.pid})`);
    console.log(`[GATEWAY] Mode: ${MODE.toUpperCase()}, Port: ${PORT}`);
    console.log(`[GATEWAY] Deployment: ${isDeployment}, Autoscale: ${isAutoscaleMode}`);

    // Create Express app
    app = express();
    // 2026-04-25 (helmet-hardening): kill the X-Powered-By: Express leak at the
    // Express level. helmet().hidePoweredBy strips the header after the fact;
    // app.disable() prevents it from ever being emitted, race-free.
    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    // Import bootstrap modules
    const { configureHealthEndpoints, mountHealthRouter } = await import('./server/bootstrap/health.js');
    const { configureMiddleware, configureErrorHandler } = await import('./server/bootstrap/middleware.js');
    const { mountRoutes, mountSSE, mountUnifiedCapabilities } = await import('./server/bootstrap/routes.js');
    // 2026-02-17: Removed startEventSyncJob — events sync per-snapshot via briefing pipeline
    const { startStrategyWorker, shouldStartWorker, killAllChildren } = await import('./server/bootstrap/workers.js');

    // 2026-04-25: SECURITY (P0-1) — Middleware (helmet/cors/body) MUST be mounted
    // FIRST so every response (including health and static) carries CSP / HSTS /
    // X-Content-Type-Options. Previously these were applied after health + static,
    // leaving the SPA bundle and probe endpoints unprotected.
    await configureMiddleware(app);

    // Health endpoints (now wrapped by helmet/cors)
    configureHealthEndpoints(app, distDir, MODE);
    await mountHealthRouter(app);

    // Start HTTP server immediately
    const server = http.createServer(app);
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.requestTimeout = 5000;

    server.on('error', (err) => {
      console.error('[GATEWAY] Server error:', err);
      process.exit(1);
    });

    // Export for testing
    globalThis.testApp = app;

    // 2026-03-17: SECURITY FIX (F-4) — Mount ALL middleware and routes BEFORE listening.
    // Previously, setImmediate() deferred middleware/routes after server.listen(), creating
    // a window where requests arrived with no CORS, Helmet, auth, or route handlers.
    console.log('[GATEWAY] Loading modules and mounting routes...');

    // Static assets
    app.use(express.static(distDir));

    // 2026-04-25: SECURITY (P0-2) — `/api/diagnostic/db-info` removed. It leaked
    // database_host (masked but resolvable) plus environment-detection metadata
    // (REPLIT_DEPLOYMENT, NODE_ENV, mode). Use authenticated diagnostics under
    // /api/diagnostics/* instead.

    // SSE (not in autoscale mode)
    if (!isAutoscaleMode) {
      await mountSSE(app);
    } else {
      console.log('[GATEWAY] ⏩ SSE disabled (autoscale mode)');
    }

    // Mount all routes (mono mode)
    if (MODE === 'mono') {
      await mountRoutes(app, server);
    }

    // Error handler (after all routes)
    await configureErrorHandler(app);

    // Unified capabilities
    await mountUnifiedCapabilities(app);

    // Unified capabilities API endpoint
    app.get('/api/unified/capabilities', (_req, res) => {
      res.json({
        ok: true,
        system: 'Unified AI (Eidolon/Assistant/Atlas)',
        model: UNIFIED_CAPABILITIES.model,
        context_window: UNIFIED_CAPABILITIES.context_window,
        thinking_mode: UNIFIED_CAPABILITIES.thinking_mode,
        capabilities: unifiedAI.getCapabilities()
      });
    });

    // SPA catch-all (must be LAST)
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/agent/')) {
        return next();
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });

    console.log('[GATEWAY] All routes and middleware loaded');

    // 2026-03-17: server.listen() AFTER all middleware and routes are mounted.
    // Previously called before setImmediate(), creating a security bypass window.
    const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
    if (entryUrl && import.meta.url === entryUrl) {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`[GATEWAY] HTTP listening on 0.0.0.0:${PORT}`);
        console.log(`[GATEWAY] Bootstrap completed in ${Date.now() - startTime}ms`);
        startUnifiedAIMonitoring();
      });
    }

    // Background tasks (non-blocking, safe to start after listen)
    const workerConfig = shouldStartWorker({ isAutoscaleMode });
    if (workerConfig.shouldStart) {
      console.log(`[GATEWAY] ${workerConfig.reason}`);
      startStrategyWorker({ useLogFile: workerConfig.useLogFile });
    } else {
      console.log(`[GATEWAY] ⏸️ Worker not started: ${workerConfig.reason}`);
    }

    // 2026-02-17: Event sync removed from server start — events sync per-snapshot via briefing pipeline

    // 2026-02-17: Snapshot workflow observer — captures full pipeline timing to snapshot.txt
    if (!isAutoscaleMode) {
      import('./scripts/test-snapshot-workflow.js')
        .then(({ observeSnapshotWorkflow }) => {
          observeSnapshotWorkflow().catch(err =>
            console.warn(`[GATEWAY] snapshot-observer error: ${err.message}`)
          );
        })
        .catch(err => console.warn(`[GATEWAY] snapshot-observer load failed: ${err.message}`));
    }

    // Graceful shutdown
    const shutdown = (signal) => {
      console.log(`[signal] ${signal} received, shutting down...`);
      killAllChildren(signal);
      server.close(() => process.exit(0));
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('[GATEWAY] Fatal startup error:', err);
    process.exit(1);
  }
})();

/**
 * Start unified AI health monitoring
 */
function startUnifiedAIMonitoring() {
  console.log('[Unified AI] Starting health monitoring...');

  // Check every 30 seconds
  setInterval(async () => {
    try {
      await unifiedAI.checkHealth();
    } catch (err) {
      console.error('[Unified AI] Health check failed:', err.message);
    }
  }, 30000);

  // Initial health check
  unifiedAI.checkHealth().then(health => {
    console.log(`[Unified AI] Initial health: ${health.healthy ? 'Healthy' : 'Issues detected'}`);
    if (!health.healthy) {
      console.log('[Unified AI] Issues:', health.issues);
    }
  });
}

export { app as default };
