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
const isDev = process.env.NODE_ENV !== 'production';
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
//  MAIN ASYNC BOOTSTRAP
//  ═══════════════════════════════════════════════════════════════════
(async function main() {
  // Startup assertion: Validate all strategy providers are registered
  try {
    assertStrategies();
  } catch (err) {
    console.error('❌ [gateway] Strategy provider validation failed:', err.message);
    process.exit(1);
  }
  
  const app = express();
  app.set('trust proxy', 1);

  // ═══════════════════════════════════════════════════════════════════
  // 1) HEALTH ENDPOINTS FIRST — No middleware before these!
  //    Cloud Run/Replit health probes MUST get instant 200 response
  //    Includes HEAD / for load balancers that probe via HEAD
  // ═══════════════════════════════════════════════════════════════════
  app.get('/', (_req, res) => res.status(200).send('OK'));
  app.head('/', (_req, res) => res.status(200).end());
  app.get('/health', (_req, res) => res.status(200).send('OK'));
  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, mode: MODE, port: PORT }));
  app.get('/ready', (_req, res) => res.status(200).send('OK'));
  app.get('/api/health', (_req, res) => res.status(200).json({ ok: true, port: PORT, mode: MODE }));

  // ═══════════════════════════════════════════════════════════════════
  // 2) CREATE SERVER AND START LISTENING IMMEDIATELY
  //    Health endpoints active before any route mounting
  // ═══════════════════════════════════════════════════════════════════
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ready] Server listening on 0.0.0.0:${PORT}`);
    console.log(`[ready] Health endpoints: /, /health, /healthz, /ready, /api/health`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3) MOUNT MIDDLEWARE AND ROUTES AFTER SERVER IS LISTENING
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
        console.error('[mono] FATAL: SDK embed failed:', e?.message || e);
        process.exit(1);
      }

      try {
        const { mountAgent } = await import('./server/agent/embed.js');
        mountAgent({ app, basePath: AGENT_PREFIX, wsPath: WS_PUBLIC_PATH, server });
        console.log(`[mono] ✓ Agent routes mounted at ${AGENT_PREFIX}, WS at ${WS_PUBLIC_PATH}`);
      } catch (e) {
        console.error('[mono] FATAL: Agent embed failed:', e?.message || e);
        process.exit(1);
      }

      // 404 JSON for unknown API routes (AFTER route mounting)
      app.use(API_PREFIX, (_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND', mode: 'mono' }));

      console.log(`🎉 [mono] Application fully initialized`);
      
      // Start triad worker for strategy generation
      import('./server/jobs/triad-worker.js').then(({ processTriadJobs }) => {
        processTriadJobs().catch(err => {
          console.error('[triad-worker] Worker crashed:', err.message);
        });
        console.log('[triad-worker] ✅ Strategy generation worker started');
      }).catch(err => {
        console.error('[triad-worker] Failed to start worker:', err.message);
      });
      
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

        // Proxy everything that's NOT a health/API route to Vite
        app.use((req, res, next) => {
          if (req.path === '/' || req.path === '/health' || req.path.startsWith('/api') || req.path.startsWith('/agent')) {
            return next(); // Skip proxy for health/API
          }
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
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        // Static files mounted at /app to avoid shadowing health endpoints
        app.use('/app', express.static(path.join(__dirname, 'client/dist')));
        app.get('/app/*', (req, res) => {
          res.sendFile(path.join(__dirname, 'client/dist/index.html'));
        });
        // Redirect non-health requests to /app for SPA
        app.get('*', (req, res, next) => {
          if (req.path === '/' || req.path === '/health' || req.path.startsWith('/api') || req.path.startsWith('/agent')) {
            return next();
          }
          res.redirect('/app');
        });
      }
    }

    //  ═══════════════════════════════════════════════════════════════════
    //  MODE B: SPLIT (Multi-Process - Production)
    //  ═══════════════════════════════════════════════════════════════════
    else {
    const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || PORT);
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

    // 3. Frontend (LAST)
    if (isDev) {
      const viteTarget = 'http://127.0.0.1:5173';
      app.use('/', (req, res) => {
        proxy.web(req, res, { target: viteTarget, changeOrigin: true });
      });
    } else {
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      app.use(express.static(path.join(__dirname, 'client/dist')));
      app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'client/dist/index.html'));
      });
    }

    // WebSocket upgrades
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = req.url || '/';

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

    server.listen(GATEWAY_PORT, '0.0.0.0', () => {
      console.log(`🚀 [split] Gateway listening on ${GATEWAY_PORT}`);
      console.log(`   proxy -> agent @ ${agentTarget}`);
      console.log(`   proxy -> sdk @ ${sdkTarget}`);
      if (isDev) console.log(`   proxy -> vite @ http://127.0.0.1:5173`);
    });
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