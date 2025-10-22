// gateway-server.js — ESM gateway: single public port, supervised children, Vite in middleware mode with pinned HMR

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware as proxy } from 'http-proxy-middleware';
import http from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Import after env is loaded
import { loadAssistantPolicy } from './server/eidolon/policy-loader.js';
import { startMemoryCompactor } from './server/eidolon/memory/compactor.js';
import { memoryPut, memoryGet, memoryQuery } from './server/eidolon/memory/pg.js';

// Export functions for ML learning infrastructure
export async function rememberContext(scope, key, content, userId = null) {
  return memoryPut({
    table: 'assistant_memory',
    scope,
    key,
    userId,
    content,
    ttlDays: 30
  });
}

// Export vector search functions for semantic-search.js
export async function upsertDoc({ id, content, metadata, embedding }) {
  try {
    const embeddingStr = `[${embedding.join(',')}]`;
    await pool.query(
      `INSERT INTO documents (id, content, metadata, embedding) 
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT (id) 
       DO UPDATE SET content = $2, metadata = $3, embedding = $4::vector`,
      [id, content, metadata, embeddingStr]
    );
    return { success: true };
  } catch (error) {
    console.error('[vector] Upsert failed:', error.message);
    return { success: false, error: error.message };
  }
}

export async function knnSearch(embedding, k = 10) {
  try {
    const embeddingStr = `[${embedding.join(',')}]`;
    const result = await pool.query(
      `SELECT id, content, metadata, 
              embedding <=> $1::vector AS distance
       FROM documents
       ORDER BY distance
       LIMIT $2`,
      [embeddingStr, k]
    );
    return result.rows;
  } catch (error) {
    console.error('[vector] KNN search failed:', error.message);
    return [];
  }
}

// Export memory recall functions for ml-health.js
export async function recallContext(scope, key, userId = null) {
  return memoryGet({
    table: 'assistant_memory',
    scope,
    key,
    userId
  });
}

export async function searchMemory(scope, userId = null, limit = 50) {
  return memoryQuery({
    table: 'assistant_memory',
    scope,
    userId,
    limit
  });
}

// ---------- Ports (1 public, rest private) ----------
const GATEWAY_PORT = Number(process.env.PORT || 8080); // Replit assigns this (only public)
const SDK_PORT     = 3101;      // internal
const AGENT_PORT   = 43717;     // internal
const HMR_PORT     = 24700;     // internal HMR WS server
const HMR_PATH     = '/hmr';    // public WS path clients connect to
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ---------- Helpers ----------
const log  = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);
const err  = (...a) => console.error(...a);

// ---------- Vector DB setup (REQUIRED) ----------
if (!process.env.DATABASE_URL) {
  err('❌ [FATAL] DATABASE_URL is required. This system cannot run without a database.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const INIT_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536)
);
CREATE INDEX IF NOT EXISTS documents_embedding_idx
  ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`;

async function prepareDb() {
  try {
    await pool.query(INIT_SQL);
    await pool.query("ANALYZE documents;");
    log('[db] Vector DB ready ✅');
  } catch (error) {
    err('❌ [FATAL] Failed to prepare vector DB:', error.message);
    process.exit(1);
  }
}

// ---------- Port wait helper ----------
function waitForPort(port, host = '127.0.0.1', timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function retry() {
      const s = net.connect({ port, host }, () => { s.destroy(); resolve(true); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for ${host}:${port}`));
        setTimeout(retry, 250);
      });
    })();
  });
}

// ---------- Child process supervisor ----------
const children = new Map(); // Track children by label for proper cleanup

