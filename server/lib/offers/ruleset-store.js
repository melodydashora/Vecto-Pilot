// server/lib/offers/ruleset-store.js
// 2026-07-03 (todo #10): Per-driver ruleset resolution for the analyze-offer hot path.
//
// FLOW (Siri request → rules):
//   X-Shortcut-Token header (or shortcut_token form field)
//     → driver_profiles.shortcut_token → user_id
//     → offer_rulesets.config → migrateRuleset() → { ruleset, userId, version, hash }
//
// 2026-09-11: provided tokens fail closed when identity or saved rules cannot be
// verified. The ingest route speaks NO DATA, never ACCEPT under substituted rules.
// Untokened legacy requests retain their explicitly anonymous default path.
//
// CACHING: measured Phase-1 p50 is ~5.3s, so one indexed read (~10-20ms) is
// noise — the 15s in-process TTL exists to absorb trip-radar bursts, not to
// save latency. Deployment is Cloud Run (can autoscale): cross-instance edits
// converge within TTL; the PUT handler busts the local instance immediately.

import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { DEFAULT_RULESET, migrateRuleset } from './rules-engine.js';
import { validateRuleset } from './ruleset-schema.js';
import { initialRulesetFromProfile } from './profile-ruleset.js';
import { hashRuleset } from './ruleset-hash.js';

// Pure identity helpers live in ruleset-hash.js (no DB import — testable without
// a pool); re-exported here so API consumers keep a single import site.
export { hashRuleset, generateShortcutToken } from './ruleset-hash.js';

const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 500; // bound the map — the public path must not grow memory on attacker-minted tokens
const cache = new Map(); // token → { value, expiresAt }
// 2026-08-17 (race review): a read that STARTED before a save and lands after it would
// re-populate the cache with the pre-save rules for up to 15 s (invalidateUser only
// clears what is already there). Remember when each user was last invalidated and
// refuse to cache a value whose read began before that instant.
const invalidatedAt = new Map(); // userId → epoch ms

/**
 * Resolve the ruleset for an incoming analyze-offer request.
 * @param {string|null|undefined} token - X-Shortcut-Token header / shortcut_token field
 * @returns {Promise<{ruleset: object, userId: string|null, version: number|null, hash: string|null}>}
 *   No token → defaults with null identity (legacy behavior, zero change).
 *   Invalid token or unreadable rules → null rules, with an explicit status.
 */
export async function resolveRuleset(token) {
  const defaults = { ruleset: DEFAULT_RULESET, userId: null, version: null, hash: null, status: 'anonymous_defaults' };
  if (!token || typeof token !== 'string') return defaults;

  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const readStartedAt = Date.now();
  try {
    const result = await db.execute(sql`
      SELECT dp.user_id, dp.pref_shared, dp.max_deadhead_mi, r.config, r.version, r.config_hash
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
      console.warn('[ruleset-store] Unknown shortcut token — personal rules unavailable');
      return { ruleset: null, userId: null, version: null, hash: null, status: 'invalid_token' };
    } else if (row.version == null && row.config == null) {
      const { config } = initialRulesetFromProfile(row);
      value = { ruleset: config, userId: row.user_id, version: null, hash: hashRuleset(config), status: 'profile_defaults' };
    } else {
      if (!row.config || typeof row.config !== 'object' || Array.isArray(row.config)
          || !row.config.global || !validateRuleset(migrateRuleset(row.config)).ok) {
        throw new Error('Saved personal rules are invalid');
      }
      value = {
        ruleset: migrateRuleset(row.config),
        userId: row.user_id,
        version: row.version,
        hash: row.config_hash,
        status: 'saved',
      };
    }
    if ((invalidatedAt.get(value.userId) ?? -1) >= readStartedAt) {
      // Saved while this read was in flight — serve it (it is what the DB said when we
      // asked) but do not cache it; the next request reads the fresh row.
      return value;
    }
    if (cache.size >= CACHE_MAX) {
      // Evict the oldest entry (Map preserves insertion order) — simple and enough
      // at this scale; a full sweep would be overkill for a 500-entry bound.
      cache.delete(cache.keys().next().value);
    }
    cache.set(token, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    console.error(`[ruleset-store] Personal rules could not be verified (${err.message})`);
    return { ruleset: null, userId: null, version: null, hash: null, status: 'rules_unavailable' };
  }
}

/** Bust the local cache for a user (called by the PUT handler after a save). */
export function invalidateUser(userId) {
  for (const [token, entry] of cache) {
    if (entry.value?.userId === userId) cache.delete(token);
  }
  const now = Date.now();
  invalidatedAt.set(userId, now);
  // Bounded: an invalidation older than the TTL can no longer race any read.
  for (const [uid, at] of invalidatedAt) {
    if (now - at > CACHE_TTL_MS * 2) invalidatedAt.delete(uid);
  }
}

/** Test hook. */
export function _clearCache() {
  cache.clear();
  invalidatedAt.clear();
}
