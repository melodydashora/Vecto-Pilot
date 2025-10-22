// gateway-server.js
import http from 'node:http';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;
import { GATEWAY_CONFIG } from './agent-ai-config.js';

const isDev = process.env.NODE_ENV !== 'production';
const PORT = Number(process.env.PORT || 80);
const AGENT_PORT = Number(process.env.AGENT_PORT || 43717);
const SDK_PORT = Number(process.env.EIDOLON_PORT || 3101);

// Log AI config on boot
console.log('[gateway] AI Config:', GATEWAY_CONFIG);

const agentTarget = `http://127.0.0.1:${AGENT_PORT}`;
const sdkTarget = `http://127.0.0.1:${SDK_PORT}`;

// Child process tracking
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

// Async main function to handle child spawning and server startup
(async function main() {
  // Only spawn children in development or if not already running
  if (isDev && PORT !== SDK_PORT && PORT !== AGENT_PORT) {
    // Spawn SDK
    spawnChild('sdk', 'node', ['index.js'], { PORT: SDK_PORT });

    // Spawn Agent
    spawnChild('agent', 'node', ['agent-server.js'], { AGENT_PORT });

    // Spawn Vite dev server for client
    spawnChild('vite', 'npm', ['run', 'dev:client'], {});

    // Wait a bit for children to start
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Request logger - see what's hitting the gateway
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    console.log(`[gateway] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - t}ms`);
  });
  next();
});

// One proxy instance (HTTP + WS) with HTML guard for APIs
const proxy = createProxyServer({});
proxy.on('error', (err, req, res) => {
  const r = res;
  if (r && !r.headersSent) {
    r.statusCode = 502;
    r.setHeader('Content-Type', 'application/json');
    r.end(JSON.stringify({ ok: false, error: 'bad_gateway', detail: String(err?.message || err) }));
  }
});

// JSON guard - catch HTML leaking through API routes
proxy.on('proxyRes', (proxyRes, req, res) => {
  try {
    if (req.originalUrl.startsWith('/api')) {
      const ct = proxyRes.headers['content-type'] || '';
      if (ct.includes('text/html')) {
        console.error(`[gateway] WARNING: HTML detected for API route ${req.originalUrl} - allowing through (SDK may send correct response)`);
        // Don't block - SDK middleware may override content-type
        // Just log for diagnostics
      }
    }
  } catch (err) {
    console.error(`[gateway] proxyRes handler error:`, err.message);
  }
});

// Health check endpoints
app.get('/healthz', (_req, res) => res.json({ ok: true, gateway: true, t: new Date().toISOString() }));
app.get('/ready', (_req, res) => res.json({ ok: true }));
app.get('/sdk/healthz', (_req, res) => {
  proxy.web(_req, res, { target: sdkTarget, changeOrigin: true });
});
app.get('/agent/healthz', (_req, res) => {
  proxy.web(_req, res, { target: agentTarget, changeOrigin: true });
});

// Aggregate status endpoint for drivers and agent introspection
app.get('/status', async (_req, res) => {
  const status = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    gateway: { ok: true, port: PORT, config: GATEWAY_CONFIG },
    sdk: { ok: false, port: SDK_PORT, error: null },
    agent: { ok: false, port: AGENT_PORT, error: null },
    vite: { ok: false, port: 5173, error: null },
    memory: { diagnosticsAvailable: false }
  };

  // Check SDK
  try {
    const sdkRes = await fetch(`http://127.0.0.1:${SDK_PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
    status.sdk.ok = sdkRes.ok;
    if (!sdkRes.ok) status.sdk.error = `HTTP ${sdkRes.status}`;
  } catch (err) {
    status.sdk.error = err.message || 'unreachable';
  }

  // Check Agent
  try {
    const agentRes = await fetch(`http://127.0.0.1:${AGENT_PORT}/agent/health`, { signal: AbortSignal.timeout(2000) });
    status.agent.ok = agentRes.ok || agentRes.status === 401; // 401 is OK, just needs auth
    if (!agentRes.ok && agentRes.status !== 401) status.agent.error = `HTTP ${agentRes.status}`;
  } catch (err) {
    status.agent.error = err.message || 'unreachable';
  }

  // Check Vite (dev only)
  if (isDev) {
    try {
      const viteRes = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(2000) });
      status.vite.ok = viteRes.ok;
      if (!viteRes.ok) status.vite.error = `HTTP ${viteRes.status}`;
    } catch (err) {
      status.vite.error = err.message || 'unreachable';
    }
  } else {
    status.vite = { ok: true, note: 'production mode - using static build' };
  }

  // Check memory diagnostics availability
  try {
    const memRes = await fetch(`http://127.0.0.1:${SDK_PORT}/diagnostics/memory`, { signal: AbortSignal.timeout(1000) });
    if (memRes.ok) {
      const memData = await memRes.json();
      status.memory = { 
        diagnosticsAvailable: true, 
        recentPathsCount: memData.recent?.length || 0,
        service: 'sdk'
      };
    }
  } catch {
    status.memory = { diagnosticsAvailable: false, note: 'SDK memory endpoint unavailable' };
  }

  const allOk = status.gateway.ok && status.sdk.ok && status.agent.ok && status.vite.ok;
  res.status(allOk ? 200 : 503).json({ ...status, overall: allOk ? 'healthy' : 'degraded' });
});

// HTTP forwarding - ORDER MATTERS!
// 1. Agent routes
app.use('/agent', (req, res) => {
  req.url = req.originalUrl.replace(/^\/agent/, '') || '/';
  proxy.web(req, res, { target: agentTarget, changeOrigin: true });
});

// 2. SDK routes (API, assistant, diagnostics, websockets) - MUST BE BEFORE VITE
app.use(['/assistant', '/api', '/diagnostics', '/socket.io'], (req, res) => {
  proxy.web(req, res, { target: sdkTarget, changeOrigin: true });
});

// API 404 guard - ensure no routes fall through to Vite
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// 3. Frontend - Vite dev server or static files (MUST BE LAST)
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

// A single HTTP server that also owns the WS upgrades
const server = http.createServer(app);

// WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  try {
    const url = req.url || '/';

    if (url.startsWith('/agent')) {
      req.url = url.replace(/^\/agent/, '') || '/';
      proxy.ws(req, socket, head, { target: agentTarget, changeOrigin: true, ws: true });
      return;
    }

    if (url.startsWith('/assistant') || url.startsWith('/api') || url.startsWith('/socket.io')) {
      proxy.ws(req, socket, head, { target: sdkTarget, changeOrigin: true, ws: true });
      return;
    }

    // Proxy Vite HMR WebSocket in development
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [gateway] listening on ${PORT}`);
  console.log(`   proxy -> agent ws/http @ http://127.0.0.1:${AGENT_PORT}`);
  console.log(`   proxy -> sdk   ws/http @ http://127.0.0.1:${SDK_PORT}`);
  if (isDev) {
    console.log(`   proxy -> vite  ws/http @ http://127.0.0.1:5173`);
  }
  console.log(`   supervisor managing 3 child processes`);
});

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

// Prevent crashes from uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[gateway] UNCAUGHT EXCEPTION:', err);
  console.error('[gateway] Stack:', err.stack);
  // Don't exit - keep serving
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[gateway] UNHANDLED REJECTION at:', promise);
  console.error('[gateway] Reason:', reason);
  // Don't exit - keep serving
});

})().catch((err) => {
  console.error('[gateway] Fatal error:', err);
  process.exit(1);
});