// Opt-in actual PostgreSQL acceptance. Imports of the production pool are below
// the fail-closed URL guard. No gateway bootstrap, migrations or providers run.
import { jest, test, expect, beforeAll, afterAll } from '@jest/globals';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';

let selected;
try { selected = new URL(process.env.DATABASE_URL || ''); } catch { throw new Error('Disposable preview DATABASE_URL is required.'); }
if (selected.hostname !== '127.0.0.1' || selected.port !== '55432' || selected.pathname !== '/vecto_preview') {
  throw new Error('Refusing PostgreSQL acceptance outside disposable 127.0.0.1:55432/vecto_preview.');
}
if (process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production') {
  throw new Error('PostgreSQL acceptance requires a non-deployment process.');
}

const provider = jest.fn(async () => { throw new Error('Provider/address work is forbidden in PostgreSQL acceptance.'); });
// Authentication is deliberately injected; ownership, DB queries, readiness and
// actual Express routes remain production implementations.
jest.unstable_mockModule('../../server/middleware/auth.js', () => ({ requireAuth(req, res, next) {
  const userId = req.headers['x-synthetic-user'];
  if (typeof userId !== 'string') return res.status(401).json({ error: 'synthetic_auth_required' });
  req.auth = { userId }; next();
} }));
jest.unstable_mockModule('../../server/middleware/rate-limit.js', () => ({ expensiveEndpointLimiter: (_req, _res, next) => next() }));
jest.unstable_mockModule('../../server/lib/ai/providers/briefing.js', () => ({ runBriefing: provider }));
jest.unstable_mockModule('../../server/lib/ai/providers/consolidator.js', () => ({ runImmediateStrategy: provider }));
jest.unstable_mockModule('../../server/lib/venue/enhanced-smart-blocks.js', () => ({ generateEnhancedSmartBlocks: provider }));
jest.unstable_mockModule('../../server/lib/venue/venue-address-resolver.js', () => ({ resolveVenueAddressesBatch: provider }));

// Production connection-manager owns an interval without a shutdown export.
// Capture only timers created by these imports; release them in this harness's
// finally cleanup together with its actual pool. No gateway timer is touched.
const intervals = [];
const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const timer = originalSetInterval(...args); intervals.push(timer); return timer; };
let pool, withBriefingGeneration, writeBriefingGeneration, verifySnapshotOwnership, getBriefingReadiness, blocksRouter;
try {
  ({ pool } = await import('../../server/db/connection-manager.js'));
  ({ withBriefingGeneration, writeBriefingGeneration } = await import('../../server/lib/briefing/briefing-generation.js'));
  ({ verifySnapshotOwnership } = await import('../../server/middleware/require-snapshot-ownership.js'));
  ({ getBriefingReadiness } = await import('../../server/lib/briefing/briefing-readiness.js'));
  ({ default: blocksRouter } = await import('../../server/api/strategy/blocks-fast.js'));
} catch (error) {
  for (const timer of intervals) clearInterval(timer);
  await pool?.end();
  throw error;
} finally {
  globalThis.setInterval = originalSetInterval;
}

const namespace = `astra-briefing-pg-${randomUUID()}`;
const callerA = randomUUID(), callerB = randomUUID();
const fixtures = [];
const receipt = { namespace, started_at: new Date().toISOString(), target: '127.0.0.1:55432/vecto_preview', checks: [], cleanup: false, authentication: 'synthetic req.auth; real ownership and router', provider_calls: null };
let app, raceScope, ownedScope, foreignScope, orphanScope;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const completeSections = {
  weather_current: { temperature: 20, conditions: 'Synthetic cloudy' },
  weather_forecast: [{ temperature: 20, conditions: 'Synthetic cloudy' }],
  traffic_conditions: { summary: 'Synthetic no incidents', incidents: [] },
  events: { items: [], reason: 'Synthetic search found no events' },
  news: { items: [], reason: 'Synthetic search found no news' },
  school_closures: { items: [], reason: 'Synthetic search found no closures' },
  airport_conditions: { airports: [], verifiedEmpty: true, reason: 'Synthetic search found no airports' },
  holiday: { holiday: 'none', is_holiday: false },
};

