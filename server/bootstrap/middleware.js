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

  // 2026-03-17: SECURITY FIX (F-2) — CORS origin whitelist replaces reflect-all.
  // Previously `origin: true` reflected any origin with credentials, enabling CSRF.
  // Now only Replit deployment domains and localhost are allowed.
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, Siri Shortcuts, curl)
      if (!origin) return callback(null, true);
      // Check explicit whitelist from env
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow Replit domains (*.replit.dev, *.repl.co, *.replit.app) and localhost
      if (/\.(replit\.dev|repl\.co|replit\.app)$/.test(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // 2026-03-18: Allow production custom domain
      if (/^https?:\/\/(www\.)?vectopilot\.com$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true
  }));

  // Correlation ID middleware (before JSON parsing)
  try {
    const correlationPath = path.join(rootDir, 'server/middleware/correlation-id.js');
    const { correlationId } = await import(pathToFileURL(correlationPath).href);
    app.use(correlationId);
  } catch (e) {
    console.warn('[gateway] Correlation ID middleware not available:', e?.message);
  }

  // JSON body parsing for API and agent routes
  // Route-specific limits MUST come BEFORE the general /api rule — Express matches first matching middleware
  // 2026-02-17: /api/chat needs larger limit for base64 image attachments (vision/OCR)
  app.use('/api/chat', express.json({ limit: '10mb' }));
  // 2026-02-16: /api/hooks needs larger limit for base64 image payloads (Siri Vision shortcut)
  app.use('/api/hooks', express.json({ limit: '5mb' }));
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
