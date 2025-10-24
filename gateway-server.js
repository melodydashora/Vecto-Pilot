// gateway-server.js - MONO + SPLIT capable
import http from 'node:http';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;
import { GATEWAY_CONFIG } from './agent-ai-config.js';

//  ═══════════════════════════════════════════════════════════════════
//  MODE DETECTION - Single Source of Truth
//  ═══════════════════════════════════════════════════════════════════
const MODE = (process.env.APP_MODE || 'mono').toLowerCase(); // 'mono' | 'gateway'
const isDev = process.env.NODE_ENV !== 'production';
const DISABLE_SPAWN_SDK = process.env.DISABLE_SPAWN_SDK === '1';
const DISABLE_SPAWN_AGENT = process.env.DISABLE_SPAWN_AGENT === '1';

// Ports - Use 5000 as default to match .env.example and tests
const PORT = Number(process.env.PORT || 5000);
const AGENT_PORT = Number(process.env.AGENT_PORT || 43717);
const SDK_PORT = Number(process.env.EIDOLON_PORT || process.env.SDK_PORT || 3102);

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
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  
  // Global timeout middleware
  const { timeoutMiddleware } = await import('./server/middleware/timeout.js');
  app.use(timeoutMiddleware);

  // Request logger
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
      console.log(`[gateway] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - t}ms`);
    });
    next();
  });

  // Health endpoints (ALWAYS available) - Respond immediately for deployment health checks
  app.get('/health', (_req, res) => res.status(200).send('OK'));
  app.get('/healthz', (_req, res) => res.json({ ok: true, mode: MODE, t: new Date().toISOString() }));
  app.get('/ready', (_req, res) => res.json({ ok: true, mode: MODE }));
  app.get('/diagnostics/memory', (_req, res) => res.json(process.memoryUsage()));
  app.post('/diagnostics/prefs', express.json(), (req, res) => res.json({ ok: true, set: req.body || {} }));
  app.post('/diagnostics/session', express.json(), (req, res) => res.json({ ok: true, phase: req.body?.phase ?? 'unknown' }));

  const server = http.createServer(app);

  //  ═══════════════════════════════════════════════════════════════════
  //  MODE A: MONO (Single Process - Replit-safe)
  //  ═══════════════════════════════════════════════════════════════════
  if (MODE === 'mono') {
    console.log(`[mono] Starting MONO mode on port ${PORT}`);

    // Start server FIRST for fast health checks, then mount routes
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🟢 [mono] Listening on 0.0.0.0:${PORT} (HTTP+WS)`);
      console.log(`   Health checks ready at /health and /healthz`);
    });

    // Mount SDK and Agent AFTER server starts (lazy loading)
    setImmediate(async () => {
      try {
        const createSdkRouter = (await import('./sdk-embed.js')).default;
        const sdkRouter = createSdkRouter({ API_PREFIX });
        app.use(API_PREFIX, sdkRouter);
        console.log(`[mono] ✓ SDK mounted at ${API_PREFIX}`);
      } catch (e) {
        console.warn('[mono] SDK embed failed:', e?.message || e);
      }

      try {
        const { mountAgent } = await import('./server/agent/embed.js');
        mountAgent({ app, basePath: AGENT_PREFIX, wsPath: WS_PUBLIC_PATH, server });
        console.log(`[mono] ✓ Agent mounted at ${AGENT_PREFIX}, WS at ${WS_PUBLIC_PATH}`);
      } catch (e) {
        console.warn('[mono] Agent embed failed:', e?.message || e);
      }
    });

    // 404 JSON for unknown API routes
    app.use(API_PREFIX, (_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND', mode: 'mono' }));

    // Vite or static files (LAST)
    if (isDev) {
      const viteTarget = 'http://127.0.0.1:5173';
      const proxy = createProxyServer({});
      proxy.on('error', (err) => console.error('[mono] Vite proxy error:', err.message));
      
      // Spawn Vite (unless disabled)
      if (!process.env.DISABLE_SPAWN_VITE) {
        spawnChild('vite', 'npm', ['run', 'dev:client'], {});
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      app.use('/', (req, res) => {
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
      app.use(express.static(path.join(__dirname, 'client/dist')));
      app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'client/dist/index.html'));
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

  // Common error handlers
  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[gateway] Port ${PORT} in use`);
      process.exit(1);
    } else {
      throw err;
    }
  });

  // Cleanup on exit
  process.on('SIGTERM', () => {
    console.log('🛑 [gateway] Shutting down...');
    children.forEach((child) => child.kill());
    server.close(() => process.exit(0));
  });

  // Prevent crashes
  process.on('uncaughtException', (err) => {
    console.error('[gateway] UNCAUGHT EXCEPTION:', err);
    console.error('[gateway] Stack:', err.stack);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[gateway] UNHANDLED REJECTION at:', promise);
    console.error('[gateway] Reason:', reason);
  });

})().catch((err) => {
  console.error('[gateway] Fatal error:', err);
  process.exit(1);
});
