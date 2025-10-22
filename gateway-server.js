// gateway-server.js
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;

const PORT       = Number(process.env.PORT || process.env.GATEWAY_PORT || 80);
const AGENT_PORT = Number(process.env.AGENT_PORT || 43717);
const SDK_PORT   = Number(process.env.EIDOLON_PORT || 3101);

const agentTarget = `http://127.0.0.1:${AGENT_PORT}`;
const sdkTarget   = `http://127.0.0.1:${SDK_PORT}`;

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Basic healthz
app.get('/healthz', (_req, res) => res.json({ ok: true, gateway: true, t: new Date().toISOString() }));
app.get('/ready',   (_req, res) => res.json({ ok: true }));

// One proxy instance (HTTP + WS)
const proxy = createProxyServer({});
proxy.on('error', (err, req, res) => {
  // Don't crash the gateway if a target is down
  const r = res;
  if (r && !r.headersSent) {
    r.statusCode = 502;
    r.setHeader('Content-Type', 'application/json');
    r.end(JSON.stringify({ ok: false, error: 'bad_gateway', detail: String(err?.message || err) }));
  }
});

// HTTP forwarding
// /agent/* → Agent (strip /agent)
app.use('/agent', (req, res) => {
  req.url = req.originalUrl.replace(/^\/agent/, '') || '/';
  proxy.web(req, res, { target: agentTarget, changeOrigin: true });
});

// SDK & socket.io (if SDK is separate; safe if embedded as well)
app.use(['/assistant', '/api', '/socket.io'], (req, res) => {
  proxy.web(req, res, { target: sdkTarget, changeOrigin: true });
});

// A single HTTP server that also owns the WS upgrades
const server = http.createServer(app);

// WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  try {
    const url = req.url || '/';

    // Agent websockets: /agent/ws → forward to Agent's /ws
    if (url.startsWith('/agent')) {
      req.url = url.replace(/^\/agent/, '') || '/';
      proxy.ws(req, socket, head, { target: agentTarget, changeOrigin: true, ws: true });
      return;
    }

    // SDK/socket.io websockets
    if (url.startsWith('/assistant') || url.startsWith('/api') || url.startsWith('/socket.io')) {
      proxy.ws(req, socket, head, { target: sdkTarget, changeOrigin: true, ws: true });
      return;
    }

    // Unknown WS path → close
    socket.destroy();
  } catch {
    try { socket.destroy(); } catch {}
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [gateway] listening on ${PORT}`);
  console.log(`   proxy -> agent ws/http @ ${agentTarget}`);
  console.log(`   proxy -> sdk   ws/http @ ${sdkTarget}`);
});

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[gateway] Port ${PORT} in use`);
    process.exit(1);
  } else {
    throw err;
  }
});