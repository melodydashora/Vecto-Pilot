// server/middleware/auth.js
// Converted from auth.ts to JavaScript for Node.js compatibility
import crypto from 'crypto';

// JWT functions - basic implementation
function verifyAppToken(token) {
  // If no JWT_SECRET configured, generate from Device ID for development
  const secret = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID || 'dev-secret-change-in-production';
  
  try {
    // Simple token verification: token format is "userId.signature"
    const [userId, signature] = token.split('.');
    if (!userId || !signature) throw new Error('Invalid token format');
    
    // Verify signature
    const expectedSig = crypto.createHmac('sha256', secret).update(userId).digest('hex');
    if (signature !== expectedSig) throw new Error('Invalid signature');
    
    // Ensure userId exists and is not a timestamp-based fake
    if (!userId.startsWith('user-') && !userId.includes('@')) {
      throw new Error('Invalid userId format');
    }
    
    console.log('[auth] Token verified for user:', userId.substring(0, 20));
    return { userId, verified: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[auth] Token verification failed:', errMsg);
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
    
    if (token) {
      // Token provided - verify it
      try {
        const payload = verifyAppToken(token);
        req.auth = { userId: payload.userId, phantom: isPhantom(payload.userId, payload.tetherSig) };
      } catch (e) {
        console.warn('[auth] Token provided but invalid:', e?.message);
        // Token was provided but invalid - reject the request
        return res.status(401).json({ error: 'unauthorized', detail: e?.message });
      }
    }
    // Continue regardless of whether auth was provided or verified
    next();
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: e?.message });
  }
}
