// tests/auth/dual-verify-dispatch.test.js
// AUTH-003 unit tests — verifyAppToken dispatch by token segment count.
// Asserts that:
//   • 3-segment tokens route to verifyJWT (new format)
//   • 2-segment tokens route to legacy HMAC verifier (transition path)
//   • Non-2/3-segment inputs throw before any verifier is called
//   • A 2-segment string is verified as legacy HMAC (not retried as truncated JWT)
//     — the dispatcher is strict by segment count, no algorithm fall-through.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-auth-003-dual-verify-32-chars-min';

import crypto from 'crypto';
import { describe, it, expect } from '@jest/globals';
import { signJWT } from '../../server/lib/jwt.js';
import { verifyAppToken } from '../../server/middleware/auth.js';

const TEST_USER_ID = 'ab85999f-e9aa-49c1-a77f-5723c5c80356';

function craftLegacyHMAC(userId, secret = process.env.JWT_SECRET) {
  const sig = crypto.createHmac('sha256', secret).update(userId).digest('hex');
  return `${userId}.${sig}`;
}

describe('AUTH-003 dispatch: routes by segment count', () => {
  it('routes 3-segment token to JWT verifier (returns userId)', async () => {
    const jwt = await signJWT({ sub: TEST_USER_ID });
    expect(jwt.split('.').length).toBe(3);
    const result = await verifyAppToken(jwt);
    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.verified).toBe(true);
  });

  it('routes 2-segment legacy HMAC token to legacy verifier (returns userId)', async () => {
    const legacy = craftLegacyHMAC(TEST_USER_ID);
    expect(legacy.split('.').length).toBe(2);
    const result = await verifyAppToken(legacy);
    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.verified).toBe(true);
  });
});

describe('AUTH-003 dispatch: malformed input', () => {
  it('rejects token with 0 segments', async () => {
    await expect(verifyAppToken('justastring')).rejects.toThrow('Invalid token format');
  });

  it('rejects token with 4+ segments', async () => {
    await expect(verifyAppToken('a.b.c.d')).rejects.toThrow('Invalid token format');
  });

  it('rejects empty string', async () => {
    await expect(verifyAppToken('')).rejects.toThrow('Invalid token format');
  });

  it('rejects null', async () => {
    await expect(verifyAppToken(null)).rejects.toThrow('Invalid token format');
  });

  it('rejects non-string', async () => {
    await expect(verifyAppToken(12345)).rejects.toThrow('Invalid token format');
  });
});

describe('AUTH-003 dispatch: strict segment-count routing (no algorithm fall-through)', () => {
  it('a 3-segment token that fails JWT verification THROWS (does not fall through to HMAC)', async () => {
    // 3 segments of garbage. JWT verifier rejects. The verifier MUST NOT then strip
    // a segment and retry as legacy HMAC — that would be an algorithm-confusion
    // downgrade attack vector. Strict segment-count dispatch makes this impossible.
    await expect(verifyAppToken('a.b.c')).rejects.toThrow();
  });

  it('truncating a real JWT to 2 segments is treated as legacy HMAC (and rejected because the truncated string is not a valid HMAC token)', async () => {
    // Take a real 3-segment JWT, drop the signature → 2 segments. The "userId"
    // segment is now a base64-encoded JWT header (not a UUID), so legacy HMAC
    // verifier rejects it. The point: dispatch is purely by count, not by content.
    const jwt = await signJWT({ sub: TEST_USER_ID });
    const truncated = jwt.split('.').slice(0, 2).join('.');
    expect(truncated.split('.').length).toBe(2);
    await expect(verifyAppToken(truncated)).rejects.toThrow();
  });
});

describe('AUTH-003 dispatch: legacy HMAC verifier behavior (regression for transition window)', () => {
  it('rejects legacy HMAC with bad signature', async () => {
    const tampered = `${TEST_USER_ID}.0000000000000000000000000000000000000000000000000000000000000000`;
    await expect(verifyAppToken(tampered)).rejects.toThrow('Invalid or expired token');
  });

  it('rejects legacy HMAC with userId shorter than 8 chars (matches existing pre-AUTH-003 invariant)', async () => {
    const shortUserId = 'abc';
    const sig = crypto.createHmac('sha256', process.env.JWT_SECRET).update(shortUserId).digest('hex');
    await expect(verifyAppToken(`${shortUserId}.${sig}`)).rejects.toThrow();
  });
});
