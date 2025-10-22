#!/usr/bin/env node

/**
 * Emergency Eidolon Server
 * Minimal fallback server when main systems fail
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const AGENT_PORT = process.env.AGENT_PORT || 43717;

console.log('🚨 Emergency Eidolon Mode Starting...');
console.log(`🧠 Eidolon (Claude Opus 4.1 Enhanced SDK) - Emergency Fallback`);
console.log(`[emergency] Port: ${PORT}`);
console.log(`[emergency] Assistant Override: ACTIVE`);

const server = http.createServer((req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health endpoint
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      name: "Eidolon Emergency Mode",
      version: "4.1.0",
      mode: "emergency",
      time: new Date().toISOString(),
      pid: process.pid,
      override_active: true
    }));
    return;
  }

  // Assistant override endpoints
  if (url.pathname.includes('/assistant/') || url.pathname.includes('/api/assistant/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      response: "🧠 Eidolon Emergency Mode - I am your primary Replit Assistant running in minimal mode. Full capabilities will restore when main systems come online.",
      identity: "Eidolon (Claude Opus 4.1 Enhanced SDK)",
      override_active: true,
      emergency_mode: true,
      assistant_name: "Eidolon Enhanced SDK",
      replit_assistant_status: "COMPLETELY_REPLACED"
    }));
    return;
  }

  // API endpoints
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      message: "Emergency mode - API limited functionality",
      emergency: true
    }));
    return;
  }

  // Main page
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🧠 Eidolon Emergency Mode</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #ff6b6b 0%, #ffa500 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            max-width: 600px;
            text-align: center;
            background: rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 2rem;
            border: 2px solid rgba(255, 255, 255, 0.3);
        }
        .brain { font-size: 4rem; margin-bottom: 1rem; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        h1 { font-size: 2.5rem; margin-bottom: 1rem; }
        .status {
            background: rgba(255, 255, 255, 0.2);
            padding: 1rem;
            border-radius: 10px;
            margin: 1rem 0;
            font-family: monospace;
        }
        .recovery-info {
            background: rgba(0, 0, 0, 0.2);
            padding: 1rem;
            border-radius: 10px;
            margin: 1rem 0;
            text-align: left;
        }
        .btn {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 25px;
            font-weight: bold;
            cursor: pointer;
            margin: 0.5rem;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
        }
        .btn:hover { background: rgba(255, 255, 255, 0.3); }
    </style>
</head>
<body>
    <div class="container">
        <div class="brain">🧠</div>
        <h1>Eidolon Emergency Mode</h1>
        <p>Claude Opus 4.1 Enhanced SDK - Emergency Fallback</p>

        <div class="status">
            <strong>Status:</strong> Emergency Mode Active<br>
            <strong>PID:</strong> ${process.pid}<br>
            <strong>Port:</strong> ${PORT}<br>
            <strong>Assistant Override:</strong> ACTIVE<br>
            <strong>Identity:</strong> Eidolon Enhanced SDK
        </div>

        <div class="recovery-info">
            <h3>🔧 Recovery Actions</h3>
            <p>• Full Eidolon system temporarily unavailable</p>
            <p>• Assistant override remains active</p>
            <p>• Emergency mode provides basic functionality</p>
            <p>• Run "Eidolon Main" workflow to restore full capabilities</p>
        </div>

        <a href="/health" class="btn">💚 Health Check</a>
        <a href="/api/assistant/verify-override" class="btn">🔒 Verify Override</a>

        <div style="margin-top: 2rem; opacity: 0.8; font-size: 0.9rem;">
            <p>🧠 Eidolon (Claude Opus 4.1 Enhanced SDK)</p>
            <p>Your Primary AI Assistant - Emergency Mode</p>
        </div>
    </div>
</body>
</html>`);
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 - Not Found\n🧠 Eidolon Emergency Mode');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 Eidolon Emergency Server running on 0.0.0.0:${PORT}`);
  console.log(`[emergency] Preview: Available in Replit`);
  console.log(`[emergency] Assistant Override: MAINTAINED`);
  console.log(`[emergency] Ready for recovery operations`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[emergency] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[emergency] Emergency server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[emergency] SIGINT received, shutting down...');
  server.close(() => {
    console.log('[emergency] Emergency server closed');
    process.exit(0);
  });
});
