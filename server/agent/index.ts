// server/agent/index.ts
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';

const PORT  = Number(process.env.AGENT_PORT || 43717);
const TOKEN = process.env.AGENT_TOKEN || 'dev-token';

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Basic bearer auth for non-public routes
app.use((req, res, next) => {
  if (req.path.startsWith('/public')) return next();
  const ok = (req.headers.authorization || '') === `Bearer ${TOKEN}`;
  if (!ok) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  next();
});

// Health + simple echo route
app.get('/healthz', (_req, res) => res.json({ ok: true, agent: true, t: new Date().toISOString() }));
app.post('/op/echo', (req, res) => res.json({ ok: true, data: req.body ?? null }));

// One HTTP server that also owns WS
const server = http.createServer(app);

// WS lives at /ws (gateway will forward /agent/ws → /ws)
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '/';
  if (!url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  // (Optional) enforce auth/cookies at handshake here
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// Echo + keepalive pings
wss.on('connection', (ws) => {
  const pinger = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      try { ws.ping(); } catch {}
    }
  }, 15000);

  ws.on('message', (buf) => {
    let msg: any;
    try { msg = JSON.parse(String(buf)); } catch { msg = { raw: String(buf) }; }
    ws.send(JSON.stringify({ type: 'echo', received: msg }));
  });

  ws.on('close', () => clearInterval(pinger));
  ws.on('error', () => clearInterval(pinger));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🤖 [agent] listening on ${PORT} (HTTP + WS @ /ws)`);
});

server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[agent] EADDRINUSE on ${PORT}. Stop the other process or set AGENT_PORT.`);
    process.exit(1);
  } else {
    throw err;
  }
});