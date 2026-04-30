// server/api/strategy/strategy-events.js
// SSE endpoints for real-time notifications via PostgreSQL LISTEN/NOTIFY
//
// ARCHITECTURE: Uses shared notification dispatcher (subscribeToChannel) to ensure
// ONE notification handler on the database client, regardless of how many SSE
// connections exist. This prevents duplicate log spam and duplicate processing.
//
// 2026-01-09: Consolidated all SSE endpoints here. /events/phase uses EventEmitter
// (high-frequency ephemeral updates), while strategy/briefing/blocks use DB NOTIFY.
//
// 2026-02-18: FIX - Two subscriber leak bugs:
//   Bug 1: req.on('close') fired before subscribeToChannel resolved → unsubscribe was null → leaked
//   Bug 2: No SSE heartbeat → dead connections undetected for hours → orphaned subscribers
//   Fix: Post-subscribe cleanup check + 30s heartbeat on all endpoints

import express from 'express';
import { subscribeToChannel } from '../../db/db-client.js';
import { sseLog, OP } from '../../logger/workflow.js';
// Phase events use EventEmitter (high-frequency, ephemeral - no DB needed)
// 2026-01-09: Extracted to dedicated module (eliminates legacy SSE router dependency)
import { phaseEmitter } from '../../events/phase-emitter.js';
// 2026-04-18 (F2): Initial-state handshake — query DB for current state on subscribe
// so a client that arrives after a NOTIFY has fired (or after a NOTIFY was lost
// during a LISTEN reconnect window) immediately receives a wake-up signal and
// refetches. Closes G3 from NOTIFY_LOSS_RECON_2026-04-18.md.
import { db } from '../../db/drizzle.js';
import { briefings, strategies, rankings } from '../../../shared/schema.js';
import { eq, and, isNotNull, desc, or, sql as drizzleSql } from 'drizzle-orm';

const router = express.Router();

