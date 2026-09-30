// Real Express feedback/blocks routers, canonical transformer and SQL in a new
// in-memory PostgreSQL-compatible PGlite database. Auth/providers are synthetic;
// this is separate evidence from the real disposable PostgreSQL preview.
import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../shared/schema.js';
import { parseVenueFeedbackInput } from '../../server/lib/venue/venue-feedback.js';

const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const userA = '00000000-0000-4000-8000-00000000000a';
const userB = '00000000-0000-4000-8000-00000000000b';
let pg, sqlDb, app, scopeA, scopeB;
let clock = Date.parse('2026-09-11T02:30:00Z');
const db = new Proxy({}, { get: (_target, key) => (...args) => sqlDb[key](...args) });
const mustNotGenerate = jest.fn(async () => { throw new Error('Unexpected external generation/address request'); });
const indexFeedback = jest.fn(async () => {});
const capturelearning = jest.fn(async () => {});
const log = new Proxy({}, { get: () => jest.fn() });
jest.unstable_mockModule('../../server/db/drizzle.js', () => ({ db }));
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, res, next) {
  const userId = { 'Bearer synthetic-a': userA, 'Bearer synthetic-b': userB }[req.headers.authorization];
  if (!userId) return res.status(401).json({ error: 'synthetic_auth_required' });
  req.auth = { userId }; next();
} }));
jest.unstable_mockModule('../../server/middleware/learning-capture.js', () => ({ capturelearning, LEARNING_EVENTS: { VENUE_FEEDBACK: 'venue_feedback' } }));
jest.unstable_mockModule('../../server/lib/external/semantic-search.js', () => ({ indexFeedback }));
jest.unstable_mockModule('../../server/logger/workflow.js', () => ({ sseLog: log, venuesLog: log, dbLog: log, briefingLog: log, matrixLog: log }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ expensiveEndpointLimiter: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/lib/strategy/strategy-utils.js', () => ({
  isStrategyReady: async () => ({ ready: true, status: 'ok' }), ensureStrategyRow: mustNotGenerate, updatePhase: mustNotGenerate,
}));
jest.unstable_mockModule('../../server/lib/ai/providers/briefing.js', () => ({ runBriefing: mustNotGenerate }));
jest.unstable_mockModule('../../server/lib/ai/providers/consolidator.js', () => ({ runImmediateStrategy: mustNotGenerate }));
jest.unstable_mockModule('../../server/lib/venue/enhanced-smart-blocks.js', () => ({ generateEnhancedSmartBlocks: mustNotGenerate }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ resolveVenueAddressesBatch: mustNotGenerate }));
jest.unstable_mockModule('../../server/events/phase-emitter.js', () => ({ phaseEmitter: {} }));
const { default: feedbackRouter } = await import('../../server/api/feedback/feedback.js');
const { default: blocksRouter } = await import('../../server/api/strategy/blocks-fast.js');

beforeAll(async () => {
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  pg = new PGlite();
  sqlDb = drizzle(pg);
  // Real column names/types from current schema; explicit relevant identity and
  // receipt constraints, without bootstrapping the application or migrations.
  for (const table of [schema.snapshots, schema.rankings, schema.ranking_candidates, schema.venue_catalog, schema.venue_feedback, schema.actions, schema.strategies, schema.briefings]) {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`);
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(', ')})`);
  }
  await pg.exec(`
    ALTER TABLE venue_feedback ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE venue_feedback ALTER COLUMN created_at SET DEFAULT now();
    -- Actual preview schema has no user/ranking/place unique constraint. The
    -- production helper must serialize writes using its existing ranking lock.
    ALTER TABLE venue_feedback ADD FOREIGN KEY (ranking_id) REFERENCES rankings(ranking_id);
    ALTER TABLE venue_feedback ADD FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id);
    ALTER TABLE venue_feedback ADD CHECK (sentiment IN ('up','down'));
    ALTER TABLE actions ADD FOREIGN KEY (ranking_id) REFERENCES rankings(ranking_id);
    ALTER TABLE actions ADD FOREIGN KEY (snapshot_id) REFERENCES snapshots(snapshot_id);
  `);
  app = express(); app.use(express.json());
  app.use('/api/feedback', feedbackRouter); app.use('/api/blocks-fast', blocksRouter);
});

