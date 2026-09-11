// Actual PostgreSQL + production feedback router/helper. Opt-in disposable preview
// only; no gateway, migration, paid provider or allocated Offer fixture is touched.
import { jest, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';

let selected;
try { selected = new URL(process.env.DATABASE_URL || ''); } catch { throw new Error('Disposable preview DATABASE_URL is required.'); }
if (selected.hostname !== '127.0.0.1' || selected.port !== '55432' || selected.pathname !== '/vecto_preview' ||
    process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production') {
  throw new Error('Refusing venue acceptance outside disposable 127.0.0.1:55432/vecto_preview.');
}
const namespace = `astra-venue-pg-${randomUUID()}`;
// Same inherited target/credentials; unique connection label lets an independent
// observer identify this test's actual lock queue without inspecting query data.
selected.searchParams.set('application_name', namespace);
process.env.DATABASE_URL = selected.toString();

const indexFeedback = jest.fn(async () => {}), capturelearning = jest.fn(async () => {});
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, res, next) {
  const userId = req.headers['x-synthetic-user'];
  if (typeof userId !== 'string') return res.status(401).json({ error: 'synthetic_auth_required' });
  req.auth = { userId }; next();
} }));
jest.unstable_mockModule('../../server/lib/external/semantic-search.js', () => ({ indexFeedback }));
jest.unstable_mockModule('../../server/middleware/learning-capture.js', () => ({ capturelearning, LEARNING_EVENTS: { VENUE_FEEDBACK: 'venue_feedback' } }));
// A transport guard, not a provider response fixture: accidental outbound fetch
// fails immediately instead of making a paid request. Helper imports no provider.
const network = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Outbound fetch forbidden in venue acceptance.'); });

const intervals = [];
const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const timer = originalSetInterval(...args); intervals.push(timer); return timer; };
let pool, db, readSavedVenueFeedback, feedbackRouter;
try {
  ({ pool } = await import('../../server/db/connection-manager.js'));
  ({ db } = await import('../../server/db/drizzle.js'));
  ({ readSavedVenueFeedback } = await import('../../server/lib/venue/venue-feedback.js'));
  ({ default: feedbackRouter } = await import('../../server/api/feedback/feedback.js'));
} catch (error) {
  for (const timer of intervals) clearInterval(timer);
  network.mockRestore(); await pool?.end(); throw error;
} finally { globalThis.setInterval = originalSetInterval; }

const snapshots = [], venueIds = [];
const place = Object.fromEntries(['x','y','z','replacement','extra','low'].map(key => [key, `${namespace}:${key}`]));
const catalog = new Map();
const receipt = { namespace, started_at: new Date().toISOString(), target: '127.0.0.1:55432/vecto_preview', checks: [], cleanup: false, auth: 'synthetic req.auth; real production router, ownership and SQL', reload: 'real readSavedVenueFeedback helper; HTTP /saved covered separately', provider_calls: null };
let app, scope;

beforeAll(async () => {
  const identity = (await pool.query('SELECT current_database() AS database, inet_server_port() AS port')).rows[0];
  expect(identity).toEqual({ database: 'vecto_preview', port: 55432 });
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    for (const [index, key] of Object.keys(place).entries()) {
      const id = randomUUID(), lat = 33 + index * 0.03;
      await setup.query(`INSERT INTO venue_catalog (venue_id,place_id,venue_name,address,category,lat,lng)
        VALUES ($1,$2,$3,$4,'venue',$5,-96)`, [id, place[key], `${namespace} ${key}`, `${namespace} synthetic ${key} address`, lat]);
      catalog.set(key, { id, lat }); venueIds.push(id);
    }
    await setup.query('COMMIT');
  } catch (error) { await setup.query('ROLLBACK'); venueIds.length = 0; throw error; }
  finally { setup.release(); }
  app = express(); app.use(express.json()); app.use('/api/feedback', feedbackRouter);
});

