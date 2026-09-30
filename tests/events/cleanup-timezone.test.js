import { describe, test, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { createRequire } from 'node:module';
import { PgDialect } from 'drizzle-orm/pg-core';

// Test-only dependency (devDependency @electric-sql/pglite); no application DB or
// provider is initialized. VECTO_TEST_PGLITE_MODULE optionally overrides the module path.
const pgliteModule = process.env.VECTO_TEST_PGLITE_MODULE || '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const dialect = new PgDialect();
const execute = jest.fn();
const warn = jest.fn();
const error = jest.fn();
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db: { execute } }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: { warn, error, phase: jest.fn() }, OP: { DB: 'DB' } }));
const { deactivatePastEvents } = await import('../../server/lib/briefing/cleanup-events.js');

describe('event cleanup executes actual generated SQL in disposable in-memory PostgreSQL', () => {
  let memory;
  beforeAll(async () => {
    const { PGlite } = require(pgliteModule);
    memory = new PGlite();
    await memory.exec(`
      CREATE TABLE venue_catalog (venue_id text PRIMARY KEY, timezone text);
      CREATE TABLE discovered_events (
        id text PRIMARY KEY, venue_id text, event_end_date text, event_end_time text,
        is_active boolean DEFAULT true, deactivated_at timestamptz, updated_at timestamptz, deactivated_by text, deactivation_reason text
      );
    `);
  }, 30000);
  afterAll(async () => memory?.close());
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-13T12:00:00Z').getTime());
    await memory.exec('TRUNCATE discovered_events, venue_catalog');
    execute.mockImplementation(async query => {
      const { sql, params } = dialect.sqlToQuery(query);
      return memory.query(sql, params);
    });
    warn.mockClear(); error.mockClear();
  });
  afterEach(() => jest.restoreAllMocks());
  const venue = async (id, timezone) => memory.query('INSERT INTO venue_catalog VALUES ($1, $2)', [id, timezone]);
  const event = async (id, venueId, date, time) => memory.query('INSERT INTO discovered_events (id, venue_id, event_end_date, event_end_time) VALUES ($1, $2, $3, $4)', [id, venueId, date, time]);
  const activeIds = async () => (await memory.query('SELECT id FROM discovered_events WHERE is_active ORDER BY id')).rows.map(row => row.id);

  test('a later timezone cannot expire another markets future event', async () => {
    await venue('tokyo', 'Asia/Tokyo'); await venue('la', 'America/Los_Angeles');
    await event('tokyo-ended', 'tokyo', '2026-09-13', '18:00');
    await event('la-future', 'la', '2026-09-13', '18:00');
    await event('la-ended', 'la', '2026-09-13', '02:00');
    expect(await deactivatePastEvents()).toBe(2);
    const statement = dialect.sqlToQuery(execute.mock.calls.at(-1)[0]).sql;
    expect(statement).toContain('de.event_end_date = ei.event_end_date');
    expect(statement).toContain('de.event_end_time = ei.event_end_time');
    expect(statement).toContain('de.venue_id IS NOT DISTINCT FROM ei.venue_id');
    expect(error).not.toHaveBeenCalled();
    expect(await activeIds()).toEqual(['la-future']);
  });
  test('unknown timezones, orphan venues, and malformed timing are preserved and reported', async () => {
    await venue('missing', null); await venue('invalid', 'Invalid/Timezone'); await venue('valid', 'Asia/Tokyo');
    await event('missing-zone', 'missing', '2026-09-01', '10:00');
    await event('bad-zone', 'invalid', '2026-09-01', '10:00');
    await event('orphan', null, '2026-09-01', '10:00');
    await event('invalid-hour', 'valid', '2026-09-01', '99:99');
    await event('legacy-clock', 'valid', '2026-09-01', '10 AM');
    await event('bad-month', 'valid', '2026-13-01', '10:00');
    await event('bad-day', 'valid', '2026-02-30', '10:00');
    await event('null-date', 'valid', null, '10:00');
    await event('null-time', 'valid', '2026-09-01', null);
    await event('arbitrary-date', 'valid', 'invalid', '10:00');
    await event('year-zero', 'valid', '0000-09-01', '10:00');
    await event('valid-ended', 'valid', '2026-09-13', '18:00');
    expect(await deactivatePastEvents()).toBe(1);
    expect(error).not.toHaveBeenCalled();
    expect(await activeIds()).toHaveLength(11);
    expect(warn).toHaveBeenCalledWith(1, expect.stringContaining('timezone=3, timing=8'), 'DB');
  });
  test('respects the exact two-hour buffer and is idempotent', async () => {
    await venue('la', 'America/Los_Angeles');
    await event('boundary', 'la', '2026-09-13', '03:00');
    await event('just-ended', 'la', '2026-09-13', '02:59');
    expect(await deactivatePastEvents()).toBe(1);
    expect(await activeIds()).toEqual(['boundary']);
    expect(await deactivatePastEvents()).toBe(0);
    const row = (await memory.query("SELECT deactivated_at, updated_at FROM discovered_events WHERE id = 'just-ended'")).rows[0];
    expect(row.deactivated_at).not.toBeNull();
    expect(row.updated_at).not.toBeNull();
  });
  test('the two-hour buffer crosses spring-forward using a real instant before timezone conversion', async () => {
    Date.now.mockReturnValue(new Date('2026-03-08T11:00:00Z').getTime());
    await venue('la', 'America/Los_Angeles');
    await event('ended', 'la', '2026-03-08', '00:59');
    await event('boundary', 'la', '2026-03-08', '01:00');
    expect(await deactivatePastEvents()).toBe(1);
    expect(await activeIds()).toEqual(['boundary']);
  });
  test('ambiguous fall-back end times wait until the later occurrence is two hours old', async () => {
    Date.now.mockReturnValue(new Date('2026-11-01T10:40:00Z').getTime());
    await venue('la', 'America/Los_Angeles');
    await event('ended', 'la', '2026-11-01', '00:30');
    await event('ambiguous', 'la', '2026-11-01', '01:30');
    await event('future', 'la', '2026-11-01', '03:00');
    // 01:30 could be either 08:30Z or 09:30Z. Only the first occurrence is
    // more than two hours old; retain the event until either interpretation is safe.
    expect(await deactivatePastEvents()).toBe(1);
    expect(error).not.toHaveBeenCalled();
    expect(await activeIds()).toEqual(['ambiguous', 'future']);
    Date.now.mockReturnValue(new Date('2026-11-01T11:30:00Z').getTime());
    expect(await deactivatePastEvents()).toBe(0);
    Date.now.mockReturnValue(new Date('2026-11-01T11:31:00Z').getTime());
    expect(await deactivatePastEvents()).toBe(1);
    expect(await activeIds()).toEqual(['future']);
  });
  test('compares local dates across the international date boundary', async () => {
    Date.now.mockReturnValue(new Date('2026-09-13T11:00:00Z').getTime());
    await venue('east', 'Pacific/Kiritimati'); await venue('west', 'Pacific/Honolulu');
    await event('east-ended', 'east', '2026-09-13', '22:59');
    await event('west-future', 'west', '2026-09-13', '01:00');
    expect(await deactivatePastEvents()).toBe(1);
    expect(await activeIds()).toEqual(['west-future']);
  });
});

describe('cleanup failure policy without a database', () => {
  test('logs an SQL failure and preserves discovery availability', async () => {
    execute.mockRejectedValueOnce(new Error('synthetic SQL failure'));
    expect(await deactivatePastEvents()).toBe(0);
    expect(error).toHaveBeenCalled();
  });
});
