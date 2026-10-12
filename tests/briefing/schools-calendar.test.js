import process from 'node:process';
import { jest, test, expect, beforeEach, afterEach, afterAll } from '@jest/globals';

const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  briefingLog: log, matrixLog: log, OP: {},
}));
const callModel = jest.fn();
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({ callModel }));
const writes = [];
jest.unstable_mockModule('../../server/lib/briefing/briefing-notify.js', () => ({
  CHANNELS: {}, errorMarker: error => ({ _generationFailed: true, error: error.message }),
  writeSectionAndNotify: async (_id, value) => writes.push(value),
}));
const { fetchSchoolClosures, discoverSchools } = await import('../../server/lib/briefing/pipelines/schools.js');
const { default: plannerFilters } = await import('../../server/lib/briefing/filter-for-planner.js');
const { filterClosuresToToday, getLocalDate } = plannerFilters;
const { getSchoolClosureInterval, getSchoolClosureStatusOnDate, isSchoolClosureActiveOnDate } = await import('../../shared/school-closures.js');
const originalKey = process.env.GEMINI_API_KEY;
const snapshot = { city: 'Fixture City', state: 'Fixture State', country: 'US', market: 'Fixture Metro',
  timezone: 'America/Chicago', lat: 33.123456, lng: -96.123456 };

