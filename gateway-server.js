// gateway-server.js - Main application entry point
// Refactored: Bootstrap modules handle routes, middleware, workers, health
import http from 'node:http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadEnvironment } from './server/config/load-env.js';
import { validateOrExit } from './server/config/validate-env.js';
import { unifiedAI, UNIFIED_CAPABILITIES } from './server/lib/ai/unified-ai-capabilities.js';

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
const isAutoscaleMode = isDeployment && process.env.CLOUD_RUN_AUTOSCALE === '1';

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[gateway] ❌ Uncaught exception:', err);
  if (process.env.NODE_ENV !== 'production') process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[gateway] ❌ Unhandled rejection at:', promise, 'reason:', reason);
});

// Main bootstrap
(async function main() {
  try {
    const startTime = Date.now();
    console.log(`[gateway] Starting bootstrap (PID: ${process.pid})`);
    console.log(`[gateway] Mode: ${MODE.toUpperCase()}, Port: ${PORT}`);
    console.log(`[gateway] Deployment: ${isDeployment}, Autoscale: ${isAutoscaleMode}`);

    // Create Express app
    const app = express();
    app.set('trust proxy', 1);

    // Import bootstrap modules
    const { configureHealthEndpoints, mountHealthRouter } = await import('./server/bootstrap/health.js');
    const { configureMiddleware, configureErrorHandler } = await import('./server/bootstrap/middleware.js');
    const { mountRoutes, mountSSE, mountUnifiedCapabilities } = await import('./server/bootstrap/routes.js');
    const { startStrategyWorker, shouldStartWorker, killAllChildren, startEventSyncJob } = await import('./server/bootstrap/workers.js');

    // Health endpoints FIRST (before any heavy imports)
    configureHealthEndpoints(app, distDir, MODE);
    await mountHealthRouter(app);

    // Start HTTP server immediately
    const server = http.createServer(app);
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.requestTimeout = 5000;

    server.on('error', (err) => {
      console.error('[gateway] ❌ Server error:', err);
      process.exit(1);
    });

    // Listen
    if (import.meta.url === `file://${process.argv[1]}`) {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 [gateway] HTTP listening on 0.0.0.0:${PORT}`);
        console.log(`[gateway] Bootstrap completed in ${Date.now() - startTime}ms`);

        // Start unified AI health monitoring
        startUnifiedAIMonitoring();
      });
    }

    // Export for testing
    globalThis.testApp = app;

    // Load heavy modules after server is listening
    setImmediate(async () => {
      console.log('[gateway] Loading modules and mounting routes...');

      // Load AI config
      const { GATEWAY_CONFIG } = await import('./agent-ai-config.js');
      console.log('[gateway] AI Config loaded');

      // Static assets
      app.use(express.static(distDir));

      // Middleware
      await configureMiddleware(app);

      // Diagnostic endpoint
      app.get('/api/diagnostic/db-info', (_req, res) => {
        const dbUrl = process.env.DATABASE_URL;
        const maskedUrl = dbUrl ? dbUrl.replace(/:[^:@]*@/, ':***@').split('@')[1] : 'NOT_SET';
        res.json({
          environment_detection: {
            REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT || 'not set',
            NODE_ENV: process.env.NODE_ENV || 'not set',
            mode: MODE,
          },
          database_target: 'REPLIT_POSTGRES',
          database_host: maskedUrl,
          has_database_url: !!process.env.DATABASE_URL,
          timestamp: new Date().toISOString(),
        });
      });

      // SSE (not in autoscale mode)
      if (!isAutoscaleMode) {
        await mountSSE(app);
      } else {
        console.log('[gateway] ⏩ SSE disabled (autoscale mode)');
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

      // Start background worker if needed
      const workerConfig = shouldStartWorker({ mode: MODE, isAutoscaleMode });
      if (workerConfig.shouldStart) {
        console.log(`[gateway] ${workerConfig.reason}`);
        startStrategyWorker({ useLogFile: workerConfig.useLogFile });
      } else {
        console.log(`[gateway] ⏸️ Worker not started: ${workerConfig.reason}`);
      }

      // Start daily event sync job (runs at 6 AM daily)
      if (!isAutoscaleMode) {
        startEventSyncJob();
      }

      // Start change analyzer job (runs on startup, flags doc updates needed)
      if (!isAutoscaleMode) {
        const { startChangeAnalyzerJob } = await import('./server/jobs/change-analyzer-job.js');
        startChangeAnalyzerJob();
      }

      console.log('[gateway] ✅ All routes and middleware loaded');
    });

    // Graceful shutdown
    const shutdown = (signal) => {
      console.log(`[signal] ${signal} received, shutting down...`);
      killAllChildren(signal);
      server.close(() => process.exit(0));
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('[gateway] ❌ Fatal startup error:', err);
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
      console.error('❌ [Unified AI] Health check failed:', err.message);
    }
  }, 30000);

  // Initial health check
  unifiedAI.checkHealth().then(health => {
    console.log(`[Unified AI] Initial health: ${health.healthy ? '✅ Healthy' : '⚠️ Issues detected'}`);
    if (!health.healthy) {
      console.log('[Unified AI] Issues:', health.issues);
    }
  });
}

export default globalThis.testApp;
