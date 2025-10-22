import { Request, Response, NextFunction } from 'express';

// JWT functions - simplified for now
function verifyAppToken(token: string) {
  // TODO: Implement proper JWT verification
  return { userId: 'user_' + Date.now() };
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