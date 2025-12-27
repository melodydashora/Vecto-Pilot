/**
 * Capability configuration for agent servers
 *
 * Parses environment variables to determine what operations are allowed.
 * Supports prefixed env vars like AGENT_FS_READ=true, AGENT_SHELL_WHITELIST=ls,cat,grep
 *
 * @module capabilities
 */

/**
 * Default capabilities - all enabled
 */
const DEFAULT_CAPS = {
  fsRead: true,
  fsWrite: true,
  fsDelete: true,
  shellExec: true,
  shellWhitelist: [], // Empty = use hardcoded whitelist in agent-server.js
  sqlQuery: true,
  sqlExecute: true,
  memoryRead: true,
  memoryWrite: true,
  configRead: true,
  configWrite: true,
};

/**
 * Parse capabilities from environment variables
 *
 * @param {string} prefix - Environment variable prefix (e.g., "AGENT" for AGENT_FS_READ)
 * @returns {Object} Parsed capabilities object
 *
 * @example
 * // With AGENT_FS_READ=true, AGENT_SHELL_WHITELIST=ls,cat,grep
 * const caps = capsFromEnv("AGENT");
 * // Returns: { fsRead: true, shellWhitelist: ["ls", "cat", "grep"], ... }
 */
export function capsFromEnv(prefix = "AGENT") {
  const caps = { ...DEFAULT_CAPS };
  const p = prefix.toUpperCase();

  // Boolean capabilities
  const boolKeys = ["FS_READ", "FS_WRITE", "FS_DELETE", "SHELL_EXEC", "SQL_QUERY", "SQL_EXECUTE", "MEMORY_READ", "MEMORY_WRITE", "CONFIG_READ", "CONFIG_WRITE"];

  for (const key of boolKeys) {
    const envKey = `${p}_${key}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      const camelKey = key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      caps[camelKey] = envVal === "true" || envVal === "1";
    }
  }

  // Shell whitelist (comma-separated)
  const wlKey = `${p}_SHELL_WHITELIST`;
  const wlVal = process.env[wlKey];
  if (wlVal) {
    caps.shellWhitelist = wlVal === "*" ? ["*"] : wlVal.split(",").map(s => s.trim()).filter(Boolean);
  }

  return caps;
}

/**
 * Check if a specific capability is enabled
 *
 * @param {Object} caps - Capabilities object from capsFromEnv
 * @param {string} capability - Capability name (e.g., "fsRead", "shellExec")
 * @returns {boolean} Whether the capability is enabled
 */
export function hasCap(caps, capability) {
  return caps[capability] === true;
}

/**
 * Check if a shell command is allowed
 *
 * @param {Object} caps - Capabilities object from capsFromEnv
 * @param {string} cmd - Command to check
 * @returns {boolean} Whether the command is allowed
 */
export function isShellAllowed(caps, cmd) {
  if (!caps.shellExec) return false;
  if (!caps.shellWhitelist?.length) return true; // No whitelist = defer to hardcoded list
  if (caps.shellWhitelist.includes("*")) return true; // Wildcard allows all
  return caps.shellWhitelist.includes(cmd);
}
