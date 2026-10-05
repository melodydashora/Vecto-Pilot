import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { auth_login_attempts, users, driver_profiles, driver_vehicles } from '../../../shared/schema.js';
import { sessionIsLive } from './session-policy.js';
import { signJWT } from '../jwt.js';
import { driverProfileResponse } from '../driver-profile-response.js';

export const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const validRecoveryProof = proof => typeof proof === 'string' && /^[a-f0-9]{64}$/.test(proof);
export class LoginAttemptError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function proofHash(proof) {
  if (!validRecoveryProof(proof)) throw new LoginAttemptError(400, 'invalid_recovery_proof', 'A valid sign-in recovery proof is required.');
  return createHash('sha256').update(proof).digest('hex');
}
const pending = () => ({ status: 202, body: { error: 'login_pending', message: 'Sign-in has not finished. Check again or cancel this attempt.' } });
const terminal = () => ({ status: 410, body: { error: 'login_attempt_ended', message: 'This sign-in attempt has ended. Please sign in again.' } });
const attemptWhere = attempt => and(eq(auth_login_attempts.proof_hash, attempt.proof_hash), eq(auth_login_attempts.attempt_id, attempt.attempt_id));
const lockAttempt = (tx, hash) => tx.select().from(auth_login_attempts).where(eq(auth_login_attempts.proof_hash, hash)).for('update').limit(1);

export async function beginLoginAttempt(db, proof, method) {
  const hash = proofHash(proof);
  if (!['password', 'google'].includes(method)) throw new Error('Invalid login attempt method');
  return db.transaction(async tx => {
    const now = new Date();
    const [created] = await tx.insert(auth_login_attempts).values({ proof_hash: hash, attempt_id: randomUUID(),
      method, status: 'processing', created_at: now, expires_at: new Date(now.getTime() + LOGIN_ATTEMPT_WINDOW_MS) })
      .onConflictDoNothing({ target: auth_login_attempts.proof_hash }).returning();
    const [attempt] = created ? [created] : await lockAttempt(tx, hash);
    return { attempt, claimed: Boolean(created) };
  });
}

// Authentication/provider work happens before this short final transaction.
// All finalization, recovery and cancellation acquire the attempt before users.
export async function withLoginAttempt(db, attempt, callback) {
  return db.transaction(async tx => {
    if (attempt) {
      const [current] = await lockAttempt(tx, attempt.proof_hash);
      if (!current || current.attempt_id !== attempt.attempt_id || current.status !== 'processing' ||
          new Date(current.expires_at).getTime() <= Date.now()) {
        throw new LoginAttemptError(410, 'login_attempt_ended', 'This sign-in attempt has ended. Please sign in again.');
      }
    }
    return callback(tx);
  });
}

export async function completeLoginAttempt(tx, attempt, { userId, sessionId, isNewUser = false, passwordRevoked = false }) {
  if (!attempt) return;
  if (new Date(attempt.expires_at).getTime() <= Date.now()) {
    throw new LoginAttemptError(410, 'login_attempt_ended', 'This sign-in attempt has ended. Please sign in again.');
  }
  await tx.update(auth_login_attempts).set({ status: 'completed', user_id: userId, session_id: sessionId,
    is_new_user: isNewUser, password_revoked: passwordRevoked }).where(attemptWhere(attempt));
}

export async function failLoginAttempt(db, attempt) {
  if (!attempt) return;
  await db.update(auth_login_attempts).set({ status: 'failed' })
    .where(and(attemptWhere(attempt), eq(auth_login_attempts.status, 'processing')));
}

export async function recoverLoginAttempt(db, proof) {
  const hash = proofHash(proof);
  return db.transaction(async tx => {
    const [attempt] = await lockAttempt(tx, hash);
    // The original HTTP request may not have arrived yet. Missing is not proof
    // it failed; only explicit cancellation can make abandoning the proof safe.
    if (!attempt) return pending();
    if (attempt.status === 'processing') {
      if (new Date(attempt.expires_at).getTime() > Date.now()) return pending();
      await tx.update(auth_login_attempts).set({ status: 'failed' }).where(attemptWhere(attempt));
      return terminal();
    }
    if (attempt.status !== 'completed') return terminal();
    const [session] = await tx.select().from(users).where(eq(users.user_id, attempt.user_id)).for('update').limit(1);
    if (!session || session.session_id !== attempt.session_id || !sessionIsLive(session) ||
        Math.floor(new Date(session.session_start_at).getTime() / 1000) + 7200 <= Math.floor(Date.now() / 1000)) return terminal();
    const profile = await tx.query.driver_profiles.findFirst({ where: eq(driver_profiles.user_id, attempt.user_id) });
    if (!profile) return terminal();
    const vehicle = await tx.query.driver_vehicles.findFirst({ where: and(eq(driver_vehicles.driver_profile_id, profile.id),
      eq(driver_vehicles.is_primary, true), eq(driver_vehicles.is_active, true)) });
    const token = await signJWT({ sub: attempt.user_id, sid: attempt.session_id, issuedAt: session.session_start_at });
    return { status: 200, body: { ok: true, token, recovered: true,
      ...(attempt.method === 'google' && { isNewUser: attempt.is_new_user, passwordRevoked: attempt.password_revoked }),
      ...driverProfileResponse(profile, vehicle, attempt.session_id) } };
  });
}

export async function cancelLoginAttempt(db, proof) {
  const hash = proofHash(proof);
  return db.transaction(async tx => {
    const now = new Date();
    await tx.insert(auth_login_attempts).values({ proof_hash: hash, attempt_id: randomUUID(), method: 'cancel',
      status: 'cancelled', created_at: now, expires_at: new Date(now.getTime() + LOGIN_ATTEMPT_WINDOW_MS) })
      .onConflictDoNothing({ target: auth_login_attempts.proof_hash });
    const [attempt] = await lockAttempt(tx, hash);
    if (attempt.status === 'completed') {
      // Conditional UPDATE takes the same owner lock. A delayed cancellation
      // cannot revoke a different session that has since been established.
      await tx.update(users).set({ session_id: null, current_snapshot_id: null, current_main_run_id: null, updated_at: now })
        .where(and(eq(users.user_id, attempt.user_id), eq(users.session_id, attempt.session_id)));
    }
    await tx.update(auth_login_attempts).set({ status: 'cancelled' }).where(attemptWhere(attempt));
    return { status: 200, body: { ok: true } };
  });
}
