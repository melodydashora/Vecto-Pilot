export interface SpokenOfferResult {
  decision: 'ACCEPT' | 'REJECT' | 'NO DATA';
  voice: string;
  reason: string;
  verified: boolean;
  rulesVersion: number | null;
  analyzedAt: string | null;
}

// A spoken recommendation is valid only when the server confirms personal rules
// and timestamps the decision. Never promote an unverified or stale response.
export function readSpokenOfferResult(payload: unknown, now = Date.now()): SpokenOfferResult {
  const data = payload as Record<string, unknown> | null;
  const rawTime = typeof data?.analyzed_at === 'string' ? data.analyzed_at : null;
  const time = rawTime ? Date.parse(rawTime) : NaN;
  const analyzedAt = Number.isFinite(time) ? rawTime : null;
  const current = Number.isFinite(time) && now - time >= -5000 && now - time <= 30000;
  const verified = data?.personal_rules_verified === true;
  const decision = data?.decision;
  const voiceMatches = typeof data?.voice === 'string' && (decision === 'ACCEPT' ? /^accept\b/i : /^reject\b/i).test(data.voice);
  if (!current || !verified || data?.success !== true || (decision !== 'ACCEPT' && decision !== 'REJECT') || !voiceMatches) {
    return { decision: 'NO DATA', voice: 'No data. A current decision using your personal rules could not be verified. Decide manually when safe.', reason: 'A current decision using your personal rules could not be verified.', verified: false, rulesVersion: null, analyzedAt };
  }
  return {
    decision,
    voice: data.voice as string,
    reason: typeof data.reason === 'string' ? data.reason : '',
    verified,
    rulesVersion: typeof data.ruleset_version === 'number' ? data.ruleset_version : null,
    analyzedAt,
  };
}
