// September 10, 2026: driver-reported outcomes are distinct from analyzer recommendations.
export const OUTCOME_VALUES = ['Accepted', 'Rejected', 'Cancelled', 'Completed', 'Other'];
export const EARNINGS_KEYS = ['actual_pay', 'reimbursements', 'extras', 'other'];
export function parseOutcomeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('An outcome object is required');
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  const versionKind = has('expected_revision') ? 'revision' : 'timestamp';
  if (!has('expected_revision') && !has('expected_outcome_updated_at')) {
    const error = new Error('This form is out of date. Refresh the Offer Analyzer before saving so newer entries are protected.');
    error.code = 'outcome_version_required';
    throw error;
  }
  if (has('expected_revision') && (body.expected_revision !== null &&
    (!Number.isInteger(body.expected_revision) || body.expected_revision < 1 || body.expected_revision > 2147483646))) {
    throw new Error('expected_revision must be the loaded revision, or null for a new outcome. Reload this offer before saving.');
  }
  const expectedUpdatedAt = body.expected_outcome_updated_at ?? null;
  if (has('expected_outcome_updated_at') && body.expected_outcome_updated_at !== null) {
    // Preserve f09e8d58's timestamp clients, including the DB's microseconds.
    // Date is only a validity check; never pass its millisecond-rounded value to SQL.
    const value = body.expected_outcome_updated_at;
    const localAsUtc = typeof value === 'string' ? value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, 'Z') : '';
    if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value)) || !Number.isFinite(Date.parse(localAsUtc))
      || new Date(localAsUtc).toISOString().slice(0, 19) !== value.slice(0, 19)) {
      throw new Error('expected_outcome_updated_at must be the loaded ISO timestamp with timezone, or null');
    }
  }
  const fields = {};
  if (has('driver_decision')) {
    if (!OUTCOME_VALUES.includes(body.driver_decision)) throw new Error(`driver_decision must be one of ${OUTCOME_VALUES.join(', ')}`);
    fields.driver_decision = body.driver_decision;
  }
  const expectsNew = versionKind === 'revision' ? body.expected_revision === null : expectedUpdatedAt === null;
  if (expectsNew && !fields.driver_decision) throw new Error('Choose a decision for the new outcome');
  if (has('driver_reasoning')) {
    if (body.driver_reasoning !== null && (typeof body.driver_reasoning !== 'string' || body.driver_reasoning.length > 2000 || body.driver_reasoning.includes('\0'))) {
      throw new Error('driver_reasoning must be text up to 2000 characters, or null');
    }
    fields.driver_reasoning = body.driver_reasoning === null ? null : body.driver_reasoning.trim() || null;
  }
  for (const key of EARNINGS_KEYS) {
    if (!has(key)) continue;
    const value = body[key];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000)) {
      throw new Error(`${key} must be a number between 0 and 10000, or null if unknown`);
    }
    if (fields.driver_decision && !['Accepted', 'Completed'].includes(fields.driver_decision) && value !== null) {
      throw new Error('Only accepted or completed offers can have reported earnings');
    }
    fields[key] = value;
  }
  if (!Object.keys(fields).length) throw new Error('No outcome fields were supplied');
  return { expectedRevision: body.expected_revision ?? null, expectedUpdatedAt, versionKind, expectsNew, fields };
}

export function offerPeriod(value = '7d', now = new Date()) {
  const days = { '7d': 7, '30d': 30, '90d': 90 };
  if (typeof value !== 'string' || !Object.hasOwn(days, value)) throw new Error('period must be 7d, 30d or 90d');
  return {
    key: value, label: `Rolling last ${days[value]} days`,
    start: new Date(now.getTime() - days[value] * 86400000).toISOString(), end: now.toISOString(),
  };
}
