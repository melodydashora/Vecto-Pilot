// gateway-server.js - Single public server with supervised child processes
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadAssistantPolicy } from "./server/eidolon/policy-loader.js";
import { startMemoryCompactor } from "./server/eidolon/memory/compactor.js";
import pg from "pg";

// ---------- config ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// CRITICAL: Gateway is the ONLY public server on PORT
const GATEWAY_PORT = Number(process.env.PORT || 8080);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Private ports - MUST bind to 127.0.0.1
const SDK_PORT = 3101;
const AGENT_PORT = 43717;
const VITE_PORT = 5173;
const VITE_HMR_PORT = 24700; // Pin HMR to avoid collisions

console.log("🚀 [gateway] Starting in", IS_PRODUCTION ? "PRODUCTION" : "DEVELOPMENT", "mode");
console.log("🚀 [gateway] Port configuration:", { 
  Gateway: GATEWAY_PORT + " (public)", 
  SDK: SDK_PORT + " (private)",
  Agent: AGENT_PORT + " (private)",
  Vite: VITE_PORT + " (private)"
});

// ---------- Vector DB setup (REQUIRED) ----------
if (!process.env.DATABASE_URL) {
  console.error("❌ [FATAL] DATABASE_URL is required. This system cannot run without a database.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const INIT_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536)
);
CREATE INDEX IF NOT EXISTS documents_embedding_idx
  ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`;

let dbReady = false;

async function prepareDb() {
  try {
    await pool.query(INIT_SQL);
    await pool.query("ANALYZE documents;");
    dbReady = true;
    console.log("[db] Vector DB ready ✅");
  } catch (err) {
    console.error("❌ [FATAL] Failed to prepare vector DB:", err.message);
    process.exit(1);
  }
}

// ---------- child process supervisor ----------
const children = [];

function spawnSvc(label, cmd, args, opts) {
  let child = null;
  let restarting = false;
  let backoff = 500; // ms min backoff
  
  function start() {
    if (restarting) return;
    
    console.log(`[${label}] Starting on port ${opts.port}...`);
    
    child = spawn(cmd, args, {
      stdio: "inherit",
      env: { 
        ...process.env, 
        HOST: "127.0.0.1",  // CRITICAL: Force localhost
        PORT: String(opts.port),
        NODE_ENV: process.env.NODE_ENV
      },
      cwd: opts.cwd || process.cwd(),
    });
    
    children.push(child);
    
    child.on("exit", (code, signal) => {
      if (restarting) return;
      restarting = true;
      
      const delay = Math.min(backoff, 5000);
      console.error(`[${label}] exited (code=${code}, sig=${signal}) — restarting in ${delay}ms`);
      
      setTimeout(() => {
        restarting = false;
        backoff = Math.min(backoff * 2, 5000);
        start();
      }, delay);
    });
    
    child.on("error", (err) => {
      console.error(`[${label}] spawn error:`, err.message);
    });
    
    return child;
  }
  
  return start();
}

// ---------- Start children BEFORE HTTP routing ----------
if (!IS_PRODUCTION) {
  console.log("🐕 Starting supervised child processes...");
  
  // Start SDK
  spawnSvc("eidolon-sdk", "node", ["index.js"], { 
    port: SDK_PORT, 
    cwd: process.cwd() 
  });
  
  // Start Agent
  const agentPath = path.join(process.cwd(), "agent-server.js");
  if (fs.existsSync(agentPath)) {
    spawnSvc("agent", "node", ["agent-server.js"], { 
      port: AGENT_PORT, 
      cwd: process.cwd() 
    });
  } else {
    console.warn("[gateway] agent-server.js not found, skipping agent spawn");
  }
}

// ---------- Vite dev middleware (single instance, pinned HMR) ----------
let viteReady = false;

async function setupVite(app) {
  if (IS_PRODUCTION) return;
  
  try {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: {
        middlewareMode: true,
        host: "127.0.0.1",  // CRITICAL: localhost only
        port: VITE_PORT,
        hmr: { 
          host: "127.0.0.1", 
          port: VITE_HMR_PORT  // Pin HMR to avoid collisions
        },
      },
      appType: "custom",
    });
    
    app.use(vite.middlewares);
    viteReady = true;
    console.log("[gateway] Vite dev middleware active - React app served from memory");
    console.log("[gateway] Vite HMR pinned to port", VITE_HMR_PORT);
  } catch (err) {
    console.error("[gateway] Vite setup failed:", err);
  }
}

// ---------- helper to wait for ports ----------
function waitForPort(port, host = "127.0.0.1", timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    
    (function tryConnect() {
      const socket = net.connect({ port, host }, () => { 
        socket.destroy(); 
        resolve(true); 
      });
      
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timeout waiting for ${host}:${port}`));
        }
        setTimeout(tryConnect, 250);
      });
    })();
  });
}