beforeEach(() => {
  jest.useFakeTimers();
  // UTC Monday is still Sunday locally. Old snapshot calendar fields must not win.
  jest.setSystemTime(new Date('2026-10-12T04:30:00Z'));
  process.env.GEMINI_API_KEY = 'synthetic';
  callModel.mockReset();
  callModel.mockResolvedValue({ ok: true, output: '[]' });
  writes.length = 0;
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

test('research uses the current local date and weekday without repurposing saved snapshot times', async () => {
  await fetchSchoolClosures({ snapshot: { ...snapshot, created_at: '2026-10-09T16:00:00Z',
    local_iso: '2026-10-09T11:00:00', date: '2026-10-09' } });
  const [role, { user, system }] = callModel.mock.calls[0];
  expect(role).toBe('BRIEFING_SCHOOLS');
  expect(user).toContain('Today: 2026-10-11 (Sunday), timezone America/Chicago');
  expect(user).toContain('Current local time: 23:30:00.');
  expect(user).not.toContain('2026-10-09');
  expect(system).toContain('school breaks and student returns affecting today');
  expect(user).toContain('closureStart <= 2026-10-11 <= reopeningDate');
  expect(user).toContain('the institution is no longer closed');
  expect(getLocalDate(snapshot.timezone)).toBe('2026-10-11');
});

test('local date also advances ahead of UTC in an eastern timezone', async () => {
  jest.setSystemTime(new Date('2026-10-11T15:30:00Z'));
  await fetchSchoolClosures({ snapshot: { ...snapshot, timezone: 'Asia/Tokyo' } });
  expect(callModel.mock.calls[0][1].user).toContain('Today: 2026-10-12 (Monday), timezone Asia/Tokyo');
});

test.each([undefined, '', 'Unknown/Zone'])('missing or invalid timezone %s fails before dispatch and planner filtering', async timezone => {
  await expect(fetchSchoolClosures({ snapshot: { ...snapshot, timezone } })).rejects.toThrow();
  expect(callModel).not.toHaveBeenCalled();
  expect(() => getLocalDate(timezone)).toThrow();
});

test.each(['city', 'state'])('missing %s fails before dispatch', async field => {
  await expect(fetchSchoolClosures({ snapshot: { ...snapshot, [field]: ' ' } })).rejects.toThrow('requires city and state');
  expect(callModel).not.toHaveBeenCalled();
});

test('research crosses city boundaries using known geography without sending driver GPS', async () => {
  await fetchSchoolClosures({ snapshot });
  const { system, user } = callModel.mock.calls[0][1];
  expect(user).toContain('City: Fixture City, Fixture State, US. Market: Fixture Metro.');
  expect(user).toContain('surrounding connected communities in this market');
  expect(user).toContain('check each relevant district separately');
  expect(user).toContain('neighboring city');
  expect(`${system}\n${user}`).not.toContain(String(snapshot.lat));
  expect(`${system}\n${user}`).not.toContain(String(snapshot.lng));
  expect(user).not.toMatch(/TARGET COORDINATES|SEARCH RADIUS|next 30 days/);
});

test('an unknown market does not invent a market or block known city/state research', async () => {
  await fetchSchoolClosures({ snapshot: { ...snapshot, market: null } });
  const { user } = callModel.mock.calls[0][1];
  expect(user).toContain('City: Fixture City, Fixture State, US.');
  expect(user).toContain('surrounding connected communities.');
  expect(user).not.toMatch(/Market:|undefined/);
});

test('plain prompt retains institution fields and defines continuous breaks without guessing closures', async () => {
  await fetchSchoolClosures({ snapshot: { ...snapshot, country: 'CA' } });
  const { user } = callModel.mock.calls[0][1];
  expect(user).toContain('School Board');
  expect(user).toContain('holidays, academic breaks, professional development days and unexpected closures');
  expect(user).toContain('including adjoining weekends');
  expect(user).toContain('Never extend it across a scheduled student class day');
  expect(user).toContain('first date students actually return, even if staff return earlier');
  expect(user).toContain('A normal weekend alone is not a break');
  expect(user).not.toContain('exceptional');
  for (const field of ['schoolName', 'type', 'closureStart', 'reopeningDate', 'reason', 'impact', 'lat', 'lng']) {
    expect(user).toContain(`"${field}":`);
  }
  expect(user).toContain('school_calendar_verification_failed');
});

test('normalization preserves the complete break and planner distinguishes the student return day', async () => {
  const institution = { schoolName: 'Fixture District', type: 'public', closureStart: '2026-10-09',
    reopeningDate: '2026-10-14', reason: 'Fall break and adjoining weekend', impact: 'high',
    lat: snapshot.lat, lng: snapshot.lng };
  callModel.mockResolvedValue({ ok: true, output: JSON.stringify([institution]) });
  const result = await discoverSchools({ snapshot, snapshotId: 'fixture' });
  expect(result.closures[0]).toMatchObject({ start_date: '2026-10-09', reopening_date: '2026-10-14',
    end_date: '2026-10-14', school_name: 'Fixture District', distanceFromDriver: 0, status: 'closed' });
  for (const day of ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) {
    expect(filterClosuresToToday(result.closures, day)).toHaveLength(1);
  }
  expect(filterClosuresToToday(result.closures, '2026-10-14')).toEqual([
    expect.objectContaining({ school_name: 'Fixture District', status: 'reopening_today' }),
  ]);
  expect(isSchoolClosureActiveOnDate(result.closures[0], '2026-10-14')).toBe(false);
  for (const day of ['2026-10-08', '2026-10-15']) {
    expect(filterClosuresToToday(result.closures, day)).toEqual([]);
  }
  expect(writes.at(-1).school_closures).toEqual(result.closures);
});

test('camelCase return dates are exclusive while legacy last-closed dates stay inclusive', () => {
  const returning = { closureStart: '2026-10-10', reopeningDate: '2026-10-19', end_date: '2026-10-20' };
  const lastClosed = { start_date: '2026-10-10', end_date: '2026-10-19' };
  const singleDay = { date: '2026-10-19' };
  expect(filterClosuresToToday([returning, lastClosed, singleDay], '2026-10-19')).toEqual([
    { ...returning, status: 'reopening_today' }, { ...lastClosed, status: 'closed' },
  ]);
  expect(getSchoolClosureStatusOnDate(lastClosed, '2026-10-20')).toBeNull();
  expect(getSchoolClosureInterval(lastClosed)).toEqual({
    startDate: '2026-10-10', endDate: '2026-10-19', endExclusive: false, closedThroughDate: '2026-10-19',
  });
});

test('real calendar validation accepts leap day and rejects rolled-over or non-date values', () => {
  const leapBreak = { startDate: '2028-02-29', reopening_date: '2028-03-01' };
  expect(isSchoolClosureActiveOnDate(leapBreak, '2028-02-29')).toBe(true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-11T00:00:00Z', '2026-1-11', null]) {
    expect(getSchoolClosureInterval({ closureStart: date, reopeningDate: '2029-01-01' })).toBeNull();
    expect(isSchoolClosureActiveOnDate(leapBreak, date)).toBe(false);
  }
  expect(isSchoolClosureActiveOnDate({ date: '2026-10-11', endDate: '2026-10-11' }, '2026-10-11')).toBe(true);
});

test('fresh research saves breaks and student returns today and preserves nullable coordinates', async () => {
  const intervals = [
    { schoolName: 'Active District', closureStart: '2026-10-10', reopeningDate: '2026-10-19', lat: null, lng: null },
    { schoolName: 'Future District', closureStart: '2026-10-12', reopeningDate: '2026-10-19' },
    { schoolName: 'Returning Today', closureStart: '2026-10-09', reopeningDate: '2026-10-11' },
    { schoolName: 'Returned Yesterday', closureStart: '2026-10-09', reopeningDate: '2026-10-10' },
  ];
  callModel.mockResolvedValue({ ok: true, output: JSON.stringify(intervals) });
  const { closures } = await discoverSchools({ snapshot, snapshotId: 'fixture' });
  expect(closures).toHaveLength(2);
  expect(closures[0]).toMatchObject({ school_name: 'Active District', lat: null, lng: null, distanceFromDriver: null, status: 'closed' });
  expect(closures[1]).toMatchObject({ school_name: 'Returning Today', status: 'reopening_today' });
  expect(writes.at(-1).school_closures).toEqual(closures);
});

test.each([
  null,
  { closureStart: '2026-10-10' },
  { reopeningDate: '2026-10-19' },
  { closureStart: '2026-02-30', reopeningDate: '2026-10-19' },
  { closureStart: '2026-10-10', reopeningDate: '2026-10-32' },
  { closureStart: '2026-10-12', reopeningDate: '2026-10-12' },
  { closureStart: '2026-10-12', reopeningDate: '2026-10-11' },
  { closureStart: '2026-10-10', end_date: '2026-10-19' },
])('malformed fresh interval fails before date filtering or persistence: %j', async invalid => {
  // Include a valid active record: partial research must not hide another bad row.
  callModel.mockResolvedValue({ ok: true, output: JSON.stringify([
    { closureStart: '2026-10-10', reopeningDate: '2026-10-19' }, invalid,
  ]) });
  await expect(discoverSchools({ snapshot, snapshotId: 'fixture' })).rejects.toThrow('invalid or missing calendar dates');
  expect(writes).toHaveLength(1);
  expect(writes[0].school_closures._generationFailed).toBe(true);
});

test('cached legacy end dates remain inclusive and explicit return days receive fresh status', async () => {
  const cachedClosures = { items: [
    { school_name: 'Legacy District', start_date: '2026-10-10', end_date: '2026-10-11', lat: null, lng: null, status: 'reopening_today' },
    { schoolName: 'Returning Today', closureStart: '2026-10-09', reopeningDate: '2026-10-11', status: 'closed' },
    { schoolName: 'Future District', closureStart: '2026-10-12', reopeningDate: '2026-10-19' },
  ] };
  const { closures } = await discoverSchools({ snapshot, snapshotId: 'fixture', cachedClosures });
  expect(callModel).not.toHaveBeenCalled();
  expect(closures).toHaveLength(2);
  expect(closures[0]).toMatchObject({ school_name: 'Legacy District', end_date: '2026-10-11', lat: null, lng: null, status: 'closed' });
  expect(closures[0].reopening_date).toBeUndefined();
  expect(closures[1]).toMatchObject({ school_name: 'Returning Today', status: 'reopening_today' });
  expect(writes[0].school_closures).toEqual(closures);
});

test('return-day context follows local midnight and expires the following day', async () => {
  const cachedClosures = [{ school_name: 'Fixture District', start_date: '2026-10-09',
    reopening_date: '2026-10-14', status: 'closed' }];
  jest.setSystemTime(new Date('2026-10-15T04:30:00Z')); // October 14 in Chicago.
  const onReturnDay = await discoverSchools({ snapshot, snapshotId: 'fixture', cachedClosures });
  expect(onReturnDay.closures).toEqual([expect.objectContaining({ status: 'reopening_today' })]);
  expect(cachedClosures[0].status).toBe('closed'); // The historical record is preserved.
  jest.setSystemTime(new Date('2026-10-15T05:30:00Z'));
  const nextDay = await discoverSchools({ snapshot, snapshotId: 'fixture', cachedClosures });
  expect(nextDay.closures).toEqual([]);
  expect(callModel).not.toHaveBeenCalled();
});

test.each([
  [{ start_date: '2026-10-10', end_date: '2026-10-09' }],
  [{ start_date: '2026-10-10' }],
  [{ start_date: '2026-10-10', end_date: '2026-10-32' }],
  { items: null },
])('invalid cached calendar data fails without dispatch or a successful empty write: %j', async cachedClosures => {
  await expect(discoverSchools({ snapshot, snapshotId: 'fixture', cachedClosures })).rejects.toThrow();
  expect(callModel).not.toHaveBeenCalled();
  expect(writes).toHaveLength(1);
  expect(writes[0].school_closures._generationFailed).toBe(true);
});

test.each(['_generationFailed', '_pending', 'isFallback'])(
  'cached %s marker cannot be hidden by empty or retained items', async marker => {
    for (const items of [[], [{ closureStart: '2026-10-09', reopeningDate: '2026-10-14' }]]) {
      writes.length = 0;
      await expect(discoverSchools({ snapshot, snapshotId: 'fixture', cachedClosures: { [marker]: true, items } }))
        .rejects.toThrow('cached research is incomplete or failed');
      expect(callModel).not.toHaveBeenCalled();
      expect(writes).toHaveLength(1);
      expect(writes[0].school_closures._generationFailed).toBe(true);
      expect(writes[0].school_closures.items).toBeUndefined();
    }
  });

test('cached date filtering still requires the snapshot timezone', async () => {
  await expect(discoverSchools({ snapshot: { ...snapshot, timezone: null }, snapshotId: 'fixture',
    cachedClosures: [] })).rejects.toThrow();
  expect(writes[0].school_closures._generationFailed).toBe(true);
});

test.each([
  { ok: false, error: 'provider HTTP 503' },
  { ok: true, output: '{"error":"school_calendar_verification_failed"}' },
  { ok: true, output: 'not JSON' },
])('provider or research failure never becomes a successful empty school section: %j', async response => {
  callModel.mockResolvedValue(response);
  await expect(discoverSchools({ snapshot, snapshotId: 'fixture' })).rejects.toThrow();
  expect(writes.at(-1).school_closures._generationFailed).toBe(true);
});

test('successful empty research retains the explained-empty contract', async () => {
  const result = await discoverSchools({ snapshot, snapshotId: 'fixture' });
  expect(result).toEqual({ closures: [], reason: 'No school closures found for this area' });
  expect(writes.at(-1).school_closures).toEqual({ items: [], reason: result.reason });
});
