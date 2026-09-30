import { jest, beforeAll, beforeEach, afterAll, test, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const dialect = new PgDialect();
let pg, orm, realPostgres = false;
// PGlite has one serialized connection and no advisory-lock implementation.
// Exercise all actual data SQL here; cleanupEvents.test separately checks lock
// placement and interleaved writers. The opt-in disposable Postgres mode also
// executes real advisory locks across pooled connections.
const adapt = tx => ({ execute: query => !realPostgres && dialect.sqlToQuery(query).sql.includes('pg_advisory_xact_lock') ? Promise.resolve({ rows: [] }) : tx.execute(query) });
const db = { execute: query => orm.execute(query), transaction: write => orm.transaction(tx => write(adapt(tx))) };
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ briefingLog: new Proxy({}, { get: () => jest.fn() }), OP: {} }));
const { withEventVenueLock, resolveEventWriteHash, mergeIntoOverlappingActiveSpan, discoveryReactivationFields } = await import('../../server/lib/briefing/cleanup-events.js');
const venueId = '00000000-0000-4000-8000-000000000001';
const event = extra => ({ venue_id: venueId, title: 'Fixture show', event_start_date: '2026-09-29', event_end_date: '2026-09-29', event_start_time: '19:00', event_end_time: '22:00', ...extra });
beforeAll(async () => {
 if (process.env.VECTO_RUN_DATABASE_TESTS === '1') {
  const selected = new URL(process.env.DATABASE_URL || '');
  if (selected.hostname !== '127.0.0.1' || selected.port !== '55432' || selected.pathname !== '/vecto_preview' ||
      process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1') {
   throw new Error('Refusing event acceptance outside disposable 127.0.0.1:55432/vecto_preview.');
  }
  const { Pool } = await import('pg');
  const { drizzle: postgresDrizzle } = await import('drizzle-orm/node-postgres');
  const schemaName = `event_writer_fixture_${process.pid}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, options: `-c search_path=${schemaName}` });
  const actual = (await pool.query('SELECT current_database() AS name, inet_server_port() AS port')).rows[0];
  expect(actual).toEqual({ name: 'vecto_preview', port: 55432 });
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  pg = { exec: query => pool.query(query), query: (query, params) => pool.query(query, params), close: async () => {
   try { await pool.query(`DROP SCHEMA "${schemaName}" CASCADE`); } finally { await pool.end(); }
  } };
  realPostgres = true; orm = postgresDrizzle(pool);
 } else { pg = new PGlite(); orm = drizzle(pg); }
 await pg.exec('CREATE TABLE discovered_events(id uuid PRIMARY KEY, venue_id uuid, city text, state text, venue_name text, address text, title text, event_hash text UNIQUE, event_start_date text, event_end_date text, event_start_time text, event_end_time text, is_active boolean DEFAULT true, updated_at timestamptz, deactivated_at timestamptz, deactivated_by text, deactivation_reason text)');
}, 30000);
beforeEach(async () => { await pg.exec('TRUNCATE discovered_events'); });
afterAll(async () => { await pg?.close(); });
async function write(event, hash = 'legacy') {
 return withEventVenueLock(event.venue_id, async tx => {
  const merged = await mergeIntoOverlappingActiveSpan({ venueId: event.venue_id, title: event.title, startDate: event.event_start_date, endDate: event.event_end_date, startTime: event.event_start_time, endTime: event.event_end_time }, tx, { returnRecord: true });
  if (merged) return merged.event_hash;
  const stored = await resolveEventWriteHash(tx, event, hash);
  await tx.execute(sql`INSERT INTO discovered_events(id,venue_id,title,event_hash,event_start_date,event_end_date,event_start_time,event_end_time)
    VALUES(${randomUUID()}::uuid,${event.venue_id}::uuid,${event.title},${stored},${event.event_start_date},${event.event_end_date},${event.event_start_time},${event.event_end_time})
    ON CONFLICT(event_hash) DO NOTHING`);
  return stored;
 });
}
test('actual stored SQL retains both performances and repeated simultaneous variants dedupe', async () => {
 expect(await write(event())).toBe('legacy');
 const matinee = event({ event_start_time: '14:00', event_end_time: '17:00' });
 const hashes = await Promise.all([write(matinee), write(matinee), write(event())]);
 expect(hashes[0]).toBe(hashes[1]); expect(hashes[0]).not.toBe('legacy'); expect(hashes[2]).toBe('legacy');
 const rows = (await pg.query('SELECT event_hash,event_start_time,event_end_time FROM discovered_events ORDER BY event_start_time')).rows;
 expect(rows).toHaveLength(2); expect(rows.map(r => r.event_start_time)).toEqual(['14:00', '19:00']);
});
test('actual span union expands both ends and retains canonical hash', async () => {
 await write(event({ event_start_date: '2026-09-20', event_end_date: '2026-09-30' }));
 expect(await write(event({ event_start_date: '2026-09-18', event_end_date: '2026-10-02' }), 'rediscovery')).toBe('legacy');
 expect((await pg.query('SELECT event_start_date,event_end_date FROM discovered_events')).rows).toEqual([{ event_start_date: '2026-09-18', event_end_date: '2026-10-02' }]);
});
test('failed work rolls its union back with the transaction', async () => {
 await write(event({ event_start_date: '2026-09-20', event_end_date: '2026-09-30' }));
 await expect(withEventVenueLock(venueId, async tx => {
  await mergeIntoOverlappingActiveSpan({ venueId, title: 'Fixture show', startDate: '2026-09-18', endDate: '2026-10-02', startTime: '19:00', endTime: '22:00' }, tx);
  throw new Error('Fixture abort');
 })).rejects.toThrow('Fixture abort');
 expect((await pg.query('SELECT event_start_date,event_end_date FROM discovered_events')).rows).toEqual([{ event_start_date: '2026-09-20', event_end_date: '2026-09-30' }]);
});


test('discovery update preserves explicit and unattributed removal; only attributed expiry may reactivate', async () => {
 const values = discoveryReactivationFields();
 for (const [by, reason, expected] of [['driver-id', 'cancelled', false], ['ai_coach', 'incorrect', false], [null, null, false], ['cleanup', 'duplicate_span', false], ['cleanup', 'past_event', true]]) {
  await pg.exec('TRUNCATE discovered_events');
  await write(event());
  await pg.query('UPDATE discovered_events SET is_active=false,deactivated_by=$1,deactivation_reason=$2,deactivated_at=NOW()', [by, reason]);
  await orm.execute(sql`UPDATE discovered_events SET is_active=${values.is_active}, deactivated_at=${values.deactivated_at}, deactivated_by=${values.deactivated_by}, deactivation_reason=${values.deactivation_reason}`);
  const stored = (await pg.query('SELECT is_active,deactivated_by,deactivation_reason FROM discovered_events')).rows[0];
  expect(stored).toEqual({ is_active: expected, deactivated_by: expected ? null : by, deactivation_reason: expected ? null : reason });
 }
});


test('simultaneous extensions preserve both ends of the existing run', async () => {
 await write(event({ event_start_date: '2026-09-20', event_end_date: '2026-09-30' }));
 const hashes = await Promise.all([
  write(event({ event_start_date: '2026-09-18', event_end_date: '2026-09-30' }), 'earlier-report'),
  write(event({ event_start_date: '2026-09-20', event_end_date: '2026-10-04' }), 'later-report'),
  write(event({ event_start_date: '2026-09-19', event_end_date: '2026-10-02' }), 'overlap-report'),
 ]);
 expect(hashes).toEqual(['legacy', 'legacy', 'legacy']);
 expect((await pg.query('SELECT event_start_date,event_end_date FROM discovered_events')).rows).toEqual([
  { event_start_date: '2026-09-18', event_end_date: '2026-10-04' },
 ]);
});
