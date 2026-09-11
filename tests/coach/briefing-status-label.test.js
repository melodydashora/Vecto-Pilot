// tests/coach/briefing-status-label.test.js
// 2026-09-11: desktop-coach-review.md item 4 — the Coach prompt's Briefing line must reflect
// real completion state (missing / pending / error / legacy / complete), never "Complete" for
// an empty object.
import { describe, test, expect, jest } from '@jest/globals';

jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
const { describeBriefingStatus } = await import('../../server/lib/ai/rideshare-coach-dal.js');
const { getBriefingReadiness } = await import('../../server/lib/briefing/briefing-readiness.js');
const { completeBriefing } = await import('../briefing/briefing-readiness.test.js');

const wrap = row => ({ exists: true, status: row.status ?? null, generated_at: row.generated_at ?? null, readiness: getBriefingReadiness(row, 'test-snapshot') });

describe('describeBriefingStatus', () => {
  test('missing row is Unavailable, never Complete', () => {
    const label = describeBriefingStatus({ exists: false, status: 'missing', readiness: { ready: false, failed: false, issues: {} }, events: [], traffic: [], news: [] });
    expect(label).toMatch(/^Unavailable — no Briefing row/);
    expect(label).not.toMatch(/Complete/);
  });
  test('read failure is reported as such', () => {
    expect(describeBriefingStatus({ exists: false, status: 'read_failed', error: 'boom' })).toMatch(/read failed \(boom\)/);
  });
  test('undefined / legacy empty object is Unavailable', () => {
    expect(describeBriefingStatus(undefined)).toMatch(/^Unavailable/);
    expect(describeBriefingStatus({})).toMatch(/Unverified legacy/);
  });
  test('complete persisted row is Complete with its generated_at', () => {
    const row = completeBriefing();
    expect(describeBriefingStatus(wrap(row))).toBe(`Complete (generated ${new Date(row.generated_at).toISOString()})`);
  });
  test('pending row is Pending and warns not to present facts as current', () => {
    const row = { ...completeBriefing(), status: 'pending', generated_at: null, events: null };
    expect(describeBriefingStatus(wrap(row))).toMatch(/^Pending — generation in progress/);
  });
  test('error status and failure markers are Failed', () => {
    expect(describeBriefingStatus(wrap({ ...completeBriefing(), status: 'error' }))).toMatch(/^Failed/);
    const row = completeBriefing(); row.news = { _generationFailed: true, error: 'provider HTTP 503' };
    expect(describeBriefingStatus(wrap(row))).toMatch(/^Failed \(news:/);
  });
  test('legacy row with data but no status marker is Unverified legacy, not Complete', () => {
    const row = { ...completeBriefing(), status: null, generated_at: null };
    const label = describeBriefingStatus(wrap(row));
    expect(label).toMatch(/^Unverified legacy Briefing/);
    expect(label).not.toMatch(/^Complete/);
  });
});