async function seedScope(userId = userA, ids = ['x', 'y', 'z', 'replacement', 'closer', 'low-value']) {
  const snapshotId = randomUUID(), rankingId = randomUUID();
  await pg.query(`INSERT INTO snapshots (snapshot_id,user_id,status,formatted_address,lat,lng,city,state,country,timezone,local_iso,date,dow,hour,day_part_key,market,weather,air)
    VALUES ($1,$2,'ok','Synthetic fixture address',33,-96,'Fixture City','TX','US','America/Chicago','2026-09-10 21:00:00','2026-09-10',4,21,'evening','Fixture Market','{}','{}')`, [snapshotId, userId]);
  await pg.query('INSERT INTO rankings (ranking_id,snapshot_id,user_id,model_name) VALUES ($1,$2,$3,$4)', [rankingId, snapshotId, userId, 'synthetic']);
  await pg.query('INSERT INTO strategies (snapshot_id,status,strategy_for_now) VALUES ($1,$2,$3)', [snapshotId, 'ok', 'Synthetic persisted guidance']);
  const complete = {
    weather_current: { temperature: 20, conditions: 'Cloudy' }, weather_forecast: [{ temperature: 20, conditions: 'Cloudy' }],
    traffic_conditions: { summary: 'No reported incidents', incidents: [] },
    events: { items: [], reason: 'Synthetic search found no events' }, news: { items: [], reason: 'Synthetic search found no news' },
    school_closures: { items: [], reason: 'Synthetic search found no closures' },
    airport_conditions: { airports: [], verifiedEmpty: true, reason: 'Synthetic search found no airports' }, holiday: { holiday: 'none', is_holiday: false },
  };
  const fields = Object.keys(complete);
  await pg.query(`INSERT INTO briefings (snapshot_id,status,generated_at,${fields.join(',')}) VALUES ($1,'complete',now(),${fields.map((_key, i) => `$${i + 2}::jsonb`).join(',')})`, [snapshotId, ...Object.values(complete).map(JSON.stringify)]);
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index], venueId = randomUUID();
    const lat = id === 'closer' ? 33.03001 : 33 + index * 0.03;
    await pg.query('INSERT INTO venue_catalog (venue_id,place_id,venue_name,address,lat,lng) VALUES ($1,$2,$3,$4,$5,$6)', [venueId, `${rankingId}:${id}`, `Fixture ${id}`, `Synthetic address ${id}`, lat, -96]);
    await pg.query(`INSERT INTO ranking_candidates (id,ranking_id,snapshot_id,venue_id,block_id,name,lat,lng,rank,place_id,value_grade,value_per_min,distance_miles,not_worth)
      VALUES ($1,$2,$3,$4,$5,$6,$7,-96,$8,$9,$10,$11,2,false)`, [randomUUID(), rankingId, snapshotId, venueId, id, `Fixture ${id}`, lat, index + 1, id, id === 'low-value' ? 'C' : 'A', 10 - index]);
  }
  return { snapshotId, rankingId };
}
beforeEach(async () => {
  clock += 120000;
  scopeA = await seedScope(); scopeB = await seedScope(userB);
  mustNotGenerate.mockClear(); indexFeedback.mockClear(); capturelearning.mockClear();
});
afterAll(async () => { jest.restoreAllMocks(); await pg?.close(); });

function input(scope = scopeA, overrides = {}) {
  return { snapshot_id: scope.snapshotId, ranking_id: scope.rankingId, place_id: 'x', action: 'dismiss', request_id: randomUUID(), visible_place_ids: ['x', 'y', 'z'], ...overrides };
}
const post = (body, user = 'a') => request(app).post('/api/feedback/venue').set('Authorization', `Bearer synthetic-${user}`).send(body);
const saved = (scope = scopeA, user = 'a') => request(app).get(`/api/blocks-fast/saved?snapshotId=${scope.snapshotId}&rankingId=${scope.rankingId}`).set('Authorization', `Bearer synthetic-${user}`);
const ids = body => body.blocks.map(block => block.placeId);
const count = async (table, rankingId = scopeA.rankingId) => Number((await pg.query(`SELECT count(*) FROM ${table} WHERE ranking_id=$1`, [rankingId])).rows[0].count);

