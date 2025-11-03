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
    console.log(`[gateway] REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}`);
    console.log(`[gateway] PORT=${PORT}`);
    console.log(`[gateway] NODE_ENV=${process.env.NODE_ENV}`);
    
    const app = express();
    app.set("trust proxy", 1);

    // Detect Replit autoscale deployment environment
    const isAutoscale = process.env.REPLIT_DEPLOYMENT === "1";
    
    // AUTOSCALE MODE: Health check only, no routes/middleware
    if (isAutoscale) {
      console.log("[gateway] ⚡ Autoscale mode - health-only server");
      console.log("[gateway] Creating minimal Express app...");
      
      // Minimal health endpoints
      app.get("/", (_req, res) => {
        console.log("[health] GET / - responding OK");
        res.status(200).send("OK");
      });
      app.head("/", (_req, res) => {
        console.log("[health] HEAD / - responding OK");
        res.status(200).end();
      });
      app.get("/health", (_req, res) => {
        console.log("[health] GET /health - responding OK");
        res.status(200).send("OK");
      });
      app.head("/health", (_req, res) => {
        console.log("[health] HEAD /health - responding OK");
        res.status(200).end();
      });
      
      // Start server immediately - no routes, no middleware, no delays
      console.log(`[gateway] Binding to 0.0.0.0:${PORT}...`);
      const server = http.createServer(app);
      
      server.on('error', (err) => {
        console.error(`[gateway] ❌ Server error:`, err);
        console.error(`[gateway] Error code: ${err.code}`);
        console.error(`[gateway] Error stack:`, err.stack);
        process.exit(1);
      });
      
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`[ready] Health-only server listening on 0.0.0.0:${PORT}`);
        console.log(`[ready] Autoscale mode active - ready for health checks`);
        console.log(`[ready] Timestamp: ${new Date().toISOString()}`);
      });
      
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

    // Health endpoints
    app.get("/health", (_req, res) => res.status(200).send("OK"));
    app.head("/health", (_req, res) => res.status(200).end());
    app.get("/healthz", (_req, res) => {
      const indexPath = path.join(distDir, "index.html");
      if (fs.existsSync(indexPath)) {
        return res.json({ ok: true, spa: "ready", mode: isDev ? "dev" : "prod", ts: Date.now() });
      }
      return res.status(503).json({ ok: false, spa: "missing", mode: isDev ? "dev" : "prod", ts: Date.now() });
    });

    // Serve SPA static assets
    app.use(express.static(distDir));

    // Start HTTP server
    const server = http.createServer(app);
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
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: true, credentials: true }));
    app.use("/api", express.json({ limit: "1mb" }));
    app.use("/agent", express.json({ limit: "1mb" }));

    // Mount SSE strategy events endpoint (before SDK/Agent routes)
    // Don't mount at "/" in autoscale to avoid overriding health check
    if (!isCloudRun) {
      try {
        const strategyEvents = (await import("./server/strategy-events.js")).default;
        app.use("/", strategyEvents);
        console.log("[gateway] ✅ SSE strategy events endpoint mounted");
      } catch (e) {
        console.error("[gateway] ❌ SSE events failed:", e?.message);
      }
    }

    if (MODE === "mono") {
      try {
        const createSdkRouter = (await import("./sdk-embed.js")).default;
        app.use(process.env.API_PREFIX || "/api", createSdkRouter({}));
      } catch (e) {
        console.error("[mono] SDK embed failed:", e?.message);
      }
      try {
        const { mountAgent } = await import("./server/agent/embed.js");
        mountAgent({ app, basePath: process.env.AGENT_PREFIX || "/agent", wsPath: "/agent/ws", server });
      } catch (e) {
        console.error("[mono] Agent embed failed:", e?.message);
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
