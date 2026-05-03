// tests/auth/jwt-helpers.test.js
// AUTH-003 unit tests — signJWT / verifyJWT round-trip + claim validation + tamper detection.
// Uses real `jose` for crafting edge-case tokens (expired, wrong issuer, wrong algorithm).

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-auth-003-jwt-helpers-32-chars-min';

import { describe, it, expect } from '@jest/globals';
import { SignJWT } from 'jose';
import { signJWT, verifyJWT, JWT_CONFIG } from '../../server/lib/jwt.js';

const TEST_USER_ID = 'ab85999f-e9aa-49c1-a77f-5723c5c80356';

function getKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

describe('AUTH-003 jwt-helpers: round-trip', () => {
  it('signs + verifies a valid token (sub round-trips)', async () => {
    const token = await signJWT({ sub: TEST_USER_ID });
    const result = await verifyJWT(token);
    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.verified).toBe(true);
  });

  it('produces a 3-segment JWT (header.payload.signature)', async () => {
    const token = await signJWT({ sub: TEST_USER_ID });
    expect(token.split('.').length).toBe(3);
  });

  it('rejects tampered signature segment', async () => {
    const token = await signJWT({ sub: TEST_USER_ID });
    const [h, p, sig] = token.split('.');
    const flippedSig = sig.split('').reverse().join('');
    await expect(verifyJWT(`${h}.${p}.${flippedSig}`)).rejects.toThrow();
  });

  it('rejects tampered payload (different sub) when signature is original', async () => {
    const token = await signJWT({ sub: TEST_USER_ID });
    const [h, _p, sig] = token.split('.');
    const evilPayload = Buffer.from(JSON.stringify({
      sub: 'attacker-id-99999',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7200,
      iss: JWT_CONFIG.issuer,
      aud: JWT_CONFIG.audience,
    })).toString('base64url');
    await expect(verifyJWT(`${h}.${evilPayload}.${sig}`)).rejects.toThrow();
  });
});

describe('AUTH-003 jwt-helpers: signJWT input validation', () => {
  it('rejects empty sub', async () => {
    await expect(signJWT({ sub: '' })).rejects.toThrow();
  });

  it('rejects undefined sub', async () => {
    await expect(signJWT({})).rejects.toThrow();
  });

  it('rejects non-string sub', async () => {
    await expect(signJWT({ sub: 12345 })).rejects.toThrow();
  });

  it('rejects sub shorter than 8 chars', async () => {
    await expect(signJWT({ sub: 'short' })).rejects.toThrow();
  });
});

describe('AUTH-003 jwt-helpers: verifyJWT claim validation', () => {
  it('rejects expired token (exp in past)', async () => {
    const key = getKey();
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER_ID)
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 60)
      .setIssuer(JWT_CONFIG.issuer)
      .setAudience(JWT_CONFIG.audience)
      .sign(key);
    await expect(verifyJWT(expired)).rejects.toThrow();
  });

  it('rejects token with wrong issuer', async () => {
    const key = getKey();
    const wrongIss = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER_ID)
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer('attacker-app')
      .setAudience(JWT_CONFIG.audience)
      .sign(key);
    await expect(verifyJWT(wrongIss)).rejects.toThrow();
  });

  it('rejects token with wrong audience', async () => {
    const key = getKey();
    const wrongAud = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER_ID)
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer(JWT_CONFIG.issuer)
      .setAudience('attacker-api')
      .sign(key);
    await expect(verifyJWT(wrongAud)).rejects.toThrow();
  });

  it('rejects token signed with wrong algorithm (HS512 vs expected HS256)', async () => {
    // Algorithm-confusion attack defense: jose accepts whatever alg the header
    // declares unless we pin algorithms. server/lib/jwt.js pins to [HS256].
    const key = getKey();
    const wrongAlg = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(TEST_USER_ID)
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer(JWT_CONFIG.issuer)
      .setAudience(JWT_CONFIG.audience)
      .sign(key);
    await expect(verifyJWT(wrongAlg)).rejects.toThrow();
  });

  it('rejects token missing sub claim', async () => {
    const key = getKey();
    const noSub = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')
      .setIssuer(JWT_CONFIG.issuer)
      .setAudience(JWT_CONFIG.audience)
      .sign(key);
    await expect(verifyJWT(noSub)).rejects.toThrow();
  });

  it('rejects malformed token (4 segments)', async () => {
    await expect(verifyJWT('a.b.c.d')).rejects.toThrow();
  });
});

describe('AUTH-003 jwt-helpers: JWT_CONFIG sanity', () => {
  it('exposes the expected immutable config', () => {
    expect(JWT_CONFIG.issuer).toBe('vecto-pilot');
    expect(JWT_CONFIG.audience).toBe('vecto-pilot-api');
    expect(JWT_CONFIG.algorithm).toBe('HS256');
    expect(JWT_CONFIG.ttl).toBe('2h');
    expect(Object.isFrozen(JWT_CONFIG)).toBe(true);
  });
});
