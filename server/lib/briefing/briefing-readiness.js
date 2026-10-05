// 2026-09-10: Melody's dependency: the full persisted Briefing precedes Strategy.
// Progressive section writes are useful to the Briefing tab, but are not completion.
export const BRIEFING_FIELDS = Object.freeze([
  'weather_current', 'weather_forecast', 'traffic_conditions', 'events',
  'news', 'school_closures', 'airport_conditions', 'holiday',
]);

const hasText = value => typeof value === 'string' && value.trim().length > 0;
// Bound inactivity, not the whole fan-out: verified section writes can continue
// after a three-minute Events search and advance the saved progress timestamp.
export const BRIEFING_WAIT_TIMEOUT_MS = 180000;

// Provider errors can contain URLs/credentials. Expose the cause, not raw responses.
export function briefingFailureReason(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (/database.*read|database could not be read/.test(message)) return 'The Briefing database could not be read.';
  if (/database|persist|storage|could not be saved/.test(message)) return 'The Briefing could not be saved.';
  if (/timeout|timed out|abort/.test(message)) return 'The data provider timed out.';
  if (/429|rate.limit|quota/.test(message)) return 'The data provider rate limit was reached.';
  if (/401|403|api.key|not configured|not set|authentication/.test(message)) return 'The data provider is not configured or rejected authentication.';
  if (/50[0234]|unavailable|overloaded|unreachable|fetch failed|network/.test(message)) return 'The data provider was unavailable.';
  if (/parse|json|invalid|malformed|truncated/.test(message)) return 'The data provider returned an invalid or incomplete response.';
  if (/no forecast hours|returned no data/.test(message)) return 'The data provider returned no data for the required section.';
  if (/snapshot|coordinates|timezone|location/.test(message)) return 'Required location context is missing or invalid.';
  return 'The section could not be generated. Please retry.';
}

/** Return null for usable data, otherwise a concrete failure/pending reason. */
export function briefingSectionIssue(field, value) {
  if (value == null) return 'Section has not finished.';
  if (value?._generationFailed || value?.isFallback || value?._pending) {
    return value._pending ? 'Section has not finished.' : briefingFailureReason(value.error || value.reason);
  }
  if (field === 'events' && /^(Database error:|Location data not available|Location coordinates unavailable|GEMINI_API_KEY required|Event discovery incomplete)/.test(value?.reason || '')) {
    return briefingFailureReason(value.reason);
  }
  if (typeof value !== 'object') return 'Section has an invalid response shape.';
  if (field === 'events' || field === 'news' || field === 'school_closures') {
    const items = Array.isArray(value) ? value : value.items;
    if (!Array.isArray(items)) return 'Section did not return an items array.';
    return items.length > 0 || hasText(value.reason) ? null : 'No-data result is missing its explanation.';
  }
  if (field === 'weather_forecast') {
    if (!Array.isArray(value)) return 'Weather forecast did not return an hourly array.';
    if (value.length === 0) return 'Weather forecast returned no hours or explanation.';
    return value.every(hour => Number.isFinite(hour?.temperature) && hasText(hour?.conditions))
      ? null : 'Weather forecast is missing temperature or conditions.';
  }
  if (field === 'weather_current') {
    return Number.isFinite(value.temperature) && hasText(value.conditions)
      ? null : 'Current weather is missing temperature or conditions.';
  }
  if (field === 'traffic_conditions') {
    return hasText(value.briefing) || hasText(value.summary)
      ? null : 'Traffic returned no analysis or explanation.';
  }
  if (field === 'airport_conditions') {
    if (!Array.isArray(value.airports)) return 'Airport conditions did not return an airports array.';
    return value.airports.length > 0 || (value.verifiedEmpty === true && hasText(value.reason))
      ? null : 'No-airports result was not verified with an explanation.';
  }
  if (field === 'holiday') {
    return hasText(value.holiday) && typeof value.is_holiday === 'boolean'
      ? null : 'Holiday detection did not return a verified result.';
  }
  return 'Unknown Briefing section.';
}

