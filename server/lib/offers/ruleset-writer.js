// Canonical Offer Analyzer write boundary shared by the editor and directed Coach edits.
import { sql } from 'drizzle-orm';
import { withDriverSettingsLock } from '../main-run-admission.js';
import { migrateRuleset } from './rules-engine.js';
import { validateRuleset } from './ruleset-schema.js';
import { hashRuleset } from './ruleset-hash.js';
import { initialRulesetFromProfile } from './profile-ruleset.js';

export class RulesetWriteError extends Error {
  constructor(status, body) {
    super(body.message || body.details?.join('; ') || body.error);
    this.status = status;
    this.body = body;
  }
}
const fail = (status, body) => { throw new RulesetWriteError(status, body); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function validatedConfig(supplied) {
  // Migrations supply defaults; absent/malformed core data must never reset choices.
  if (!object(supplied) || !object(supplied.global)) {
    fail(422, { error: 'Invalid ruleset', details: ['config: a rules object with a global rules object is required'] });
  }
  if (!Object.hasOwn(supplied.global, 'rating_floor') || !Object.hasOwn(supplied.global, 'require_verified')) {
    fail(422, { error: 'Invalid ruleset', details: ['config.global: rating_floor and require_verified are required'] });
  }
  const validation = validateRuleset(migrateRuleset(supplied));
  if (!validation.ok) fail(422, { error: 'Invalid ruleset', details: validation.errors });
  return validation.config;
}

/**
 * transform is server code, never model data. It receives a freshly read config
 * under the same owner/session lock as editor saves. Its changes receipt is
 * returned only after the versioned write commits (or a verified no-op).
 */
export async function saveOfferRules(auth, input, { transform, expectedHash, signal } = {}) {
  const suppliedConfig = transform ? null : validatedConfig(input?.config);
  if (!input || !Object.hasOwn(input, 'expected_version')) {
    fail(400, { error: 'rules_version_required', message: 'Reload saved rules before saving changes.' });
  }
  const expectedVersion = input.expected_version;
  if (expectedVersion !== null && !(Number.isInteger(expectedVersion) && expectedVersion >= 1 && expectedVersion < 2147483647)) {
    fail(400, { error: 'expected_version must be a positive integer or null' });
  }
  signal?.throwIfAborted();
  const saved = await withDriverSettingsLock(auth, async tx => {
    signal?.throwIfAborted();
    const current = await tx.execute(sql`SELECT config, version, config_hash FROM offer_rulesets WHERE user_id = ${auth.userId} LIMIT 1`);
    const row = current.rows?.[0];
    const conflict = () => fail(409, {
      error: 'version_conflict',
      message: 'Your rules were changed elsewhere since this page loaded. Reload and re-apply your change.',
      current: row ? { config: migrateRuleset(row.config), version: row.version, hash: row.config_hash } : null,
    });
    if ((row?.version ?? null) !== expectedVersion) conflict();
    let config = suppliedConfig;
    let changes;
    if (transform) {
      let baseline;
      let baselineHash;
      if (row) {
        baseline = validatedConfig(row.config);
        baselineHash = row.config_hash;
        if (hashRuleset(row.config) !== baselineHash) fail(422, { error: 'Saved personal rules are invalid' });
      } else {
        const profiles = await tx.execute(sql`SELECT pref_shared, max_deadhead_mi FROM driver_profiles WHERE user_id = ${auth.userId} LIMIT 1`);
        if (!profiles.rows?.[0]) fail(422, { error: 'Driver profile defaults could not be verified' });
        baseline = initialRulesetFromProfile(profiles.rows[0]).config;
        baselineHash = hashRuleset(baseline);
      }
      if (typeof expectedHash !== 'string' || baselineHash !== expectedHash) conflict();
      const patched = transform(baseline);
      config = validatedConfig(patched.config);
      changes = patched.changes;
      if (hashRuleset(config) === hashRuleset(baseline)) {
        return { success: true, config: baseline, version: row?.version ?? null, hash: baselineHash, changed: false, changes: [] };
      }
    }
    const hash = hashRuleset(config);
    const configJson = JSON.stringify(config);
    signal?.throwIfAborted();
    const result = await tx.execute(sql`
      INSERT INTO offer_rulesets (user_id, version, config, config_hash)
      VALUES (${auth.userId}, 1, ${configJson}::jsonb, ${hash})
      ON CONFLICT (user_id) DO UPDATE SET
        config = EXCLUDED.config,
        config_hash = EXCLUDED.config_hash,
        version = offer_rulesets.version + 1,
        updated_at = NOW()
      WHERE offer_rulesets.version IS NOT DISTINCT FROM ${expectedVersion}::integer
      RETURNING version
    `);
    if (!result.rows?.length) conflict();
    // Abort while the transaction is still rollback-able; never replay a commit.
    signal?.throwIfAborted();
    return { success: true, version: result.rows[0].version, hash, config,
      ...(transform && { changed: true, changes }) };
  });
  return saved;
}
