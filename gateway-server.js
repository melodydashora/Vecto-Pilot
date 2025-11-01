// gateway-server.js - MONO + SPLIT capable
import http from 'node:http';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;
import { GATEWAY_CONFIG } from './agent-ai-config.js';
import { assertStrategies } from './server/lib/strategies/index.js';

//  ═══════════════════════════════════════════════════════════════════
//  MODE DETECTION - Single Source of Truth
//  ═══════════════════════════════════════════════════════════════════
const MODE = (process.env.APP_MODE || 'mono').toLowerCase(); // 'mono' | 'gateway'

// Robust dev detection: honor explicit envs and Replit flags
const env = (process.env.NODE_ENV || '').toLowerCase();
const isDev =
  env === 'development' ||
  (env === '' && process.env.REPLIT_DEV === '1') ||
  process.env.FORCE_DEV === '1';

const DISABLE_SPAWN_SDK = process.env.DISABLE_SPAWN_SDK === '1';
const DISABLE_SPAWN_AGENT = process.env.DISABLE_SPAWN_AGENT === '1';

// Ports - Replit maps internal 5000 to external 80
const PORT = Number(process.env.PORT || 5000);
const AGENT_PORT = Number(process.env.AGENT_PORT || 43717);
const SDK_PORT = Number(process.env.EIDOLON_PORT || process.env.SDK_PORT || 3102);

// Log PID for preview tracking
console.log(`[gateway] Process ID (PID): ${process.pid}`);

// Paths
const API_PREFIX = process.env.API_PREFIX || '/api';
const AGENT_PREFIX = process.env.AGENT_PREFIX || '/agent';
const WS_PUBLIC_PATH = process.env.WS_PUBLIC_PATH || '/agent/ws';
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/socket.io';

console.log(`[gateway] Mode: ${MODE.toUpperCase()}`);
console.log('[gateway] AI Config:', GATEWAY_CONFIG);

// Child process tracking (SPLIT mode only)
const children = new Map();

function spawnChild(name, command, args, env) {
  console.log(`🐕 [gateway] Starting ${name}...`);

  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (data) => {
    console.log(`[${name}] ${data.toString().trim()}`);
  });

  child.stderr.on('data', (data) => {
    console.error(`[${name}] ${data.toString().trim()}`);
  });

  child.on('exit', (code) => {
    console.error(`❌ [gateway] ${name} exited with code ${code}, restarting...`);
    children.delete(name);
    setTimeout(() => spawnChild(name, command, args, env), 2000);
  });

  children.set(name, child);
  return child;
}

//  ═══════════════════════════════════════════════════════════════════
//  ENVIRONMENT DETECTION
//  ═══════════════════════════════════════════════════════════════════
const isReplit = !!process.env.REPL_ID;
const isCloudRun = !!(process.env.K_SERVICE || process.env.CLOUD_RUN_AUTOSCALE === '1');
const isAutoscale = isCloudRun && !isReplit; // Cloud Run autoscale, NOT Replit
const fastBoot = process.env.FAST_BOOT === '1' || isAutoscale;

console.log(`[env] 🔍 ENABLE_BACKGROUND_WORKER="${process.env.ENABLE_BACKGROUND_WORKER}" (type: ${typeof process.env.ENABLE_BACKGROUND_WORKER})`);
console.log(`[env] 🔍 isReplit=${isReplit}, isCloudRun=${isCloudRun}, isAutoscale=${isAutoscale}`);

if (isAutoscale) {
  console.log('[autoscale] Cloud Run autoscale detected - using fast boot profile');
}
if (isReplit) {
  console.log('[replit] Replit environment detected - worker will be enabled');
}

