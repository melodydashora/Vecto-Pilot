// ISSUE #24 FIX: Rate limiting middleware for expensive endpoints
import rateLimit from 'express-rate-limit';

// Rate limiter for expensive AI endpoints (blocks-fast, briefing generation)
export const expensiveEndpointLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: { 
    ok: false, 
    error: 'Too many requests to expensive endpoint. Please wait a moment before trying again.' 
  },
  standardHeaders: true, // Return rate limit info in headers
  skip: (req) => {
    // Allow health checks and auth endpoints to bypass
    return req.path.includes('/health') || req.path.includes('/auth');
  }
});

// Stricter rate limiter for chat/streaming endpoints (highest cost)
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 requests per minute for chat
  message: { 
    ok: false, 
    error: 'Chat request limit exceeded. Please wait before sending another message.' 
  },
  standardHeaders: true,
  skip: (req) => req.path.includes('/health')
});

// 2026-03-17: Translation-specific limiter — more generous than expensiveEndpointLimiter
// because real-time conversation can need 20-30 translations in a 15-min ride.
// 2026-03-18: FIX — Disabled keyGeneratorIpFallback validation to avoid ERR_ERL_KEY_GEN_IPV6.
// express-rate-limit v7 throws if req.ip is used directly without ipKeyGenerator helper.
export const translationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute — supports conversational pace
  message: {
    ok: false,
    error: 'Translation rate limit exceeded. Please wait a moment before translating again.'
  },
  standardHeaders: true,
  validate: { keyGeneratorIpFallback: false },
  // For hooks endpoint (no JWT): rate-limit by IP + device_id combo
  keyGenerator: (req) => {
    const deviceId = req.body?.device_id || 'unknown';
    return `${req.ip}-${deviceId}`;
  }
});

// 2026-04-05: SECURITY — Global rate limiter for all /api routes (CodeQL: missing rate limiting)
// Applied in server/bootstrap/middleware.js on all /api/* routes.
// Per-route limiters (expensiveEndpointLimiter, chatLimiter) are stricter overrides.
export const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: {
    ok: false,
    error: 'Too many requests. Please try again later.'
  },
  standardHeaders: true,
  validate: { keyGeneratorIpFallback: false },
  skip: (req) => {
    // Health/diagnostic endpoints have their own higher-limit limiter
    return req.path.startsWith('/health') || req.path.startsWith('/ml-health') ||
           req.path.startsWith('/diagnostics') || req.path.startsWith('/diagnostic');
  }
});

// Higher-limit rate limiter for health/monitoring endpoints (200 req/min)
export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: {
    ok: false,
    error: 'Health check rate limit exceeded.'
  },
  standardHeaders: true,
  validate: { keyGeneratorIpFallback: false },
});

// 2026-04-25: Stricter limit for endpoints that mint billable OpenAI tokens.
// 5 mints/min per user is generous for legit voice-session start; anything
// beyond is bug or abuse. Keys by req.auth.userId when available (post-auth)
// and falls back to req.ip for pre-auth attempts (which auth itself rejects,
// but limiting unauthenticated floods to the route is still cheap insurance).
// validate.keyGeneratorIpFallback=false matches the existing pattern in this
// file — express-rate-limit v7 throws ERR_ERL_KEY_GEN_IPV6 on raw req.ip
// without that flag.
export const realtimeMintLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => req.auth?.userId || req.ip,
  message: { error: 'realtime_rate_limited', message: 'Too many voice-session starts. Slow down.' },
});