async function seedScope(userId = randomUUID(), keys = ['x','y','z','replacement','extra','low']) {
  const snapshotId = randomUUID(), rankingId = randomUUID();
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(`INSERT INTO snapshots
      (snapshot_id,created_at,date,session_id,user_id,lat,lng,city,state,country,formatted_address,timezone,local_iso,dow,hour,day_part_key,status,weather,air,market)
      VALUES ($1,now(),'2026-09-11',$2,$3,33,-96,'Synthetic City','TX','US',$4,'America/Chicago','2026-09-10 22:00:00',4,22,'evening','ok','{}','{}','Synthetic Market')`,
    [snapshotId, randomUUID(), userId, `${namespace} fixture address`]);
    await setup.query('INSERT INTO rankings (ranking_id,snapshot_id,user_id,model_name) VALUES ($1,$2,$3,$4)', [rankingId,snapshotId,userId,'synthetic']);
    for (const [index, key] of keys.entries()) {
      const venue = catalog.get(key);
      await setup.query(`INSERT INTO ranking_candidates
        (id,ranking_id,snapshot_id,venue_id,block_id,name,lat,lng,rank,exploration_policy,place_id,value_grade,value_per_min,distance_miles,not_worth)
        VALUES ($1,$2,$3,$4,$5,$6,$7,-96,$8,'synthetic',$9,$10,$11,2,false)`,
      [randomUUID(),rankingId,snapshotId,venue.id,place[key],`${namespace} ${key}`,venue.lat,index+1,place[key],key==='low'?'C':key==='extra'?'B':'A',10-index]);
    }
    await setup.query('COMMIT'); snapshots.push(snapshotId);
    return { userId,snapshotId,rankingId };
  } catch (error) { await setup.query('ROLLBACK'); throw error; }
  finally { setup.release(); }
}
beforeEach(async () => { scope = await seedScope(); indexFeedback.mockClear(); capturelearning.mockClear(); });
const input = (target = scope, overrides = {}) => ({ snapshot_id:target.snapshotId,ranking_id:target.rankingId,place_id:place.x,action:'dismiss',request_id:randomUUID(),visible_place_ids:[place.x,place.y,place.z],...overrides });
const post = (body, caller = scope.userId) => request(app).post('/api/feedback/venue').set('x-synthetic-user',caller).send(body);
const saved = (target = scope, caller = target.userId) => readSavedVenueFeedback(db,{userId:caller,snapshotId:target.snapshotId,rankingId:target.rankingId});
const ids = body => body.blocks.map(block => block.placeId);
const counts = async target => (await pool.query(`SELECT
  (SELECT count(*)::int FROM venue_feedback WHERE ranking_id=$1) AS votes,
  (SELECT count(*)::int FROM actions WHERE ranking_id=$1 AND action='venue_feedback_state') AS actions`,[target.rankingId])).rows[0];

async function concurrentPosts(bodies, label) {
  const holder = await pool.connect();
  let observer;
  let pending = [];
  try {
    observer = await pool.connect();
    await holder.query('BEGIN');
    await holder.query("SET LOCAL lock_timeout='4s'; SET LOCAL statement_timeout='6s'");
    await holder.query('SELECT ranking_id FROM rankings WHERE ranking_id=$1 FOR UPDATE',[scope.rankingId]);
    const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = bodies.map(body => post(body).timeout({ response: 8000, deadline: 12000 })
      .then(response => ({ response }),error => ({ error })));
    const stop = Date.now()+4000;
    let blocked = [];
    while (Date.now()<stop) {
      blocked = (await observer.query(`SELECT pid,pg_blocking_pids(pid) AS blocked_by,wait_event_type
        FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0
        AND query ILIKE '%SELECT r.ranking_id%'`,[namespace])).rows;
      if (blocked.length >= bodies.length) break;
      await new Promise(resolve => setTimeout(resolve,25));
    }
    expect(blocked.length).toBe(bodies.length);
    expect(blocked.some(item => item.blocked_by.includes(holderPid))).toBe(true);
    expect(blocked.every(item => item.wait_event_type==='Lock')).toBe(true);
    await holder.query('COMMIT');
    const results = await Promise.all(pending);
    for (const result of results) if (result.error) throw result.error;
    receipt.checks.push({label,actual_lock_queue:true,holder_pid:holderPid,writer_pids:blocked.map(item=>item.pid)});
    return results.map(result=>result.response);
  } finally {
    await holder.query('ROLLBACK').catch(()=>{});
    await Promise.allSettled(pending);
    holder.release();observer?.release();
  }
}

