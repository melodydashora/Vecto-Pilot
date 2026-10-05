import { and, eq } from 'drizzle-orm';
import { users, driver_profiles, driver_vehicles } from '../../../shared/schema.js';
import { sessionIsLive } from './session-policy.js';

export class ActiveDriverSessionError extends Error {
  constructor() {
    super('You already have an active session. Log out of that session before starting a new one.');
    this.name = 'ActiveDriverSessionError';
    this.code = 'session_already_active';
  }
}

// Caller owns the transaction. The users lock serializes admission with other
// logins, logout, setup saves, Continue and publication. A rejected login writes
// no session clock or current pointers and must roll back its credential writes.
export async function createDriverSession(tx, userId, sessionId) {
  const readOwner = () => tx.select().from(users).where(eq(users.user_id, userId)).for('update').limit(1);
  let [existing] = await readOwner();
  if (!existing) {
    await tx.insert(users).values({ user_id: userId, session_id: null })
      .onConflictDoNothing({ target: users.user_id });
    [existing] = await readOwner();
  }
  // Take the clock after waiting for the lock. A request's earlier start time
  // can predate the winning session, incorrectly classifying it as invalid.
  const now = new Date();
  if (sessionIsLive(existing, now.getTime())) throw new ActiveDriverSessionError();
  await tx.update(users).set({ session_id: sessionId, current_snapshot_id: null,
    current_main_run_id: null, session_start_at: now, last_active_at: now, updated_at: now })
    .where(eq(users.user_id, userId));
  const profile = await tx.query.driver_profiles.findFirst({ where: eq(driver_profiles.user_id, userId) });
  if (!profile) throw new Error('Driver profile disappeared during session creation');
  const vehicle = await tx.query.driver_vehicles.findFirst({ where: and(
    eq(driver_vehicles.driver_profile_id, profile.id), eq(driver_vehicles.is_primary, true), eq(driver_vehicles.is_active, true),
  ) });
  return { profile, vehicle, sessionStartedAt: now };
}
