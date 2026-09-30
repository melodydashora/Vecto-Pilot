/**
 * cleanup-events.js — behavioral contract tests (first coverage for this module).
 *
 * Added 2026-07-02 out of the todo #5 investigation. That investigation proved a
 * place_id-equality anchor CANNOT fix the cross-venue duplicate escape (see
 * docs/EVENTS.md §4 and todo #5): venue_catalog.place_id is UNIQUE, so
 * venue_id ↔ place_id is a bijection and any join-based place_id key partitions
 * identically to venue_id. The code change was reverted; these tests pin the
 * venue_id-keyed historical contract. September 29 repairs below add atomic writers and preserve ambiguous performance schedules.
 *
 * Test-design rules (from the 2026-07-02 adversarial review — keep them):
 *   - Fixtures must be representable under the live schema constraints. Never
 *     mock a DB state the constraints forbid; that certifies unreachable code.
 *   - Assertions are mutation-informed: multi-candidate selection, multi-loser
 *     UPDATE binding, the soft-deactivation SQL contract, and exact param ORDER
 *     on the extension UPDATE were each verified to kill a mutant that the
 *     naive assertions let pass.
 *
 * db.execute is mocked (unit scope); captured drizzle `sql` objects are rendered
 * through PgDialect (exported + typed in drizzle-orm 0.45.2) to assert query
 * shape and bound params. titlesMatch is the REAL discovery matcher (import-free
 * module), so title semantics stay pinned to production behavior. No clock
 * dependence: neither function reads "today" — all dates are caller-supplied
 * strings, so fixed fixture dates are safe (lessons_learned row 5 applies only
 * to today-relative logic).
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
const executeMock = jest.fn(), transactions = jest.fn();
const db = { execute: executeMock, transaction: transactions };
jest.unstable_mockModule('../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../server/logger/workflow.js', () => ({ briefingLog: new Proxy({}, { get: () => jest.fn() }), OP: {} }));
const { mergeIntoOverlappingActiveSpan, collapseDuplicateEventSpans, withEventVenueLock, resolveEventWriteHash } = await import('../server/lib/briefing/cleanup-events.js');
const dialect = new PgDialect();
const render = query => dialect.sqlToQuery(query);
const row = (id, extra = {}) => ({ id, venue_id: 'venue-a', title: 'Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-14', event_start_time: '19:00', event_end_time: '22:00', ...extra });
const incoming = extra => ({ venueId: 'venue-a', title: 'Wicked', startDate: '2026-07-05', endDate: '2026-07-18', startTime: '19:00', endTime: '22:00', ...extra });
beforeEach(() => { executeMock.mockReset(); transactions.mockReset().mockImplementation(write => write(db)); });
describe('serialized span writers', () => {
 test('union is monotonic SQL and not a stale SELECT-computed replacement', async () => {
  executeMock.mockResolvedValueOnce({ rows: [row('existing')] }).mockResolvedValueOnce({ rowCount: 1 });
  expect(await mergeIntoOverlappingActiveSpan(incoming())).toBe('existing');
  const scan = render(executeMock.mock.calls[0][0]), update = render(executeMock.mock.calls[1][0]);
  expect(scan.sql).toContain('FOR UPDATE'); expect(scan.params).toEqual(['venue-a', '2026-07-18', '2026-07-05']);
  expect(update.sql).toContain('LEAST(event_start_date'); expect(update.sql).toContain('GREATEST(event_end_date'); expect(update.params).toEqual(['2026-07-05', '2026-07-18', 'existing']);
 });
 test.each([{ startDate: '2026-07-05', endDate: '2026-07-05' }, { startDate: '2026-07-05', endDate: '2026-07-06' }, { venueId: null }, { startTime: null }])('single/overnight/unknown spans %j never merge', async extra => {
  expect(await mergeIntoOverlappingActiveSpan(incoming(extra))).toBeNull(); expect(executeMock).not.toHaveBeenCalled();
 });
 test.each([
  [row('single', { event_end_date: '2026-07-01' })], [row('matinee', { event_start_time: '14:00' })],
  [row('different', { title: 'Hamilton' })], [row('a'), row('b')], [],
 ].map(rows => ({ rows })))('incompatible or ambiguous candidates remain source variants (%j)', async ({ rows }) => {
  executeMock.mockResolvedValue({ rows }); expect(await mergeIntoOverlappingActiveSpan(incoming())).toBeNull(); expect(executeMock).toHaveBeenCalledTimes(1);
 });
 test('a matching row after another title is found without erasing the other performance', async () => {
  executeMock.mockResolvedValueOnce({ rows: [row('other', { title: 'Hamilton' }), row('match')] }).mockResolvedValueOnce({ rowCount: 1 });
  expect(await mergeIntoOverlappingActiveSpan(incoming())).toBe('match');
 });
 test('database failure aborts the write instead of becoming insert permission', async () => {
  executeMock.mockRejectedValue(new Error('fixture unavailable')); await expect(mergeIntoOverlappingActiveSpan(incoming())).rejects.toThrow('fixture unavailable');
 });
 test('venue lock encloses both the overlap check and the insertion callback', async () => {
  const tx = { execute: jest.fn(async () => ({ rows: [] })) }; transactions.mockImplementation(async write => write(tx));
  const write = jest.fn(async executor => { expect(executor).toBe(tx); expect(tx.execute).toHaveBeenCalledTimes(1); return 'insert receipt'; });
  expect(await withEventVenueLock('venue-a', write)).toBe('insert receipt');
  expect(render(tx.execute.mock.calls[0][0]).sql).toContain('pg_advisory_xact_lock'); expect(render(tx.execute.mock.calls[0][0]).params).toEqual(['event-venue:venue-a']);
 });
 test('two simultaneous miss-to-insert writers serialize into one union', async () => {
  let tail = Promise.resolve(); const saved = [];
  transactions.mockImplementation(async write => {
   let release;
   const tx = { execute: async query => {
    const { sql, params } = render(query);
    if (sql.includes('pg_advisory_xact_lock')) { const previous = tail; tail = new Promise(resolve => { release = resolve; }); await previous; return {}; }
    if (sql.includes('SELECT id')) return { rows: structuredClone(saved) };
    if (sql.includes('LEAST')) { saved[0].event_start_date = [saved[0].event_start_date, params[0]].sort()[0]; saved[0].event_end_date = [saved[0].event_end_date, params[1]].sort().at(-1); return {}; }
    throw new Error('Unexpected SQL');
   } };
   try { return await write(tx); } finally { release?.(); }
  });
  const persist = extra => withEventVenueLock('venue-a', async tx => { const event = incoming(extra); const merged = await mergeIntoOverlappingActiveSpan(event, tx); if (!merged) saved.push(row('inserted', { event_start_date: event.startDate, event_end_date: event.endDate })); });
  await Promise.all([persist({ startDate: '2026-07-03', endDate: '2026-07-18' }), persist({ startDate: '2026-07-01', endDate: '2026-07-20' })]);
  expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ event_start_date: '2026-07-01', event_end_date: '2026-07-20' });
 });
});
describe('conservative cleanup', () => {
 function scan(rows) { executeMock.mockImplementation(async query => { const { sql } = render(query); if (sql.includes('SELECT DISTINCT')) return { rows: [{ venue_id: 'venue-a' }] }; if (sql.includes('SELECT id')) return { rows }; if (sql.includes('UPDATE')) return { rowCount: 2 }; return {}; }); }
 test('contained matching multi-day variants soft-deactivate under the writer lock', async () => {
  scan([row('loser1', { event_start_date: '2026-07-05', event_end_date: '2026-07-08' }), row('survivor'), row('loser2', { event_start_date: '2026-07-03', event_end_date: '2026-07-09' })]);
  expect(await collapseDuplicateEventSpans()).toBe(2);
  const statements = executeMock.mock.calls.map(([q]) => render(q)); const update = statements.find(q => q.sql.includes('UPDATE discovered_events'));
  expect(statements.some(q => q.sql.includes('pg_advisory_xact_lock'))).toBe(true);
  expect(update.params).toEqual(['venue-a', 'loser2', 'loser1']); expect(update.sql).toContain("deactivation_reason = 'duplicate_span'"); expect(update.sql).not.toContain('DELETE');
 });
 test.each([
  [row('a', { event_end_date: '2026-07-01' }), row('b', { event_end_date: '2026-07-01', event_start_time: '14:00' })],
  [row('a'), row('b', { event_start_time: '14:00' })],
  [row('a'), row('b', { event_start_date: '2026-07-05', event_end_date: '2026-07-20' })],
  [row('a'), row('b', { event_end_time: null })],
 ].map(rows => ({ rows })))('single-day, different-clock, partial-overlap and unknown schedules survive (%j)', async ({ rows }) => {
  scan(rows); expect(await collapseDuplicateEventSpans()).toBe(0); expect(executeMock.mock.calls.map(([q]) => render(q).sql).some(sql => sql.includes('UPDATE discovered_events'))).toBe(false);
 });
 test('cleanup error is reported and leaves events untouched', async () => { executeMock.mockRejectedValue(new Error('outage')); expect(await collapseDuplicateEventSpans()).toBe(0); });
});


describe('timed source variants retain compatible stored identities', () => {
 const event = row('first', { event_start_date: '2026-07-01', event_end_date: '2026-07-01' });
 test('new and identical first-show schedules keep their original hash', async () => {
  executeMock.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [] });
  expect(await resolveEventWriteHash(db, event, 'legacy-hash')).toBe('legacy-hash');
  executeMock.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [event] });
  expect(await resolveEventWriteHash(db, event, 'legacy-hash')).toBe('legacy-hash');
 });
 test('same venue/title/day matinee and evening get separate stable identities without overwriting the first', async () => {
  executeMock.mockImplementation(async query => ({ rows: render(query).sql.includes('SELECT venue_id') ? [event] : [] }));
  const matinee = { ...event, event_start_time: '14:00', event_end_time: '17:00' };
  const first = await resolveEventWriteHash(db, matinee, 'legacy-hash');
  expect(first).not.toBe('legacy-hash'); expect(await resolveEventWriteHash(db, matinee, 'legacy-hash')).toBe(first);
  expect(await resolveEventWriteHash(db, { ...matinee, event_start_time: '10:00' }, 'legacy-hash')).not.toBe(first);
  expect(executeMock.mock.calls.map(([q]) => render(q).sql).some(sql => sql.includes('UPDATE'))).toBe(false);
 });
 test('unknown saved timing or another known venue stays a separate source variant', async () => {
  executeMock.mockImplementation(async query => ({ rows: render(query).sql.includes('SELECT venue_id') ? [{ ...event, event_start_time: null }] : [] }));
  expect(await resolveEventWriteHash(db, event, 'legacy-hash')).not.toBe('legacy-hash');
 });
});


test('venue tag refresh follows the successful event callback inside the same lock transaction', async () => {
 const order = []; const tx = { execute: async query => { const text = render(query).sql; order.push(text.includes('pg_advisory') ? 'lock' : 'tag'); return {}; } };
 transactions.mockImplementation(write => write(tx));
 await withEventVenueLock('venue-a', async () => { order.push('insert'); }, { refreshTag: true });
 expect(order).toEqual(['lock', 'insert', 'tag']);
});