test('simultaneous identical UUID requests commit one vote/action and replay one exact replacement receipt',async()=>{
  const body=input();
  const responses=await concurrentPosts([body,body],'same_uuid_concurrent_idempotency');
  expect(responses.map(item=>item.status)).toEqual([200,200]);
  expect(responses[0].body).toEqual(responses[1].body);
  expect(responses[0].body.replacement).toMatchObject({placeId:place.replacement,valueGrade:'A'});
  expect(body.visible_place_ids).not.toContain(responses[0].body.replacement.placeId);
  expect(ids(responses[0].body)).toEqual([place.y,place.z,place.replacement]);
  expect(await counts(scope)).toEqual({votes:1,actions:1});
  expect(indexFeedback).toHaveBeenCalledTimes(1);
  expect((await post({...body,comment:'Changed request'})).status).toBe(409);
  const reload=await saved();
  expect(reload.scope_revision).toBe(1);expect(ids(reload)).toEqual(ids(responses[0].body));
  expect(reload.dismissals).toEqual(responses[0].body.dismissals);
});

test('simultaneous different UUID taps serialize without choosing a second replacement',async()=>{
  const responses=await concurrentPosts([input(),input()],'different_uuid_concurrent_display_idempotency');
  expect(responses.map(item=>item.status)).toEqual([200,200]);
  expect(responses.map(item=>item.body.scope_revision).sort()).toEqual([1,2]);
  expect(responses.map(item=>item.body.replacement_status).sort()).toEqual(['not_requested','replaced']);
  expect(ids(responses[0].body)).toEqual(ids(responses[1].body));
  expect(await counts(scope)).toEqual({votes:1,actions:2});
  const reload=await saved();expect(reload.scope_revision).toBe(2);
  const current=responses.find(item=>item.body.scope_revision===2).body;
  expect(reload.dismissals[0].action_id).toBe(current.action_id);
});

test('confirmed Undo restores original cards and retains the original downvote across pure-read reload',async()=>{
  const dismissed=await post(input());expect(dismissed.status).toBe(200);
  const body=input(scope,{action:'restore',undo_action_id:dismissed.body.action_id,visible_place_ids:ids(dismissed.body)});
  const restored=await post(body);expect(restored.status).toBe(200);
  expect(restored.body).toMatchObject({restored:true,dismissed_place_ids:[],scope_revision:2,replacement_status:'not_requested'});
  expect(ids(restored.body)).toEqual([place.x,place.y,place.z]);
  expect((await post(body)).body).toEqual(restored.body);
  const vote=(await pool.query('SELECT sentiment FROM venue_feedback WHERE id=$1',[restored.body.feedback_id])).rows[0];
  expect(vote.sentiment).toBe('down');expect(await counts(scope)).toEqual({votes:1,actions:2});
  expect(ids(await saved())).toEqual([place.x,place.y,place.z]);
  receipt.checks.push({label:'undo_persisted_reload',original_vote:'down',invented_upvotes:0,original_cards_restored:true});
});

test('Undo after a distinct-UUID repeated dismissal still removes its original replacement when the UI reorders grades',async()=>{
  await pool.query("UPDATE ranking_candidates SET value_grade='B' WHERE ranking_id=$1 AND place_id=ANY($2::text[])",[scope.rankingId,[place.y,place.z]]);
  const first=await post(input());expect(first.status).toBe(200);
  const repeat=await post(input());expect(repeat.status).toBe(200);
  // Strategy's A-first display policy moves replacement A before retained B cards.
  const restored=await post(input(scope,{action:'restore',undo_action_id:repeat.body.action_id,visible_place_ids:[place.replacement,place.y,place.z]}));
  expect(restored.status).toBe(200);
  expect(new Set(ids(restored.body))).toEqual(new Set([place.x,place.y,place.z]));
  receipt.checks.push({label:'undo_duplicate_grade_reorder',original_cards_restored:true});
});

