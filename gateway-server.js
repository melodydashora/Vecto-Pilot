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

// Global error handlers - prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[gateway] ❌ Uncaught exception:', err);
  // Don't exit in production - log and continue
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[gateway] ❌ Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit in production - log and continue
});

// Main bootstrap
(async function main() {
  try {
    const startTime = Date.now();
    console.log(`[gateway] Starting bootstrap (PID: ${process.pid})`);
    console.log(`[gateway] 🔍 Environment detection:`);
    console.log(`[gateway]   REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}`);
    console.log(`[gateway]   REPL_DEPLOYMENT=${process.env.REPL_DEPLOYMENT}`);
    console.log(`[gateway]   HOSTNAME=${process.env.HOSTNAME}`);
    console.log(`[gateway]   PORT=${PORT}`);
    console.log(`[gateway]   NODE_ENV=${process.env.NODE_ENV}`);
    
    const app = express();
    app.set("trust proxy", 1);
    console.log(`[gateway] Express loaded in ${Date.now() - startTime}ms`);

    // Autoscale is opt-in only
    const isAutoscale =
      (process.env.REPLIT_DEPLOYMENT === "1" || process.env.REPLIT_DEPLOYMENT === "true") &&
      process.env.CLOUD_RUN_AUTOSCALE === "1";
    
    const isDeployment = process.env.REPLIT_DEPLOYMENT === "1" || process.env.REPLIT_DEPLOYMENT === "true";
    
    console.log(`[gateway] 🎯 isDeployment: ${isDeployment}`);
    console.log(`[gateway] 🎯 isAutoscale: ${isAutoscale}`);
    console.log(`[gateway] 🎯 CLOUD_RUN_AUTOSCALE: ${process.env.CLOUD_RUN_AUTOSCALE}`);
    
    // AUTOSCALE MODE: Simplified for Cloud Run
    // Disables background workers, uses polling instead of LISTEN/NOTIFY
    if (isAutoscale) {
      console.log(`[gateway] 🎯 Autoscale mode - stateless configuration`);
      console.log(`[gateway] ⚠️  Background workers disabled`);
      console.log(`[gateway] ⚠️  LISTEN/NOTIFY disabled (use polling)`);
      
      // Minimal health endpoints
      app.get('/', (_req, res) => res.status(200).send('OK'));
      app.head('/', (_req, res) => res.status(200).end());
      app.get('/health', (_req, res) => res.status(200).send('OK'));
      app.get('/ready', (_req, res) => res.status(200).send('OK'));
      
      const server = http.createServer(app);
      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;

      server.on('error', (err) => {
        console.error(`[gateway] ❌ FATAL:`, err.code, err.message);
        process.exit(1);
      });

      process.on('SIGTERM', () => {
        console.log('[gateway] 🛑 SIGTERM received');
        server.close(() => process.exit(0));
      });

      server.listen(PORT, '0.0.0.0', () => {
        console.log(`[ready] ✅ Autoscale ready on 0.0.0.0:${PORT} (${Date.now() - startTime}ms)`);
      });

      return;
    }

    // REGULAR MODE: Full application
    console.log(`[gateway] PID: ${process.pid}`);
    console.log(`[gateway] Mode: ${MODE.toUpperCase()}`);
    
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distDir = path.join(__dirname, "client", "dist");

    // CRITICAL: Health endpoints FIRST (before any middleware or imports)
    // This ensures instant responses to deployment health checks
    // In deployment, Cloud Run checks "/" - return OK immediately
    // In dev/preview, let SPA handle "/" (don't register it here)
    if (isDeployment) {
      app.get('/', (_req, res) => res.status(200).send('OK'));
      app.head('/', (_req, res) => res.status(200).end());
    }
    app.get('/health', (_req, res) => res.status(200).send('OK'));
    app.head('/health', (_req, res) => res.status(200).end());
    app.get('/ready', (_req, res) => res.status(200).send('OK'));
    app.head('/ready', (_req, res) => res.status(200).end());
    app.get("/healthz", (_req, res) => {
      const indexPath = path.join(distDir, "index.html");
      if (fs.existsSync(indexPath)) {
        return res.json({ ok: true, spa: "ready", mode: isDev ? "dev" : "prod", ts: Date.now() });
      }
      return res.status(503).json({ ok: false, spa: "missing", mode: isDev ? "dev" : "prod", ts: Date.now() });
    });

    // Start HTTP server IMMEDIATELY (before loading heavy modules)
    const server = http.createServer(app);
    
    // Cloud Run compatible timeouts
    server.keepAliveTimeout = 65000; // must be < headersTimeout
    server.headersTimeout = 66000;
    server.requestTimeout = 5000;
    
    server.on('error', (err) => {
      console.error('[gateway] ❌ Server error:', err);
      process.exit(1);
    });
    
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[ready] ✅ Server listening on 0.0.0.0:${PORT} in ${Date.now() - startTime}ms`);
      console.log(`[ready] 🚀 Health endpoints ready - accepting requests`);
    });

  // NOTE: In mono mode, consolidation listener runs in separate strategy-generator.js process
  // Gateway should NOT start an inline listener to avoid conflicts with separate worker
  const isCloudRun = process.env.REPLIT_DEPLOYMENT === "1";
  
  if (isCloudRun) {
    console.log("[gateway] ⏩ Background worker disabled (Cloud Run detected)");
  } else {
    console.log("[gateway] ⏩ Consolidation listener runs in separate worker process");
  }

  // Mount middleware and routes after server is listening
  setImmediate(async () => {
    console.log("[gateway] Loading heavy modules and mounting routes...");
    
    // Load AI config after server is bound
    const { GATEWAY_CONFIG } = await import("./agent-ai-config.js");
    console.log("[gateway] AI Config:", GATEWAY_CONFIG);
    
    // Serve static assets
    app.use(express.static(distDir));
    
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: true, credentials: true }));
    app.use("/api", express.json({ limit: "1mb" }));
    app.use("/agent", express.json({ limit: "1mb" }));
    console.log("[gateway] ✅ Middleware configured");

    // Mount SSE strategy events endpoint (before SDK/Agent routes)
    // Enable SSE in all modes EXCEPT autoscale (Reserved VM supports SSE, autoscale doesn't)
    const isAutoscaleDeploy = isDeployment && process.env.CLOUD_RUN_AUTOSCALE === "1";
    if (!isAutoscaleDeploy) {
      try {
        console.log("[gateway] Loading SSE strategy events...");
        const strategyEvents = (await import("./server/strategy-events.js")).default;
        app.use("/", strategyEvents);
        console.log("[gateway] ✅ SSE strategy events endpoint mounted");
      } catch (e) {
        console.error("[gateway] ❌ SSE events failed:", e?.message);
      }
    } else {
      console.log("[gateway] ⏩ SSE disabled (autoscale mode - use polling)");
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
