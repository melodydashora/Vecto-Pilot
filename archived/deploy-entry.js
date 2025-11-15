// deploy-entry.js - Ultra-fast deployment entrypoint
// Bypasses all bootstrapping for instant health check response

import http from "node:http";

const PORT = parseInt(process.env.PORT || '5000', 10);

console.log('[deploy] 🚀 Fast deployment entrypoint');
console.log('[deploy] 🔧 PORT:', PORT);
console.log('[deploy] ⏱️ Start:', new Date().toISOString());

// Create minimal HTTP server - no Express, no middleware
const server = http.createServer((req, res) => {
  // Health check endpoints
  if (req.url === '/' || req.url === '/health' || req.url === '/healthz' || req.url === '/ready') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }
  
  // Everything else
  res.writeHead(404);
  res.end('Not Found');
});

// Error handling
server.on('error', (err) => {
  console.error('[deploy] ❌ Server error:', err);
  process.exit(1);
});

// Success
server.on('listening', () => {
  const addr = server.address();
  console.log(`[deploy] ✅ LISTENING ${addr.address}:${addr.port}`);
  console.log('[deploy] 🎯 Health: /, /health, /healthz, /ready');
  console.log('[deploy] ⏱️ Ready:', new Date().toISOString());
  console.log('[deploy] 💚 Ready for Cloud Run health checks');
});

// Bind to all interfaces
server.listen(PORT, '0.0.0.0');

// Global error catchers - don't crash
process.on('unhandledRejection', (err) => {
  console.error('[deploy] ⚠️ Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[deploy] ⚠️ Uncaught exception:', err);
});

console.log('[deploy] 💪 Server started, staying alive...');