test('already-restored Undo with a new UUID and stale visible cards preserves current confirmed cards',async()=>{
  const dismissed=await post(input());expect(dismissed.status).toBe(200);
  const body=input(scope,{action:'restore',undo_action_id:dismissed.body.action_id,visible_place_ids:ids(dismissed.body)});
  const restored=await post(body);expect(restored.status).toBe(200);
  const repeated=await post({...body,request_id:randomUUID()});expect(repeated.status).toBe(200);
  expect(repeated.body.restored).toBe(false);
  expect(ids(repeated.body)).toEqual(ids(restored.body));
  expect(ids(await saved())).toEqual(ids(restored.body));
  receipt.checks.push({label:'already_restored_stale_new_uuid',confirmed_cards_preserved:true});
});

test('other drivers and a new owned ranking retain the venue; foreign and mismatched scope mutations fail',async()=>{
  const other=await seedScope(),next=await seedScope(scope.userId);
  const dismissed=await post(input());expect(dismissed.status).toBe(200);
  expect(ids(await saved(other))).toContain(place.x);
  expect(ids(await saved(next))).toContain(place.x);expect((await saved(next)).scope_revision).toBe(0);
  expect((await post(input(),other.userId)).status).toBe(404);
  expect((await post(input(scope,{snapshot_id:other.snapshotId}))).status).toBe(404);
  await expect(saved(scope,other.userId)).rejects.toMatchObject({status:404});
  expect(await counts(other)).toEqual({votes:0,actions:0});
  receipt.checks.push({label:'driver_and_new_scope_isolation',other_driver_retains:true,new_scope_resets:true,foreign_and_mismatch_status:404});
});

test('exhausted candidate pool confirms removal without invented alternatives or paid regeneration',async()=>{
  const short=await seedScope(randomUUID(),['x','y','z']);
  const dismissed=await post(input(short),short.userId);expect(dismissed.status).toBe(200);
  expect(dismissed.body.replacement_status).toBe('exhausted');expect(dismissed.body.replacement).toBeNull();
  expect(ids(await saved(short))).toEqual([place.y,place.z]);
  expect(network).not.toHaveBeenCalled();
  receipt.checks.push({label:'exhausted_pool',replacement:null,no_generation:true});
});

afterAll(async()=>{
  try {
    const cleanup=await pool.connect();
    try {
      await cleanup.query('BEGIN');
      for(const table of ['actions','venue_feedback','ranking_candidates','rankings','snapshots']) {
        await cleanup.query(`DELETE FROM ${table} WHERE snapshot_id=ANY($1::uuid[])`,[snapshots]);
      }
      await cleanup.query('DELETE FROM venue_catalog WHERE venue_id=ANY($1::uuid[])',[venueIds]);
      await cleanup.query('COMMIT');
      const remaining=(await cleanup.query(`SELECT
        (SELECT count(*)::int FROM snapshots WHERE snapshot_id=ANY($1::uuid[])) AS snapshots,
        (SELECT count(*)::int FROM venue_catalog WHERE venue_id=ANY($2::uuid[])) AS venues`,[snapshots,venueIds])).rows[0];
      receipt.cleanup=remaining.snapshots===0&&remaining.venues===0;
    } catch(error) {await cleanup.query('ROLLBACK');throw error;}
    finally {cleanup.release();}
  } finally {
    receipt.provider_calls=network.mock.calls.length;network.mockRestore();
    for(const timer of intervals)clearInterval(timer);
    await pool.end();
    receipt.completed_at=new Date().toISOString();
    receipt.complete=receipt.checks.length===7&&receipt.cleanup&&receipt.provider_calls===0;
    if(process.env.ASTRA_VENUE_PG_RECEIPT) await fs.writeFile(process.env.ASTRA_VENUE_PG_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  }
});
