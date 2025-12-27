// server/eidolon/policy-middleware.js
// Policy configuration (informational only - no enforcement)

export function policyGuard(policy) {
  return (req, res, next) => {
    // No enforcement - just log policy configuration for visibility
    if (process.env.NODE_ENV === 'development') {
      console.log('[eidolon policy] Configuration loaded:', {
        triadEnabled: policy?.triad?.enabled,
        identity: policy?.identity,
        note: 'Enforcement disabled'
      });
    }

    next();
  };
}