import { describe, test, expect, jest } from '@jest/globals';
import { reconcileEventLists } from '../../server/lib/events/event-read-reconciliation.js';

// Load the real freshness predicate without initializing database infrastructure.
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: {} }));
jest.unstable_mockModule('../../shared/schema.js', () => ({ strategies: {} }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  triadLog: {}, OP: {}, tagLog: jest.fn(),
}));
const { filterFreshEvents } = await import('../../server/lib/strategy/strategy-utils.js');

// Exact displayed titles/times from Desktop's Sept 10 observation. IDs and resolved
// venue identities below are synthetic; these fixtures do not verify event schedules.
const concert = {
  venue_id: 'fixture-pavilion', venue: 'Dos Equis Pavilion', subtype: 'concert',
  event_start_date: '2026-09-10', event_end_date: '2026-09-10',
  event_start_time: '18:30', event_end_time: '22:30',
};
const variants = [
  { ...concert, id: 'report-1', title: 'Mötley Crüe: The Return Of The Carnival Of Sins' },
  { ...concert, id: 'report-2', title: 'The Return Of The Carnival Of Sins: Mötley Crüe, Tesla, and Extreme' },
  { ...concert, id: 'report-3', title: 'The Return Of The Carnival Of Sins: Mötley Crüe', event_end_time: '22:00' },
];
const school = {
  venue_id: 'fixture-ford-center', venue: 'Ford Center at The Star', subtype: 'sports',
  event_start_date: '2026-09-10', event_end_date: '2026-09-10', event_start_time: '19:00',
};

