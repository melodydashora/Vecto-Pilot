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
    console.log('[GATEWAY] Bot blocker enabled (full protection)');
  } catch (e) {
    console.warn('[GATEWAY] Bot blocker not available:', e?.message);
  }

  // X-Robots-Tag header - prevent indexing at HTTP level
  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });

  // 2026-04-05: SECURITY — Enable CSP with SPA-compatible directives (CodeQL fix)
  // Previously disabled entirely; now allows inline styles (Vite/React), self scripts,
  // and required external domains for Google Maps, AI APIs, and analytics.
  //
  // 2026-04-26 PHASE B follow-through: Google Maps Platform mapId-based vector
  // tiles need FOUR things the original CSP blocked. Each was found by an
  // explicit DevTools console error after the prior fix unblocked the next
  // layer:
  //
  //   1. workerSrc 'self' blob: — Google's WebGL renderer spawns Web Workers
  //      from blob: URLs to draw vector tiles. Without this, the map shows pins
  //      on a grey void (markers are plain DOM and unaffected; tiles aren't).
  //
  //   2. connectSrc wildcard for *.googleapis.com — map style resources for a
  //      Cloud Console mapId come from mapsresources-pa.googleapis.com, which
  //      the previous explicit subdomain list (maps/places/routes) did not
  //      cover. Collapsing to a wildcard here is appropriate because (a) we
  //      already trust Google with the API key, (b) all *.googleapis.com hosts
  //      are first-party Google services, and (c) Phase D/E/F may add more
  //      Google APIs — wildcard avoids whack-a-mole subdomain maintenance.
  //
  //   3. scriptSrc 'unsafe-eval' — Google's shared-label-worker.js compiles
  //      WebAssembly via WebAssembly.instantiateStreaming() to render street
  //      names smoothly. CSP3 has 'wasm-unsafe-eval' as a tighter alternative
  //      (allows WASM without enabling general eval), but Google's own Maps
  //      Platform CSP docs canonically recommend 'unsafe-eval'. We don't have
  //      independent verification that the Maps SDK doesn't use eval()
  //      elsewhere, so shipping the verified-working flag now. Future hardening
  //      could attempt 'wasm-unsafe-eval' alone after a real test pass.
  //
  //   4. connectSrc 'data:' — Google Maps packages tiny text icon and font
  //      sprites as base64 data: URIs to load them inline without extra network
  //      round-trips. connect-src enforces these as if they were network
  //      requests; without 'data:' allowed, label sprites fail to load.
  //
  //   5. mediaSrc 'self' data: blob: (added 2026-04-27, Coach Pass 2 Phase B)
  //      Coach TTS (client/src/hooks/useTTS.ts) does two things the implicit
  //      default-src 'self' was blocking, which caused the audio element to
  //      throw NotSupportedError and silently fall back to
  //      window.speechSynthesis (OS robotic voice, not OpenAI TTS-1-HD):
  //        (a) warmUp() loads a silent data:audio/wav;base64,... buffer to
  //            unlock the audio element inside the user-gesture; data: required.
  //        (b) speak() fetches /api/tts, wraps the response in blob:https://...
  //            via URL.createObjectURL, and assigns it to audio.src; blob: required.
  //      Without media-src declared, CSP falls back to default-src ('self'
  //      only), which forbids both. Diagnosed via DevTools console errors
  //      that explicitly cited "Loading media from 'data:audio/wav;base64,...'
  //      violates ... default-src 'self'".
  //
  // Diagnostic process: after each restart the previously-blocked layer
  // unblocked, exposing the next CSP error in the console. Phase B's commit
  // history (b7b1c7f5 → c765ce22 → e371c757 → THIS) is the audit trail.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://maps.googleapis.com", "https://maps.gstatic.com", "https://*.ggpht.com", "https://places.googleapis.com"],
        mediaSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "data:", "https://*.googleapis.com", "https://*.replit.dev", "https://*.replit.app", "wss://*.replit.dev", "wss://*.replit.app"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      }
    },
    // Ensure HSTS and X-Frame-Options are enabled (helmet defaults)
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));

  // 2026-04-25: Permissions-Policy — scope browser feature access for monetization
  // and for upcoming Coach voice work. Helmet 8 doesn't set this directly.
  //
  //   microphone=(self):  Coach voice tab needs mic. Strategy and other tabs do NOT.
  //   camera=():          no camera access anywhere (deny).
  //   geolocation=(self): Strategy/Snapshot needs GPS.
  //   payment=():         deny. Flip to ('self') when Stripe ships.
  //   usb=(), bluetooth=(), midi=(): hard-deny.
  //   display-capture=(), clipboard-read=(): hard-deny (no screen-share, no clip-read).
  //   clipboard-write=(self): allow copy actions in Coach answers.
  //   fullscreen=(self):  allow fullscreen for Map / Coach driving mode.
  app.use((req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'microphone=(self), camera=(), geolocation=(self), payment=(), usb=(), bluetooth=(), midi=(), display-capture=(), clipboard-read=(), clipboard-write=(self), fullscreen=(self)'
    );
    next();
  });

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
        console.warn(`[GATEWAY] CORS blocked origin: ${origin} (${req.method} ${req.originalUrl})`);
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
    const { globalApiLimiter, healthLimiter, realtimeMintLimiter } = await import(pathToFileURL(rateLimitPath).href);
    app.use('/api', globalApiLimiter);
    app.use('/api/health', healthLimiter);
    app.use('/api/ml-health', healthLimiter);
    app.use('/api/diagnostics', healthLimiter);
    app.use('/api/diagnostic', healthLimiter);
    // 2026-04-25 (helmet-hardening): each /api/realtime/token call mints a
    // billable OpenAI client_secret. 5/min/user is generous for legit voice
    // session starts; anything above is bug or abuse.
    app.use('/api/realtime/token', realtimeMintLimiter);
    console.log('[GATEWAY] Global rate limiting enabled (100/min API, 200/min health, 5/min realtime mint)');
  } catch (e) {
    console.warn('[GATEWAY] Rate limiting not available:', e?.message);
  }

  // Correlation ID middleware (before JSON parsing)
  try {
    const correlationPath = path.join(rootDir, 'server/middleware/correlation-id.js');
    const { correlationId } = await import(pathToFileURL(correlationPath).href);
    app.use(correlationId);
  } catch (e) {
    console.warn('[GATEWAY] Correlation ID middleware not available:', e?.message);
  }

  // JSON body parsing for API and agent routes
  // Route-specific limits MUST come BEFORE the general /api rule — Express matches first matching middleware
  // 2026-02-17: /api/chat needs larger limit for base64 image attachments (vision/OCR)
  app.use('/api/chat', express.json({ limit: '10mb' }));
  // 2026-02-16: /api/hooks needs larger limit for base64 image payloads (Siri Vision shortcut)
  app.use('/api/hooks', express.json({ limit: '5mb' }));
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/agent', express.json({ limit: '1mb' }));

  console.log('[GATEWAY] Middleware configured');
}

/**
 * Configure error handling middleware (must be mounted AFTER all routes)
 * @param {Express} app - Express app
 */
export async function configureErrorHandler(app) {
  try {
    console.log('[GATEWAY] Loading error middleware...');
    const errorPath = path.join(rootDir, 'server/middleware/error-handler.js');
    const { errorTo503 } = await import(pathToFileURL(errorPath).href);
    app.use(errorTo503);
    console.log('[GATEWAY] Error middleware configured');
    return true;
  } catch (e) {
    console.error('[GATEWAY] Error middleware failed:', e?.message);
    return false;
  }
}
