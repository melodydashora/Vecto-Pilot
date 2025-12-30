// server/middleware/auth.js
// Converted from auth.ts to JavaScript for Node.js compatibility
import crypto from 'crypto';
import { authLog } from '../logger/workflow.js';

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

// Required auth - must have valid token
export function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'no_token' });
    const payload = verifyAppToken(token);
    req.auth = { userId: payload.userId, phantom: isPhantom(payload.userId, payload.tetherSig) };
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
