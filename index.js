// BOOT PROOF — must appear in supervisor logs (ESM version)
try {
  console.log('[index] BOOT MARK', new Date().toISOString(), {
    cwd: process.cwd(),
    path: import.meta.url,
    argv: process.argv,
    node: process.version,
    pid: process.pid,
  });
} catch (e) {
  console.log('[index] BOOT MARK (fallback)', new Date().toISOString(), e?.message);
}

import http from 'node:http';

function getArg(name){const p=`--${name}=`, a=process.argv.find(s=>s.startsWith(p)); return a? a.slice(p.length):undefined;}
const PORT = Number(getArg('port') || process.env.EIDOLON_PORT || process.env.SDK_PORT || 3102); // SDK port, NOT 5000
const HOST = getArg('host') || process.env.HOST || '0.0.0.0'; // CRITICAL: Must be 0.0.0.0 for Cloud Run

// Log port/host immediately (removed process.env.PORT to prevent binding to gateway's port)
console.log('[index] CONFIG:', { PORT, HOST, EIDOLON_PORT: process.env.EIDOLON_PORT, 'process.env.PORT': process.env.PORT });

function responder(req, res) {
  const u = req.url || '/';
  if (req.method === 'HEAD' && (u === '/' || u === '/health')) { res.statusCode = 200; res.end(); return; }
  if (req.method === 'GET'  && (u === '/' || u === '/health' || u === '/ready')) {
    res.statusCode = 200; res.setHeader('Content-Type','text/plain'); res.end('OK'); return;
  }
  res.statusCode = 200; res.setHeader('Content-Type','text/plain'); res.end('OK');
}

const server = http.createServer(responder);
server.requestTimeout = 5000;
server.headersTimeout  = 6000;
server.keepAliveTimeout = 5000;

server.on('error', (err) => {
  console.error('[index] LISTEN ERROR:', err.code, err.message);
  if (err.code === 'EADDRINUSE') {
    console.error('[index] Port', PORT, 'already in use - FATAL');
    process.exit(1);
  }
});

server.on('listening', () => {
  const a = server.address();
  const where = a && typeof a === 'object' ? `${a.address}:${a.port}` : String(a);
  console.log('[index] LISTENING', where);
  console.log('[index] ✅ Health probe ready - answering GET/HEAD on /, /health, /ready');
});

console.log('[index] About to listen on', HOST, PORT);
server.listen(PORT, HOST);

// Defer heavy stuff; swap to real app after we're listening
setImmediate(async () => {
  try {
    console.log('[index] Starting lazy module loading...');
    
    // Lazy import AFTER listen so health is already green
    const { default: express } = await import('express');
    const app = express();
    app.set('trust proxy', 1);
    
    // Fast-path health probes (even after swap)
    app.get('/', (_q,r)=>r.status(200).send('OK'));
    app.head('/', (_q,r)=>r.status(200).end());
    app.get('/health', (_q,r)=>r.status(200).send('OK'));
    app.head('/health', (_q,r)=>r.status(200).end());
    app.get('/ready', (_q,r)=>r.status(200).send('READY'));
    
    // Probe logging
    app.use((req, _res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && 
          (req.path === '/' || req.path === '/health' || req.path === '/ready')) {
        console.log(`[probe] ${req.method} ${req.path}`);
      }
      next();
    });
    
    console.log('[index] Loading full SDK routes and middleware...');
    
    // Dynamic imports for all heavy dependencies
    const [
      { default: cors },
      { loggingMiddleware },
      { securityMiddleware },
      { default: healthRoutes },
      { default: locationRoutes },
      { default: actionsRoutes },
      { default: researchRoutes },
      { default: feedbackRoutes },
      { default: diagnosticsRoutes },
      { default: venueEventsRoutes },
      { default: snapshotRoutes },
      { default: jobMetricsRoutes },
      { default: mlHealthRoutes },
      { default: chatRoutes },
      { default: authRoutes },
      { default: intelligenceRoutes },
    ] = await Promise.all([
      import('cors'),
      import('./server/middleware/logging.js'),
      import('./server/middleware/security.js'),
      import('./server/api/health/health.js'),
      import('./server/api/location/location.js'),
      import('./server/api/feedback/actions.js'),
      import('./server/api/research/research.js'),
      import('./server/api/feedback/feedback.js'),
      import('./server/api/health/diagnostics.js'),
      import('./server/api/venue/venue-events.js'),
      import('./server/api/location/snapshot.js'),
      import('./server/api/health/job-metrics.js'),
      import('./server/api/health/ml-health.js'),
      import('./server/api/chat/chat.js'),
      import('./server/api/auth/auth.js'),
      import('./server/api/intelligence/index.js'),
    ]);
    
    // Mount middleware
    app.use(cors());
    app.use(loggingMiddleware);
    app.use(securityMiddleware);
    
    // Mount API routes
    app.use('/api/health', healthRoutes);
    app.use('/api/location', locationRoutes);
    app.use('/api/actions', actionsRoutes);
    app.use('/api/research', researchRoutes);
    app.use('/api/feedback', feedbackRoutes);
    app.use('/api/diagnostics', diagnosticsRoutes);
    app.use('/api/venue-events', venueEventsRoutes);
    app.use('/api/snapshot', snapshotRoutes);
    app.use('/api/job-metrics', jobMetricsRoutes);
    app.use('/api/ml-health', mlHealthRoutes);
    app.use('/api/chat', chatRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/intelligence', intelligenceRoutes);
    
    // Quick status endpoint
    app.get("/api/copilot", (_req, res) => {
      res.json({
        ok: true,
        status: "active",
        copilot: "Eidolon Enhanced SDK",
        capabilities: [
          "smart_recommendations",
          "location_aware_routing",
          "earnings_optimization",
          "real_time_analytics",
        ],
        timestamp: new Date().toISOString(),
      });
    });
    
    // 404 handler
    app.use((req, res) => {
      console.warn('[SDK 404]', req.method, req.originalUrl);
      res.status(404).json({ error: 'not found' });
    });
    
    // Hot-swap request handler from shim -> Express
    server.removeAllListeners('request');
    server.on('request', app);
    console.log('[index] SWAPPED to Express handler');
    console.log('[index] ✅ Full application loaded and ready');
    
  } catch (e) {
    console.error('[index] post-listen init failed:', e);
    console.error('[index] Health probes still active, but routes unavailable');
  }
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`[index] ${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('[index] Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

["SIGTERM", "SIGINT", "SIGQUIT"].forEach((sig) => {
  process.on(sig, () => gracefulShutdown(sig));
});

process.on("uncaughtException", (err) => {
  console.error("[index] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[index] Unhandled rejection:", reason);
});
