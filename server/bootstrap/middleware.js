// server/bootstrap/middleware.js
// Centralized middleware configuration for gateway-server.js

import cors from 'cors';
import helmet from 'helmet';
import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

/**
 * Configure security and parsing middleware
 * @param {Express} app - Express app
 */
export async function configureMiddleware(app) {
  // Bot blocker - FIRST, before any other processing
  try {
    const botBlockerPath = path.join(rootDir, 'server/middleware/bot-blocker.js');
    const { botBlocker } = await import(pathToFileURL(botBlockerPath).href);
    app.use(botBlocker);
    console.log('[gateway] ✅ Bot blocker enabled (full protection)');
  } catch (e) {
    console.warn('[gateway] Bot blocker not available:', e?.message);
  }

  // X-Robots-Tag header - prevent indexing at HTTP level
  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });

  // Helmet security headers (CSP disabled for SPA compatibility)
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS - allow all origins with credentials
  app.use(cors({ origin: true, credentials: true }));

  // Correlation ID middleware (before JSON parsing)
  try {
    const correlationPath = path.join(rootDir, 'server/middleware/correlation-id.js');
    const { correlationId } = await import(pathToFileURL(correlationPath).href);
    app.use(correlationId);
  } catch (e) {
    console.warn('[gateway] Correlation ID middleware not available:', e?.message);
  }

  // JSON body parsing for API and agent routes
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/agent', express.json({ limit: '1mb' }));

  console.log('[gateway] ✅ Middleware configured');
}

/**
 * Configure error handling middleware (must be mounted AFTER all routes)
 * @param {Express} app - Express app
 */
export async function configureErrorHandler(app) {
  try {
    console.log('[gateway] Loading error middleware...');
    const errorPath = path.join(rootDir, 'server/middleware/error-handler.js');
    const { errorTo503 } = await import(pathToFileURL(errorPath).href);
    app.use(errorTo503);
    console.log('[gateway] ✅ Error middleware configured');
    return true;
  } catch (e) {
    console.error('[gateway] ❌ Error middleware failed:', e?.message);
    return false;
  }
}
