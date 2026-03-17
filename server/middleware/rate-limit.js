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
export const translationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute — supports conversational pace
  message: {
    ok: false,
    error: 'Translation rate limit exceeded. Please wait a moment before translating again.'
  },
  standardHeaders: true,
  // For hooks endpoint (no JWT): rate-limit by IP + device_id combo
  keyGenerator: (req) => {
    const deviceId = req.body?.device_id || 'unknown';
    return `${req.ip}-${deviceId}`;
  }
});

// Standard rate limiter for general endpoints
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: { 
    ok: false, 
    error: 'Too many requests. Please try again later.' 
  },
  standardHeaders: true,
  skip: (req) => req.path.includes('/health')
});
