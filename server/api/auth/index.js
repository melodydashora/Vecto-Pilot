// server/api/auth/index.js - Barrel exports for auth routes
// Auth endpoints: JWT token generation and verification
// 2026-09-13: Uber OAuth router removed (no Uber API relationship exists).

export { default as authRouter } from './auth.js';

// Route summary:
// POST /api/auth/token - Generate JWT token (DEV ONLY - disabled in production)
