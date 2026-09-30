import { describe, expect, test } from '@jest/globals';
import { readSpokenOfferResult } from '../client/src/lib/offer-capture';

const now = Date.now();
const accepted = { success: true, decision: 'ACCEPT', voice: 'Accept. Two dollars per mile.', reason: 'Clears rules', personal_rules_verified: true, ruleset_version: 8, analyzed_at: new Date(now).toISOString() };
describe('mobile spoken offer boundary', () => {
  test('uses the server decision and voice with verified personal rules', () => {
    expect(readSpokenOfferResult(accepted, now)).toMatchObject({ decision: 'ACCEPT', verified: true, rulesVersion: 8, voice: accepted.voice });
  });
  test('accepts verified signup preferences before a rules version exists', () => {
    expect(readSpokenOfferResult({ ...accepted, ruleset_version: null }, now)).toMatchObject({ decision: 'ACCEPT', verified: true, rulesVersion: null });
  });
  test.each([
    { personal_rules_verified: false },
    { personal_rules_verified: undefined },
    { analyzed_at: new Date(now - 31000).toISOString() },
    { analyzed_at: new Date(now + 6000).toISOString() },
    { analyzed_at: 'invalid' },
    { analyzed_at: undefined },
    { voice: 'Reject. Below your floor.' },
    { voice: '' },
    { success: false },
  ])('never speaks ACCEPT for an unverified, stale, or contradictory payload %p', changed => {
    const result = readSpokenOfferResult({ ...accepted, ...changed }, now);
    expect(result.decision).toBe('NO DATA');
    expect(result.voice).toMatch(/^No data\./);
    expect(result.verified).toBe(false);
  });
});
