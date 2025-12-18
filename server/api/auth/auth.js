import { Router } from 'express';
import crypto from 'crypto';
import { authLog, OP } from '../../logger/workflow.js';

const router = Router();

// Environment checks
// REPLIT_DEPLOYMENT is only set during actual Replit deployments, not during development/preview
// NODE_ENV=production is set by Vite for optimization, but doesn't mean it's a real production deployment
// On Replit, we should only block token minting in actual deployments (REPLIT_DEPLOYMENT=1)
const IS_REPLIT = Boolean(process.env.REPL_ID || process.env.REPLIT_DB_URL);
const IS_PRODUCTION = IS_REPLIT
  ? process.env.REPLIT_DEPLOYMENT === '1'  // On Replit: only true deployments
  : process.env.NODE_ENV === 'production'; // Elsewhere: respect NODE_ENV

/**
 * POST /api/auth/token - Generate JWT token for user
 *
 * SECURITY: This endpoint allows token generation for any user_id.
 * In production, this is restricted to prevent impersonation attacks.
 *
 * Production behavior: Returns 403 Forbidden (tokens should come from proper auth flow)
 * Development behavior: Generates token for testing purposes
 *
 * TODO: Replace with proper OAuth/login flow when user auth is implemented
 */
router.post('/token', async (req, res) => {
  try {
    // SECURITY: Block token minting in production
    // This prevents arbitrary user impersonation
    if (IS_PRODUCTION) {
      authLog.warn(1, `Token minting blocked in production`);
      return res.status(403).json({
        error: 'token_minting_disabled',
        message: 'Token minting is disabled in production. Use proper authentication flow.'
      });
    }

    const { user_id } = req.body || req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }

    // Generate signed token: userId.signature
    const secret = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID || 'dev-secret-change-in-production';
    const signature = crypto.createHmac('sha256', secret).update(user_id).digest('hex');
    const token = `${user_id}.${signature}`;

    authLog.done(1, `[DEV] Generated token for user: ${user_id.substring(0, 20)}`);

    res.json({
      token,
      user_id,
      expires_in: 86400, // 24 hours
      _dev_warning: 'This endpoint is disabled in production'
    });
  } catch (err) {
    authLog.error(1, `Token generation failed`, err);
    res.status(500).json({ error: 'Token generation failed', detail: err.message });
  }
});

export default router;
