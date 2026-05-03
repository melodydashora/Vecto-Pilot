// server/lib/jwt.js
// Standard JWT helpers — AUTH-003 (Phase 1, HS256).
// Replaces the legacy custom HMAC `userId.signature` token with a 3-segment JWT
// containing sub/iat/exp/iss/aud claims. See docs/architecture/AUTH.md §2.
// Phase 2 (separate PR) will introduce RS256 with keypair management for
// third-party verifier integrations that should not hold the signing secret.

import { SignJWT, jwtVerify } from 'jose';

const JWT_ISSUER = 'vecto-pilot';
const JWT_AUDIENCE = 'vecto-pilot-api';
const JWT_TTL = '2h';
const JWT_ALG = 'HS256';

function getSecretKey() {
  const secret = process.env.JWT_SECRET || process.env.REPLIT_DEVSERVER_INTERNAL_ID;
  if (!secret) {
    throw new Error('JWT_SECRET (or REPLIT_DEVSERVER_INTERNAL_ID dev fallback) required for JWT signing/verification');
  }
  return new TextEncoder().encode(secret);
}

export async function signJWT({ sub }) {
  if (!sub || typeof sub !== 'string' || sub.length < 8) {
    throw new Error('signJWT: sub (userId) is required and must be a string of length >= 8');
  }
  const key = getSecretKey();
  return await new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(JWT_TTL)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .sign(key);
}

export async function verifyJWT(token) {
  const key = getSecretKey();
  const { payload } = await jwtVerify(token, key, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: [JWT_ALG],
  });
  if (!payload.sub) {
    throw new Error('verifyJWT: token missing sub claim');
  }
  return { userId: payload.sub, verified: true };
}

export const JWT_CONFIG = Object.freeze({
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  ttl: JWT_TTL,
  algorithm: JWT_ALG,
});
