// server/agent/path-guard.js
// 2026-09-10 (security finding [7]): `..` in any spelling — raw, %2e, %2E — anywhere in a
// request URL. Shared by embed.js (IP-allowlist exemption) and bridge.js (upstream proxy):
// fetch() would normalize `/agent/memory/../shell` into `/agent/shell`.
export function hasDotSegments(url) {
  if (typeof url !== 'string') return true;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { return true; }
  return /(^|\/)\.\.(\/|$|\?)/.test(decoded) || /%2e/i.test(url);
}
