// index.js — Health-first shim with lazy module loading
// CRITICAL: Minimal imports at top to ensure instant startup (<1 second)
console.log('[index] BOOT v2.0.0 @', new Date().toISOString(), 'cwd=', process.cwd());

import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI argument parser (supervisor-friendly)
function getCliArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

// Resolve port/host from CLI > env > defaults
function getPortConfig() {
  const cliPort = getCliArg('port');
  const mainPort = Number(cliPort || process.env.EIDOLON_PORT || process.env.PORT || 3101);
  const agentPort = Number(process.env.AGENT_PORT || process.env.DEFAULT_AGENT_PORT || 43717);
  if (mainPort === agentPort) {
    console.warn(
      `[index] Warning: main and agent ports are identical (${mainPort}). Using ${mainPort + 1} for agent.`,
    );
    return { mainPort, agentPort: mainPort + 1 };
  }
  return { mainPort, agentPort };
}

const { mainPort: PORT, agentPort: AGENT_PORT } = getPortConfig();
const HOST = getCliArg('host') || process.env.HOST || '0.0.0.0';

// Expose resolved values for downstream code
process.env.PORT = String(PORT);
process.env.EIDOLON_PORT = String(PORT);
process.env.HOST = HOST;

const BASE_DIR = process.env.BASE_DIR || "/home/runner/workspace";
const AGENT_BASE_URL = process.env.AGENT_BASE_URL || `http://127.0.0.1:${AGENT_PORT}`;
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const EIDOLON_VERSION = process.env.EIDOLON_VERSION || "2.0.0";

// Create Express app with minimal setup
const app = express();
app.set('trust proxy', 1);
process.noDeprecation = true;

// ───────────────────────────────────────────────────────────────────────────────
// CRITICAL: Fast-path health probes (BEFORE any middleware or heavy imports)
// Handle both GET and HEAD methods (many platform probes use HEAD)
// ───────────────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.status(200).send('OK'));
app.head('/', (_req, res) => res.status(200).end());
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.head('/health', (_req, res) => res.status(200).end());
app.get('/ready', (_req, res) => res.status(200).send('READY'));

// Probe logging middleware (logs both GET and HEAD)
app.use((req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (req.path === '/' || req.path === '/health' || req.path === '/ready' || req.path === '/healthz') {
      console.log(`[probe] ${req.method} ${req.path} @ ${new Date().toISOString()}`);
    }
  }
  next();
});

// Global state for shutdown coordination
let serverInstance = null;
let agentChild = null;
let isShuttingDown = false;

