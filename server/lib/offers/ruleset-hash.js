// server/lib/offers/ruleset-hash.js
// 2026-07-03 (todo #10): Pure helpers for ruleset identity — no DB import, so
// tests and the rules engine can use them without opening a connection pool
// (ruleset-store.js pulls in db/drizzle.js, which keeps Jest's loop alive).

import crypto from 'node:crypto';

/** Stable hash of a config: sha256 over JSON with sorted keys at every level. */
export function hashRuleset(config) {
  return crypto.createHash('sha256').update(canonicalJson(config)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Generate an unguessable shortcut token: "vp_" + 40 base62 chars (~238 bits). */
export function generateShortcutToken() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(40);
  let out = 'vp_';
  for (let i = 0; i < 40; i++) out += alphabet[bytes[i] % 62];
  return out;
}
