import { describe, test, expect } from '@jest/globals';
import { BRIEFING_FIELDS, assertBriefingReady, getBriefingReadiness, waitForBriefing } from '../../server/lib/briefing/briefing-readiness.js';

export function completeBriefing() {
  return {
    snapshot_id: 'test-snapshot', status: 'complete', generated_at: new Date(),
    weather_current: { temperature: 20, conditions: 'Cloudy' },
    weather_forecast: [{ temperature: 20, conditions: 'Cloudy' }],
    traffic_conditions: { summary: 'No reported incidents', incidents: [] },
    events: { items: [], reason: 'Successful search found no events' },
    news: { items: [], reason: 'Successful search found no relevant news' },
    school_closures: { items: [], reason: 'Successful search found no closures' },
    airport_conditions: { airports: [], verifiedEmpty: true, reason: 'No airports within the search radius' },
    holiday: { holiday: 'none', is_holiday: false },
  };
}

describe('Briefing completion contract', () => {
  test('explained, verified empty sections and verified non-holiday are complete', () => {
    expect(assertBriefingReady(completeBriefing(), 'test-snapshot')).toBeTruthy();
  });
  test.each(BRIEFING_FIELDS)('%s must finish before Strategy', field => {
    const row = completeBriefing();
    row[field] = null;
    expect(() => assertBriefingReady(row, 'test-snapshot')).toThrow(field);
  });
  test.each(BRIEFING_FIELDS)('%s failure markers cannot satisfy completion', field => {
    const row = completeBriefing();
    row[field] = { _generationFailed: true, error: 'provider HTTP 503 at https://example.invalid/?key=secret' };
    expect(getBriefingReadiness(row).failed).toBe(true);
    expect(() => assertBriefingReady(row)).toThrow('provider was unavailable');
    try { assertBriefingReady(row); } catch (error) { expect(error.message).not.toContain('secret'); }
  });
  test.each(['pending', null, 'error'])('status %s cannot pass even with every section populated', status => {
    expect(() => assertBriefingReady({ ...completeBriefing(), status })).toThrow();
  });
  test('requires final persistence timestamp and matching snapshot identity', () => {
    expect(() => assertBriefingReady({ ...completeBriefing(), generated_at: null })).toThrow();
    expect(() => assertBriefingReady(completeBriefing(), 'different-snapshot')).toThrow('different snapshot');
  });
  test.each(['events', 'news', 'school_closures'])('empty %s without a reason is not a successful search', field => {
    expect(() => assertBriefingReady({ ...completeBriefing(), [field]: [] })).toThrow('explanation');
  });
  test('airport fallback cannot pass just because its known-airports list is populated', () => {
    expect(getBriefingReadiness({ ...completeBriefing(), airport_conditions: { airports: [{}], isFallback: true, reason: 'provider failed' } }).failed).toBe(true);
  });
  test('waits through partial writes, then returns only the final complete row', async () => {
    let time = 0;
    const row = completeBriefing();
    const reads = [null, { ...row, status: 'pending' }, row];
    const result = await waitForBriefing({ snapshotId: row.snapshot_id, read: async () => reads.shift(), now: () => time, sleep: async ms => { time += ms; } });
    expect(result).toBe(row);
    expect(time).toBe(6000);
  });
  test('timeout fails instead of returning the last partial row', async () => {
    let time = 0;
    await expect(waitForBriefing({ snapshotId: 'test-snapshot', read: async () => ({ ...completeBriefing(), status: 'pending' }), timeoutMs: 10, intervalMs: 3, now: () => time, sleep: async ms => { time += ms; } })).rejects.toThrow('timed out');
    expect(time).toBe(10);
  });
  test('persisted section failure fails immediately rather than polling to timeout', async () => {
    await expect(waitForBriefing({ read: async () => ({ ...completeBriefing(), status: 'error' }), sleep: () => { throw new Error('should not sleep'); } })).rejects.toThrow('not complete');
  });
});
