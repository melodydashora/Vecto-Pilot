// server/lib/auth/identity-policy.js
// 2026-09-10: Pure account-identity policy for the Google OAuth exchange and the
// registration error path (VP-003 / VP-004, Astra findings A3b, A3c, A4a, A4b, A4c —
// each verified against auth.js by an independent reader + skeptic on 2026-09-10).
//
// No DB, no Express: the route runs the lookups and applies the verdict returned
// here, so the policy is unit-testable without a database (tests/auth/identity-policy.test.js).
//
// Provenance: Claude-authored under Melody's 2026-09-10 delegation (claude_memory #387).
// The one product-level call made here — revoking an UNVERIFIED password when its
// account is adopted through a verified Google login — is reversible (set
// REVOKE_UNVERIFIED_PASSWORD_ON_GOOGLE_LINK to false) and is explained below.

/**
 * PostgreSQL unique_violation. drizzle-orm (0.4x) may surface the pg DatabaseError
 * directly or wrapped in DrizzleQueryError with the driver error as `cause`.
 */
export function isUniqueViolation(err) {
  return err?.code === '23505' || err?.cause?.code === '23505';
}

/**
 * Pre-hijack mitigation (A4c). A password account whose email was never verified
 * may have been created by someone who does NOT own the address. When the real
 * address owner later signs in with Google (Google verified the email), we link the
 * Google subject — and we must not leave the unverified password usable, or the
 * pre-registrant keeps a door into the address owner's account. The address owner
 * can always set a new password through the email-based reset flow.
 */
export const REVOKE_UNVERIFIED_PASSWORD_ON_GOOGLE_LINK = true;

/**
 * Decide what a verified Google login means for our account model.
 *
 * Subject first: the Google `sub` is the identity; email is only a secondary
 * matcher for linking a pre-existing password account.
 *
 * @param {object} args
 * @param {object|null} args.bySubject  driver_profiles row whose google_id === sub
 * @param {object|null} args.byEmail    driver_profiles row whose email === google email
 *                                      (only consulted when bySubject is null)
 * @param {string} args.sub             verified Google subject
 * @param {boolean} [args.byEmailHasPassword]  auth_credentials.password_hash is non-null for byEmail
 * @returns {{kind:'subject'|'link'|'conflict'|'new', profile:object|null, revokePassword:boolean, reason:string}}
 */
export function resolveGoogleIdentity({ bySubject, byEmail, sub, byEmailHasPassword = false }) {
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('resolveGoogleIdentity: Google subject is required');
  }

  if (bySubject) {
    return { kind: 'subject', profile: bySubject, revokePassword: false, reason: 'google_id matched' };
  }

  if (byEmail) {
    if (byEmail.google_id && byEmail.google_id !== sub) {
      // A4b: the email belongs to a profile already bound to ANOTHER Google subject.
      // Authenticating it would hand one Google identity another identity's account.
      return { kind: 'conflict', profile: byEmail, revokePassword: false, reason: 'email bound to a different google_id' };
    }
    const unverified = byEmail.email_verified !== true;
    const revokePassword = REVOKE_UNVERIFIED_PASSWORD_ON_GOOGLE_LINK && unverified && byEmailHasPassword === true;
    return {
      kind: 'link',
      profile: byEmail,
      revokePassword,
      reason: revokePassword
        ? 'email matched an unverified password account — linking and revoking the unproven password'
        : 'email matched — linking google_id',
    };
  }

  return { kind: 'new', profile: null, revokePassword: false, reason: 'no profile for subject or email' };
}
