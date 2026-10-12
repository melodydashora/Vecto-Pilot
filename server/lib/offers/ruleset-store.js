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
// Each tokened offer reads the owner's saved rules and service selections.
// A committed editor or Coach save is available to the next request on every
// server instance; an in-flight offer retains its original rules and provenance.

import { db } from '../../db/drizzle.js';
import { sql } from 'drizzle-orm';
import { DEFAULT_RULESET, migrateRuleset } from './rules-engine.js';
import { validateRuleset } from './ruleset-schema.js';
import { initialRulesetFromProfile } from './profile-ruleset.js';
import { hashRuleset } from './ruleset-hash.js';
import { normalizeSelectedServices } from '../../../shared/driver-services.js';

// Pure identity helpers live in ruleset-hash.js (no DB import — testable without
// a pool); re-exported here so API consumers keep a single import site.
export { hashRuleset, generateShortcutToken } from './ruleset-hash.js';

/**
 * Resolve the ruleset for an incoming analyze-offer request.
 * @param {string|null|undefined} token - X-Shortcut-Token header / shortcut_token field
 * @returns {Promise<{ruleset: object|null, userId: string|null, version: number|null, hash: string|null, selectedServices: string[]|null, selectionVerified: boolean, status: string}>}
 *   No token → defaults with null identity (legacy behavior, zero change).
 *   Invalid token or unreadable rules → null rules, with an explicit status.
 *   Service selection is profile context, not part of the persisted rules hash.
 *   Null remains an explicitly unverified legacy selection; it is never inferred.
 */
export async function resolveRuleset(token) {
  const defaults = { ruleset: DEFAULT_RULESET, userId: null, version: null, hash: null, status: 'anonymous_defaults', selectedServices: null, selectionVerified: false };
  if (!token || typeof token !== 'string') return defaults;

  try {
    const result = await db.execute(sql`
      SELECT dp.user_id, dp.pref_shared, dp.max_deadhead_mi, dp.selected_services, r.config, r.version, r.config_hash
      FROM driver_profiles dp
      LEFT JOIN offer_rulesets r ON r.user_id = dp.user_id
      WHERE dp.shortcut_token = ${token}
      LIMIT 1
    `);
    const row = result.rows?.[0];

    let value;
    if (!row) {
      console.warn('[ruleset-store] Unknown shortcut token — personal rules unavailable');
      return { ruleset: null, userId: null, version: null, hash: null, status: 'invalid_token', selectedServices: null, selectionVerified: false };
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
    value.selectedServices = normalizeSelectedServices(row.selected_services);
    value.selectionVerified = value.selectedServices !== null;
    return value;
  } catch (err) {
    console.error(`[ruleset-store] Personal rules could not be verified (${err.message})`);
    return { ruleset: null, userId: null, version: null, hash: null, status: 'rules_unavailable', selectedServices: null, selectionVerified: false };
  }
}
