import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// JWT functions - basic implementation
function verifyAppToken(token: string) {
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
    console.error('[auth] Token verification failed:', error.message);
    throw new Error('Invalid or expired token');
  }
}

function isPhantom(userId: string, tetherSig?: string) {
  return false;
}

declare global {
  namespace Express {
    interface Request { 
      auth?: { userId: string; phantom: boolean } 
    }
  }
}

export function requireAuth(req: any, res: any, next: any) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'no_token' });
    const payload: any = verifyAppToken(token);
    req.auth = { userId: payload.userId, phantom: isPhantom(payload.userId, payload.tetherSig) };
    next();
  } catch (e: any) {
    res.status(401).json({ error: 'unauthorized', detail: e?.message });
  }
}