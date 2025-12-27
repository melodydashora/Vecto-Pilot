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
