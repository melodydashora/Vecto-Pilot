// tests/auth/identity-policy.test.js
// 2026-09-10: Pure policy tests for the Google identity resolution + unique-violation
// mapping introduced for VP-003 / VP-004. No database, no network.

import { describe, it, expect } from '@jest/globals';
import {
  isUniqueViolation,
  resolveGoogleIdentity,
  REVOKE_UNVERIFIED_PASSWORD_ON_GOOGLE_LINK,
} from '../../server/lib/auth/identity-policy.js';

const SUB = 'google-sub-111';
const OTHER_SUB = 'google-sub-222';

describe('isUniqueViolation', () => {
  it('recognises a raw pg unique_violation and a drizzle-wrapped one', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ message: 'wrapped', cause: { code: '23505' } })).toBe(true);
  });
  it('does not match other errors, nulls, or foreign-key violations', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe('resolveGoogleIdentity', () => {
  it('requires a subject', () => {
    expect(() => resolveGoogleIdentity({ bySubject: null, byEmail: null, sub: '' })).toThrow(/subject is required/);
  });

  it('subject match wins, regardless of any email row (A4a: subject first)', () => {
    const bySubject = { id: 'p1', google_id: SUB, email: 'a@x.test', email_verified: true };
    const v = resolveGoogleIdentity({ bySubject, byEmail: { id: 'p2', google_id: null }, sub: SUB });
    expect(v.kind).toBe('subject');
    expect(v.profile).toBe(bySubject);
    expect(v.revokePassword).toBe(false);
  });

  it('no subject, no email → new account', () => {
    const v = resolveGoogleIdentity({ bySubject: null, byEmail: null, sub: SUB });
    expect(v.kind).toBe('new');
    expect(v.profile).toBeNull();
  });

  it('email bound to a DIFFERENT google subject → conflict, never authenticate (A4b)', () => {
    const byEmail = { id: 'p2', google_id: OTHER_SUB, email: 'a@x.test', email_verified: true };
    const v = resolveGoogleIdentity({ bySubject: null, byEmail, sub: SUB });
    expect(v.kind).toBe('conflict');
    expect(v.revokePassword).toBe(false);
  });

  it('email matched a VERIFIED password account → plain link, password kept', () => {
    const byEmail = { id: 'p2', google_id: null, email: 'a@x.test', email_verified: true };
    const v = resolveGoogleIdentity({ bySubject: null, byEmail, sub: SUB, byEmailHasPassword: true });
    expect(v.kind).toBe('link');
    expect(v.revokePassword).toBe(false);
  });

  it('email matched an UNVERIFIED password account → link AND revoke the unproven password (A4c)', () => {
    const byEmail = { id: 'p2', google_id: null, email: 'a@x.test', email_verified: false };
    const v = resolveGoogleIdentity({ bySubject: null, byEmail, sub: SUB, byEmailHasPassword: true });
    expect(v.kind).toBe('link');
    expect(v.revokePassword).toBe(REVOKE_UNVERIFIED_PASSWORD_ON_GOOGLE_LINK);
  });

  it('email matched an unverified account with NO password (google-only or reset) → link, nothing to revoke', () => {
    const byEmail = { id: 'p2', google_id: null, email: 'a@x.test', email_verified: false };
    const v = resolveGoogleIdentity({ bySubject: null, byEmail, sub: SUB, byEmailHasPassword: false });
    expect(v.kind).toBe('link');
    expect(v.revokePassword).toBe(false);
  });

  it('email row already bound to the SAME subject is a link no-op, not a conflict', () => {
    // Reachable only if the subject lookup was skipped; the policy must still be safe.
    const byEmail = { id: 'p2', google_id: SUB, email: 'a@x.test', email_verified: true };
    const v = resolveGoogleIdentity({ bySubject: null, byEmail, sub: SUB });
    expect(v.kind).toBe('link');
  });
});