// 2026-09-11 (Astra FAA chain finding 1, verified): the aggregator replaced any fulfilled
// section that still failed the contract (e.g. an airport fallback that RETAINED known
// airport identities with isFallback) by a bare error marker, discarding the safe known
// data the pipeline had deliberately kept. Seal the failure instead: keep the section's
// own plain-object fields, add the failure marker and reason. Readiness is unchanged —
// _generationFailed still means failed → status error, never complete.
export function sealFailedSection(value, issue) {
  const known = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const { _generationFailed: _ignored, ...safe } = known;
  const failedAt = new Date().toISOString();
  return { ...safe, _generationFailed: true, error: issue, failedAt, reason: issue };
}

export function getBriefingReadiness(row, snapshotId) {
  const issues = Object.fromEntries(BRIEFING_FIELDS.flatMap(field => {
    const issue = briefingSectionIssue(field, row?.[field]);
    return issue ? [[field, issue]] : [];
  }));
  if (row && snapshotId && row.snapshot_id !== snapshotId) issues.snapshot_id = 'Briefing belongs to a different snapshot.';
  const failed = row?.status === 'error' || BRIEFING_FIELDS.some(field => row?.[field]?._generationFailed || row?.[field]?.isFallback);
  const persisted = row?.status === 'complete' && Number.isFinite(new Date(row.generated_at).getTime()) && !!row.generated_at;
  return {
    ready: persisted && Object.keys(issues).length === 0,
    failed: failed || (row?.status === 'complete' && Object.keys(issues).length > 0),
    issues,
  };
}

export class BriefingNotReadyError extends Error {
  constructor(row, snapshotId, { timedOut = false } = {}) {
    const readiness = getBriefingReadiness(row, snapshotId);
    const details = Object.entries(readiness.issues).map(([section, reason]) => `${section}: ${reason}`).join(' ');
    super(`${timedOut ? 'Briefing completion timed out.' : 'Briefing is not complete.'} ${details || 'The final Briefing has not been saved.'}`);
    this.name = 'BriefingNotReadyError';
    this.code = 'briefing_failed';
    this.issues = readiness.issues;
  }
}

export function assertBriefingReady(row, snapshotId) {
  if (!getBriefingReadiness(row, snapshotId).ready) throw new BriefingNotReadyError(row, snapshotId);
  return row;
}

// Cached Strategy paths cannot start/own Briefing generation. A legacy row with
// no owner, or pending work with no progress within the bounded wait, needs an
// explicit new-snapshot retry instead of an endless pending response. This does
// not revoke ownership or allow an ordinary duplicate to take over generation.
export function cachedBriefingRetryReason(row, snapshotId, now = Date.now()) {
  const readiness = getBriefingReadiness(row, snapshotId);
  if (readiness.ready || readiness.failed) return null;
  if (row?.status !== 'pending' || !row.generation_token) {
    return 'The previous Briefing was not verified complete. Refresh your location to start a new Briefing.';
  }
  const lastProgress = new Date(row.updated_at).getTime();
  if (!Number.isFinite(lastProgress) || now - lastProgress >= BRIEFING_WAIT_TIMEOUT_MS) {
    return 'Briefing completion timed out. Refresh your location to start a new Briefing.';
  }
  return null;
}

// Used when another process owns generation. A timeout is a failure, never permission
// to invoke Strategy. Injectable timing makes this contract testable without a DB.
export async function waitForBriefing({ snapshotId, read, timeoutMs = BRIEFING_WAIT_TIMEOUT_MS, intervalMs = 3000,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let lastProgressAt = now();
  let lastSavedUpdate = null;
  for (;;) {
    const row = await read(snapshotId);
    const readiness = getBriefingReadiness(row, snapshotId);
    if (readiness.ready) return row;
    // A failed section blocks Strategy immediately, but the generation owner
    // still saves other sections before publishing its terminal row status.
    if (readiness.failed && row?.status !== 'pending') throw new BriefingNotReadyError(row, snapshotId);
    const savedUpdate = row?.updated_at ? new Date(row.updated_at).getTime() : NaN;
    if (Number.isFinite(savedUpdate) && (lastSavedUpdate === null || savedUpdate > lastSavedUpdate)) {
      lastSavedUpdate = savedUpdate;
      lastProgressAt = Math.min(now(), savedUpdate);
    }
    const inactiveFor = now() - lastProgressAt;
    if (inactiveFor >= timeoutMs) throw new BriefingNotReadyError(row, snapshotId, { timedOut: true });
    await sleep(Math.min(intervalMs, timeoutMs - inactiveFor));
  }
}
