// server/middleware/require-operator.js
// 2026-09-10: Operator-only gate for internal surfaces that were reachable by ANY
// signed-in driver (Astra/Codex security audit 2026-09-10, findings [1] shared
// agent memory, [2] global log tail, [3] global diagnostics; [5] shared intelligence
// writes). Passing requireAuth proves "a driver"; these surfaces need "the operator or
// a service account".
//
// Policy (ONE shape — the AGENT_ADMIN_USERS allowlist means the same thing here as in
// server/agent/embed.js requireAgentAdmin):
//   - service-account callers (x-vecto-agent-secret / x-claude-bridge-token →
//     req.auth.isAgent) pass;
//   - users listed in AGENT_ADMIN_USERS (comma-separated user_ids) pass;
//   - everyone else → 403. There is NO workspace fallback: the dev instance is
//     internet-reachable and holds the real continuity table (verification skeptic,
//     2026-09-10), so "any authenticated driver" is never acceptable. Set
//     AGENT_ADMIN_USERS in .env.local / the deployment secrets to use these surfaces.
//
// PREREQUISITE: mount AFTER requireAuth (reads req.auth).

function allowlist() {
  return (process.env.AGENT_ADMIN_USERS || '').split(',').map((u) => u.trim()).filter(Boolean);
}

export function isOperator(auth) {
  if (!auth?.userId) return false;
  if (auth.isAgent === true) return true;
  return allowlist().includes(auth.userId);
}

export function requireOperator(req, res, next) {
  if (!req.auth?.userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.auth.isAgent === true) return next();

  const admins = allowlist();
  if (admins.length === 0) {
    console.error(`[OPERATOR] ⛔ ${req.method} ${req.originalUrl} blocked — AGENT_ADMIN_USERS is not set (no workspace fallback by design)`);
    return res.status(403).json({ error: 'OPERATOR_NOT_CONFIGURED', message: 'Operator users are not configured for this surface (AGENT_ADMIN_USERS)' });
  }
  if (!admins.includes(req.auth.userId)) {
    console.warn(`[OPERATOR] ⛔ ${req.method} ${req.originalUrl} denied for user ${req.auth.userId.slice(0, 8)}`);
    return res.status(403).json({ error: 'OPERATOR_REQUIRED', message: 'This surface is restricted to operators' });
  }
  return next();
}
