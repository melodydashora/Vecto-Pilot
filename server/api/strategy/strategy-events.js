// server/api/strategy/strategy-events.js
// SSE endpoints for real-time notifications via PostgreSQL LISTEN/NOTIFY
//
// ARCHITECTURE: Uses shared notification dispatcher (subscribeToChannel) to ensure
// ONE notification handler on the database client, regardless of how many SSE
// connections exist. This prevents duplicate log spam and duplicate processing.
//
// 2026-01-09: Consolidated all SSE endpoints here. /events/phase uses EventEmitter
// (high-frequency ephemeral updates), while strategy/briefing/blocks use DB NOTIFY.

import express from 'express';
import { subscribeToChannel } from '../../db/db-client.js';
import { sseLog, OP } from '../../logger/workflow.js';
// Phase events use EventEmitter (high-frequency, ephemeral - no DB needed)
// 2026-01-09: Extracted to dedicated module (eliminates legacy SSE router dependency)
import { phaseEmitter } from '../../events/phase-emitter.js';

const router = express.Router();

// Track active SSE connections for debugging
let strategyConnections = 0;
let briefingConnections = 0;
let blocksConnections = 0;
let phaseConnections = 0;

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

  // 2026-01-08: FIX - Register cleanup BEFORE subscription to prevent orphaned subscribers
  // Race condition: If bot detector or network kills connection after subscribeToChannel()
  // but before req.on('close') is registered, the subscription becomes orphaned.
  // Solution: Register cleanup first, store unsubscribe function for later use.
  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return; // Prevent double cleanup
    cleanedUp = true;
    strategyConnections--;
    sseLog.info(`SSE /events/strategy closed (${strategyConnections} remaining)`, OP.SSE);
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  try {
    // Use shared notification dispatcher - ONE handler, many subscribers
    unsubscribe = await subscribeToChannel('strategy_ready', (payload) => {
      if (cleanedUp) return; // Don't write to closed connection
      res.write(`event: strategy_ready\n`);
      res.write(`data: ${payload}\n\n`);
    });
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

  // Send initial comment to establish connection
  res.write(': connected\n\n');

  // 2026-01-08: FIX - Register cleanup BEFORE subscription to prevent orphaned subscribers
  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    briefingConnections--;
    sseLog.info(`SSE /events/briefing closed (${briefingConnections} remaining)`, OP.SSE);
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  try {
    // Use shared notification dispatcher - ONE handler, many subscribers
    unsubscribe = await subscribeToChannel('briefing_ready', (payload) => {
      if (cleanedUp) return;
      res.write(`event: briefing_ready\n`);
      res.write(`data: ${payload}\n\n`);
    });
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

  // Send initial comment to establish connection
  res.write(': connected\n\n');

  // 2026-01-08: FIX - Register cleanup BEFORE subscription to prevent orphaned subscribers
  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    blocksConnections--;
    sseLog.info(`SSE /events/blocks closed (${blocksConnections} remaining)`, OP.SSE);
    if (unsubscribe) {
      await unsubscribe();
    }
  });

  try {
    // Use shared notification dispatcher - ONE handler, many subscribers
    unsubscribe = await subscribeToChannel('blocks_ready', (payload) => {
      if (cleanedUp) return;
      res.write(`event: blocks_ready\n`);
      res.write(`data: ${payload}\n\n`);
    });
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

  // Send initial comment to establish connection
  res.write(': connected\n\n');

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

  let unsubscribe = null;
  let cleanedUp = false;

  req.on('close', async () => {
    if (cleanedUp) return;
    cleanedUp = true;
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
  } catch (err) {
    sseLog.error(1, `Offer listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

export default router;
