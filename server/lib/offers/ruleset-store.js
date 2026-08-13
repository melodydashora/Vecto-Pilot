// server/lib/offers/ruleset-store.js
// 2026-07-03 (todo #10): Per-driver ruleset resolution for the analyze-offer hot path.
//
// FLOW (Siri request → rules):
//   X-Shortcut-Token header (or shortcut_token form field)
//     → driver_profiles.shortcut_token → user_id
//     → offer_rulesets.config → migrateRuleset() → { ruleset, userId, version, hash }
//
// FAIL POSTURE (named conflict, resolved in design §6): validation is STRICT at
// write time (ruleset-schema.js — invalid configs cannot persist), and the READ
// path fail-opens to DEFAULT_RULESET with a console.error. The Siri path must
// always answer inside the decision window; ruleset_hash=NULL on the stored row
// makes the degradation visible, never silent.
//
// CACHING: measured Phase-1 p50 is ~5.3s, so one indexed read (~10-20ms) is
// noise — the 15s in-process TTL exists to absorb trip-radar bursts, not to
// save latency. Deployment is Cloud Run (can autoscale): cross-instance edits
// converge within TTL; the PUT handler busts the local instance immediately.

import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { DEFAULT_RULESET, migrateRuleset } from './rules-engine.js';

// Pure identity helpers live in ruleset-hash.js (no DB import — testable without
// a pool); re-exported here so API consumers keep a single import site.
export { hashRuleset, generateShortcutToken } from './ruleset-hash.js';

const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 500; // bound the map — the public path must not grow memory on attacker-minted tokens
const cache = new Map(); // token → { value, expiresAt }

/**
 * Resolve the ruleset for an incoming analyze-offer request.
 * @param {string|null|undefined} token - X-Shortcut-Token header / shortcut_token field
 * @returns {Promise<{ruleset: object, userId: string|null, version: number|null, hash: string|null}>}
 *   No token → defaults with null identity (legacy behavior, zero change).
 *   Invalid token → same, with a warn (fail loud, answer anyway).
 */
export async function resolveRuleset(token) {
  const defaults = { ruleset: DEFAULT_RULESET, userId: null, version: null, hash: null };
  if (!token || typeof token !== 'string') return defaults;

  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const result = await db.execute(sql`
      SELECT dp.user_id, r.config, r.version, r.config_hash
      FROM driver_profiles dp
      LEFT JOIN offer_rulesets r ON r.user_id = dp.user_id
      WHERE dp.shortcut_token = ${token}
      LIMIT 1
    `);
    const row = result.rows?.[0];

    let value;
    if (!row) {
      // NOT cached: unknown tokens are unbounded attacker input — caching them
      // would let a scanner grow the map; a real driver's token resolves next try.
      console.warn('[ruleset-store] Unknown shortcut token — applying DEFAULT_RULESET (check the Shortcut setup)');
      return defaults;
    } else if (!row.config) {
      // Known driver, no saved rules yet → defaults WITH identity (offers get user_id).
      value = { ruleset: DEFAULT_RULESET, userId: row.user_id, version: null, hash: null };
    } else {
      value = {
        ruleset: migrateRuleset(row.config),
        userId: row.user_id,
        version: row.version,
        hash: row.config_hash,
      };
    }
    if (cache.size >= CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order) — simple and enough
      // at this scale; a full sweep would be overkill for a 500-entry bound.
      cache.delete(cache.keys().next().value);
    }
    cache.set(token, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    // Fail-open: the driver gets an answer under default rules; the error is loud
    // and the stored row's NULL ruleset_hash records that defaults were applied.
    console.error(`[ruleset-store] Ruleset load failed (${err.message}) — applying DEFAULT_RULESET`);
    return defaults;
  }
}

/** Bust the local cache for a user (called by the PUT handler after a save). */
export function invalidateUser(userId) {
  for (const [token, entry] of cache) {
    if (entry.value?.userId === userId) cache.delete(token);
  }
}

/** Test hook. */
export function _clearCache() {
  cache.clear();
}
