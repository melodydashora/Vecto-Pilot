import { beforeEach, afterEach, test, expect, jest } from '@jest/globals';
import { formatCoachSourceContext } from '../../server/lib/ai/coach-source-context.js';

const snapshot = { snapshot_id: 'saved-context', timezone: 'America/Chicago',
  created_at: '2026-10-09T14:00:00Z', local_iso: '2026-10-09T09:00:00' };
const closure = { schoolName: 'Fixture District', closureStart: '2026-10-09', reopeningDate: '2026-10-14',
  reason: 'Fall break', status: 'closed', extra_calendar_evidence: { retained: true } };
const row = section => ({ snapshot_id: 'saved-context', status: 'complete',
  generated_at: '2026-10-09T14:02:00Z', school_closures: section });
function records(snapshotValue = snapshot, briefing = row([closure]), context) {
  const prompt = formatCoachSourceContext(snapshotValue, briefing, context);
  return JSON.parse(prompt.slice(prompt.indexOf('\n{') + 1, prompt.lastIndexOf('\n=== END SAVED SOURCE RECORDS ===')));
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-13T18:00:00Z'));
});
afterEach(() => jest.useRealTimers());

test.each([
  ['2026-10-13', 'closed'],
  ['2026-10-14', 'reopening_today'],
  ['2026-10-15', null],
])('classifies saved school dates on %s without changing the source records', (today, expected) => {
  jest.setSystemTime(new Date(`${today}T18:00:00Z`));
  const original = row([closure]);
  const result = records(snapshot, original);
  expect(result.snapshot).toEqual(snapshot);
  expect(result.briefing).toEqual(original);
  expect(result.school_calendar_context).toMatchObject({
    source_state: 'derived_from_saved_dates', local_date: today, timezone: 'America/Chicago', status: 'available',
  });
  expect(result.school_calendar_context.items).toEqual(expected ? [{
    school_name: 'Fixture District', status: expected, closure_start: '2026-10-09',
    closed_through: '2026-10-13', student_return_date: '2026-10-14',
  }] : []);
  expect(original.school_closures[0].status).toBe('closed');
});

test('uses the raw snapshot timezone and current day rather than wrapper or saved clock fields', () => {
  jest.setSystemTime(new Date('2026-10-14T02:00:00Z'));
  const rawSnapshot = { ...snapshot, timezone: 'America/Los_Angeles' };
  const rawBriefing = row([closure]);
  const result = records({ timezone: 'Asia/Tokyo', source_record: rawSnapshot },
    { source_record: rawBriefing, school_closures: [] });
  expect(result.school_calendar_context).toMatchObject({ local_date: '2026-10-13',
    timezone: 'America/Los_Angeles', items: [{ status: 'closed' }] });
  expect(result.snapshot).toEqual(rawSnapshot);
  expect(result.briefing).toEqual(rawBriefing);
});

test('legacy inclusive end dates do not invent a student return day', () => {
  const legacy = { school_name: 'Legacy District', start_date: '2026-10-09', end_date: '2026-10-13' };
  expect(records(snapshot, row({ items: [legacy] })).school_calendar_context.items).toEqual([{
    school_name: 'Legacy District', status: 'closed', closure_start: '2026-10-09', closed_through: '2026-10-13',
  }]);
  jest.setSystemTime(new Date('2026-10-14T18:00:00Z'));
  expect(records(snapshot, row([legacy])).school_calendar_context.items).toEqual([]);
});

test('explicit return dates override legacy end dates and stale stored status', () => {
  jest.setSystemTime(new Date('2026-10-14T18:00:00Z'));
  const saved = { ...closure, reopening_date: '2026-10-14', end_date: '2026-10-20', status: 'closed' };
  expect(records(snapshot, row([saved])).school_calendar_context.items[0]).toMatchObject({
    status: 'reopening_today', closed_through: '2026-10-13', student_return_date: '2026-10-14',
  });
  const future = { ...closure, closureStart: '2026-10-16', reopeningDate: '2026-10-19', status: 'reopening_today' };
  expect(records(snapshot, row([future])).school_calendar_context.items).toEqual([]);
});

