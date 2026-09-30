import { migrateRuleset } from './rules-engine.js';

/** Only fields with the same meaning are inherited, and only without saved rules. */
export function initialRulesetFromProfile(profile = {}) {
  const config = migrateRuleset(null);
  const sourceFields = [];
  if (typeof profile.pref_shared === 'boolean') {
    config.share.auto_reject = !profile.pref_shared;
    sourceFields.push('pref_shared');
  }
  if (Number.isInteger(profile.max_deadhead_mi) && profile.max_deadhead_mi >= 0 && profile.max_deadhead_mi <= 500) {
    config.global.pickup_limits = { max_miles: profile.max_deadhead_mi, max_minutes: null };
    sourceFields.push('max_deadhead_mi');
  }
  // Goals are not minimum offer rates; eligibility is not chosen work. Neither
  // can safely become a gate. Saved analyzer rules always take precedence.
  return { config, sourceFields };
}
