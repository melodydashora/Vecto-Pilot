// server/api/auth/index.js - Barrel exports for auth routes
// Auth endpoints: JWT token generation and verification

export { default as authRouter } from './auth.js';

// Route summary:
// POST /api/auth/token - Generate JWT token (DEV ONLY - disabled in production)