//  ═══════════════════════════════════════════════════════════════════
//  MAIN ASYNC BOOTSTRAP
//  ═══════════════════════════════════════════════════════════════════
(async function main() {
  // ❌ REMOVED: assertStrategies() - moved to post-listen yielded ladder
  // This was blocking the event loop and causing Cloud Run health check failures
  
  const app = express();
  app.set('trust proxy', 1);

  // ═══════════════════════════════════════════════════════════════════
  // 1) HEALTH ENDPOINTS FIRST — No middleware before these!
  //    Cloud Run/Replit health probes MUST get instant 200 response
  //    Note: Root / serves the app, dedicated health paths for probes
  // ═══════════════════════════════════════════════════════════════════
  
  // Shell renderer function
  function renderShellHtml({ mode }) {
    return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Gateway</title>
        <style>
          :root{color-scheme:light dark}
          body{margin:0;font:14px system-ui,-apple-system,Segoe UI,Roboto,Ubuntu}
          header{position:sticky;top:0;z-index:10;padding:8px 12px;border-bottom:1px solid #ccc;background:Canvas}
          main{padding:12px}
          .status{font-weight:600}
        </style>
      </head>
      <body>
        <header>
          <div class="status">Mode: ${mode} • <span id="hb">hb…</span></div>
        </header>
        <main>
          <div id="app">Loading UI… If the client isn't built, the shell stays available.</div>
        </main>
        <script>
          async function ping(){
            try{
              const r = await fetch('/healthz');
              const j = await r.json();
              document.getElementById('hb').textContent = 'ok@'+j.ts;
            }catch(e){
              document.getElementById('hb').textContent = 'recovering';
            }
          }
          setInterval(ping, 3000); ping();
        </script>
      </body>
    </html>`;
  }
  
  app.get('/health', (_req, res) => res.status(200).send('OK'));
  app.head('/health', (_req, res) => res.status(200).end());
  
  // Health check with client build verification
  app.get('/healthz', async (_req, res) => {
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const { existsSync } = await import('fs');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const clientDist = path.join(__dirname, 'client/dist');
    const indexPath = path.join(clientDist, 'index.html');
    
    if (existsSync(indexPath)) {
      return res.status(200).json({ ok: true, spa: 'ready', mode: isDev ? 'dev' : 'prod', ts: Date.now() });
    }
    return res.status(503).json({ ok: false, spa: 'missing', mode: isDev ? 'dev' : 'prod', ts: Date.now() });
  });
  
  // Prevent caching of SPA shell to avoid stale "Cannot GET" pages
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.startsWith('/app')) {
      res.set('Cache-Control', 'no-store, must-revalidate');
    }
    next();
  });
  
  // Root route: redirect to app (shell available at /shell if needed)
  app.get('/', (_req, res) => {
    res.redirect(302, '/app/');
  });
  
  // Shell route for diagnostics
  app.get('/shell', (_req, res) => {
    res.status(200).send(renderShellHtml({ mode: isDev ? 'dev' : 'prod' }));
  });
  
  // /ready with DB probe per stabilization doc
  app.get('/ready', async (_req, res) => {
    try {
      const { db } = await import('./server/db/drizzle.js');
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`SELECT 1`);
      res.status(200).json({ ok: true, db: 'connected' });
    } catch (err) {
      console.error('[ready] DB probe failed:', err.message);
      res.status(503).json({ 
        ok: false, 
        reason: 'database_unavailable', 
        cause: err.message 
      });
    }
  });
  
  app.get('/api/health', (_req, res) => res.status(200).json({ ok: true, port: PORT, mode: MODE }));

  // ═══════════════════════════════════════════════════════════════════
  // 2) CREATE SERVER AND START LISTENING IMMEDIATELY
  //    Health endpoints active before any route mounting
  // ═══════════════════════════════════════════════════════════════════
  const server = http.createServer(app);
  
  // HTTP keepalive tuning for Cloud Run (slightly higher than Cloud Run's 60s timeout)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  
  // Unified listen: use GATEWAY_PORT in split mode, PORT otherwise
  const LISTEN_PORT = MODE === 'split'
    ? Number(process.env.GATEWAY_PORT || PORT)
    : PORT;
  
  server.listen(LISTEN_PORT, '0.0.0.0', () => {
    console.log(`[ready] Server listening on 0.0.0.0:${LISTEN_PORT}`);
    console.log(`[ready] Health endpoints: /, /health, /healthz, /ready, /api/health`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3) EVENT LOOP MONITORING - Detect starvation and pause heavy work
  // ═══════════════════════════════════════════════════════════════════
  const { monitorEventLoopDelay } = await import('node:perf_hooks');
  const loopMonitor = monitorEventLoopDelay({ resolution: 20 });
  loopMonitor.enable();
  
  globalThis.__PAUSE_BACKGROUND__ = false;
  
  setInterval(() => {
    const p95 = Math.round(loopMonitor.percentile(95) / 1_000_000); // Convert ns to ms
    if (p95 > 200) {
      console.warn(`[perf] ⚠️  Event loop lag p95=${p95}ms — pausing background tasks`);
      globalThis.__PAUSE_BACKGROUND__ = true;
    } else {
      globalThis.__PAUSE_BACKGROUND__ = false;
    }
  }, 1000);

  // ═══════════════════════════════════════════════════════════════════
  // 4) MOUNT MIDDLEWARE AND ROUTES AFTER SERVER IS LISTENING
  //    This keeps health checks fast while allowing slow imports
  // ═══════════════════════════════════════════════════════════════════
  setImmediate(async () => {
    // Middleware (mounted AFTER health endpoints)
    // Helmet & CORS are lightweight, can be global
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors({ origin: true, credentials: true }));
    
    // JSON parsing ONLY on API routes (not health endpoints)
    app.use('/api', express.json({ limit: '1mb' }));
    app.use('/agent', express.json({ limit: '1mb' }));

    // Timeout middleware (selective: only on API/agent routes)
    try {
      const { timeoutMiddleware } = await import('./server/middleware/timeout.js');
      app.use(['/api', '/agent'], timeoutMiddleware);
    } catch (e) {
      console.warn('[gateway] Timeout middleware failed to load:', e?.message);
    }

    // Request logger (AFTER health endpoints)
    app.use((req, res, next) => {
      if (req.path === '/' || req.path === '/health' || req.path === '/healthz' || req.path === '/ready') {
        return next(); // Skip logging for health checks
      }
      const t = Date.now();
      res.on('finish', () => {
        console.log(`[gateway] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - t}ms`);
      });
      next();
    });

    // Diagnostics endpoints
    app.get('/diagnostics/memory', (_req, res) => res.json(process.memoryUsage()));
    app.post('/diagnostics/prefs', express.json(), (req, res) => res.json({ ok: true, set: req.body || {} }));
    app.post('/diagnostics/session', express.json(), (req, res) => res.json({ ok: true, phase: req.body?.phase ?? 'unknown' }));

    //  ═══════════════════════════════════════════════════════════════════
    //  MODE A: MONO (Single Process - Replit-safe)
    //  ═══════════════════════════════════════════════════════════════════
    if (MODE === 'mono') {
      console.log(`[mono] Mounting routes in MONO mode...`);
      try {
        const createSdkRouter = (await import('./sdk-embed.js')).default;
        const sdkRouter = createSdkRouter({ API_PREFIX });
        app.use(API_PREFIX, sdkRouter);
        console.log(`[mono] ✓ SDK routes mounted at ${API_PREFIX}`);
      } catch (e) {
        console.error('[mono] ERROR: SDK embed failed:', e?.message || e);
        console.error('[mono] Continuing with degraded functionality...');
      }

      try {
        const { mountAgent } = await import('./server/agent/embed.js');
        mountAgent({ app, basePath: AGENT_PREFIX, wsPath: WS_PUBLIC_PATH, server });
        console.log(`[mono] ✓ Agent routes mounted at ${AGENT_PREFIX}, WS at ${WS_PUBLIC_PATH}`);
      } catch (e) {
        console.error('[mono] ERROR: Agent embed failed:', e?.message || e);
        console.error('[mono] Continuing with degraded functionality...');
      }

      // Legacy redirect for closed-venue-reasoning (was at root, now at /api)
      app.post('/closed-venue-reasoning', (req, res) => {
        console.log('[redirect] /closed-venue-reasoning -> /api/closed-venue-reasoning');
        res.redirect(307, '/api/closed-venue-reasoning');
      });

      // 404 JSON for unknown API routes (AFTER route mounting)
      app.use(API_PREFIX, (_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND', mode: 'mono' }));

      // ═══════════════════════════════════════════════════════════════════
      // MOUNT FRONTEND ROUTES EARLY - Before heavy initialization
      // This ensures the app is accessible immediately
      // ═══════════════════════════════════════════════════════════════════
      // Vite or static files (LAST - NEVER mount at "/" to avoid shadowing health)
      if (isDev) {
        const viteTarget = 'http://127.0.0.1:5173';
        const proxy = createProxyServer({});
        proxy.on('error', (err) => console.error('[mono] Vite proxy error:', err.message));

        // Spawn Vite (unless disabled)
        if (!process.env.DISABLE_SPAWN_VITE) {
          spawnChild('vite', 'npm', ['run', 'dev:client'], {});
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Proxy /app/* to Vite for frontend
        app.use('/app', (req, res) => {
          proxy.web(req, res, { target: viteTarget, changeOrigin: true });
        });

        // Vite HMR WebSocket
        server.on('upgrade', (req, socket, head) => {
          const url = req.url || '/';
          if (!url.startsWith(WS_PUBLIC_PATH) && !url.startsWith(SOCKET_IO_PATH)) {
            // Probably Vite HMR
            proxy.ws(req, socket, head, { target: viteTarget, changeOrigin: true, ws: true });
          }
        });
      } else {
        // Production mode - serve built static files at /app/
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const { statSync } = await import('fs');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        
        // Try common build output locations
        const candidates = [
          path.join(__dirname, 'client/dist'),
          path.join(__dirname, '../client/dist'),
          path.join(process.cwd(), 'client/dist'),
        ];
        
        const CLIENT_DIST = candidates.find(p => {
          try { return statSync(p).isDirectory(); } catch { return false; }
        });
        
        if (CLIENT_DIST) {
          console.log('[gateway] Serving SPA from', CLIENT_DIST);
          app.use('/app', express.static(CLIENT_DIST, { index: 'index.html' }));
          app.get(['/app', '/app/*'], (req, res) => {
            console.log('[gateway] SPA route hit:', req.path);
            res.sendFile(path.join(CLIENT_DIST, 'index.html'));
          });
        } else {
          console.warn('[gateway] No client build found — /app/ will 404 until you build the client.');
        }
        
        app.use((req, res, next) => {
          console.log('[gateway] Unmatched request:', req.method, req.path);
          next();
        });
      }
      
      console.log(`🎉 [mono] Application fully initialized`);
      
      // ═══════════════════════════════════════════════════════════════════
      // POST-LISTEN YIELDED LADDER - Heavy initialization AFTER routes mounted
      // Yields between steps to keep health checks responsive
      // ═══════════════════════════════════════════════════════════════════
      setImmediate(async () => {
        console.log('[gateway] Background worker managed by separate process (strategy-generator.js)');
        
        const initSteps = [
          {
            name: 'Job seeding',
            fn: async () => {
              const { seedJobIfEmpty } = await import('./server/bootstrap/enqueue-initial.js');
              await seedJobIfEmpty();
            }
          },
          {
            name: 'Strategy validation',
            fn: async () => {
              const { safeAssertStrategies } = await import('./server/lib/strategies/assert-safe.js');
              await safeAssertStrategies({ batchSize: 5, delayMs: 0 });
            }
          },
          {
            name: 'Cache warmup',
            fn: async () => {
              if (!fastBoot) {
                const { maybeWarmCaches } = await import('./server/lib/strategies/assert-safe.js');
                await maybeWarmCaches();
              } else {
                console.log('[warmup] Skipped (FAST_BOOT enabled)');
              }
            }
          },
        ];
        
        // Execute init steps with yielding
        for (const step of initSteps) {
          // Check if event loop is starved
          if (globalThis.__PAUSE_BACKGROUND__) {
            console.warn(`[boot] Pausing due to event loop lag before: ${step.name}`);
            await new Promise(r => setTimeout(r, 250));
          }
          
          try {
            await step.fn();
          } catch (e) {
            console.warn(`[boot] Step '${step.name}' failed:`, e?.message || e);
          }
          
          // Yield to event loop after each step
          await new Promise(r => setTimeout(r, 0));
        }
        
        console.log('[gateway] ✓ Background initialization complete');
      });
    }

    //  ═══════════════════════════════════════════════════════════════════
    //  MODE B: SPLIT (Multi-Process - Production)
    //  ═══════════════════════════════════════════════════════════════════
    else {
    const agentTarget = `http://127.0.0.1:${AGENT_PORT}`;
    const sdkTarget = `http://127.0.0.1:${SDK_PORT}`;

    // Spawn child processes (unless disabled)
    if (!DISABLE_SPAWN_SDK) {
      spawnChild('sdk', 'node', ['index.js'], { PORT: SDK_PORT });
    }
    if (!DISABLE_SPAWN_AGENT) {
      spawnChild('agent', 'node', ['agent-server.js'], { AGENT_PORT });
    }
    if (isDev && !process.env.DISABLE_SPAWN_VITE) {
      spawnChild('vite', 'npm', ['run', 'dev:client'], {});
    }

    // Wait for children
    if (!DISABLE_SPAWN_SDK || !DISABLE_SPAWN_AGENT) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const proxy = createProxyServer({});
    proxy.on('error', (err, req, res) => {
      const r = res;
      if (r && !r.headersSent) {
        r.statusCode = 502;
        r.setHeader('Content-Type', 'application/json');
        r.end(JSON.stringify({ ok: false, error: 'bad_gateway', detail: String(err?.message || err) }));
      }
    });

    // Proxy routes - ORDER MATTERS!
    // 1. Agent routes
    app.use(AGENT_PREFIX, (req, res) => {
      req.url = req.originalUrl.replace(new RegExp(`^${AGENT_PREFIX}`), '') || '/';
      proxy.web(req, res, { target: agentTarget, changeOrigin: true });
    });

    // 2. SDK routes
    app.use(['/assistant', API_PREFIX, '/diagnostics', SOCKET_IO_PATH], (req, res) => {
      proxy.web(req, res, { target: sdkTarget, changeOrigin: true });
    });

    // API 404 guard
    app.use(API_PREFIX, (req, res) => {
      res.status(404).json({ error: 'not_found', path: req.path, mode: 'split' });
    });

    // 3. Frontend (LAST) - Gate to preserve root shell and health endpoints
    if (isDev) {
      const viteTarget = 'http://127.0.0.1:5173';
      // Proxy /app/* to Vite for frontend
      app.use('/app', (req, res) => {
        proxy.web(req, res, { target: viteTarget, changeOrigin: true });
      });
    } else {
      // Production mode - serve built static files at /app/
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const fs = await import('fs');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      
      // Try common build output locations
      const candidates = [
        path.join(__dirname, 'client/dist'),
        path.join(__dirname, '../client/dist'),
        path.join(process.cwd(), 'client/dist'),
      ];
      
      const CLIENT_DIST = candidates.find(p => {
        try { return fs.statSync(p).isDirectory(); } catch { return false; }
      });
      
      if (CLIENT_DIST) {
        console.log('[gateway] Serving SPA from', CLIENT_DIST);
        app.use('/app', express.static(CLIENT_DIST, { index: 'index.html' }));
        app.get(['/app', '/app/*'], (req, res) => {
          res.sendFile(path.join(CLIENT_DIST, 'index.html'));
        });
      } else {
        console.warn('[gateway] No client build found — /app/ will 404 until you build the client.');
      }
    }

    // WebSocket upgrades
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = req.url || '/';

        // Reject upgrades for health endpoints
        if (url === '/' || url.startsWith('/health') || url.startsWith('/healthz') || url.startsWith('/ready')) {
          socket.destroy();
          return;
        }

        if (url.startsWith(AGENT_PREFIX)) {
          req.url = url.replace(new RegExp(`^${AGENT_PREFIX}`), '') || '/';
          proxy.ws(req, socket, head, { target: agentTarget, changeOrigin: true, ws: true });
          return;
        }

        if (url.startsWith('/assistant') || url.startsWith(API_PREFIX) || url.startsWith(SOCKET_IO_PATH)) {
          proxy.ws(req, socket, head, { target: sdkTarget, changeOrigin: true, ws: true });
          return;
        }

        if (isDev) {
          const viteTarget = 'http://127.0.0.1:5173';
          proxy.ws(req, socket, head, { target: viteTarget, changeOrigin: true, ws: true });
          return;
        }

        socket.destroy();
      } catch {
        try { socket.destroy(); } catch {}
      }
    });

    // Log split mode proxies (server already listening from line 184)
    console.log(`🚀 [split] Proxies mounted: agent=${agentTarget}, sdk=${sdkTarget}${isDev ? ', vite=http://127.0.0.1:5173' : ''}`);
    console.log(`[split] Root shell retained; health endpoints never shadowed`);
  }
  }); // Close setImmediate async block

  // Common error handlers - never crash
  server.on('error', (err) => {
    console.error(`[gateway] Server error:`, err?.message || err);
    if (err?.code === 'EADDRINUSE') {
      console.error(`[gateway] Port ${PORT} in use - trying to continue anyway`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4) HARDENING: Graceful shutdown & crash shields
  // ═══════════════════════════════════════════════════════════════════
  
  // Graceful shutdown for SIGTERM (Cloud Run, Docker, Kubernetes)
  process.on('SIGTERM', () => {
    console.log('[signal] SIGTERM received, shutting down gracefully...');
    children.forEach((child) => child.kill('SIGTERM'));
    server.close(() => {
      console.log('[signal] HTTP server closed');
      process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      console.error('[signal] Force exit after 10s timeout');
      process.exit(1);
    }, 10000);
  });

  // Graceful shutdown for SIGINT (Ctrl+C in terminal)
  process.on('SIGINT', () => {
    console.log('[signal] SIGINT received, shutting down gracefully...');
    children.forEach((child) => child.kill('SIGINT'));
    server.close(() => {
      console.log('[signal] HTTP server closed');
      process.exit(0);
    });
  });

  // Crash shields (log but don't exit, keep health endpoints alive)
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    console.error('[uncaughtException] Stack:', err.stack);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

})().catch((err) => {
  console.error('[gateway] Fatal error:', err);
  process.exit(1);
});

// Helper to initialize DB - currently only for vector extension
// TODO: Make this more generic or move to a dedicated DB service
async function prepareDb() {
  if (!db || !pool) {
    console.log('[gateway] Skipping DB prep (no pool)');
    return;
  }
  try {
    await pool.query(INIT_SQL);
    console.log('[gateway] ✅ Vector DB ready');
  } catch (err) {
    if (err.message.includes('vector') || err.message.includes('extension')) {
      console.warn('[gateway] ⚠️ Vector extension unavailable - semantic search disabled');
      console.warn('[gateway] Upgrade Neon plan or pgvector version to enable');
    } else {
      console.error('[gateway] DB prep failed:', err.message);
    }
  }
}