// ---------- security middleware ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "http:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "http:", "ws:", "wss:"],
      fontSrc: ["'self'", "https:", "http:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://www.google.com", "https://recaptcha.net"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// Health check (gateway itself)
app.get("/health", (req, res) => {
  res.json({ ok: true, gateway: "healthy", port: GATEWAY_PORT });
});

// ---------- Load production routes if needed ----------
if (IS_PRODUCTION) {
  console.log("✅ [gateway] Production mode - loading API routes synchronously");
  
  const parseJson = express.json({ limit: "1mb", strict: true });
  
  // Load all production routes
  Promise.all([
    import('./server/routes/health.js'),
    import('./server/routes/blocks.js'),
    import('./server/routes/blocks-fast.js'),
    import('./server/routes/blocks-triad-strict.js'),
    import('./server/routes/location.js'),
    import('./server/routes/venues.js'),
    import('./server/routes/catalog.js'),
    import('./server/routes/candidates.js'),
    import('./server/routes/snapshots.js'),
    import('./server/routes/strategies.js'),
    import('./server/routes/rankings.js'),
    import('./server/routes/feedback.js'),
    import('./server/routes/actions.js'),
    import('./server/routes/ml-health.js'),
    import('./server/eidolon/memory.js'),
    import('./server/eidolon/assistant.js')
  ]).then(modules => {
    // Mount routes
    app.use('/api/health', modules[0].default);
    app.use('/api/blocks', modules[1].default);
    app.use('/api/blocks', modules[2].default);
    app.use('/api/blocks', modules[3].default);
    app.use('/api/location', modules[4].default);
    app.use('/api/venues', modules[5].default);
    app.use('/api/catalog', modules[6].default);
    app.use('/api/candidates', modules[7].default);
    app.use('/api/snapshots', modules[8].default);
    app.use('/api/strategies', modules[9].default);
    app.use('/api/rankings', modules[10].default);
    app.use('/api/feedback', modules[11].default);
    app.use('/api/actions', modules[12].default);
    app.use('/api/ml', modules[13].default);
    app.use('/api/memory', modules[14].default);
    app.use('/api/assistant', modules[15].default);
    
    console.log("✅ [gateway] All production routes loaded");
  }).catch(err => {
    console.error("❌ [gateway] Failed to load production routes:", err);
  });
  
  // Serve static build
  const distDir = path.resolve(process.cwd(), "dist");
  app.use(express.static(distDir));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// ---------- Proxies (all to localhost) ----------
if (!IS_PRODUCTION) {
  const createProxy = (target, extra = {}) => 
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      logLevel: "warn",
      ...extra
    });
  
  // SDK proxies
  app.use("/assistant", createProxy(`http://127.0.0.1:${SDK_PORT}/api/assistant`));
  app.use("/eidolon", createProxy(`http://127.0.0.1:${SDK_PORT}`));
  app.use("/api", createProxy(`http://127.0.0.1:${SDK_PORT}/api`));
  
  // Agent proxy
  app.use("/agent", createProxy(`http://127.0.0.1:${AGENT_PORT}/agent`));
  
  // Setup Vite after proxies
  setupVite(app).then(() => {
    if (!IS_PRODUCTION) {
      // Wait for backend services
      Promise.allSettled([
        waitForPort(SDK_PORT).then(() => console.log(`✅ [gateway] SDK ready on port ${SDK_PORT}`)),
        waitForPort(AGENT_PORT).then(() => console.log(`✅ [gateway] Agent ready on port ${AGENT_PORT}`))
      ]).then(() => console.log("✅ [gateway] All backends ready"));
    }
  });
}

// Error handling
app.use((err, req, res, next) => {
  if (err?.code === "ECONNABORTED") {
    if (!res.headersSent) res.status(499).end();
    return;
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "payload too large" });
  }
  console.error("[gateway] Error:", err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "route_not_found", path: req.path });
});

// ---------- Start server ----------
const server = app.listen(GATEWAY_PORT, "0.0.0.0", async () => {
  console.log(`🌐 [gateway] Server listening on 0.0.0.0:${GATEWAY_PORT} (public)`);
  
  // Prepare vector DB
  await prepareDb();
  
  // Load assistant policy
  setImmediate(() => {
    try {
      console.log("[gateway] Loading assistant policy...");
      const policy = loadAssistantPolicy(process.env.ASSISTANT_POLICY_PATH || "config/assistant-policy.json");
      app.set("assistantPolicy", policy);
      console.log("[gateway] Starting memory compactor...");
      startMemoryCompactor(policy);
      console.log("[gateway] Policy and memory compactor initialized");
    } catch (err) {
      console.warn("[gateway] Policy loading failed (non-critical):", err.message);
    }
  });
  
  if (process.env.REPL_ID) {
    console.log(`🌐 [gateway] Preview: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  }
});

// Handle WebSocket upgrades
server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";
  
  const createProxy = (target) => 
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
    });
  
  // Route WebSocket connections
  if (url.startsWith("/agent")) {
    return createProxy(`http://127.0.0.1:${AGENT_PORT}`).upgrade(req, socket, head);
  }
  
  if (url.startsWith("/assistant") || url.startsWith("/api") || url.startsWith("/socket.io")) {
    return createProxy(`http://127.0.0.1:${SDK_PORT}`).upgrade(req, socket, head);
  }
  
  // Default: Vite HMR
  if (viteReady) {
    return createProxy(`http://127.0.0.1:${VITE_PORT}`).upgrade(req, socket, head);
  }
});

// ---------- Graceful shutdown ----------
function shutdown() {
  console.log("[gateway] Shutting down...");
  
  // Kill all child processes
  children.forEach(child => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  });
  
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;