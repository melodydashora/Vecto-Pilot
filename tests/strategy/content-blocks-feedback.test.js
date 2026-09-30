import { beforeAll, beforeEach, afterAll, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import express from 'express';
import request from 'supertest';
import * as schema from '../../shared/schema.js';
import { completeSnapshot } from '../fixtures/complete-snapshot.js';
import { completeBriefing } from '../fixtures/complete-briefing.js';

// Real saved source, ranking and feedback reads in disposable SQL. Generation,
// providers and the workspace database are not part of this read-only request.
let pg, orm, snapshotId, rankingId, app;
const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const db = new Proxy({}, { get: (_target, key) => typeof orm?.[key] === 'function' ? orm[key].bind(orm) : orm?.[key] });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth: (req, _res, next) => {
  req.auth = { userId, sessionId }; next();
} }));
const updatePhase = jest.fn();
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({ PHASE_EXPECTED_DURATIONS: {}, updatePhase }));
const { router } = await import('../../server/api/strategy/content-blocks.js');
const read = () => request(app).get(`/blocks/strategy/${snapshotId}`);
const savedChoices = async (revision, dismissals, visible) => orm.insert(schema.actions).values({
  action_id: randomUUID(), user_id: userId, snapshot_id: snapshotId, ranking_id: rankingId,
  action: 'venue_feedback_state', created_at: new Date(), raw: {
    version: 1, scope_revision: revision, dismissals, visible_place_ids: visible,
  },
});

beforeAll(async () => {
  pg = new PGlite();
  for (const table of [schema.snapshots, schema.strategies, schema.briefings, schema.rankings, schema.ranking_candidates, schema.actions]) {
    const { name, columns } = getTableConfig(table);
    await pg.exec(`CREATE TABLE "${name}" (${columns.map(column =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`).join(', ')})`);
  }
  orm = drizzle(pg, { schema });
  app = express().use('/blocks', router);
}, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE actions, ranking_candidates, rankings, strategies, briefings, snapshots');
  snapshotId = randomUUID(); rankingId = randomUUID(); updatePhase.mockClear();
  const generatedAt = new Date('2026-09-29T18:00:00Z'), strategyAt = new Date('2026-09-29T18:01:00Z');
  const token = randomUUID();
  await orm.insert(schema.snapshots).values(completeSnapshot({ snapshot_id: snapshotId, user_id: userId,
    session_id: sessionId, createdAt: '2026-09-29T17:59:00Z' }));
  await orm.insert(schema.briefings).values(completeBriefing(snapshotId, {
    id: randomUUID(), generation_token: token, generated_at: generatedAt,
  }));
  await orm.insert(schema.strategies).values({ id: randomUUID(), snapshot_id: snapshotId, user_id: userId,
    status: 'ok', phase: 'complete', strategy_for_now: 'Saved verified guidance', created_at: strategyAt,
    updated_at: strategyAt, venue_cache_metrics: { strategy_source: {
      snapshot_id: snapshotId, briefing_generation_token: token,
      briefing_generated_at: generatedAt.toISOString(), strategy_generated_at: strategyAt.toISOString(),
    } },
  });
  await orm.insert(schema.rankings).values({ ranking_id: rankingId, snapshot_id: snapshotId, user_id: userId,
    model_name: 'synthetic', created_at: strategyAt });
  await orm.insert(schema.ranking_candidates).values(['A', 'B', 'C', 'D', 'E'].map((place, rank) => ({
    id: randomUUID(), ranking_id: rankingId, snapshot_id: snapshotId, block_id: place, place_id: place,
    name: `Synthetic ${place}`, lat: 0, lng: rank * 0.02, rank, value_grade: 'A',
    value_per_min: 10 - rank, estimated_distance_miles: rank, not_worth: false, exploration_policy: 'fixture',
  })));
});
afterAll(async () => { await pg?.close(); });

test('canonical polling preserves a confirmed dismissal and chosen slots across repeated reads', async () => {
  const dismissal = { place_id: 'A', action_id: randomUUID(), venue_name: 'Synthetic A' };
  await savedChoices(1, [dismissal], ['C', 'B', 'D']);
  const before = (await pg.query('SELECT strategy_for_now, updated_at, venue_cache_metrics FROM strategies')).rows[0];
  for (let i = 0; i < 2; i++) {
    const result = await read().expect(200);
    expect(result.body).toMatchObject({ status: 'ok', snapshotId, rankingId, scope_revision: 1,
      dismissed_place_ids: ['A'], dismissals: [dismissal], generatedAt: '2026-09-29T18:01:00.000Z',
      strategyUpdatedAt: '2026-09-29T18:01:00.000Z', snapshotCreatedAt: '2026-09-29T17:59:00.000Z',
      strategy: { strategyForNow: 'Saved verified guidance' },
    });
    expect(result.body.blocks.map(block => block.placeId)).toEqual(['C', 'B', 'D']);
    expect(result.body.blocks.every(block => block.rankingId === rankingId)).toBe(true);
  }
  expect((await pg.query('SELECT strategy_for_now, updated_at, venue_cache_metrics FROM strategies')).rows[0]).toEqual(before);
  expect((await pg.query('SELECT count(*)::int AS n FROM actions')).rows[0].n).toBe(1);
  expect(updatePhase).not.toHaveBeenCalled();
});

test('the latest persisted restore replaces an older dismissal without changing source receipts', async () => {
  await savedChoices(1, [{ place_id: 'A', action_id: randomUUID() }], ['B', 'C', 'D']);
  await savedChoices(2, [], ['A', 'C', 'B']);
  const result = await read().expect(200);
  expect(result.body.scope_revision).toBe(2);
  expect(result.body.dismissed_place_ids).toEqual([]);
  expect(result.body.blocks.map(block => block.placeId)).toEqual(['A', 'C', 'B']);
  expect(result.body.blocks[0].coordinates).toEqual({ lat: 0, lng: 0 });
  expect(result.body.generatedAt).toBe('2026-09-29T18:01:00.000Z');
});

test('a ranking without saved feedback retains its original candidate response', async () => {
  const result = await read().expect(200);
  expect(result.body.scope_revision).toBe(0);
  expect(result.body.dismissed_place_ids).toEqual([]);
  expect(result.body.blocks.map(block => block.placeId)).toEqual(['A', 'B', 'C', 'D', 'E']);
});

test('an owned empty ranking remains a completed empty response', async () => {
  await pg.exec('TRUNCATE ranking_candidates');
  const result = await read().expect(200);
  expect(result.body).toMatchObject({ status: 'ok', blocks: [], rankingId, scope_revision: 0 });
});

test('a foreign ranking scope cannot fall back to unfiltered saved candidates', async () => {
  await pg.query('UPDATE rankings SET user_id=$1', [randomUUID()]);
  const result = await read().expect(404);
  expect(result.body).toMatchObject({ status: 'error', error: 'ranking_not_found', strategyFresh: false, blocks: [] });
  expect(result.body.strategy).toBeUndefined();
  expect(updatePhase).not.toHaveBeenCalled();
});

test('missing ranking still waits for venues rather than treating feedback scope as an error', async () => {
  await pg.exec('TRUNCATE rankings');
  const result = await read().expect(200);
  expect(result.body).toMatchObject({ status: 'pending_blocks', waitFor: ['blocks'], blocks: [],
    generatedAt: '2026-09-29T18:01:00.000Z', strategy: { strategyForNow: 'Saved verified guidance' },
  });
});