function spawnSupervised(label, cmd, args, { cwd, port }) {
  let restarting = false;
  let backoff = 750;
  let currentChild = null;
  
  const start = () => {
    // Kill any existing child for this label
    if (currentChild && !currentChild.killed) {
      log(`[${label}] Killing existing process before restart`);
      currentChild.kill('SIGTERM');
      currentChild = null;
    }
    
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),                  // child binds privately
      REPLIT_PUBLIC_PORT: String(GATEWAY_PORT), // optional: for logging
    };
    
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit', detached: false });
    currentChild = child;
    children.set(label, child);
    
    child.on('exit', (code, signal) => {
      warn(`[${label}] exited (code=${code}, signal=${signal})`);
      children.delete(label);
      
      // Don't restart if we're shutting down
      if (process.exitCode !== undefined) return;
      if (restarting) return;
      
      restarting = true;
      const delay = Math.min(backoff, 5000);
      warn(`[${label}] restarting in ${delay}ms...`);
      setTimeout(() => { 
        restarting = false; 
        backoff = Math.min(backoff * 2, 5000); 
        start(); 
      }, delay);
    });
    
    child.on('error', (error) => {
      err(`[${label}] spawn error:`, error.message);
      children.delete(label);
    });
  };
  
  start();
}

// ---------- Boot ----------
// Only run server code if this is the main module (not imported)
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  log('🚀 [gateway] Starting in', IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT', 'mode');
  log('🚀 [gateway] Port configuration:', { 
    Gateway: GATEWAY_PORT + ' (public)', 
    SDK: SDK_PORT, 
    Agent: AGENT_PORT, 
    HMR: HMR_PORT 
  });

  // Start internal services BEFORE routes
  if (!IS_PRODUCTION) {
    // Check if files exist and spawn with correct names
    const workspace = '/home/runner/workspace';
    
    if (fs.existsSync(path.join(workspace, 'index.js'))) {
      spawnSupervised('sdk', 'node', ['index.js'], { cwd: workspace, port: SDK_PORT });
    } else {
      warn('[gateway] index.js not found, SDK spawn skipped');
    }
    
    if (fs.existsSync(path.join(workspace, 'agent-server.js'))) {
      spawnSupervised('agent', 'node', ['agent-server.js'], { cwd: workspace, port: AGENT_PORT });
    } else {
      warn('[gateway] agent-server.js not found, Agent spawn skipped');
    }
  }
}

// ---------- App ----------
const app = express();
app.set('trust proxy', true);
// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: IS_PRODUCTION ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://www.google.com", "https://recaptcha.net"]
    }
  } : false // Disable CSP in development for easier debugging
}));
app.disable('x-powered-by');

// Rate limiting - configured for Replit environment
const limiter = rateLimit({ 
  windowMs: 60_000, 
  max: 300, 
  standardHeaders: true, 
  legacyHeaders: false,
  // Replit requires trust proxy, but we'll validate IP correctly
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  },
  keyGenerator: (req) => {
    // Use X-Forwarded-For in Replit environment
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
           req.connection.remoteAddress || 
           'unknown';
  }
});

app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true, gateway: 'healthy', port: GATEWAY_PORT });
});

