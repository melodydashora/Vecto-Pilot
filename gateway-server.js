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
import { GATEWAY_CONFIG } from "./agent-ai-config.js";
import { startConsolidationListener } from "./server/jobs/triad-worker.js";
import { startCleanupLoop } from "./server/jobs/event-cleanup.js";

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
const SDK_PORT = Number(process.env.EIDOLON_PORT || process.env.SDK_PORT || 5000);

console.log(`[gateway] PID: ${process.pid}`);
console.log(`[gateway] Mode: ${MODE.toUpperCase()}`);
console.log("[gateway] AI Config:", GATEWAY_CONFIG);

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
  const app = express();
  app.set("trust proxy", 1);

  // Serve SPA early
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.join(__dirname, "client", "dist");

  app.use("/app", express.static(distDir));
  app.get("/", (_req, res) => res.redirect("/app"));
  app.get("/app/*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));

  // Health endpoints
  app.get("/health", (_req, res) => res.status(200).send("OK"));
  app.get("/healthz", (_req, res) => {
    const indexPath = path.join(distDir, "index.html");
    if (fs.existsSync(indexPath)) {
      return res.json({ ok: true, spa: "ready", mode: isDev ? "dev" : "prod", ts: Date.now() });
    }
    return res.status(503).json({ ok: false, spa: "missing", mode: isDev ? "dev" : "prod", ts: Date.now() });
  });

  // Start HTTP server
  const server = http.createServer(app);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[ready] Server listening on 0.0.0.0:${PORT}`);
  });

  // Start LISTEN-only consolidation listener
  if (!global.__CONSOLIDATION_LISTENER_STARTED__) {
    global.__CONSOLIDATION_LISTENER_STARTED__ = true;
    startConsolidationListener()
      .then(() => console.log("[gateway] 🎧 Consolidation listener started"))
      .catch((err) => console.error("[gateway] ❌ Listener failed:", err?.message || err));
  }

  // Start event cleanup job (removes expired events from events_facts table)
  if (!global.__EVENT_CLEANUP_STARTED__) {
    global.__EVENT_CLEANUP_STARTED__ = true;
    startCleanupLoop();
    console.log("[gateway] 🧹 Event cleanup job started");
  }

  // Mount middleware and routes after server is listening
  setImmediate(async () => {
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: true, credentials: true }));
    app.use("/api", express.json({ limit: "1mb" }));
    app.use("/agent", express.json({ limit: "1mb" }));

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
})();