// 2026-04-18 (F2): Helper to write the initial-state SSE event after subscribe.
// Each per-channel handler calls a tailored variant below; this wraps the wire format.
function writeStateEvent(res, payload) {
  try {
    res.write(`event: state\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // Socket closed mid-write — caller's req.on('close') will clean up.
  }
}

// Track active SSE connections for debugging
let strategyConnections = 0;
let briefingConnections = 0;
let blocksConnections = 0;
let phaseConnections = 0;

// 2026-02-18: SSE heartbeat interval (30s) — detects dead connections that didn't send TCP close.
// Without this, mobile sleep/network switch leaves orphaned subscribers for hours.
const HEARTBEAT_INTERVAL_MS = 30000;

/**
 * Start SSE heartbeat that sends a comment every 30s.
 * If the write fails (dead socket), Express emits 'close' on req → triggers cleanup.
 * @returns {NodeJS.Timeout} Interval ID for cleanup
 */
function startHeartbeat(res) {
  return setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      // Write failed — socket is dead. Express will emit 'close' event.
    }
  }, HEARTBEAT_INTERVAL_MS);
}

router.get('/events/strategy', async (req, res) => {
  strategyConnections++;
  sseLog.phase(1, `SSE /events/strategy connected (${strategyConnections} active)`, OP.SSE);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial comment to establish connection
  res.write(': connected\n\n');

  // 2026-02-18: Heartbeat to detect dead connections
  const heartbeat = startHeartbeat(res);

  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return; // Prevent double cleanup
    cleanedUp = true;
    clearInterval(heartbeat);
    strategyConnections--;
    sseLog.info(`SSE /events/strategy closed (${strategyConnections} remaining)`, OP.SSE);
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  // 2026-04-18 (F2): Initial-state handshake. If client passed ?snapshot_id=,
  // query strategies for current readiness and emit a `state` event so a client
  // that missed the original strategy_ready NOTIFY catches up immediately.
  const handshakeSnapshotId = typeof req.query.snapshot_id === 'string' ? req.query.snapshot_id : null;
  if (handshakeSnapshotId) {
    try {
      const [row] = await db.select({
        snapshot_id: strategies.snapshot_id,
        status: strategies.status,
        has_strategy_for_now: drizzleSql`(${strategies.strategy_for_now} IS NOT NULL AND length(${strategies.strategy_for_now}) > 0)`,
      })
        .from(strategies)
        .where(eq(strategies.snapshot_id, handshakeSnapshotId))
        .limit(1);
      if (!cleanedUp && row) {
        writeStateEvent(res, {
          snapshot_id: row.snapshot_id,
          status: row.status,
          has_strategy_for_now: !!row.has_strategy_for_now,
          ts: new Date().toISOString(),
        });
      }
    } catch (err) {
      sseLog.warn(1, `Strategy handshake lookup failed: ${err.message}`, OP.SSE);
    }
  }

  try {
    // Use shared notification dispatcher - ONE handler, many subscribers
    unsubscribe = await subscribeToChannel('strategy_ready', (payload) => {
      if (cleanedUp) return; // Don't write to closed connection
      res.write(`event: strategy_ready\n`);
      res.write(`data: ${payload}\n\n`);
    });

    // 2026-02-18: FIX - If connection closed DURING the await above, unsubscribe immediately.
    // Previously, req.on('close') fired while unsubscribe was still null → leaked subscriber.
    if (cleanedUp && unsubscribe) {
      await unsubscribe();
    }
  } catch (err) {
    sseLog.error(1, `Strategy listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

router.get('/events/briefing', async (req, res) => {
  briefingConnections++;
  sseLog.phase(1, `SSE /events/briefing connected (${briefingConnections} active)`, OP.SSE);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(': connected\n\n');
  const heartbeat = startHeartbeat(res);

  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    briefingConnections--;
    sseLog.info(`SSE /events/briefing closed (${briefingConnections} remaining)`, OP.SSE);
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  // 2026-04-18 (F2): Initial-state handshake. If client passed ?snapshot_id=,
  // query briefings for current readiness and emit a `state` event so a client
  // that missed the original briefing_ready NOTIFY catches up immediately. This
  // is the primary fix for the "infinite spinner after LISTEN reconnect window"
  // symptom documented in NOTIFY_LOSS_RECON_2026-04-18.md.
  const handshakeBriefingSnapshotId = typeof req.query.snapshot_id === 'string' ? req.query.snapshot_id : null;
  if (handshakeBriefingSnapshotId) {
    try {
      const [row] = await db.select({
        snapshot_id: briefings.snapshot_id,
        has_traffic: drizzleSql`(${briefings.traffic_conditions} IS NOT NULL)`,
        has_news: drizzleSql`(${briefings.news} IS NOT NULL)`,
        has_airport: drizzleSql`(${briefings.airport_conditions} IS NOT NULL)`,
        has_school_closures: drizzleSql`(${briefings.school_closures} IS NOT NULL)`,
        has_weather: drizzleSql`(${briefings.weather_current} IS NOT NULL)`,
      })
        .from(briefings)
        .where(eq(briefings.snapshot_id, handshakeBriefingSnapshotId))
        .limit(1);
      if (!cleanedUp && row) {
        writeStateEvent(res, {
          snapshot_id: row.snapshot_id,
          has_traffic: !!row.has_traffic,
          has_news: !!row.has_news,
          has_airport: !!row.has_airport,
          has_school_closures: !!row.has_school_closures,
          has_weather: !!row.has_weather,
          ts: new Date().toISOString(),
        });
      }
    } catch (err) {
      sseLog.warn(1, `Briefing handshake lookup failed: ${err.message}`, OP.SSE);
    }
  }

  try {
    // 2026-04-18: PHASE A — also subscribe to the six per-section channels emitted
    // by briefing-service.js (writeSectionAndNotify). Each per-section NOTIFY is
    // forwarded to the client as a `briefing_ready` event so the client's existing
    // refetch-on-briefing_ready hook re-pulls the aggregate endpoint whenever a
    // section lands. Net UX: the briefing tab populates section-by-section as
    // providers resolve (weather first, then traffic, then events), instead of
    // all-or-nothing at t=52s. The final `briefing_ready` still fires at the end
    // of generation as the "fully complete" signal.
    const perSectionChannels = [
      'briefing_weather_ready',
      'briefing_traffic_ready',
      'briefing_events_ready',
      'briefing_news_ready',
      'briefing_airport_ready',
      'briefing_school_closures_ready',
    ];
    const unsubscribers = [];

    // Final (complete) NOTIFY — preserved as the authoritative "all sections done"
    // signal. Downstream consumers (strategist pipeline, tests) still key off it.
    unsubscribers.push(await subscribeToChannel('briefing_ready', (payload) => {
      if (cleanedUp) return;
      res.write(`event: briefing_ready\n`);
      res.write(`data: ${payload}\n\n`);
    }));

    // Per-section NOTIFYs — each forwarded as a briefing_ready SSE event so the
    // client refetches the aggregate endpoint progressively. The client sees the
    // same event name it already handles; payload adds `section` for observability.
    for (const channel of perSectionChannels) {
      unsubscribers.push(await subscribeToChannel(channel, (payload) => {
        if (cleanedUp) return;
        res.write(`event: briefing_ready\n`);
        res.write(`data: ${payload}\n\n`);
      }));
    }

    // Bundle all unsubscribes into a single cleanup to keep the outer req.on('close')
    // handler simple.
    unsubscribe = async () => {
      for (const u of unsubscribers) {
        try { await u(); } catch { /* swallow — we're tearing down */ }
      }
    };

    // 2026-02-18: FIX - Post-subscribe cleanup for race condition
    if (cleanedUp && unsubscribe) {
      await unsubscribe();
    }
  } catch (err) {
    sseLog.error(1, `Briefing listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

router.get('/events/blocks', async (req, res) => {
  blocksConnections++;
  sseLog.phase(1, `SSE /events/blocks connected (${blocksConnections} active)`, OP.SSE);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(': connected\n\n');
  const heartbeat = startHeartbeat(res);

  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    blocksConnections--;
    sseLog.info(`SSE /events/blocks closed (${blocksConnections} remaining)`, OP.SSE);
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  // 2026-04-18 (F2): Initial-state handshake — query rankings for the latest
  // ranking_id linked to this snapshot and emit a `state` event so a client
  // that missed blocks_ready catches up immediately.
  const handshakeBlocksSnapshotId = typeof req.query.snapshot_id === 'string' ? req.query.snapshot_id : null;
  if (handshakeBlocksSnapshotId) {
    try {
      const [row] = await db.select({
        ranking_id: rankings.ranking_id,
        snapshot_id: rankings.snapshot_id,
      })
        .from(rankings)
        .where(eq(rankings.snapshot_id, handshakeBlocksSnapshotId))
        .orderBy(desc(rankings.created_at))
        .limit(1);
      if (!cleanedUp && row) {
        writeStateEvent(res, {
          snapshot_id: row.snapshot_id,
          ranking_id: row.ranking_id,
          ts: new Date().toISOString(),
        });
      }
    } catch (err) {
      sseLog.warn(1, `Blocks handshake lookup failed: ${err.message}`, OP.SSE);
    }
  }

  try {
    unsubscribe = await subscribeToChannel('blocks_ready', (payload) => {
      if (cleanedUp) return;
      res.write(`event: blocks_ready\n`);
      res.write(`data: ${payload}\n\n`);
    });

    // 2026-02-18: FIX - Post-subscribe cleanup for race condition
    if (cleanedUp && unsubscribe) {
      await unsubscribe();
    }
  } catch (err) {
    sseLog.error(1, `Blocks listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

// 2026-01-09: /events/phase migrated from briefing/events.js (EventEmitter SSE)
// Phase updates are high-frequency ephemeral events - no DB NOTIFY needed
router.get('/events/phase', (req, res) => {
  phaseConnections++;
  sseLog.phase(1, `SSE /events/phase connected (${phaseConnections} active)`, OP.SSE);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(': connected\n\n');
  const heartbeat = startHeartbeat(res);

  let cleanedUp = false;

  const onChange = (data) => {
    if (cleanedUp) return;
    // data: { snapshot_id, phase, phase_started_at, expected_duration_ms }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Register cleanup BEFORE adding listener
  req.on('close', () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    phaseConnections--;
    sseLog.info(`SSE /events/phase closed (${phaseConnections} remaining)`, OP.SSE);
    phaseEmitter.removeListener('change', onChange);
    res.end();
  });

  // Subscribe to phase changes
  phaseEmitter.on('change', onChange);
});

// 2026-02-15: SSE channel for real-time offer analysis notifications
// When a Siri Shortcut triggers an offer analysis, the web app receives the result here.
// This allows the dashboard to show "ACCEPT: $15 / 4.2mi" even while the driver
// is in the Uber app — the notification appears when they return to Vecto.
let offerConnections = 0;

router.get('/events/offers', async (req, res) => {
  offerConnections++;
  sseLog.phase(1, `SSE /events/offers connected (${offerConnections} active)`, OP.SSE);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(': connected\n\n');
  const heartbeat = startHeartbeat(res);

  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    offerConnections--;
    sseLog.info(`SSE /events/offers closed (${offerConnections} remaining)`, OP.SSE);
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  try {
    unsubscribe = await subscribeToChannel('offer_analyzed', (payload) => {
      if (cleanedUp) return;
      res.write(`event: offer_analyzed\n`);
      res.write(`data: ${payload}\n\n`);
    });

    // 2026-02-18: FIX - Post-subscribe cleanup for race condition
    if (cleanedUp && unsubscribe) {
      await unsubscribe();
    }
  } catch (err) {
    sseLog.error(1, `Offer listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

export default router;
