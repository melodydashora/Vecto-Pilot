// server/api/auth/index.js - Barrel exports for auth routes
// Auth endpoints: JWT token generation and verification

export { default as authRouter } from './auth.js';
// 2026-02-03: Uber OAuth and webhook integration
export { default as uberRouter } from './uber.js';

// Route summary:
// POST /api/auth/token - Generate JWT token (DEV ONLY - disabled in production)
// GET  /api/auth/uber - Initiates Uber OAuth flow
// GET  /api/auth/uber/callback - Handles OAuth callback
// POST /api/auth/uber/webhook - Receives Uber webhook events