// ---------- Production routes ----------
if (IS_PRODUCTION) {
  log('✅ [gateway] Production mode - loading API routes');
  
  const parseJson = express.json({ limit: '1mb', strict: true });
  
  // Load all production routes
  Promise.all([
    import('./server/routes/health.js'),
    import('./server/routes/blocks.js'),
    import('./server/routes/blocks-fast.js'),
    import('./server/routes/blocks-triad-strict.js'),
    import('./server/routes/location.js'),
    import('./server/routes/venues.js'),
    import('./server/routes/catalog.js'),
    import('./server/routes/candidates.js'),
    import('./server/routes/snapshots.js'),
    import('./server/routes/strategies.js'),
    import('./server/routes/rankings.js'),
    import('./server/routes/feedback.js'),
    import('./server/routes/actions.js'),
    import('./server/routes/ml-health.js'),
    import('./server/eidolon/memory.js'),
    import('./server/eidolon/assistant.js')
  ]).then(modules => {
    // Mount routes
    app.use('/api/health', modules[0].default);
    app.use('/api/blocks', modules[1].default);
    app.use('/api/blocks', modules[2].default);
    app.use('/api/blocks', modules[3].default);
    app.use('/api/location', modules[4].default);
    app.use('/api/venues', modules[5].default);
    app.use('/api/catalog', modules[6].default);
    app.use('/api/candidates', modules[7].default);
    app.use('/api/snapshots', modules[8].default);
    app.use('/api/strategies', modules[9].default);
    app.use('/api/rankings', modules[10].default);
    app.use('/api/feedback', modules[11].default);
    app.use('/api/actions', modules[12].default);
    app.use('/api/ml', modules[13].default);
    app.use('/api/memory', modules[14].default);
    app.use('/api/assistant', modules[15].default);
    
    log('✅ [gateway] All production routes loaded');
  }).catch(error => {
    err('❌ [gateway] Failed to load production routes:', error);
  });
  
  // Serve static build
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distDir = path.resolve(process.cwd(), 'dist');
  
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// ---------- Serve React build in development too ----------
// Check if dist exists and serve it even in dev mode
if (!IS_PRODUCTION) {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    log('✅ [gateway] Dev mode: Serving React build from', distDir);
    app.use(express.static(distDir));
    
    // SPA fallback for routes not handled by proxies
    app.get('*', (req, res, next) => {
      // Skip API and proxy routes
      if (req.path.startsWith('/api') || 
          req.path.startsWith('/assistant') || 
          req.path.startsWith('/agent') || 
          req.path.startsWith('/eidolon') ||
          req.path.startsWith('/health') ||
          req.path.startsWith('/ready')) {
        return next();
      }
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }
}

// ---------- Vite middleware (no HTTP port), HMR tunneled via /hmr ----------
let viteReady = false;
if (!IS_PRODUCTION) {
  (async () => {
    try {
      const { createServer } = await import('vite');
      const react = (await import('@vitejs/plugin-react')).default;
      
      const vite = await createServer({
        plugins: [react()],
        appType: 'custom',
        server: {
          middlewareMode: true,     // serve assets through Express
          hmr: {
            host: '127.0.0.1',      // internal WS host
            port: HMR_PORT,         // internal WS port
            clientPort: GATEWAY_PORT, // what the browser uses externally
            path: HMR_PATH,         // WS path on the public gateway
          },
        },
        root: path.resolve(process.cwd(), 'client'),
        resolve: {
          alias: {
            '@': path.resolve(process.cwd(), 'client', 'src'),
            '@shared': path.resolve(process.cwd(), 'shared'),
            '@assets': path.resolve(process.cwd(), 'attached_assets'),
          },
        },
      });
      
      app.use(vite.middlewares);
      viteReady = true;
      log(`[gateway] Vite middleware active — HMR ws ${HMR_PATH} -> 127.0.0.1:${HMR_PORT}`);
    } catch (e) {
      err('[gateway] Vite setup failed:', e);
    }
  })();
}

// ---------- Proxies (HTTP) ----------
if (!IS_PRODUCTION) {
  const p = (target) => proxy({ target, changeOrigin: true, ws: true, logLevel: 'warn' });
  
  app.use('/assistant', p(`http://127.0.0.1:${SDK_PORT}/api/assistant`));
  app.use('/eidolon',   p(`http://127.0.0.1:${SDK_PORT}`));
  app.use('/agent',     p(`http://127.0.0.1:${AGENT_PORT}/agent`));
  app.use('/api',       p(`http://127.0.0.1:${SDK_PORT}/api`));
  
  // NOTE: no catch-all needed; Vite middleware serves the app.
}

// Error handling
app.use((error, req, res, next) => {
  if (error?.code === 'ECONNABORTED') {
    if (!res.headersSent) res.status(499).end();
    return;
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'payload too large' });
  }
  err('[gateway] Error:', error);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'route_not_found', path: req.path });
});