test('strict action input requires canonical IDs, explicit retry ID and distinct visible membership', () => {
  const valid = input();
  expect(parseVenueFeedbackInput({ ...valid, comment: '<b>Dead here</b>' }).comment).toBe('Dead here');
  for (const overrides of [{ request_id: undefined }, { ranking_id: [] }, { place_id: '' }, { action: 'delete' }, { visible_place_ids: ['x','x'] }, { visible_place_ids: ['a','b','c','d'] }, { action: 'restore' }, { comment: {} }]) {
    expect(() => parseVenueFeedbackInput({ ...valid, ...overrides })).toThrow();
  }
});

test('authenticated dismissal persists a distinct eligible replacement, canonical name, and reloadable Undo', async () => {
  expect((await request(app).post('/api/feedback/venue').send(input())).status).toBe(401);
  const body = input(scopeA, { venue_name: 'Spoofed name', comment: 'Dead right now' });
  const response = await post(body);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ ok: true, action_id: body.request_id, scope_revision: 1, action: 'dismiss', replacement_status: 'replaced', restored: false });
  expect(response.body.replacement).toMatchObject({ placeId: 'replacement', name: 'Fixture replacement', valueGrade: 'A' });
  expect(ids(response.body)).toEqual(['y','z','replacement']);
  expect(response.body.dismissals).toEqual([{ place_id: 'x', action_id: body.request_id, venue_name: 'Fixture x' }]);
  const vote = (await pg.query('SELECT * FROM venue_feedback WHERE id=$1', [response.body.feedback_id])).rows[0];
  expect(vote).toMatchObject({ user_id: userA, sentiment: 'down', venue_name: 'Fixture x', comment: 'Dead right now' });
  const reload = await saved(); expect(reload.status).toBe(200);
  expect(ids(reload.body)).toEqual(ids(response.body)); expect(reload.body.scope_revision).toBe(1);
  expect(mustNotGenerate).not.toHaveBeenCalled();
});

test('other users retain the venue and foreign/mismatched scopes never disclose or write feedback', async () => {
  await post(input());
  expect(ids((await saved(scopeB, 'b')).body)).toContain('x');
  for (const [body, user] of [[input(), 'b'], [input(scopeA, { snapshot_id: scopeB.snapshotId }), 'a'], [input(scopeB), 'a']]) {
    expect((await post(body, user)).status).toBe(404);
  }
  expect((await saved(scopeA, 'b')).status).toBe(404);
  expect(await count('venue_feedback', scopeB.rankingId)).toBe(0);
});

test('invalid places, hidden target, foreign visible IDs and ineligible grades cannot mutate the scope', async () => {
  for (const overrides of [{ place_id: 'foreign', visible_place_ids: ['foreign','y','z'] }, { place_id: 'replacement' }, { visible_place_ids: ['x','foreign'] }, { place_id: 'low-value', visible_place_ids: ['low-value'] }]) {
    expect((await post(input(scopeA, overrides))).status).toBe(400);
  }
  expect(await count('venue_feedback')).toBe(0); expect(await count('actions')).toBe(0);
});

test('same request replays its exact persisted receipt, including concurrent retries; changed payload conflicts', async () => {
  const body = input();
  const responses = await Promise.all([post(body), post(body)]);
  expect(responses.map(result => result.status)).toEqual([200,200]);
  expect(responses[0].body).toEqual(responses[1].body);
  expect((await post(body)).body).toEqual(responses[0].body);
  expect((await post({ ...body, comment: 'Changed retry' })).status).toBe(409);
  expect(await count('actions')).toBe(1); expect(await count('venue_feedback')).toBe(1);
  expect(indexFeedback).toHaveBeenCalledTimes(1);
});

test('request ID collision in another owned scope returns conflict without the original receipt', async () => {
  const body = input(); await post(body);
  const foreign = await post(input(scopeB, { request_id: body.request_id }), 'b');
  expect(foreign.status).toBe(409); expect(foreign.body.feedback_id).toBeUndefined();
  expect(await count('actions', scopeB.rankingId)).toBe(0);
});

test('Undo restores the dismissed venue, removes its replacement, and never invents a positive vote', async () => {
  const dismiss = await post(input());
  const undoBody = input(scopeA, { action: 'restore', undo_action_id: dismiss.body.action_id, visible_place_ids: ids(dismiss.body) });
  const undo = await post(undoBody);
  expect(undo.status).toBe(200);
  expect(undo.body).toMatchObject({ restored: true, scope_revision: 2, dismissed_place_ids: [], replacement_status: 'not_requested' });
  expect(ids(undo.body)).toEqual(['x','y','z']);
  expect((await post(undoBody)).body).toEqual(undo.body);
  expect((await pg.query('SELECT sentiment FROM venue_feedback WHERE id=$1', [undo.body.feedback_id])).rows[0].sentiment).toBe('down');
  expect(await count('actions')).toBe(2);
  expect((await saved()).body.dismissals).toEqual([]);
});

