// gateway-server.js
import http from 'node:http';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;

const isDev = process.env.NODE_ENV !== 'production';
const PORT = Number(process.env.PORT || 80);
const AGENT_PORT = Number(process.env.AGENT_PORT || 43717);
const SDK_PORT = Number(process.env.EIDOLON_PORT || 3101);

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

// Basic healthz
app.get('/healthz', (_req, res) => res.json({ ok: true, gateway: true, t: new Date().toISOString() }));
app.get('/ready', (_req, res) => res.json({ ok: true }));

// One proxy instance (HTTP + WS)
const proxy = createProxyServer({});
proxy.on('error', (err, req, res) => {
  const r = res;
  if (r && !r.headersSent) {
    r.statusCode = 502;
    r.setHeader('Content-Type', 'application/json');
    r.end(JSON.stringify({ ok: false, error: 'bad_gateway', detail: String(err?.message || err) }));
  }
});

// HTTP forwarding
app.use('/agent', (req, res) => {
  req.url = req.originalUrl.replace(/^\/agent/, '') || '/';
  proxy.web(req, res, { target: agentTarget, changeOrigin: true });
});

app.use(['/assistant', '/api', '/socket.io'], (req, res) => {
  proxy.web(req, res, { target: sdkTarget, changeOrigin: true });
});

// Proxy to Vite dev server in development, serve static in production
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