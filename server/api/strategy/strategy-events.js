// Owned SSE streams. Subscribe before reading persisted state so reconnects
// recover both earlier completions and events racing listener registration.
import express from 'express';
import { verifySnapshotOwnership } from '../../middleware/require-snapshot-ownership.js';
import { subscribeToChannel } from '../../db/db-client.js';
import { phaseEmitter } from '../../events/phase-emitter.js';
import { db } from '../../db/drizzle.js';
import { briefings, strategies, rankings, offer_intelligence } from '../../../shared/schema.js';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { requireAuthAllowQueryToken, isRequestAuthCurrent } from '../../middleware/auth.js';
import { sseLog, OP } from '../../logger/workflow.js';
import { CHANNELS } from '../../lib/briefing/briefing-channels.js';

const router = express.Router();
const channelGroups = {
  strategy: ['strategy_ready'], briefing: ['briefing_ready', ...Object.values(CHANNELS)],
  blocks: ['blocks_ready'], offers: ['offer_analyzed'], phase: [],
};
const eventNames = { strategy: 'strategy_ready', briefing: 'briefing_ready', blocks: 'blocks_ready', offers: 'offer_analyzed', phase: 'message' };

async function readInitialState(kind, snapshotId, userId) {
  if (kind === 'offers') {
    const [row] = await db.select({ id: offer_intelligence.id, created_at: offer_intelligence.created_at })
      .from(offer_intelligence).where(and(eq(offer_intelligence.user_id, userId), isNull(offer_intelligence.removed_at)))
      .orderBy(desc(offer_intelligence.created_at)).limit(1);
    return { ...(row && { offer_id: row.id, created_at: row.created_at }), handshake: true };
  }
  let row;
  if (kind === 'strategy') {
    [row] = await db.select({ snapshot_id: strategies.snapshot_id, status: strategies.status,
      has_strategy_for_now: sql`(${strategies.strategy_for_now} IS NOT NULL AND length(trim(${strategies.strategy_for_now})) > 0)`,
    }).from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
  } else if (kind === 'briefing') {
    [row] = await db.select({ snapshot_id: briefings.snapshot_id, status: briefings.status,
      has_traffic: sql`(${briefings.traffic_conditions} IS NOT NULL)`, has_news: sql`(${briefings.news} IS NOT NULL)`,
      has_airport: sql`(${briefings.airport_conditions} IS NOT NULL)`, has_school_closures: sql`(${briefings.school_closures} IS NOT NULL)`,
      has_weather: sql`(${briefings.weather_current} IS NOT NULL AND ${briefings.weather_forecast} IS NOT NULL)`,
    }).from(briefings).where(eq(briefings.snapshot_id, snapshotId)).limit(1);
  } else if (kind === 'blocks') {
    [row] = await db.select({ ranking_id: rankings.ranking_id, snapshot_id: rankings.snapshot_id })
      .from(rankings).where(eq(rankings.snapshot_id, snapshotId)).orderBy(desc(rankings.created_at)).limit(1);
  } else {
    [row] = await db.select({ snapshot_id: strategies.snapshot_id, phase: strategies.phase, phase_started_at: strategies.phase_started_at })
      .from(strategies).where(eq(strategies.snapshot_id, snapshotId)).limit(1);
  }
  // A state event is only a wake-up to refetch the canonical row, not proof that
  // Briefing/Strategy/venues are complete. Also wake readers when no row exists.
  return { snapshot_id: snapshotId, ...row, ts: new Date().toISOString() };
}

async function stream(kind, req, res) {
  let snapshotId = null;
  try {
    if (kind !== 'offers') {
      const owned = await verifySnapshotOwnership(req.query.snapshot_id, req.auth.userId);
      if (!owned.ok) return res.status(owned.status).json(owned.body);
      snapshotId = owned.snapshot.snapshot_id;
    }
  } catch {
    return res.status(503).json({ error: 'stream_ownership_unavailable' });
  }
  if (res.destroyed || res.writableEnded) return;

  const releases = new Set();
  let closed = false, heartbeat;
  const cleanup = async () => {
    if (closed) return;
    closed = true; clearInterval(heartbeat);
    const pending = [...releases]; releases.clear();
    await Promise.allSettled(pending.map(release => Promise.resolve().then(release)));
  };
  const stop = () => { void cleanup(); };
  // Response close tracks the actual stream lifetime. Request close can mean
  // the GET request was consumed while its response is still streaming.
  res.on('close', stop); res.on('error', stop); req.on('aborted', stop);
  const write = text => {
    if (closed || res.destroyed || res.writableEnded) return false;
    try { res.write(text); return true; }
    catch { stop(); res.end(); return false; }
  };
  const emit = (event, payload) => write(`${event === 'message' ? '' : `event: ${event}\n`}data: ${JSON.stringify(payload)}\n\n`);
  let authPending = null;
  const stillAuthorized = async () => {
    if (closed) return false;
    if (!authPending) {
      authPending = Promise.resolve().then(() => isRequestAuthCurrent(req)).catch(() => false);
    }
    const pending = authPending;
    const valid = await pending;
    if (authPending === pending) authPending = null;
    if (!valid) { await cleanup(); if (!res.writableEnded) res.end(); }
    return valid && !closed;
  };
  const deliver = async (event, payload) => {
    if (await stillAuthorized()) emit(event, payload);
  };
  const forward = payload => {
    let data;
    try { data = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { return; }
    if (!data || typeof data !== 'object') return;
    if (kind === 'offers') {
      if (data.user_id !== req.auth.userId) return;
    } else if ((data.snapshot_id ?? data.snapshotId) !== snapshotId ||
      (data.user_id != null && data.user_id !== req.auth.userId)) return;
    void deliver(eventNames[kind], data);
  };

  let stateRead = null;
  const recoverState = () => {
    if (closed) return Promise.resolve();
    if (!stateRead) stateRead = (async () => {
      try { await deliver('state', await readInitialState(kind, snapshotId, req.auth.userId)); }
      catch (error) {
        sseLog.warn(1, `${kind} stream state read failed: ${error.code || error.name}`, OP.SSE);
        // LISTEN recovery can overlap a read issued on the failed connection.
        // A state message is a refetch signal, so failure must still wake readers.
        await deliver('state', { ...(snapshotId && { snapshot_id: snapshotId }), recovery: true });
      }
    })().finally(() => { stateRead = null; });
    return stateRead;
  };

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  write(': connected\n\n');
  heartbeat = setInterval(() => { void stillAuthorized().then(valid => { if (valid) write(': heartbeat\n\n'); }); }, 30000);
  heartbeat.unref?.();
  try {
    if (kind === 'phase') {
      phaseEmitter.on('change', forward);
      releases.add(() => phaseEmitter.removeListener('change', forward));
    } else {
      for (const channel of channelGroups[kind]) {
        if (closed) return;
        const release = await subscribeToChannel(channel, forward, { onReconnect: recoverState });
        // A close can win while LISTEN is pending; release that late result now.
        if (closed) { await release(); return; }
        releases.add(release);
      }
    }
    if (closed) return;
    await recoverState();
  } catch (error) {
    sseLog.error(1, `${kind} listener failed`, error, OP.SSE);
    emit('error', { error: 'stream_subscription_failed' });
    await cleanup(); res.end();
  }
}

for (const kind of Object.keys(channelGroups)) {
  router.get(`/events/${kind}`, requireAuthAllowQueryToken, (req, res) => stream(kind, req, res));
}
export default router;
