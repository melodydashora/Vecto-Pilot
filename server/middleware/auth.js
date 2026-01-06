// server/middleware/auth.js
// Converted from auth.ts to JavaScript for Node.js compatibility
import crypto from 'crypto';
import { authLog } from '../logger/workflow.js';
import { db } from '../db/drizzle.js';
import { users } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

// 2026-01-05: Session TTL Constants (per SAVE-IMPORTANT.md)
const SESSION_SLIDING_WINDOW_MS = 60 * 60 * 1000;   // 60 min sliding window
const SESSION_HARD_LIMIT_MS = 2 * 60 * 60 * 1000;   // 2 hour absolute max

// JWT functions - basic implementation
function verifyAppToken(token) {
  // Security: Require JWT_SECRET in production
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';

  if (isProduction && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured in production');
  }

  // Use JWT_SECRET, fallback to Replit device ID for dev (unique per instance)
  const secret = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID;

  if (!secret) {
    throw new Error('No JWT_SECRET or REPLIT_DEVSERVER_INTERNAL_ID available for token verification');
  }
  
  try {
    // Simple token verification: token format is "userId.signature"
    const [userId, signature] = token.split('.');
    if (!userId || !signature) throw new Error('Invalid token format');
    
    // Verify signature
    const expectedSig = crypto.createHmac('sha256', secret).update(userId).digest('hex');
    if (signature !== expectedSig) throw new Error('Invalid signature');
    
    // Ensure userId exists and is not empty
    // Accept UUIDs (primary format), emails, and user- prefix formats
    if (!userId || userId.length < 8) {
      throw new Error('Invalid userId format');
    }
    
    // Token verified - no log needed (too noisy on every API call)
    return { userId, verified: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    authLog.error(1, `Token verification failed: ${errMsg}`);
    throw new Error('Invalid or expired token');
  }
}

function isPhantom(userId, tetherSig) {
  return false;
}

// Required auth - must have valid token AND active session
export async function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'no_token' });
    const payload = verifyAppToken(token);

    // 2026-01-05: Lazy session cleanup (per SAVE-IMPORTANT.md)
    // Check session validity on every authenticated request
    const now = Date.now();
    const userId = payload.userId;

    try {
      // Look up user's active session
      const [session] = await db.select()
        .from(users)
        .where(eq(users.user_id, userId))
        .limit(1);

      if (!session) {
        // No session row = user must re-login
        authLog.warn(1, `No session found for user ${userId.substring(0, 8)} - requires re-login`);
        return res.status(401).json({ error: 'session_expired', message: 'Session not found. Please log in again.' });
      }

      // 2026-01-06: Check for logged out state (session_id cleared by logout endpoint)
      if (!session.session_id) {
        authLog.warn(1, `Session invalid for user ${userId.substring(0, 8)} - session_id is null (logged out)`);
        return res.status(401).json({ error: 'session_expired', message: 'Session ended. Please log in again.' });
      }

      const lastActiveAt = session.last_active_at ? new Date(session.last_active_at).getTime() : 0;
      const sessionStartAt = session.session_start_at ? new Date(session.session_start_at).getTime() : 0;

      // Check 1: Hard limit (2 hours from session start - force re-login)
      if (now - sessionStartAt > SESSION_HARD_LIMIT_MS) {
        authLog.warn(1, `Session exceeded 2-hour limit for user ${userId.substring(0, 8)} - clearing session`);
        // 2026-01-06: CRITICAL FIX - Use UPDATE to clear session instead of DELETE!
        // DELETE was blocked by RESTRICT foreign keys on driver_profiles, auth_credentials, etc.
        // This caused users to NOT be signed out even though session expired.
        await db.update(users)
          .set({
            session_id: null,
            current_snapshot_id: null,
            updated_at: new Date()
          })
          .where(eq(users.user_id, userId));
        return res.status(401).json({ error: 'session_expired', message: 'Session expired (2-hour limit). Please log in again.' });
      }

      // Check 2: Sliding window (60 min from last activity)
      if (now - lastActiveAt > SESSION_SLIDING_WINDOW_MS) {
        authLog.warn(1, `Session timed out for user ${userId.substring(0, 8)} (inactive ${Math.round((now - lastActiveAt) / 60000)} min) - clearing session`);
        // 2026-01-06: CRITICAL FIX - Use UPDATE to clear session instead of DELETE!
        await db.update(users)
          .set({
            session_id: null,
            current_snapshot_id: null,
            updated_at: new Date()
          })
          .where(eq(users.user_id, userId));
        return res.status(401).json({ error: 'session_expired', message: 'Session expired due to inactivity. Please log in again.' });
      }

      // Session valid - update last_active_at to extend sliding window (non-blocking)
      db.update(users)
        .set({ last_active_at: new Date(), updated_at: new Date() })
        .where(eq(users.user_id, userId))
        .catch(err => console.warn('[auth] Failed to update last_active_at:', err.message));

      // Attach session info to request
      req.auth = {
        userId: payload.userId,
        sessionId: session.session_id,
        currentSnapshotId: session.current_snapshot_id,
        phantom: isPhantom(payload.userId, payload.tetherSig)
      };
    } catch (sessionErr) {
      // Database error checking session - log but allow request to proceed
      // This prevents a DB outage from blocking all authenticated requests
      console.error('[auth] Session check failed:', sessionErr.message);
      req.auth = { userId: payload.userId, phantom: isPhantom(payload.userId, payload.tetherSig) };
    }

    next();
  } catch (e) {
    res.status(401).json({ error: 'unauthorized', detail: e?.message });
  }
}

// Optional auth - allows requests with or without auth token
// If token is provided, it validates it. If not, request continues anyway.
// This supports both unauthenticated and authenticated flows.
export function optionalAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';

    // Debug: log request path and auth status
    const path = req.path || req.url || 'unknown';
    console.log(`[optionalAuth] ${path} - token: ${token ? 'present' : 'none'}`);

    if (token) {
      // Token provided - verify it
      try {
        const payload = verifyAppToken(token);
        req.auth = { userId: payload.userId, phantom: isPhantom(payload.userId, payload.tetherSig) };
        console.log(`[optionalAuth] ✅ Token verified for user ${payload.userId.slice(0, 8)}`);
      } catch (e) {
        authLog.warn(1, `Token provided but invalid: ${e?.message}`);
        console.log(`[optionalAuth] ❌ Token INVALID: ${e?.message} - returning 401`);
        // Token was provided but invalid - reject the request
        return res.status(401).json({ error: 'unauthorized', detail: e?.message });
      }
    } else {
      console.log(`[optionalAuth] No token - proceeding as anonymous`);
    }
    // Continue regardless of whether auth was provided or verified
    next();
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: e?.message });
  }
}
