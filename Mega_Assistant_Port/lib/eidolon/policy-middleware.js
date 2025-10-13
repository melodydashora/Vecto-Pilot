// server/eidolon/policy-middleware.js
// Blocks requests when the single-path contract or env is not satisfied.

export function policyGuard(policy) {
  return (req, res, next) => {
    const inv = policy?.triad?.invariants || {};
    const ok =
      policy?.triad?.enabled === true &&
      policy?.flags?.no_fallbacks === true &&
      inv.no_venue_invention === true &&
      inv.schema_strict === true &&
      inv.word_caps === true &&
      inv.require_json_output === true &&
      inv.require_exact_model_ids === true;

    if (!ok) {
      return res.status(503).json({
        error: "policy_violation",
        details: { triadEnabled: policy?.triad?.enabled, invariants: inv }
      });
    }

    const need = policy?.startup?.require_env || [];
    const missing = need.filter(k => !process.env[k]);
    if (missing.length) {
      return res.status(503).json({
        error: "missing_env",
        details: { missing }
      });
    }

    next();
  };
}
