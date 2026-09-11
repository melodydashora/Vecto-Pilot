// tests/concierge/nearby-events-predicate.test.js
// 2026-09-11 (todo #62): the concierge's "today's events near me" query silently returned
// zero events for months because it filtered on discovered_events.lat/lng — columns dropped
// by FIX H-7 — and its catch swallowed the invalid-SQL error. These tests compile the ACTUAL
// Drizzle predicate the service builds and prove (a) coordinates come from the joined
// venue_catalog row, (b) results are bounded by distance, (c) a failed query propagates
// instead of masquerading as an empty city. No database, provider or logger connection.
import { jest, describe, test, beforeEach, expect } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({
  eventsLog: log, venuesLog: log, barsLog: log, briefingLog: log, dbLog: log, aiLog: log, OP: {},
  createWorkflowLogger: () => log,
}));
jest.unstable_mockModule('../../server/lib/ai/adapters/index.js', () => ({
  callModel: jest.fn(async () => { throw new Error('Unexpected model dispatch'); }),
}));
jest.unstable_mockModule('../../server/lib/venue/venue-cache.js', () => ({
  findOrCreateVenue: jest.fn(async () => { throw new Error('Unexpected venue write'); }),
}));
jest.unstable_mockModule('../../server/db/connection-manager.js', () => ({
  getPool: () => { throw new Error('Concierge tests must not open a pool'); },
}));

// Captured per query: table, join target/condition, where condition.
let captured, rowsFor;
const db = {
  select: () => {
    const q = { table: null, join: null, where: null };
    const chain = {
      from: t => { q.table = getTableName(t); return chain; },
      innerJoin: (t, cond) => { q.join = { table: getTableName(t), cond }; return chain; },
      where: cond => { q.where = cond; return chain; },
      orderBy: () => chain,
      limit: async () => { captured.push(q); return rowsFor(q.table); },
    };
    return chain;
  },
};
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));

const { searchNearby } = await import('../../server/lib/concierge/concierge-service.js');
const dialect = new PgDialect();
const compile = cond => dialect.sqlToQuery(cond);

// Deterministic point (Dallas area); no real driver data.
const HERE = { lat: 32.78, lng: -96.8 };
const eventRow = (overrides) => ({
  id: 1, title: 'Fixture show', venue_name: 'Fixture Hall', address: '1 Main St', city: 'Dallas',
  state: 'TX', lat: HERE.lat + 0.005, lng: HERE.lng, event_start_date: '2026-09-11',
  event_start_time: '19:00', event_end_time: '22:00', category: 'concert', expected_attendance: 500,
  ...overrides,
});

beforeEach(() => {
  captured = [];
  jest.spyOn(globalThis.console, 'log').mockImplementation(() => {});
  jest.spyOn(globalThis.console, 'error').mockImplementation(() => {});
});

describe('queryNearbyEvents predicate (via searchNearby, DB-first path)', () => {
  test('bounds coordinates on the joined venue_catalog row, never on dropped discovered_events columns', async () => {
    rowsFor = table => table === 'discovered_events'
      ? [eventRow({ id: 1 }), eventRow({ id: 2, title: 'Second' }), eventRow({ id: 3, title: 'Third' })]
      : [];
    const result = await searchNearby({ ...HERE, filter: 'all', timezone: 'America/Chicago' });

    const events = captured.find(q => q.table === 'discovered_events');
    expect(events).toBeDefined();
    expect(events.join.table).toBe('venue_catalog');
    const join = compile(events.join.cond);
    expect(join.sql).toContain('"discovered_events"."venue_id" = "venue_catalog"."venue_id"');

    const where = compile(events.where);
    expect(where.sql).toContain('"venue_catalog"."lat" BETWEEN');
    expect(where.sql).toContain('"venue_catalog"."lng" BETWEEN');
    expect(where.sql).not.toContain('"discovered_events"."lat"');
    expect(where.sql).not.toContain('"discovered_events"."lng"');
    expect(where.sql).not.toContain('undefined');
    // Bound parameters are the ±10-mile bounding box around the caller, in order.
    const latDelta = 10 / 69.0;
    const lngDelta = 10 / (69.0 * Math.cos(HERE.lat * Math.PI / 180));
    expect(where.params).toEqual(expect.arrayContaining([
      HERE.lat - latDelta, HERE.lat + latDelta, HERE.lng - lngDelta, HERE.lng + lngDelta,
    ]));

    expect(result.source).toBe('db');
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({ lat: HERE.lat + 0.005, lng: HERE.lng, source: 'db' });
    expect(result.events[0].distance_hint).toMatch(/^\d+\.\d mi$/);
  });

  test('bounds by distance: rows outside 10 miles or without finite coordinates are dropped', async () => {
    rowsFor = table => table === 'discovered_events'
      ? [
          eventRow({ id: 1, title: 'Near' }),
          eventRow({ id: 2, title: 'Far', lat: HERE.lat + 0.4 }),          // ~27 mi north
          eventRow({ id: 3, title: 'NoCoords', lat: null, lng: null }),
          eventRow({ id: 4, title: 'Near2' }),
          eventRow({ id: 5, title: 'Near3' }),
        ]
      : [];
    const result = await searchNearby({ ...HERE, filter: 'all', timezone: 'America/Chicago' });
    expect(result.events.map(e => e.title).sort()).toEqual(['Near', 'Near2', 'Near3']);
  });

  test('a failed events query propagates with its cause instead of resolving as zero events', async () => {
    rowsFor = table => {
      if (table === 'discovered_events') throw new Error('column "lat" does not exist');
      return [];
    };
    await expect(searchNearby({ ...HERE, filter: 'all', timezone: 'America/Chicago' }))
      .rejects.toThrow('Concierge events DB query failed: column "lat" does not exist');
  });
});
