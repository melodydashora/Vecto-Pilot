// server/bootstrap/middleware.js
// Centralized middleware configuration for gateway-server.js

import cors from 'cors';
import helmet from 'helmet';
import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// 2026-04-23: De-dup log noise when scanners hammer us with blocked origins.
// Set is per-process; acceptable since worst case is one log line per unique origin.
const blockedOriginSeen = new Set();

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

  // 2026-04-05: SECURITY — Enable CSP with SPA-compatible directives (CodeQL fix)
  // Previously disabled entirely; now allows inline styles (Vite/React), self scripts,
  // and required external domains for Google Maps, AI APIs, and analytics.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://maps.googleapis.com", "https://maps.gstatic.com", "https://*.ggpht.com", "https://places.googleapis.com"],
        connectSrc: ["'self'", "https://maps.googleapis.com", "https://places.googleapis.com", "https://routes.googleapis.com", "https://*.replit.dev", "https://*.replit.app", "wss://*.replit.dev", "wss://*.replit.app"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      }
    },
    // Ensure HSTS and X-Frame-Options are enabled (helmet defaults)
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));

  // 2026-03-17: SECURITY FIX (F-2) — CORS origin whitelist replaces reflect-all.
  // Previously `origin: true` reflected any origin with credentials, enabling CSRF.
  // Now only Replit deployment domains and localhost are allowed.
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

  // 2026-04-23: FIX — extracted origin-allow logic into a single predicate so both
  // the pre-middleware 403 short-circuit and the cors() callback share the same rules.
  // Previously the cors() callback called `callback(new Error(...))` for blocked
  // origins, which the cors package forwards via next(err), landing in the global
  // error handler and producing noisy 500s for attacker/scanner traffic. Now blocked
  // origins get a clean 403 at the edge and the cors() callback never throws.
  const isAllowedOrigin = (origin) => {
    // Allow requests with no origin (server-to-server, Siri Shortcuts, curl)
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    if (/\.(replit\.dev|repl\.co|replit\.app)$/.test(origin)) return true;
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
    // 2026-03-18: Allow production custom domain
    if (/^https?:\/\/(www\.)?vectopilot\.com$/.test(origin)) return true;
    return false;
  };

  // 2026-04-23: Pre-middleware — reject cross-origin requests from disallowed origins
  // with a proper 403 before they reach cors() or any route handler.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      // Log once per unique origin per process to avoid log spam under scanner floods.
      if (!blockedOriginSeen.has(origin)) {
        blockedOriginSeen.add(origin);
        console.warn(`[gateway] CORS blocked origin: ${origin} (${req.method} ${req.originalUrl})`);
      }
      return res.status(403).json({
        error: 'Origin not allowed',
        code: 'cors_blocked'
      });
    }
    next();
  });

  app.use(cors({
    // Callback never throws: allowed origins get CORS headers; blocked origins were
    // already handled by the pre-middleware above, so the `false` branch is only
    // reachable for no-origin / same-origin paths where CORS headers are simply omitted.
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true
  }));

  // 2026-04-05: SECURITY — Global rate limiting (CodeQL: missing rate limiting on 30+ routes)
  // Applied before JSON parsing to reject floods early and save CPU on body parsing.
  try {
    const rateLimitPath = path.join(rootDir, 'server/middleware/rate-limit.js');
    const { globalApiLimiter, healthLimiter } = await import(pathToFileURL(rateLimitPath).href);
    app.use('/api', globalApiLimiter);
    app.use('/api/health', healthLimiter);
    app.use('/api/ml-health', healthLimiter);
    app.use('/api/diagnostics', healthLimiter);
    app.use('/api/diagnostic', healthLimiter);
    console.log('[gateway] ✅ Global rate limiting enabled (100/min API, 200/min health)');
  } catch (e) {
    console.warn('[gateway] Rate limiting not available:', e?.message);
  }

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