test('stale Undo cannot reverse a newer dismissal and late duplicate receipts do not change saved revision', async () => {
  const original = input(); const first = await post(original);
  await post(input(scopeA, { action: 'restore', undo_action_id: first.body.action_id, visible_place_ids: ids(first.body) }));
  const later = await post(input());
  expect((await post(input(scopeA, { action: 'restore', undo_action_id: first.body.action_id, visible_place_ids: ids(later.body) }))).status).toBe(409);
  expect((await post(original)).body.scope_revision).toBe(1);
  expect((await saved()).body.scope_revision).toBe(3);
  expect((await saved()).body.dismissals[0].action_id).toBe(later.body.action_id);
});

test('empty pool confirms removal honestly and a new owned ranking/snapshot resets the scope', async () => {
  const short = await seedScope(userA, ['x','y','z']);
  const response = await post(input(short));
  expect(response.status).toBe(200); expect(response.body.replacement_status).toBe('exhausted');
  expect(response.body.replacement).toBeNull(); expect(ids(response.body)).toEqual(['y','z']);
  const next = await seedScope();
  expect(ids((await saved(next)).body)).toContain('x');
  expect((await saved(next)).body.scope_revision).toBe(0);
  expect(mustNotGenerate).not.toHaveBeenCalled();
});

test('replacement accepts Grade B with preferred spacing, then fills a close eligible alternative when necessary', async () => {
  // A close Grade A must not displace an available well-spaced Grade B.
  await pg.query("UPDATE ranking_candidates SET value_grade='B' WHERE ranking_id=$1 AND place_id='replacement'", [scopeA.rankingId]);
  const spaced = await post(input());
  expect(spaced.status).toBe(200);
  expect(spaced.body.replacement).toMatchObject({ placeId: 'replacement', valueGrade: 'B' });
  const closeScope = await seedScope(userA, ['x','y','z','closer']);
  await pg.query("UPDATE ranking_candidates SET value_grade='B' WHERE ranking_id=$1 AND place_id='closer'", [closeScope.rankingId]);
  const filled = await post(input(closeScope));
  expect(filled.status).toBe(200);
  expect(filled.body.replacement).toMatchObject({ placeId: 'closer', valueGrade: 'B' });
});

test('a new duplicate tap cannot create a second replacement; stale other-card submissions conflict', async () => {
  const first = await post(input());
  const repeated = await post(input());
  expect(repeated.status).toBe(200);
  expect(ids(repeated.body)).toEqual(ids(first.body));
  expect(repeated.body.replacement_status).toBe('not_requested');
  expect((await post(input(scopeA, { place_id: 'y' }))).status).toBe(409);
  expect(ids((await saved()).body)).toEqual(ids(first.body));
});

test('vote writes work without the missing historical unique constraint and ambiguous duplicates remain untouched', async () => {
  const unique = await pg.query("SELECT conname FROM pg_constraint WHERE conrelid='venue_feedback'::regclass AND contype='u'");
  expect(unique.rows).toHaveLength(0);
  const first = await post(input()); expect(first.status).toBe(200);
  const second = await post(input()); expect(second.status).toBe(200);
  expect(second.body.feedback_id).toBe(first.body.feedback_id); expect(await count('venue_feedback')).toBe(1);
  await pg.query(`INSERT INTO venue_feedback (user_id,snapshot_id,ranking_id,place_id,venue_name,sentiment,comment)
    VALUES ($1,$2,$3,'x','Historical duplicate','up','Preserve this record')`, [userA,scopeA.snapshotId,scopeA.rankingId]);
  const before = (await pg.query('SELECT * FROM venue_feedback WHERE ranking_id=$1 ORDER BY id',[scopeA.rankingId])).rows;
  const ambiguous = await post(input()); expect(ambiguous.status).toBe(409); expect(ambiguous.body.error).toBe('ambiguous_feedback');
  const after = (await pg.query('SELECT * FROM venue_feedback WHERE ranking_id=$1 ORDER BY id',[scopeA.rankingId])).rows;
  expect(after).toEqual(before);
});

