// gateway-server.js - MONO + SPLIT capable
import http from "node:http";
import { spawn } from "node:child_process";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import httpProxy from "http-proxy";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const { createProxyServer } = httpProxy;
// Lazy-load triad-worker to avoid DB pool creation before server is ready

// Mode detection
const MODE = (process.env.APP_MODE || "mono").toLowerCase();
const env = (process.env.NODE_ENV || "").toLowerCase();
const isDev =
  env === "development" ||
  (env === "" && process.env.REPLIT_DEV === "1") ||
  process.env.FORCE_DEV === "1";

const DISABLE_SPAWN_SDK = process.env.DISABLE_SPAWN_SDK === "1";
const DISABLE_SPAWN_AGENT = process.env.DISABLE_SPAWN_AGENT === "1";

const PORT = Number(process.env.PORT || 5000);
const AGENT_PORT = Number(process.env.AGENT_PORT || 43717);
const SDK_PORT = Number(process.env.EIDOLON_PORT || process.env.SDK_PORT || 3102);

const children = new Map();
function spawnChild(name, command, args, env) {
  console.log(`🐕 [gateway] Starting ${name}...`);
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => console.log(`[${name}] ${data.toString().trim()}`));
  child.stderr.on("data", (data) => console.error(`[${name}] ${data.toString().trim()}`));
  child.on("exit", (code) => {
    console.error(`❌ [gateway] ${name} exited with code ${code}, restarting...`);
    children.delete(name);
    setTimeout(() => spawnChild(name, command, args, env), 2000);
  });
  children.set(name, child);
  return child;
}

