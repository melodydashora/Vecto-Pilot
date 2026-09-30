import process from 'node:process';
import { jest, test, expect, beforeEach, afterEach, afterAll } from '@jest/globals';

const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: log, matrixLog: log, triadLog: log, OP: {}, tagLog: jest.fn() }));
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: new Proxy({}, { get: () => { throw new Error('Unexpected database access'); } }) }));
const callModel = jest.fn();
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
jest.unstable_mockModule('../../server/lib/briefing/shared/get-market-for-location.js', () => ({ getMarketForLocation: jest.fn() }));
const writes = [];
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  CHANNELS: {}, errorMarker: error => ({ _generationFailed: true, error: error.message }),
  writeSectionAndNotify: async (_id, value) => writes.push(value),
}));
const { discoverNews } = await import('../../server/lib/briefing/pipelines/news.js');
const { filterFreshNews } = await import('../../server/lib/strategy/strategy-utils.js');
const originalKey = process.env.GEMINI_API_KEY;
const now = new Date('2026-09-30T04:30:00Z');
const snapshot = { city: 'Synthetic City', state: 'Synthetic State', country: 'US', market: 'Synthetic Metro', timezone: 'America/Chicago' };
const article = (title, published_date) => ({ title, published_date, impact: 'high', summary: 'Synthetic road conditions.' });

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(now);
  callModel.mockReset(); writes.length = 0;
  process.env.GEMINI_API_KEY = 'synthetic';
});
afterEach(() => jest.useRealTimers());
afterAll(() => { if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey; });

test('collector saves only the same strict driver-local freshness set used by readers', async () => {
  const items = [article('Today', '2026-09-29'), article('Yesterday', '2026-09-28'),
    article('Prior window', '2026-09-26'), article('Past instant', '2026-09-30T04:29:59Z'),
    article('Missing'), article('Malformed', 'not-a-date'), article('Impossible', '2026-09-31'),
    article('Future day', '2026-09-30'), article('Future instant', '2026-09-30T04:31:00Z'),
    article('Too old', '2026-09-25')];
  callModel.mockResolvedValue({ ok: true, output: JSON.stringify({ items }) });
  const result = await discoverNews({ snapshotId: 'synthetic', snapshot });
  const expected = filterFreshNews(items, now, snapshot.timezone);
  expect(expected.map(item => item.title)).toEqual(['Today', 'Yesterday', 'Prior window', 'Past instant']);
  expect(result.news.items).toEqual(expected);
  expect(writes.at(-1).news.items).toEqual(expected);
});

test('search date follows the current driver-local day, not an earlier snapshot wall-clock value', async () => {
  callModel.mockResolvedValue({ ok: true, output: '{"items":[],"reason":"No reports"}' });
  await discoverNews({ snapshotId: 'synthetic', snapshot: { ...snapshot, local_iso: '2026-09-28T23:30:00' } });
  expect(callModel.mock.calls[0][1].user).toContain('- Date: 2026-09-29');
});

test('invalid dates only produce an explained empty result without an invented article', async () => {
  callModel.mockResolvedValue({ ok: true, output: JSON.stringify({ items: [article('Unknown'), article('Future', '2026-10-01')] }) });
  const result = await discoverNews({ snapshotId: 'synthetic', snapshot });
  expect(result.news.items).toEqual([]);
  expect(result.news.reason).toContain('outside the requested date window');
});

test('an unknown timezone fails before provider dispatch', async () => {
  await expect(discoverNews({ snapshotId: 'synthetic', snapshot: { ...snapshot, timezone: 'Unknown/Zone', local_iso: '2026-09-29T12:00:00' } })).rejects.toThrow();
  expect(callModel).not.toHaveBeenCalled();
});