// ───────────────────────────────────────────────────────────────────────────────
// Start server IMMEDIATELY (before heavy imports)
// ───────────────────────────────────────────────────────────────────────────────
console.log('[index] Starting server (minimal mode)...');
serverInstance = app.listen(PORT, HOST, () => {
  console.log(`[index] listening on ${HOST}:${PORT}`);
  console.log(`🧠 Eidolon ${EIDOLON_VERSION}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[eidolon] Internal SDK Server (health shim mode)`);
  console.log(`[eidolon] Workspace: ${BASE_DIR}`);
  
  // Set tight timeouts to prevent probe hangs
  serverInstance.requestTimeout = 5000;   // 5s to receive full request
  serverInstance.headersTimeout = 6000;   // must exceed requestTimeout
  serverInstance.keepAliveTimeout = 5000; // avoid long-lived idle sockets
  
  console.log('[index] ✅ Health probes ready, loading full application...');
  
  // ───────────────────────────────────────────────────────────────────────────────
  // CRITICAL: Lazy-load ALL heavy modules AFTER server is listening
  // This ensures supervisor health checks pass in <1 second
  // ───────────────────────────────────────────────────────────────────────────────
  setImmediate(async () => {
    try {
      console.log('[index] Starting lazy module loading...');
      
      // Dynamic imports for all heavy dependencies
      const [
        { default: cors },
        { default: MCPDiagnostics },
        { default: WorkspaceRepairTools },
        { EIDOLON_CONFIG },
        { default: healthRoutes },
        { default: blocksRoutes },
        { default: blocksDiscoveryRoutes },
        { default: locationRoutes },
        { default: actionsRoutes },
        { default: researchRoutes },
        { default: feedbackRoutes },
        { default: diagnosticsRoutes },
        { default: venueEventsRoutes },
        { default: snapshotRoutes },
        { default: jobMetricsRoutes },
        { default: mlHealthRoutes },
        { default: chatRoutes },
        { loggingMiddleware },
        { securityMiddleware, apiLimiter, strictLimiter },
        { capsFromEnv },
        { bearer },
        { makeRemoteExecutor, mountAbilityRoutes },
        {
          getProjectContext,
          saveUserPreference,
          saveSessionState,
          saveProjectState,
          rememberConversation,
          getRecentConversations,
          getProjectSummary,
        },
        {
          getEnhancedProjectContext,
          storeCrossThreadMemory,
          storeAgentMemory,
          getCrossThreadMemory,
          getAgentMemory,
        },
        {
          getThreadManager,
          getThreadAwareContext,
        },
      ] = await Promise.all([
        import('cors'),
        import('./server/eidolon/tools/mcp-diagnostics.js'),
        import('./tools/debug/vecto-repair-tools.js'),
        import('./agent-ai-config.js'),
        import('./server/routes/health.js'),
        import('./server/routes/blocks.js'),
        import('./server/routes/blocks-discovery.js'),
        import('./server/routes/location.js'),
        import('./server/routes/actions.js'),
        import('./server/routes/research.js'),
        import('./server/routes/feedback.js'),
        import('./server/routes/diagnostics.js'),
        import('./server/routes/venue-events.js'),
        import('./server/routes/snapshot.js'),
        import('./server/routes/job-metrics.js'),
        import('./server/routes/ml-health.js'),
        import('./server/routes/chat.js'),
        import('./server/middleware/logging.js'),
        import('./server/middleware/security.js'),
        import('./server/lib/capabilities.js'),
        import('./server/lib/auth.js'),
        import('./server/lib/ability-routes.js'),
        import('./server/agent/context-awareness.js'),
        import('./server/agent/enhanced-context.js'),
        import('./server/agent/thread-context.js'),
      ]);
      
      console.log('[index] AI Config:', EIDOLON_CONFIG);
      console.log('[index] Modules loaded, mounting middleware and routes...');
      
      // ───────────────────────────────────────────────────────────────────────────────
      // Mount middleware (after health probes to preserve fast-path)
      // ───────────────────────────────────────────────────────────────────────────────
      app.use(cors());
      app.use(loggingMiddleware);
      app.use(securityMiddleware);
      
      // Enhanced memory: Thread manager and context tracking
      const threadManager = getThreadManager();
      
      app.use(async (req, res, next) => {
        try {
          const ctx = await getEnhancedProjectContext({
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            includeThreadContext: true
          });
          
          await storeCrossThreadMemory('recentPaths', { 
            path: req.originalUrl, 
            method: req.method,
            t: Date.now(),
            ip: req.ip
          }, null, 7);
          
          req.enhancedContext = ctx;
          next();
        } catch (e) {
          console.error('[context] error:', e);
          next();
        }
      });
      
      // ───────────────────────────────────────────────────────────────────────────────
      // Mount API routes
      // ───────────────────────────────────────────────────────────────────────────────
      app.use('/api/health', healthRoutes);
      app.use('/api/blocks', blocksRoutes);
      app.use('/api/blocks-discovery', blocksDiscoveryRoutes);
      app.use('/api/location', locationRoutes);
      app.use('/api/actions', actionsRoutes);
      app.use('/api/research', researchRoutes);
      app.use('/api/feedback', feedbackRoutes);
      app.use('/api/diagnostics', diagnosticsRoutes);
      app.use('/api/venue-events', venueEventsRoutes);
      app.use('/api/snapshot', snapshotRoutes);
      app.use('/api/job-metrics', jobMetricsRoutes);
      app.use('/api/ml-health', mlHealthRoutes);
      app.use('/api/chat', chatRoutes);
      
      // Quick status endpoint
      app.get("/api/copilot", (_req, res) => {
        res.json({
          ok: true,
          status: "active",
          copilot: "Eidolon Enhanced SDK",
          capabilities: [
            "smart_recommendations",
            "location_aware_routing",
            "earnings_optimization",
            "real_time_analytics",
          ],
          timestamp: new Date().toISOString(),
        });
      });
      
      // 404 handler
      app.use((req, res) => {
        console.warn('[SDK 404]', req.method, req.originalUrl);
        res.status(404).json({ error: 'not found' });
      });
      
      console.log('[index] ✅ Routes mounted');
      
      // ───────────────────────────────────────────────────────────────────────────────
      // Agent and workspace analysis (heavy operations)
      // ───────────────────────────────────────────────────────────────────────────────
      const isGatewayChild = process.env.EIDOLON_PORT !== undefined || process.ppid !== 1;
      const skipAgent = process.env.SKIP_AGENT === "true" || 
                       process.env.NODE_ENV === "production" || 
                       isGatewayChild;
      
      if (!skipAgent) {
        try {
          const { ensureAgentUp } = await import('./server/eidolon/agent.js');
          await ensureAgentUp();
          console.log("[eidolon] agent healthy");
        } catch (e) {
          console.log("[eidolon] agent unavailable (optional):", e?.message || e);
        }
      } else {
        console.log("[eidolon] agent spawn skipped (gateway manages it)");
      }
      
      // Workspace analysis is optional and handled by gateway
      console.log("[eidolon] ✅ Ready for gateway proxy connections");
      
      if (process.env.REPL_ID) {
        console.log(
          `[eidolon] Gateway Preview: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`,
        );
      }
      
      console.log('[index] ✅ Full application loaded and ready');
      
    } catch (err) {
      console.error('[index] Failed to load full application:', err);
      console.error('[index] Health probes still active, but routes unavailable');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Error handling
// ───────────────────────────────────────────────────────────────────────────────
serverInstance.on("error", (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[index] ERROR: Port ${PORT} is already in use!`);
    console.error(`[index] Another process is using port ${PORT}. Exiting to prevent loop...`);
    process.exit(1);
  } else {
    console.error("[index] Server error:", err.message);
  }
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`[index] ${signal} received, shutting down gracefully...`);
  isShuttingDown = true;
  if (serverInstance) {
    serverInstance.close(() => {
      if (agentChild && !agentChild.killed) {
        try {
          agentChild.kill("SIGTERM");
        } catch {}
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

["SIGTERM", "SIGINT", "SIGQUIT"].forEach((sig) => {
  process.on(sig, () => gracefulShutdown(sig));
});

process.on("uncaughtException", (err) => {
  console.error("[index] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[index] Unhandled rejection:", reason);
});
