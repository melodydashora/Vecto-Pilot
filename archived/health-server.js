// health-server.js - ULTRA-MINIMAL health-only server for autoscale
// This is the absolute simplest possible server - no imports, no dependencies

import { createServer } from 'node:http';

const PORT = parseInt(process.env.PORT || '5000', 10);

console.log('[health] 🚀 Ultra-minimal health server starting');
console.log('[health] 📍 PORT:', PORT);
console.log('[health] ⏱️  Start:', new Date().toISOString());

const server = createServer((req, res) => {
  const start = Date.now();
  
  // Log every request
  console.log(`[health] 📥 ${req.method} ${req.url}`);
  
  // Respond to ANY request with 200 OK
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-cache'
  });
  res.end('OK');
  
  const duration = Date.now() - start;
  console.log(`[health] ✅ Responded in ${duration}ms`);
});

server.on('error', (err) => {
  console.error('[health] ❌ Server error:', err);
});

server.on('listening', () => {
  console.log(`[health] ✅ LISTENING on 0.0.0.0:${PORT}`);
  console.log('[health] 🎯 Responding to ALL requests with 200 OK');
  console.log('[health] ⏱️  Ready:', new Date().toISOString());
});

server.listen(PORT, '0.0.0.0');

console.log('[health] 💚 Server configured, binding...');