async function seedScope(userId, withCache = true) {
  const snapshotId = randomUUID(), rankingId = randomUUID(), token = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO snapshots
      (snapshot_id,created_at,date,session_id,user_id,lat,lng,city,state,country,formatted_address,timezone,local_iso,dow,hour,day_part_key,status,weather,air,market)
      VALUES ($1,now(),'2026-09-11',$2,$3,33,-96,'Synthetic City','TX','US',$4,'America/Chicago','2026-09-10 22:00:00',4,22,'evening','ok','{}','{}','Synthetic Market')`,
    [snapshotId, randomUUID(), userId, `${namespace} fixture address`]);
    const fields = Object.keys(completeSections);
    await client.query(`INSERT INTO briefings (snapshot_id,status,generation_token,generated_at,${fields.join(',')})
      VALUES ($1,'complete',$2,now(),${fields.map((_field, index) => `$${index + 3}::jsonb`).join(',')})`,
    [snapshotId, token, ...Object.values(completeSections).map(value => JSON.stringify(value))]);
    if (withCache) {
      await client.query("INSERT INTO strategies (snapshot_id,user_id,status,strategy_for_now) VALUES ($1,$2,'ok',$3)", [snapshotId, userId, `${namespace} cached guidance`]);
      await client.query('INSERT INTO rankings (ranking_id,snapshot_id,user_id,model_name) VALUES ($1,$2,$3,$4)', [rankingId, snapshotId, userId, 'synthetic']);
      await client.query(`INSERT INTO ranking_candidates (id,ranking_id,snapshot_id,block_id,name,lat,lng,rank,exploration_policy,place_id,value_grade,value_per_min)
        VALUES ($1,$2,$3,$4,$5,33,-96,1,'synthetic',$6,'A',1)`, [randomUUID(), rankingId, snapshotId, namespace, `${namespace} cached venue`, `${namespace}-${snapshotId}`]);
    }
    await client.query('COMMIT');
    fixtures.push(snapshotId);
    return { snapshotId, rankingId, token };
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}

beforeAll(async () => {
  // Verify the actual connection independently of the parsed environment guard.
  const connected = (await pool.query('SELECT current_database() AS database, inet_server_port() AS port')).rows[0];
  expect(connected).toEqual({ database: 'vecto_preview', port: 55432 });
  raceScope = await seedScope(callerA, false);
  ownedScope = await seedScope(callerA);
  foreignScope = await seedScope(callerB);
  orphanScope = await seedScope(null);
  app = express(); app.use(express.json()); app.use('/api/blocks-fast', blocksRouter);
});

async function snapshotRow(snapshotId, client = pool) {
  return (await client.query('SELECT to_jsonb(b) AS row FROM briefings b WHERE snapshot_id=$1', [snapshotId])).rows[0].row;
}

async function observeBlockedWriter(observer, holderPid) {
  const stop = Date.now() + 4000;
  while (Date.now() < stop) {
    const result = await observer.query(`SELECT pid, pg_blocking_pids(pid) AS blocked_by, wait_event_type
      FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)) AND query ILIKE '%briefings%'`, [holderPid]);
    if (result.rows.length) return result.rows[0];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('The production Briefing write did not show actual PostgreSQL lock contention.');
}

async function blockedWrite({ token, holderUpdate, updates, label }) {
  const holder = await pool.connect();
  let observer, pending;
  try {
    observer = await pool.connect();
    await holder.query('BEGIN');
    await holder.query("SET LOCAL lock_timeout='4s'; SET LOCAL statement_timeout='6s'");
    const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await holderUpdate(holder);
    const expected = await snapshotRow(raceScope.snapshotId, holder);
    pending = withBriefingGeneration(raceScope.snapshotId, token, () => writeBriefingGeneration(raceScope.snapshotId, updates));
    // Observe rejection as well as success immediately, avoiding an unhandled
    // promise if the DB rejects while the observer is checking contention.
    const settled = pending.then(value => ({ value }), error => ({ error }));
    const blocked = await observeBlockedWriter(observer, holderPid);
    expect(blocked.blocked_by).toContain(holderPid); expect(blocked.wait_event_type).toBe('Lock');
    await holder.query('COMMIT');
    const result = await settled;
    if (result.error) throw result.error;
    expect(result.value).toBeNull();
    const actual = await snapshotRow(raceScope.snapshotId);
    expect(actual).toEqual(expected);
    receipt.checks.push({ label, blocked_holder_pid: holderPid, blocked_writer_pid: blocked.pid, blocking_observed: true, stale_write_result: null, expected_row_sha256: hash(expected), actual_row_sha256: hash(actual), all_fields_unchanged: true });
    return actual;
  } finally {
    // ROLLBACK is safe after COMMIT, and releases the holder before awaiting any
    // pending write if an assertion/observer failed.
    await holder.query('ROLLBACK').catch(() => {});
    await pending?.catch(() => {});
    holder.release(); observer?.release();
  }
}

test('actual PostgreSQL rechecks generation token after a blocked stale progressive write', async () => {
  const tokenA = randomUUID(), tokenB = randomUUID();
  raceScope.token = tokenB;
  await pool.query("UPDATE briefings SET status='pending', generation_token=$2, generated_at=NULL WHERE snapshot_id=$1", [raceScope.snapshotId, tokenA]);
  const row = await blockedWrite({
    token: tokenA, label: 'token_recheck_after_blocked_update',
    holderUpdate: client => client.query("UPDATE briefings SET generation_token=$2, status='pending', news=$3::jsonb, updated_at='2026-09-11 02:45:00.123456+00' WHERE snapshot_id=$1", [raceScope.snapshotId, tokenB, JSON.stringify({ items: [], reason: 'Synthetic replacement B owns this field' })]),
    updates: { news: { sentinel: 'STALE_TOKEN_A_MUST_NOT_PERSIST' }, updated_at: new Date('2026-09-11T03:00:00Z') },
  });
  expect(row.generation_token).toBe(tokenB); expect(row.news.reason).toContain('replacement B');
});

test('actual PostgreSQL rechecks pending status after completion wins the blocked write', async () => {
  const row = await blockedWrite({
    token: raceScope.token, label: 'pending_status_recheck_after_blocked_update',
    holderUpdate: client => client.query("UPDATE briefings SET status='complete', generated_at='2026-09-11 02:46:00.654321+00', updated_at='2026-09-11 02:46:00.654321+00' WHERE snapshot_id=$1", [raceScope.snapshotId]),
    updates: { news: { sentinel: 'LATE_TOKEN_B_MUST_NOT_PERSIST' }, updated_at: new Date('2026-09-11T03:01:00Z') },
  });
  expect(getBriefingReadiness(row, raceScope.snapshotId).ready).toBe(true);
});

test('real snapshot ownership accepts its owner and rejects foreign, orphan, missing and unauthenticated reads', async () => {
  expect((await verifySnapshotOwnership(ownedScope.snapshotId, callerA)).ok).toBe(true);
  for (const snapshotId of [foreignScope.snapshotId, orphanScope.snapshotId, randomUUID()]) {
    const result = await verifySnapshotOwnership(snapshotId, callerA);
    expect(result).toMatchObject({ ok: false, status: 404, body: { error: 'snapshot_not_found' } });
  }
  expect(await verifySnapshotOwnership(ownedScope.snapshotId, undefined)).toMatchObject({ ok: false, status: 401 });
  receipt.checks.push({ label: 'real_snapshot_ownership', owner: 200, foreign: 404, null_owner: 404, missing: 404, missing_caller: 401 });
});

test.each(['get','post'])('real %s blocks router rejects foreign and NULL owners even with complete cached strategy/Briefing/venues', async method => {
  for (const scope of [foreignScope, orphanScope]) {
    const response = method === 'get'
      ? await request(app).get(`/api/blocks-fast?snapshotId=${scope.snapshotId}`).set('x-synthetic-user', callerA)
      : await request(app).post('/api/blocks-fast').set('x-synthetic-user', callerA).send({ snapshotId: scope.snapshotId });
    expect(response.status).toBe(404); expect(response.body.error).toBe('snapshot_not_found');
    expect(response.body.blocks).toBeUndefined(); expect(response.body.strategy).toBeUndefined(); expect(response.body.briefing).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(namespace);
  }
  expect(provider).not.toHaveBeenCalled();
  receipt.checks.push({ label: `${method}_real_cached_route_ownership`, foreign: 404, null_owner: 404, cached_data_exposed: false, provider_calls: provider.mock.calls.length });
});

afterAll(async () => {
  try {
    if (fixtures.length) {
      const cleanup = await pool.connect();
      try {
        await cleanup.query('BEGIN');
        // Exact synthetic IDs only; no shared account or allocated Offer row is
        // selected. Explicit child cleanup is independent of FK cascade policy.
        for (const table of ['ranking_candidates','rankings','briefings','strategies','snapshots']) {
          await cleanup.query(`DELETE FROM ${table} WHERE snapshot_id = ANY($1::uuid[])`, [fixtures]);
        }
        await cleanup.query('COMMIT');
        const remaining = await cleanup.query('SELECT count(*)::int AS count FROM snapshots WHERE snapshot_id=ANY($1::uuid[])', [fixtures]);
        receipt.cleanup = remaining.rows[0].count === 0;
      } catch (error) { await cleanup.query('ROLLBACK'); throw error; }
      finally { cleanup.release(); }
    } else receipt.cleanup = true;
  } finally {
    for (const timer of intervals) clearInterval(timer);
    await pool.end();
    receipt.provider_calls = provider.mock.calls.length;
    receipt.completed_at = new Date().toISOString();
    receipt.complete = receipt.checks.length === 5 && receipt.cleanup && receipt.provider_calls === 0;
    if (process.env.ASTRA_BRIEFING_PG_RECEIPT) {
      await fs.writeFile(process.env.ASTRA_BRIEFING_PG_RECEIPT, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    }
  }
});