test('repeated Undo and duplicate-dismiss grade reordering preserve the current original cards', async () => {
  await pg.query("UPDATE ranking_candidates SET value_grade='B' WHERE ranking_id=$1 AND place_id IN ('y','z')",[scopeA.rankingId]);
  await post(input());
  const duplicate = await post(input()); expect(duplicate.status).toBe(200);
  const body = input(scopeA, { action:'restore',undo_action_id:duplicate.body.action_id,visible_place_ids:['replacement','y','z'] });
  const restored = await post(body); expect(restored.status).toBe(200);
  expect(new Set(ids(restored.body))).toEqual(new Set(['x','y','z']));
  const repeated = await post({ ...body,request_id:randomUUID() }); expect(repeated.status).toBe(200);
  expect(repeated.body.restored).toBe(false); expect(ids(repeated.body)).toEqual(ids(restored.body));
  expect(ids((await saved()).body)).toEqual(ids(restored.body));
});

test('failed receipt persistence rolls back the vote and leaves reload unchanged', async () => {
  await pg.exec(`CREATE OR REPLACE FUNCTION synthetic_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.raw->'receipt'->>'ranking_id' = '${scopeA.rankingId}' THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON actions FOR EACH ROW EXECUTE FUNCTION synthetic_reject_receipt();`);
  const failure = await post(input());
  expect(failure.status).toBe(500); expect(failure.body.ok).toBe(false);
  expect(await count('venue_feedback')).toBe(0); expect(await count('actions')).toBe(0);
  expect(ids((await saved()).body)).toContain('x');
  await pg.exec('DROP TRIGGER synthetic_receipt_failure ON actions;');
});

test('upvote confirms a truthful persisted vote without dismissal or replacement', async () => {
  const response = await post(input(scopeA, { action: 'upvote' }));
  expect(response.status).toBe(200); expect(response.body).toMatchObject({ action: 'upvote', replacement_status: 'not_requested', dismissed_place_ids: [] });
  expect(ids(response.body)).toEqual(['x','y','z']);
  expect((await pg.query('SELECT sentiment FROM venue_feedback WHERE id=$1', [response.body.feedback_id])).rows[0].sentiment).toBe('up');
});

test('cached GET/POST and pending Briefing responses retain exclusions without calling paid generation or addresses', async () => {
  const dismissal = await post(input());
  const getCurrent = () => request(app).get(`/api/blocks-fast?snapshotId=${scopeA.snapshotId}`).set('Authorization', 'Bearer synthetic-a');
  const postCurrent = () => request(app).post('/api/blocks-fast').set('Authorization', 'Bearer synthetic-a').send({ snapshotId: scopeA.snapshotId });
  let response = await getCurrent(); expect(response.status).toBe(200); expect(ids(response.body)).not.toContain('x');
  response = await postCurrent(); expect(response.status).toBe(200); expect(ids(response.body)).toEqual(ids(dismissal.body));
  await pg.query("UPDATE briefings SET status='pending', generated_at=NULL, generation_token=$2, updated_at=$3 WHERE snapshot_id=$1", [scopeA.snapshotId, randomUUID(), new Date(clock).toISOString()]);
  response = await getCurrent(); expect(response.status).toBe(202); expect(response.body).toMatchObject({ reason: 'briefing_pending', strategyFresh: false });
  expect(ids(response.body)).not.toContain('x');
  response = await postCurrent(); expect(response.status).toBe(202); expect(response.body).toMatchObject({ reason: 'briefing_pending', strategyFresh: false });
  expect(ids(response.body)).not.toContain('x'); expect(mustNotGenerate).not.toHaveBeenCalled();
});

test('candidate snapshot mismatch and orphan ranking ownership fail closed', async () => {
  await pg.query('UPDATE ranking_candidates SET snapshot_id=$1 WHERE ranking_id=$2 AND place_id=$3', [scopeB.snapshotId, scopeA.rankingId, 'x']);
  expect((await post(input())).status).toBe(400);
  await pg.query('UPDATE rankings SET user_id=NULL WHERE ranking_id=$1', [scopeA.rankingId]);
  expect((await saved()).status).toBe(404); expect((await post(input())).status).toBe(404);
});
