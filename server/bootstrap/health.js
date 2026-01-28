// server/bootstrap/health.js
// Consolidated health endpoint configuration
// Eliminates the 3x duplicate health route mounting from original gateway-server.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

/**
 * Configure all health endpoints (mounted ONCE, early in startup)
 * @param {Express} app - Express app
 * @param {string} distDir - Path to client dist directory
 * @param {string} mode - Application mode
 */
export function configureHealthEndpoints(app, distDir, mode) {
  // Primary health check - verifies SPA is ready
  app.get('/healthz', (_req, res) => {
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.json({
        ok: true,
        spa: 'ready',
        mode,
        ts: Date.now(),
      });
    }
    return res.status(503).json({
      ok: false,
      spa: 'missing',
      mode,
      ts: Date.now(),
    });
  });

  // Fast health probes for load balancers
  app.get('/health', (_req, res) => res.status(200).send('OK'));
  app.get('/ready', (_req, res) => res.status(200).send('READY'));

  // HEAD variants for minimal overhead checks
  app.head('/health', (_req, res) => res.status(200).end());
  app.head('/ready', (_req, res) => res.status(200).end());

  console.log('[gateway] ✅ Health endpoints configured (/health, /ready, /healthz)');
}

/**
 * Mount the health router from server/api/health/health.js
 * @param {Express} app - Express app
 */
export async function mountHealthRouter(app) {
  try {
    const healthPath = path.join(rootDir, 'server/api/health/health.js');
    const { default: healthRouter } = await import(pathToFileURL(healthPath).href);
    app.use('/api/health', healthRouter);
    console.log('[gateway] ✅ Health API router mounted at /api/health');
    return true;
  } catch (e) {
    console.error('[gateway] ❌ Health router failed:', e?.message);
    return false;
  }
}