describe('event presentation reconciliation', () => {
  test('groups exact colon reversal and omitted support lineup, retaining every source and conflicting end', () => {
    const originals = variants.map(row => Object.freeze({ ...row }));
    const { local, market } = reconcileEventLists(Object.freeze(originals));
    expect(local).toHaveLength(1);
    expect(market).toEqual([]);
    expect(local[0].event_variants).toEqual(originals);
    expect(local[0].source_event_ids).toEqual(['report-1', 'report-2', 'report-3']);
    expect(local[0].event_end_conflict).toBe(true);
    expect(local[0]).not.toHaveProperty('event_end_time');
    expect(originals[0].event_end_time).toBe('22:30');
  });

  test('retains unresolved school aliases and the @ opponent unchanged', () => {
    const reports = [
      { ...school, id: 'school-1', title: 'Memorial High School @ Emerson High School', event_end_time: '21:00' },
      { ...school, id: 'school-2', title: 'Frisco Memorial vs. Frisco Emerson (High School Football)', event_end_time: '22:00' },
    ];
    expect(reconcileEventLists([...variants, ...reports]).local).toHaveLength(3);
    expect(reconcileEventLists(reports).local).toEqual(reports);
  });

  test.each([
    ['different start', { event_start_time: '20:00' }],
    ['different venue', { venue_id: 'other-resolved-venue' }],
    ['different date span', { event_end_date: '2026-09-11' }],
    ['different performer', { title: 'Another Artist: The Return Of The Carnival Of Sins' }],
    ['different tour', { title: 'Mötley Crüe: A Different Tour' }],
    ['ambiguous colon', { title: 'Mötley Crüe: The Return Of The Carnival Of Sins: Encore' }],
  ])('keeps %s separate', (_label, change) => {
    expect(reconcileEventLists([variants[0], { ...variants[0], id: 'other', ...change }]).local).toHaveLength(2);
  });

  test('does not interpret generic or sports colon titles as concert identities', () => {
    const other = variants.map(row => ({ ...row, subtype: 'sports' }));
    expect(reconcileEventLists(other).local).toHaveLength(3);
    expect(reconcileEventLists([
      { ...school, title: 'Cowboys vs Eagles' }, { ...school, title: 'Cowboys vs Giants' },
    ]).local).toHaveLength(2);
  });

  test('different explicit lineups cannot join via a shorter title', () => {
    const otherLineup = { ...variants[1], id: 'different-lineup', title: 'The Return Of The Carnival Of Sins: Mötley Crüe, Another Support Act' };
    const { local } = reconcileEventLists([variants[0], variants[1], otherLineup]);
    expect(local).toHaveLength(2);
    expect(local[0].source_event_ids).toEqual(['report-1', 'report-2']);
    expect(local[1].id).toBe('different-lineup');
  });

  test('requires resolved venue identity, never substituting report ID, venue text or address', () => {
    const unresolved = variants.map(({ venue_id: _venue, ...row }) => ({ ...row, address: 'same displayed address' }));
    expect(reconcileEventLists(unresolved).local).toHaveLength(3);
    const placeResolved = unresolved.map(row => ({ ...row, place_id: 'fixture-place-id' }));
    expect(reconcileEventLists(placeResolved).local).toHaveLength(1);
  });

  test('requires a known valid start time and normalizes exact equivalent clock values', () => {
    for (const start of [undefined, '', '25:00', '18:65', 'TBD']) {
      expect(reconcileEventLists(variants.map(row => ({ ...row, event_start_time: start }))).local).toHaveLength(3);
    }
    expect(reconcileEventLists([variants[0], { ...variants[1], event_start_time: '6:30 PM' }]).local).toHaveLength(1);
  });

  test('keeps an agreed end, but missing versus known is unresolved', () => {
    const agreed = reconcileEventLists(variants.slice(0, 2)).local[0];
    expect(agreed.event_end_conflict).toBe(false);
    expect(agreed.event_end_time).toBe('22:30');
    const unresolved = reconcileEventLists([variants[0], { ...variants[1], event_end_time: undefined }]).local[0];
    expect(unresolved.event_end_conflict).toBe(true);
    expect(unresolved).not.toHaveProperty('event_end_time');
  });

  test('unifies local and market reports without losing the market source variant', () => {
    const { local, market } = reconcileEventLists([variants[0]], variants.slice(1));
    expect(local).toHaveLength(1);
    expect(market).toHaveLength(0);
    expect(local[0].source_event_ids).toEqual(['report-1', 'report-2', 'report-3']);
  });

  test('filters original reports and retains mixed-expired variants until all reports expire', () => {
    const visibleAt = now => jest.fn(row => {
      const start = new Date(`${row.event_start_date}T${row.event_start_time}:00Z`);
      const end = new Date(`${row.event_end_date}T${row.event_end_time}:00Z`);
      return start <= now && now < end;
    });
    const duringDisagreement = visibleAt(new Date('2026-09-10T22:15:00Z'));
    const result = reconcileEventLists(variants, [], { isVisible: duringDisagreement });
    expect(duringDisagreement.mock.calls.map(([row]) => row)).toEqual(variants);
    expect(result.local).toHaveLength(1);
    expect(result.local[0].event_variants).toEqual(variants);
    expect(result.local[0].event_end_conflict).toBe(true);
    expect(reconcileEventLists(variants, [], { isVisible: visibleAt(new Date('2026-09-10T22:31:00Z')) }).local).toEqual([]);
    expect(reconcileEventLists(variants, [], { isVisible: visibleAt(new Date('2026-09-10T17:00:00Z')) }).local).toEqual([]);
  });

  test('expired local report does not hide a still-visible market report or its conflict', () => {
    const { local, market } = reconcileEventLists([variants[2]], [variants[0]], {
      isVisible: event => event.event_end_time > '22:15',
    });
    expect(local).toEqual([]);
    expect(market).toHaveLength(1);
    expect(market[0].event_variants).toEqual([variants[2], variants[0]]);
    expect(market[0].event_end_conflict).toBe(true);
  });

  test('preserves the real freshness surge window using originals, then expires the whole group', () => {
    const reports = variants.slice(0, 2).map((row, index) => ({
      ...row, event_start_time: '17:00', event_end_time: index ? '18:30' : '18:00',
    }));
    const readAt = (clock, activeOnly = false) => {
      const now = new Date(`2026-09-10T${clock}:00Z`);
      const fresh = new Set(filterFreshEvents(reports, now, 'UTC'));
      return reconcileEventLists(reports, [], {
        // The route's private active-time parser is not imported here. These
        // canonical UTC fixture values exercise the exact-window callback contract.
        isVisible: row => fresh.has(row) && (!activeOnly || (
          new Date(`${row.event_start_date}T${row.event_start_time}:00Z`) <= now &&
          now <= new Date(`${row.event_end_date}T${row.event_end_time}:00Z`)
        )),
      });
    };
    const surge = readAt('20:15').local;
    expect(surge).toHaveLength(1);
    expect(surge[0].event_variants).toEqual(reports);
    expect(surge[0].event_end_conflict).toBe(true);
    expect(surge[0]).not.toHaveProperty('event_end_time');
    expect(readAt('20:31').local).toEqual([]);
    expect(readAt('18:15', true).local[0].event_variants).toEqual(reports);
    expect(readAt('18:31', true).local).toEqual([]);
  });
});
