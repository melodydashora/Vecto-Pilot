// server/middleware/require-operator.js
// 2026-09-10: Operator-only gate for internal surfaces that were reachable by ANY
// signed-in driver (Astra/Codex security audit 2026-09-10, findings [1] shared
// agent memory, [2] global log tail, [3] global diagnostics). Passing requireAuth
// proves "a driver"; these surfaces need "the operator or a service account".
//
// Policy (ONE shape, mirroring server/agent/embed.js requireAgentAdmin so the
// AGENT_ADMIN_USERS allowlist means the same thing everywhere):
//   - service-account callers (x-vecto-agent-secret / x-claude-bridge-token →
//     req.auth.isAgent) pass;
//   - users listed in AGENT_ADMIN_USERS (comma-separated user_ids) pass;
//   - in a deployment (REPLIT_DEPLOYMENT === '1') with no allowlist → 403 fail-secure;
//   - in the workspace with no allowlist → allowed with a warning, so the dev loop
//     (memory-keeper agent, phone log viewer) keeps working before the list exists.
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
  const isDeployment = process.env.REPLIT_DEPLOYMENT === '1';
  if (admins.length === 0) {
    if (isDeployment) {
      console.error(`[OPERATOR] ⛔ ${req.method} ${req.originalUrl} blocked — AGENT_ADMIN_USERS not configured in deployment`);
      return res.status(403).json({ error: 'OPERATOR_NOT_CONFIGURED', message: 'Operator users are not configured for this surface' });
    }
    console.warn(`[OPERATOR] Dev mode: allowing ${req.auth.userId.slice(0, 8)} on ${req.originalUrl} (no AGENT_ADMIN_USERS set)`);
    return next();
  }
  if (!admins.includes(req.auth.userId)) {
    console.warn(`[OPERATOR] ⛔ ${req.method} ${req.originalUrl} denied for user ${req.auth.userId.slice(0, 8)}`);
    return res.status(403).json({ error: 'OPERATOR_REQUIRED', message: 'This surface is restricted to operators' });
  }
  return next();
}