test.each([null, undefined, '', 'Invalid/Timezone'])('missing or invalid snapshot timezone %s is unavailable, not empty', timezone => {
  const result = records({ ...snapshot, timezone });
  expect(result.school_calendar_context).toMatchObject({ status: 'unavailable', local_date: null, items: null });
  expect(result.briefing).toEqual(row([closure]));
});

test.each([
  [{ _pending: true, items: [] }, 'pending'],
  [{ _generationFailed: true, items: [closure], error: 'Provider timeout' }, 'failed'],
  [{ isFallback: true, items: [closure] }, 'failed'],
  [null, 'unavailable'],
  [undefined, 'unavailable'],
  [{ items: null }, 'invalid'],
  ['not a calendar', 'invalid'],
  [[], 'invalid'],
  [[{ ...closure, closureStart: '2026-02-30' }], 'invalid'],
  [[{ schoolName: 'Missing return', closureStart: '2026-10-09' }], 'invalid'],
])('source state %j cannot become an empty calendar result', (section, status) => {
  const result = records(snapshot, row(section));
  expect(result.school_calendar_context).toMatchObject({ status, items: null });
  expect(result.school_calendar_context.reason).toEqual(expect.any(String));
});

test('valid saved rows do not hide a malformed record that would otherwise be filtered out', () => {
  const invalidFuture = { closureStart: '2026-12-30', reopeningDate: '2026-12-32' };
  expect(records(snapshot, row([closure, invalidFuture])).school_calendar_context)
    .toMatchObject({ status: 'invalid', items: null });
});

test('missing, pending, and failed source reads stay distinct', () => {
  expect(records(snapshot, null).school_calendar_context).toMatchObject({ status: 'unavailable', items: null });
  expect(records(snapshot, { exists: false, source_state: 'missing', status: 'pending', source_record: null })
    .school_calendar_context).toMatchObject({ status: 'unavailable', items: null });
  expect(records(snapshot, { exists: false, source_state: 'read_failed', status: 'error', source_record: null })
    .school_calendar_context).toMatchObject({ status: 'failed', items: null });
  expect(records(snapshot, { status: 'pending', school_closures: null }).school_calendar_context)
    .toMatchObject({ status: 'pending', items: null });
});

test('an explained empty saved section is available without claiming a fresh lookup', () => {
  const result = records(snapshot, row({ items: [], reason: 'No school breaks found at source collection' }));
  expect(result.school_calendar_context).toMatchObject({ source_state: 'derived_from_saved_dates', status: 'available', items: [] });
  const prompt = formatCoachSourceContext(snapshot, row([closure]));
  expect(prompt).toContain('not a fresh lookup');
  expect(prompt).toContain('reopening_today means students return today, not currently closed');
  expect(prompt).toContain('Raw records remain historical evidence');
});

test('preserves all raw and existing context fields while a sibling pipeline has failed', () => {
  const originalSnapshot = Object.freeze({ ...snapshot, nested: Object.freeze({ preserved: true }) });
  const original = Object.freeze({ ...row(Object.freeze([Object.freeze({ ...closure })])), status: 'error',
    news: Object.freeze({ _generationFailed: true, error: 'Saved news failure' }), custom_section: { raw: 'retained' } });
  const beforeSnapshot = JSON.stringify(originalSnapshot);
  const beforeBriefing = JSON.stringify(original);
  const context = { strategy: { text: 'Saved strategy' }, offerHistory: { offers: [{ id: 'fixture' }] },
    offerRules: { source_state: 'saved' }, driverProfile: { selected_services: ['fixture'] },
    driverVehicle: { year: 2026 }, progress: { briefing: { state: 'failed' } } };
  const result = records({ source_record: originalSnapshot }, { source_record: original }, context);
  expect(JSON.stringify(result.snapshot)).toBe(beforeSnapshot);
  expect(JSON.stringify(result.briefing)).toBe(beforeBriefing);
  expect(JSON.stringify(originalSnapshot)).toBe(beforeSnapshot);
  expect(JSON.stringify(original)).toBe(beforeBriefing);
  expect(result).toMatchObject({ strategy: context.strategy, offer_history: context.offerHistory, offer_rules: context.offerRules,
    driver_profile: context.driverProfile, driver_vehicle: context.driverVehicle, progress: context.progress });
  expect(result.school_calendar_context).toMatchObject({ status: 'available', items: [{ status: 'closed' }] });
});