// ---------- HTTP server + WS upgrades ----------
// Only create and start the server if this is the main module
let server;
if (isMainModule) {
  server = http.createServer(app);

  server.on('upgrade', (req, socket, head) => {
  const url = req.url || '/';
  
  // Vite HMR WS (public /hmr -> internal HMR_PORT)
  if (url.startsWith(HMR_PATH)) {
    return proxy({ target: `ws://127.0.0.1:${HMR_PORT}`, changeOrigin: true, ws: true }).upgrade(req, socket, head);
  }
  
  // Agent websockets
  if (url.startsWith('/agent')) {
    return proxy({ target: `ws://127.0.0.1:${AGENT_PORT}`, changeOrigin: true, ws: true }).upgrade(req, socket, head);
  }
  
  // SDK websockets
  if (url.startsWith('/assistant') || url.startsWith('/api') || url.startsWith('/socket.io')) {
    return proxy({ target: `ws://127.0.0.1:${SDK_PORT}`, changeOrigin: true, ws: true }).upgrade(req, socket, head);
  }
  
  socket.destroy(); // unknown upgrade path
});

server.listen(GATEWAY_PORT, '0.0.0.0', async () => {
  log(`🌐 [gateway] Server listening on 0.0.0.0:${GATEWAY_PORT}`);
  
  // Prepare vector DB
  await prepareDb();
  
  // Load assistant policy
  setImmediate(() => {
    try {
      log('[gateway] Loading assistant policy...');
      const policy = loadAssistantPolicy(process.env.ASSISTANT_POLICY_PATH || 'config/assistant-policy.json');
      app.set('assistantPolicy', policy);
      log('[gateway] Starting memory compactor...');
      startMemoryCompactor(policy);
      log('[gateway] Policy and memory compactor initialized');
    } catch (error) {
      warn('[gateway] Policy loading failed (non-critical):', error.message);
    }
  });
  
  if (!IS_PRODUCTION) {
    try {
      await Promise.allSettled([
        waitForPort(SDK_PORT).then(() => log(`✅ [gateway] SDK ready on ${SDK_PORT}`)),
        waitForPort(AGENT_PORT).then(() => log(`✅ [gateway] Agent ready on ${AGENT_PORT}`)),
        waitForPort(HMR_PORT).then(() => log(`✅ [gateway] HMR WS on ${HMR_PORT} (public at ${HMR_PATH})`)),
      ]);
      log('🌐 [gateway] Proxy map:');
      log(`  /assistant/*  -> http://127.0.0.1:${SDK_PORT}/api/assistant/*`);
      log(`  /eidolon/*    -> http://127.0.0.1:${SDK_PORT}/*`);
      log(`  /agent/*      -> http://127.0.0.1:${AGENT_PORT}/agent/*`);
      log(`  /api/*        -> http://127.0.0.1:${SDK_PORT}/api/*`);
      log(`  HMR WS        -> ws://127.0.0.1:${HMR_PORT} via ${HMR_PATH}`);
    } catch (e) {
      warn('⚠️  [gateway] Some backends not ready yet:', e?.message || e);
    }
  }
  
  if (process.env.REPL_ID) {
    log(`🌐 [gateway] Preview: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
  }
  });

  // ---------- Graceful shutdown ----------
  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    
    log('[gateway] Shutting down...');
    
    // Kill all child processes
    children.forEach((child, label) => {
      if (child && !child.killed) {
        log(`[gateway] Killing ${label}...`);
        child.kill('SIGTERM');
        
        // Force kill after 2 seconds if still alive
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 2000);
      }
    });
    
    // Give children time to exit before closing server
    setTimeout(() => {
      if (server) {
        server.close(() => {
          log('[gateway] Shutdown complete');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    }, 500);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', () => {
    // Final cleanup - kill any remaining children
    children.forEach((child) => {
      if (child && !child.killed) {
        child.kill('SIGKILL');
      }
    });
  });
} // Close isMainModule block

export default app;