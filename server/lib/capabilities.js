// server/lib/capabilities.js
// Shared capability loader for all three lanes

function bool(v, def = true) {
  if (v == null) return def;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function list(v) {
  if (!v) return [];
  return String(v).split(",").map(s => s.trim()).filter(Boolean);
}

export function capsFromEnv(prefix) {
  const g = (k) => process.env[`${prefix}_${k}`];
  return {
    fsRead: bool(g("ALLOW_FS_READ"), true),
    fsWrite: bool(g("ALLOW_FS_WRITE"), true),
    shell: bool(g("ALLOW_SHELL"), true),
    shellWhitelist: list(g("SHELL_WHITELIST")),
    sqlRead: bool(g("ALLOW_SQL_READ"), true),
    sqlWrite: bool(g("ALLOW_SQL_WRITE"), true),
    persist: bool(g("PERSIST"), true),
    policyPath: g("POLICY_PATH") || undefined,
  };
}
