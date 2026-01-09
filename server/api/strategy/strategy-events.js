// server/api/strategy/strategy-events.js
// SSE endpoints for real-time notifications via PostgreSQL LISTEN/NOTIFY
//
// ARCHITECTURE: Uses shared notification dispatcher (subscribeToChannel) to ensure
// ONE notification handler on the database client, regardless of how many SSE
// connections exist. This prevents duplicate log spam and duplicate processing.

import express from 'express';
import { subscribeToChannel } from '../../db/db-client.js';
import { sseLog, OP } from '../../logger/workflow.js';

const router = express.Router();

// Track active SSE connections for debugging
let strategyConnections = 0;
let briefingConnections = 0;
let blocksConnections = 0;

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

export default router;
