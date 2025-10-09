// gateway-server.js (ESM, single SDK watchdog, sane build guard)

import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAssistantPolicy } from "./server/eidolon/policy-loader.js";
import { startMemoryCompactor } from "./server/eidolon/memory/compactor.js";

// ---------- config ----------
const app = express();
// Trust exactly 1 proxy (Replit platform) - prevents IP spoofing in rate limiting
app.set('trust proxy', 1);

// AUTOSCALE: Use Replit-provided PORT or fallback to 5000 for dev
const PORT = Number(process.env.PORT) || 5000;
const SDK_PORT = Number(process.env.EIDOLON_PORT) || 3101;
const AGENT_PORT = Number(process.env.AGENT_PORT) || 43717;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

console.log(`🚀 [gateway] Starting in ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
console.log(`🚀 [gateway] Port configuration: Gateway=${PORT}, SDK=${SDK_PORT}, Agent=${AGENT_PORT}`);

// ---------- CRITICAL: health check first (must respond instantly) ----------
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, gateway: true, timestamp: new Date().toISOString() });
});

// ---------- Bot/Scanner Protection (Rate Limiting) ----------
// Aggressive rate limiting to block scanners and bots
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per 15 minutes
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for health checks
  skip: (req) => req.path === '/health'
});

// Apply rate limiting to all routes (except health check)
app.use(generalLimiter);

// ---------- Security headers with Helmet ----------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "https://replit.com", "wss://replit.com",
        "https://*.replit.dev", "wss://*.replit.dev",
        "https://app.launchdarkly.com", "https://events.launchdarkly.com",
        "https://www.google-analytics.com", "https://stats.g.doubleclick.net"
      ],
      scriptSrc: [
        "'self'", "'unsafe-inline'", "'unsafe-eval'",
        "https://js.stripe.com", "https://www.googletagmanager.com",
        "https://www.google-analytics.com", "https://www.google.com", "https://www.gstatic.com"
      ],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://www.google.com", "https://recaptcha.net"]
    }
  }
}));

// Load assistant policy and start memory compactor (deferred to avoid blocking startup)
setImmediate(() => {
  try {
    const policy = loadAssistantPolicy(process.env.ASSISTANT_POLICY_PATH || "config/assistant-policy.json");
    app.set("assistantPolicy", policy);
    startMemoryCompactor(policy);
  } catch (err) {
    console.warn("[gateway] Policy loading deferred:", err.message);
  }
});

// Define log function first
const log = (...a) => console.log(IS_PRODUCTION ? "[vecto]" : "[eidolon-sdk]", ...a);

// SDK watchdog
const SDK_CMD  = process.env.EIDOLON_CMD  || "node";
const SDK_ARGS = (process.env.EIDOLON_ARGS || "index.js").split(" ");
const defaultSdkDir = path.resolve(process.cwd(), "eidolon-sdk");
const SDK_CWD =
  process.env.EIDOLON_CWD
  || (fs.existsSync(path.join(defaultSdkDir, "index.js")) ? defaultSdkDir : process.cwd());
log("SDK cwd:", SDK_CWD);
const HEALTH_PATH = process.env.EIDOLON_HEALTH || "/health";

const HEALTH_INTERVAL_MS = 5_000;
const HEALTH_TIMEOUT_MS  = 2_500;
const MAX_MISSES         = 3;
const RESTART_BASE_MS    = 1_000;
const RESTART_CAP_MS     = 30_000;

// paths
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const clientDir  = path.resolve(process.cwd(), "client");
// Vite builds to root dist/ directory (configured in vite.config.js)
const distDir    = path.resolve(process.cwd(), "dist");
const indexHtml  = path.join(distDir, "index.html");

// ---------- sdk watchdog ----------
let sdkProc = null;
let healthTimer = null;
let misses = 0;
let restartAttempts = 0;
let stopping = false;
let sdkReady = false;

function startSDK() {
  if (stopping || sdkProc) return;

  // Sanity check: ensure the target file exists before spawning
  if (!fs.existsSync(path.join(SDK_CWD, SDK_ARGS[0]))) {
    log(`fatal: cannot find ${SDK_ARGS[0]} in ${SDK_CWD}`);
    process.exit(1);
  }

  log("starting:", { cmd: SDK_CMD, args: SDK_ARGS.join(" "), cwd: SDK_CWD, port: SDK_PORT });
  const childEnv = {
    ...process.env,
    PORT: String(SDK_PORT),
    HOST: "127.0.0.1",
    EIDOLON_DISABLE_STATIC: "1", // gateway serves UI
    EIDOLON_APP_DIST: ""         // no SDK static path
  };

  sdkProc = spawn(SDK_CMD, SDK_ARGS, { cwd: SDK_CWD, stdio: "inherit", env: childEnv });

  sdkProc.on("exit", (code, signal) => {
    log(`exited code=${code} signal=${signal}`);
    clearHealth();
    sdkProc = null;
    sdkReady = false;
    if (!stopping) scheduleRestart();
  });

  sdkProc.on("error", (err) => {
    log("spawn error:", err.message);
    clearHealth();
    sdkProc = null;
    sdkReady = false;
    if (!stopping) scheduleRestart();
  });

  // give it a moment, then begin health checks
  setTimeout(startHealth, 500);
}

function stopSDK(signal = "SIGTERM") {
  stopping = true;
  clearHealth();
  if (sdkProc && !sdkProc.killed) {
    log("stopping…", signal);
    try { sdkProc.kill(signal); } catch {}
  }
  sdkProc = null;
}

function scheduleRestart() {
  restartAttempts += 1;
  const delay = Math.min(RESTART_BASE_MS * 2 ** (restartAttempts - 1), RESTART_CAP_MS);
  log(`restarting in ${Math.round(delay / 1000)}s (attempt ${restartAttempts})`);
  setTimeout(() => { if (!stopping) startSDK(); }, delay);
}

function clearHealth() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
  misses = 0;
}

function startHealth() {
  clearHealth();
  restartAttempts = 0; // healthy start resets backoff
  healthTimer = setInterval(async () => {
    const ok = await probeHealth();
    if (ok) { 
      if (!sdkReady) console.log("[gateway] SDK is healthy and ready");
      sdkReady = true; 
      misses = 0; 
      return; 
    }
    misses += 1;
    log(`health miss ${misses}/${MAX_MISSES}`);
    if (misses >= MAX_MISSES) {
      log("unhealthy: restarting child");
      try { sdkProc?.kill("SIGTERM"); } catch {}
    }
  }, HEALTH_INTERVAL_MS);
}

function probeHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: SDK_PORT, path: HEALTH_PATH, timeout: HEALTH_TIMEOUT_MS },
      (res) => { res.resume(); resolve(Boolean(res.statusCode && res.statusCode < 500)); }
    );
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", () => resolve(false));
  });
}

// ---------- metrics & tracing ----------
const counts = { assistant: 0, eidolon: 0, ide_assistant: 0 };
const count  = (key) => (req, _res, next) => { if (req.method !== "OPTIONS") counts[key]++; next(); };
const proxyLog = (label) => ({
  onProxyReq: (_proxyReq, req) => console.log(`[proxy→${label}] ${req.method} ${req.originalUrl}`),
  onProxyRes: (proxyRes, req) => console.log(`[${label}→proxy] ${req.method} ${req.originalUrl} -> ${proxyRes.statusCode} ${proxyRes.headers["content-type"]||""}`)
});

// Skip /health logging to reduce noise
app.use((req, res, next) => {
  if (req.path !== "/health") {
    console.log("[trace]", req.method, req.originalUrl);
  }
  if (process.env.NODE_ENV !== "production") {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  }
  next();
});


// ---------- metrics endpoint ----------

app.get("/metrics", (_req, res) => { res.set("Cache-Control", "no-store"); res.json({ counts, time: Date.now() }); });

// Job queue metrics endpoint (proxies to SDK server in dev, direct in prod)
app.get("/metrics/jobs", async (_req, res) => {
  try {
    // In production, we'd import getJobMetrics directly. In dev, proxy to SDK server.
    if (IS_PRODUCTION) {
      const { getJobMetrics } = await import("./server/lib/job-queue.js");
      res.json({ ok: true, ...(await getJobMetrics()) });
    } else {
      // Proxy to SDK server which has the job queue
      const response = await fetch(`http://127.0.0.1:${SDK_PORT}/api/metrics/jobs`);
      const data = await response.json();
      res.status(response.status).json(data);
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- proxies (before any static) ----------
// In production, no SDK = always ready. In dev, wait for SDK.
const guard = (_req, res, next) => (IS_PRODUCTION || sdkReady ? next() : res.status(503).json({ ok: false, reason: "sdk_warming" }));

// Only proxy to SDK/Agent in development mode
if (!IS_PRODUCTION) {
  // Gateway GW_KEY guard for all /agent/* calls
  app.use("/agent", (req, res, next) => {
    const want = process.env.GW_KEY;
    if (want && req.get("x-gw-key") !== want) {
      return res.status(401).json({ ok: false, error: "unauthorized_gw" });
    }
    next();
  });

  // Agent proxy: preserve full "/agent/..." upstream, inject agent token, force JSON
  app.use(
    "/agent",
    createProxyMiddleware({
      target: `http://127.0.0.1:${AGENT_PORT}`,
      changeOrigin: true,
      logLevel: "warn",

      // Express strips "/agent" before this middleware; put it back
      pathRewrite: (path) => `/agent${path}`,

      on: {
        proxyReq: (proxyReq, req, res) => {
          // Support both new (AGENT_TOKEN) and legacy (ASSISTANT_OVERRIDE_TOKEN) names
          const t = process.env.AGENT_TOKEN || process.env.ASSISTANT_OVERRIDE_TOKEN;
          if (t) {
            proxyReq.setHeader("x-agent-token", t);
            proxyReq.setHeader("authorization", `Bearer ${t}`); // covers either check
          }
          proxyReq.setHeader("accept", "application/json");
        },

        proxyRes: (proxyRes, req, res) => {
          const ct = proxyRes.headers["content-type"];
          if (!ct || !/json/i.test(String(ct))) {
            res.setHeader("content-type", "application/json; charset=utf-8");
          }
        },

        error: (err, req, res) => {
          console.error("[gateway→agent] proxy error:", err.message);
          res.status(502).json({ ok: false, error: "agent_proxy_error", detail: err.message });
        },
      },
    })
  );

  app.use(
    "/assistant",
  (req, res, next) => {
    if (req.get("referer")?.includes("replit.com") || req.get("user-agent")?.includes("replit")) counts.ide_assistant++;
    return count("assistant")(req, res, next);
  },
  guard,
  createProxyMiddleware({
    target: `http://127.0.0.1:${SDK_PORT}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: (p) => {
      const rw = p.replace(/^\/assistant/, "/api/assistant");
      console.log(`[assistant] pathRewrite: ${p} -> ${rw}`);
      return rw;
    },
    onProxyReqWs() { counts.assistant++; },
    logLevel: "warn",
    onError: (err, req, res) => {
      console.error(`[gateway] Assistant proxy error for ${req.method} ${req.url}:`, err.message);
      res.status(502).json({ ok: false, error: "Assistant SDK unavailable", where: "assistant-proxy" });
    },
    onProxyRes: (proxyRes, req) => console.log(`[assistant] ${proxyRes.statusCode} ${req.method} ${req.url}`)
  })
);

app.use(
  "/eidolon",
  count("eidolon"),
  guard,
  createProxyMiddleware({
    target: `http://127.0.0.1:${SDK_PORT}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: { "^/eidolon": "" },
    onProxyReqWs() { counts.eidolon++; },
    logLevel: "warn",
    onError: (err, req, res) => {
      console.error(`[gateway] Eidolon proxy error for ${req.url}:`, err.message);
      res.status(502).json({ ok: false, error: "Eidolon SDK unavailable" });
    },
    ...proxyLog("sdk")
  })
);

  app.all(/^\/api(\/.*)?$/i, guard, createProxyMiddleware({
    target: `http://127.0.0.1:${SDK_PORT}`,
    changeOrigin: true,
    ws: true,
    logLevel: "warn",
    onError: (err, req, res) => {
      console.error(`[gateway] API proxy error for ${req.url}:`, err.message);
      res.status(502).json({ ok: false, error: "API unavailable" });
    }
  }));
}
// End of development-only proxies

// ---------- build / serve app ----------
function ensureClientBuild() {
  if (fs.existsSync(indexHtml)) {
    console.log("[gateway] client build already exists");
    return;
  }
  console.log("[gateway] client build missing — building...");
  try {
    execSync("npm run build", { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
    console.log("[gateway] client build completed successfully");
  } catch (e) {
    console.error("[gateway] build failed:", e.message);
    console.error("[gateway] This is a real build error that needs to be fixed");
    process.exit(1);
  }
}

// ---------- production: setup middleware and routes BEFORE server starts ----------
if (IS_PRODUCTION) {
  console.log(`✅ [vecto] Production mode - loading API routes synchronously`);
  
  // JSON parser for routes that need it (not global to avoid abort errors)
  const parseJson = express.json({ limit: "1mb", strict: true });
  
  // Load routes synchronously BEFORE server.listen()
  const { default: healthRoutes } = await import('./server/routes/health.js');
  const { default: blocksRoutes } = await import('./server/routes/blocks.js');
  const { default: blocksTriadStrictRoutes } = await import('./server/routes/blocks-triad-strict.js');
  const { default: locationRoutes } = await import('./server/routes/location.js');
  const { default: actionsRoutes } = await import('./server/routes/actions.js');
  const { default: feedbackRoutes } = await import('./server/routes/feedback.js');
  const { default: jobMetricsRoutes } = await import('./server/routes/job-metrics.js');
  const { default: profileRoutes } = await import('./server/routes/profile.js');
  
  app.use("/api/health", healthRoutes);
  app.use("/api/blocks", parseJson, blocksRoutes);
  app.use(parseJson, blocksTriadStrictRoutes);
  app.use("/api/location", parseJson, locationRoutes); // parseJson for POST /snapshot
  app.use("/api/actions", parseJson, actionsRoutes);
  app.use("/api/feedback", parseJson, feedbackRoutes);
  app.use("/api/profile", parseJson, profileRoutes);
  app.use(jobMetricsRoutes); // Job queue metrics endpoint
  
  sdkReady = true;
  console.log(`✅ [vecto] API routes loaded and mounted synchronously`);
  console.log(`✅ [vecto] Routes available: /api/health, /api/blocks, /api/location, /api/actions, /api/feedback, /api/profile, /api/metrics/jobs`);
}

if (process.env.NODE_ENV !== "production") {
  console.log("[gateway] Setting up Vite dev middleware...");
  try {
    const { createServer } = await import("vite");
    const vite = await createServer({ 
      root: clientDir, 
      server: { 
        middlewareMode: true,
        host: "0.0.0.0",
        hmr: false // Disable HMR WebSocket server - not needed in middleware mode behind proxy
      }, 
      appType: "spa",
      configFile: path.resolve(process.cwd(), "vite.config.js")
    });
    
    // Register Vite middleware ONLY for root and static assets (exclude all /api, /eidolon, /assistant, etc.)
    app.use((req, res, next) => {
      // Explicitly skip Vite for all API/service routes
      if (
        req.path.startsWith("/eidolon") ||
        req.path.startsWith("/assistant") ||
        req.path.startsWith("/agent") ||
        req.path.startsWith("/api") ||
        req.path.startsWith("/health") ||
        req.path.startsWith("/metrics")
      ) {
        console.log(`[gateway] Skipping Vite for: ${req.method} ${req.path}`);
        return next();
      }
      // Let Vite handle everything else (/, /assets/*, etc.)
      return vite.middlewares(req, res, next);
    });
    console.log("[gateway] Vite dev middleware active - React app served from memory");
  } catch (err) {
    console.error("[gateway] Failed to setup Vite middleware:", err.message);
    // Fallback to serving static files
    app.use(express.static(clientDir));
    app.get("*", (req, res, next) => {
      if (
        req.path === "/" ||
        req.path.startsWith("/eidolon") ||
        req.path.startsWith("/assistant") ||
        req.path.startsWith("/agent") ||
        req.path.startsWith("/api") ||
        req.path.startsWith("/health") ||
        req.path.startsWith("/metrics")
      ) return next();
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }
} else {
  console.log("[gateway] Production mode - serving built SPA");
  ensureClientBuild();
  // Serve static assets from dist/ (but not auto-serve index.html for root)
  app.use(express.static(distDir, { index: false }));
  app.get("*", (req, res, next) => {
    // Don't serve SPA for API/proxy routes
    if (
      req.path.startsWith("/eidolon") ||
      req.path.startsWith("/assistant") ||
      req.path.startsWith("/agent") ||
      req.path.startsWith("/api") ||
      req.path.startsWith("/health") ||
      req.path.startsWith("/metrics")
    ) return next();
    // Serve SPA for root and all client routes
    res.sendFile(indexHtml);
  });
}

// Error gate for client aborts and oversized payloads
app.use((err, req, res, next) => {
  // Client closed connection mid-read
  if (err?.type === "request.aborted" || err?.code === "ECONNRESET") {
    if (!res.headersSent) res.status(499).end(); // 499: client closed request
    return; // treat as noise, don't log
  }
  // Payload too large
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "payload too large" });
  }
  // Pass other errors to default handler
  next(err);
});

// last resort 404 as JSON so jq never chokes on HTML
app.use((req, res) => res.status(404).json({ ok: false, error: "route_not_found", path: req.path }));

// ---------- server + startup ----------
// Clean up any existing processes on our ports
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

let server;
try {
  server = app.listen(PORT, "0.0.0.0", async () => {
    console.log(`🌐 [${IS_PRODUCTION ? 'vecto' : 'gateway'}] Server listening on 0.0.0.0:${PORT}`);
    
    if (IS_PRODUCTION) {
      console.log(`✅ [vecto] Production server ready with all API routes mounted`);
      if (process.env.REPL_ID) {
        console.log(`✅ [vecto] Preview: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
      }
    } else {
      // Development: Full Eidolon experience
      console.log(`🌐 [gateway] Proxying /assistant/* -> 127.0.0.1:${SDK_PORT}/api/assistant/*`);
      console.log(`🌐 [gateway] Proxying /eidolon/* -> 127.0.0.1:${SDK_PORT}/*`);
      console.log(`🌐 [gateway] Proxying /agent/* -> 127.0.0.1:${AGENT_PORT}/agent/*`);
      console.log(`🌐 [gateway] Proxying /api/* -> 127.0.0.1:${SDK_PORT}/api/*`);
      if (process.env.REPL_ID) {
        console.log(`🌐 [gateway] Preview: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
      }
      console.log("🐕 Starting Eidolon SDK watchdog…");
      startSDK();
      
      // Warm up SDK in background
      (async () => {
        console.log(`[gateway] Waiting for SDK to become healthy on port ${SDK_PORT}…`);
        const ok = await probeHealth();
        if (ok) { sdkReady = true; console.log("[gateway] SDK is healthy and ready"); }
      })();
    }
  });

  server.on('error', (err) => {
    console.error(`❌ [gateway] Server error:`, err);
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ [gateway] Port ${PORT} is already in use. Exiting.`);
      process.exit(1);
    }
  });
} catch (err) {
  console.error(`❌ [gateway] Failed to start server:`, err);
  process.exit(1);
}

// ---------- shutdown ----------
function shutdown() {
  console.log("[gateway] shutdown…");
  stopSDK();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
