/**
 * cleanup-events.js — behavioral contract tests (first coverage for this module).
 *
 * Added 2026-07-02 out of the todo #5 investigation. That investigation proved a
 * place_id-equality anchor CANNOT fix the cross-venue duplicate escape (see
 * docs/EVENTS.md §4 and todo #5): venue_catalog.place_id is UNIQUE, so
 * venue_id ↔ place_id is a bijection and any join-based place_id key partitions
 * identically to venue_id. The code change was reverted; these tests pin the
 * venue_id-keyed contract AS IT EXISTS, including the known open limitation.
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

const executeMock = jest.fn();

jest.unstable_mockModule('../server/db/drizzle.js', () => ({
  db: { execute: executeMock },
}));
jest.unstable_mockModule('../server/logger/workflow.js', () => ({
  briefingLog: {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(),
    phase: jest.fn(), done: jest.fn(),
  },
  OP: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const { mergeIntoOverlappingActiveSpan, collapseDuplicateEventSpans } =
  await import('../server/lib/briefing/cleanup-events.js');

const dialect = new PgDialect();
const render = (sqlObj) => dialect.sqlToQuery(sqlObj);

beforeEach(() => {
  executeMock.mockReset();
});

describe('mergeIntoOverlappingActiveSpan — venue_id-keyed write-time merge', () => {
  test('merges an overlapping same-venue titles-matching span and extends it to the union span (exact param order)', async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [{ id: 'row-a', title: 'Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-10' }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const id = await mergeIntoOverlappingActiveSpan({
      venueId: 'venue-a',
      title: 'Wicked',
      startDate: '2026-07-05',
      endDate: '2026-07-14',
    });

    expect(id).toBe('row-a');

    // Candidate scan keys on venue_id and the overlap window.
    const scan = render(executeMock.mock.calls[0][0]);
    expect(scan.sql).toContain('venue_id =');
    expect(scan.sql).toContain('is_active = true');
    expect(scan.params).toEqual(['venue-a', '2026-07-14', '2026-07-05']);

    // Extension UPDATE writes union [start, end] — param ORDER is load-bearing:
    // arrayContaining would pass a start/end swap that writes an inverted span.
    const update = render(executeMock.mock.calls[1][0]);
    expect(update.params).toEqual(['2026-07-01', '2026-07-14', 'row-a']);
  });

  test('with MULTIPLE overlapping candidates, the titles-matching row wins — not rows[0]', async () => {
    // Real data has concurrent distinct shows at one venue; a rows[0]-only
    // implementation must fail here (mutation-verified gap in the prior suite).
    executeMock
      .mockResolvedValueOnce({
        rows: [
          { id: 'row-hamilton', title: 'Hamilton', event_start_date: '2026-07-01', event_end_date: '2026-07-10' },
          { id: 'row-wicked', title: 'Broadway Dallas presents Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-10' },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const id = await mergeIntoOverlappingActiveSpan({
      venueId: 'venue-a',
      title: 'Wicked',
      startDate: '2026-07-05',
      endDate: '2026-07-14',
    });

    expect(id).toBe('row-wicked');
  });

  test('no titles-matching candidate → null, and no extension UPDATE runs', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [{ id: 'row-x', title: 'Hamilton', event_start_date: '2026-07-01', event_end_date: '2026-07-10' }],
    });

    const id = await mergeIntoOverlappingActiveSpan({
      venueId: 'venue-a',
      title: 'Wicked',
      startDate: '2026-07-05',
      endDate: '2026-07-14',
    });

    expect(id).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  test('exact-span match merges without an extension UPDATE', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [{ id: 'row-a', title: 'Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-14' }],
    });

    const id = await mergeIntoOverlappingActiveSpan({
      venueId: 'venue-a',
      title: 'Wicked',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
    });

    expect(id).toBe('row-a');
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  test('single-day events never merge (exact event_hash owns them) — no DB call at all', async () => {
    const id = await mergeIntoOverlappingActiveSpan({
      venueId: 'venue-a',
      title: 'Wicked',
      startDate: '2026-07-05',
      endDate: '2026-07-05',
    });

    expect(id).toBeNull();
    expect(executeMock).not.toHaveBeenCalled();
  });

  test('missing venueId → null with no DB call (unresolved venues never merge)', async () => {
    const id = await mergeIntoOverlappingActiveSpan({
      venueId: null,
      title: 'Wicked',
      startDate: '2026-07-05',
      endDate: '2026-07-14',
    });

    expect(id).toBeNull();
    expect(executeMock).not.toHaveBeenCalled();
  });

  test('DB error is non-fatal: returns null so the caller inserts normally', async () => {
    executeMock.mockRejectedValueOnce(new Error('connection refused'));

    const id = await mergeIntoOverlappingActiveSpan({
      venueId: 'venue-a',
      title: 'Wicked',
      startDate: '2026-07-05',
      endDate: '2026-07-14',
    });

    expect(id).toBeNull();
  });

  test('KNOWN OPEN LIMITATION (todo #5): a different venue_id for the same physical venue does NOT merge', async () => {
    // Pins current behavior deliberately. The cross-venue escape (same physical
    // venue as two venue_catalog rows — e.g. Places-API POI row vs geocode-
    // fallback row) is real and OPEN; a place_id-equality anchor provably cannot
    // close it (UNIQUE constraint → bijection). When a catalog-identity fix
    // lands, update this test intentionally — do not "fix" it in passing.
    executeMock.mockResolvedValueOnce({ rows: [] }); // scan at venue-b sees nothing

    const id = await mergeIntoOverlappingActiveSpan({
      venueId: 'venue-b-same-physical-place-as-a',
      title: 'Wicked',
      startDate: '2026-07-05',
      endDate: '2026-07-14',
    });

    expect(id).toBeNull();
    const scan = render(executeMock.mock.calls[0][0]);
    expect(scan.params).toContain('venue-b-same-physical-place-as-a');
  });
});

describe('collapseDuplicateEventSpans — venue_id-keyed cleanup sweep', () => {
  test('scan targets active rows with a venue link only', async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });

    const n = await collapseDuplicateEventSpans();

    expect(n).toBe(0);
    const scan = render(executeMock.mock.calls[0][0]);
    expect(scan.sql).toContain('is_active = true');
    expect(scan.sql).toContain('venue_id IS NOT NULL');
  });

  test('3-way cluster: widest span survives, BOTH losers are soft-deactivated in one UPDATE', async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          { id: 'loser-1', venue_id: 'venue-a', title: 'Wicked', event_start_date: '2026-07-05', event_end_date: '2026-07-08' },
          { id: 'survivor', venue_id: 'venue-a', title: 'Broadway Dallas presents Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-14' },
          { id: 'loser-2', venue_id: 'venue-a', title: 'Wicked', event_start_date: '2026-07-03', event_end_date: '2026-07-09' },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 2 });

    const n = await collapseDuplicateEventSpans();

    expect(n).toBe(2);
    const update = render(executeMock.mock.calls[1][0]);
    // Both loser ids bound (kills a slice(0,1) regression); survivor absent.
    expect(update.params).toEqual(expect.arrayContaining(['loser-1', 'loser-2']));
    expect(update.params).not.toContain('survivor');
    // Soft-deactivation contract: UPDATE, never DELETE (module + repo rule).
    // Params-only assertions cannot see these inline literals — pin the SQL.
    expect(update.sql).toContain('UPDATE discovered_events');
    expect(update.sql).toContain('is_active = false');
    expect(update.sql).toContain("deactivation_reason = 'duplicate_span'");
    expect(update.sql).not.toContain('DELETE');
  });

  test('same venue, genuinely distinct titles never merge', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        { id: 'e1', venue_id: 'venue-a', title: 'Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-10' },
        { id: 'e2', venue_id: 'venue-a', title: 'FIFA Fan Festival', event_start_date: '2026-07-01', event_end_date: '2026-07-10' },
      ],
    });

    const n = await collapseDuplicateEventSpans();

    expect(n).toBe(0);
    expect(executeMock).toHaveBeenCalledTimes(1); // no UPDATE issued
  });

  test('same venue + matching titles but NON-overlapping dates never merge', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        { id: 'e1', venue_id: 'venue-a', title: 'Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-05' },
        { id: 'e2', venue_id: 'venue-a', title: 'Wicked', event_start_date: '2026-07-10', event_end_date: '2026-07-14' },
      ],
    });

    const n = await collapseDuplicateEventSpans();

    expect(n).toBe(0);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  test('KNOWN OPEN LIMITATION (todo #5): different venue_ids never cluster, even with matching titles + overlap', async () => {
    // Deliberate pin of the open cross-venue escape (see merge-suite twin test).
    executeMock.mockResolvedValueOnce({
      rows: [
        { id: 'e1', venue_id: 'venue-a', title: 'Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-10' },
        { id: 'e2', venue_id: 'venue-b', title: 'Wicked', event_start_date: '2026-07-01', event_end_date: '2026-07-10' },
      ],
    });

    const n = await collapseDuplicateEventSpans();

    expect(n).toBe(0);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  test('DB error is non-fatal: returns 0 so cleanup never blocks discovery', async () => {
    executeMock.mockRejectedValueOnce(new Error('connection refused'));

    const n = await collapseDuplicateEventSpans();

    expect(n).toBe(0);
  });
});