// Main bootstrap
(async function main() {
  try {
    console.log(`[gateway] Starting bootstrap (PID: ${process.pid})`);
    console.log(`[gateway] 🔍 Environment detection:`);
    console.log(`[gateway]   REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}`);
    console.log(`[gateway]   REPL_DEPLOYMENT=${process.env.REPL_DEPLOYMENT}`);
    console.log(`[gateway]   HOSTNAME=${process.env.HOSTNAME}`);
    console.log(`[gateway]   PORT=${PORT}`);
    console.log(`[gateway]   NODE_ENV=${process.env.NODE_ENV}`);
    
    const app = express();
    app.set("trust proxy", 1);

    // Detect Replit autoscale deployment environment
    // CRITICAL: Only match actual deployments, not dev containers!
    // Allow override via CLOUD_RUN_AUTOSCALE environment variable
    const isDeployment = 
      process.env.REPLIT_DEPLOYMENT === "1" || 
      process.env.REPLIT_DEPLOYMENT === "true";
    
    const isAutoscale = 
      isDeployment && 
      process.env.CLOUD_RUN_AUTOSCALE !== "0"; // Allow disabling autoscale mode
    
    console.log(`[gateway] 🎯 isDeployment: ${isDeployment}`);
    console.log(`[gateway] 🎯 isAutoscale: ${isAutoscale}`);
    console.log(`[gateway] 🎯 CLOUD_RUN_AUTOSCALE: ${process.env.CLOUD_RUN_AUTOSCALE}`);
    
    // AUTOSCALE MODE: Raw HTTP server, skip Express entirely
    if (isAutoscale) {
      console.log("[gateway] ⚡ AUTOSCALE MODE - raw HTTP health-only server");
      console.log("[gateway] ⏱️ Start time:", new Date().toISOString());
      console.log("[gateway] 🚀 Skipping Express - using raw http.createServer");
      
      // Raw Node.js HTTP server - zero middleware overhead
      const server = http.createServer((req, res) => {
        console.log(`[health] 📥 ${req.method} ${req.url}`);
        
        // Respond to ALL requests with 200 OK
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Connection': 'close'
        });
        res.end('OK'); // Send and close in one call
      });
      
      // Request timeout to prevent hanging
      server.timeout = 5000; // 5 second timeout
      
      // Keep-alive settings for Cloud Run
      server.keepAliveTimeout = 5000;
      server.headersTimeout = 6000;
      
      // Error handling
      server.on('error', (err) => {
        console.error(`[gateway] ❌ FATAL: Server error:`, err);
        console.error(`[gateway] Error code: ${err.code}`);
      });
      
      // Success callback
      server.on('listening', () => {
        const addr = server.address();
        console.log(`[ready] ✅ LISTENING on ${addr.address}:${addr.port}`);
        console.log(`[ready] ⏱️ Ready time: ${new Date().toISOString()}`);
        console.log(`[ready] 🚀 READY FOR HEALTH CHECKS`);
      });
      
      // Graceful shutdown for Cloud Run
      process.on('SIGTERM', () => {
        console.log('[gateway] 🛑 SIGTERM received, closing server...');
        server.close(() => {
          console.log('[gateway] ✅ Server closed');
          process.exit(0);
        });
      });
      
      // Bind synchronously - no await, no delays
      console.log(`[gateway] 📡 Binding to 0.0.0.0:${PORT}...`);
      server.listen(PORT, '0.0.0.0');
      
      // Exit - don't load anything else in autoscale
      return;
    }

    // REGULAR MODE: Full application
    console.log(`[gateway] PID: ${process.pid}`);
    console.log(`[gateway] Mode: ${MODE.toUpperCase()}`);
    
    // Load AI config only in regular mode (not in autoscale)
    const { GATEWAY_CONFIG } = await import("./agent-ai-config.js");
    console.log("[gateway] AI Config:", GATEWAY_CONFIG);
    
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distDir = path.join(__dirname, "client", "dist");

    // Health endpoints (NOT on root path - that's for the SPA)
    app.get("/health", (_req, res) => res.status(200).send("OK"));
    app.head("/health", (_req, res) => res.status(200).end());
    app.get('/ready', (_req, res) => res.status(200).send('READY'));
    app.get("/healthz", (_req, res) => {
      const indexPath = path.join(distDir, "index.html");
      if (fs.existsSync(indexPath)) {
        return res.json({ ok: true, spa: "ready", mode: isDev ? "dev" : "prod", ts: Date.now() });
      }
      return res.status(503).json({ ok: false, spa: "missing", mode: isDev ? "dev" : "prod", ts: Date.now() });
    });

    // Probe logging
    app.use((req, _res, next) => {
      if (req.path === '/health' || req.path === '/healthz' || req.path === '/ready') {
        console.log(`[probe] ${req.method} ${req.path} @ ${new Date().toISOString()}`);
      }
      next();
    });

    // Serve SPA static assets
    app.use(express.static(distDir));

    // Start HTTP server (wrap Express with http.createServer for timeout control)
    const server = http.createServer(app);
    
    // Set strict server timeouts (prevent probe hangs)
    server.requestTimeout = 5000;    // 5s max to receive full request
    server.headersTimeout = 6000;    // 6s max for headers (must exceed requestTimeout)
    server.keepAliveTimeout = 5000;  // 5s keep-alive to avoid long-lived idle sockets
    
    server.on('error', (err) => {
      console.error('[gateway] ❌ Server error:', err);
      process.exit(1);
    });
    
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[ready] Server listening on 0.0.0.0:${PORT}`);
    });

  // NOTE: In mono mode, consolidation listener runs in separate strategy-generator.js process
  // Gateway should NOT start an inline listener to avoid conflicts with separate worker
  const isCloudRun = process.env.REPLIT_DEPLOYMENT === "1";
  
  if (isCloudRun) {
    console.log("[gateway] ⏩ Background worker disabled (Cloud Run/Autoscale detected)");
  } else {
    console.log("[gateway] ⏩ Consolidation listener runs in separate worker process");
  }

  // Mount middleware and routes after server is listening
  setImmediate(async () => {
    console.log("[gateway] Starting middleware and route mounting...");
    
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: true, credentials: true }));
    app.use("/api", express.json({ limit: "1mb" }));
    app.use("/agent", express.json({ limit: "1mb" }));
    console.log("[gateway] ✅ Middleware configured");

    // Mount SSE strategy events endpoint (before SDK/Agent routes)
    // Don't mount at "/" in autoscale to avoid overriding health check
    if (!isCloudRun) {
      try {
        console.log("[gateway] Loading SSE strategy events...");
        const strategyEvents = (await import("./server/strategy-events.js")).default;
        app.use("/", strategyEvents);
        console.log("[gateway] ✅ SSE strategy events endpoint mounted");
      } catch (e) {
        console.error("[gateway] ❌ SSE events failed:", e?.message);
      }
    }

    if (MODE === "mono") {
      try {
        console.log("[gateway] Loading SDK embed...");
        const createSdkRouter = (await import("./sdk-embed.js")).default;
        const sdkRouter = createSdkRouter({});
        app.use(process.env.API_PREFIX || "/api", sdkRouter);
        console.log("[gateway] ✅ SDK routes mounted at /api");
      } catch (e) {
        console.error("[mono] SDK embed failed:", e?.message, e?.stack);
      }
      try {
        console.log("[gateway] Loading Agent embed...");
        const { mountAgent } = await import("./server/agent/embed.js");
        mountAgent({ app, basePath: process.env.AGENT_PREFIX || "/agent", wsPath: "/agent/ws", server });
        console.log("[gateway] ✅ Agent mounted at /agent");
      } catch (e) {
        console.error("[mono] Agent embed failed:", e?.message, e?.stack);
      }
    }

    // Serve SPA for all other routes (catch-all must be LAST, excludes /api and /agent)
    app.get("*", (req, res, next) => {
      // Don't intercept API or agent routes
      if (req.path.startsWith('/api/') || req.path.startsWith('/agent/')) {
        return next();
      }
      res.sendFile(path.join(distDir, "index.html"));
    });
  });

    // Graceful shutdown
    process.on("SIGINT", () => {
      console.log("[signal] SIGINT received, shutting down...");
      children.forEach((c) => c.kill("SIGINT"));
      server.close(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      console.log("[signal] SIGTERM received, shutting down...");
      children.forEach((c) => c.kill("SIGTERM"));
      server.close(() => process.exit(0));
    });
  } catch (err) {
    console.error('[gateway] ❌ Fatal startup error:', err);
    process.exit(1);
  }
})();
