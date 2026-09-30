// Shared by request authentication and background main-run publication.
export const SESSION_SLIDING_WINDOW_MS = 60 * 60 * 1000;
export const SESSION_HARD_LIMIT_MS = 2 * 60 * 60 * 1000;
export function sessionExpiryReason(session, now = Date.now()) {
  const started = session?.session_start_at == null ? NaN : new Date(session.session_start_at).getTime();
  const active = session?.last_active_at == null ? NaN : new Date(session.last_active_at).getTime();
  if (!session?.session_id || !Number.isFinite(now) || !Number.isFinite(started) || !Number.isFinite(active) ||
      started > now || active > now || active < started) return 'invalid';
  if (now - started > SESSION_HARD_LIMIT_MS) return 'hard_limit';
  if (now - active > SESSION_SLIDING_WINDOW_MS) return 'inactivity';
  return null;
}
export function sessionIsLive(session, now = Date.now()) {
  return sessionExpiryReason(session, now) === null;
}
