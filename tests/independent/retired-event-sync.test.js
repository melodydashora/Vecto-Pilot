import process from 'node:process';
import { jest, test, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
// Import must not touch the application database, even before a call is made.
jest.unstable_mockModule('../../server/db/drizzle.js', () => { throw new Error('Retired entry imported application DB'); });
const retired = await import('../../server/scripts/sync-events.mjs');
const job = await import('../../server/jobs/event-sync-job.js');

test.each(['syncEventsForLocation', 'searchWithSerpAPI', 'searchWithGPT52', 'searchWithGoogleSearch', 'searchWithClaude', 'searchWithPerplexityReasoning', 'generateEventHash', 'storeEvents'])('retired %s cannot call providers or write events', name => {
  expect(() => retired[name]({ city: 'Synthetic', lat: 0, lng: 0 })).toThrow(/Legacy event sync is retired/);
});
test('the old scheduler cannot start or leave a timer behind', () => {
  jest.useFakeTimers();
  try {
    expect(() => job.startEventSyncJob()).toThrow(/admitted MAIN Briefing/);
    job.stopEventSyncJob();
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
test.each(['server/jobs/event-sync-job.js', 'server/scripts/sync-events.mjs'])('direct retired entry %s exits unsuccessfully without DB/provider setup', entry => {
  try {
    execFileSync(process.execPath, [entry], { env: { PATH: process.env.PATH }, encoding: 'utf8', stdio: 'pipe' });
    throw new Error('Retired entry unexpectedly succeeded');
  } catch (error) {
    expect(error.status).toBe(1);
    expect(String(error.stderr)).toContain('Legacy event sync is retired');
    expect(String(error.stderr)).not.toContain('DATABASE_URL');
  }
});
