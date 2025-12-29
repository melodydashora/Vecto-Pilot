// server/api/strategy/strategy-events.js
import express from 'express';
import { getListenClient } from '../../db/db-client.js';
import { sseLog, OP } from '../../logger/workflow.js';

const router = express.Router();

router.get('/events/strategy', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial comment to establish connection
  res.write(': connected\n\n');

  try {
    const dbClient = await getListenClient();

    // Subscribe to strategy_ready channel
    await dbClient.query('LISTEN strategy_ready');
    sseLog.phase(1, `Subscribed: strategy_ready`, OP.SSE);

    const onNotify = (msg) => {
      if (msg.channel !== 'strategy_ready') return;
      sseLog.done(1, `Broadcasting strategy_ready`, OP.SSE);
      res.write(`event: strategy_ready\n`);
      res.write(`data: ${msg.payload}\n\n`);
    };

    dbClient.on('notification', onNotify);

    req.on('close', async () => {
      dbClient.off('notification', onNotify);
      if (dbClient && !dbClient._ending && !dbClient._ended) {
        try {
          await dbClient.query('UNLISTEN strategy_ready');
        } catch (_e) {
          // Connection may already be closed
        }
      }
    });
  } catch (err) {
    sseLog.error(1, `Strategy listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

router.get('/events/briefing', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial comment to establish connection
  res.write(': connected\n\n');

  try {
    const dbClient = await getListenClient();

    // Subscribe to briefing_ready channel
    await dbClient.query('LISTEN briefing_ready');
    sseLog.phase(1, `Subscribed: briefing_ready`, OP.SSE);

    const onNotify = (msg) => {
      if (msg.channel !== 'briefing_ready') return;
      sseLog.done(1, `Broadcasting briefing_ready`, OP.SSE);
      res.write(`event: briefing_ready\n`);
      res.write(`data: ${msg.payload}\n\n`);
    };

    dbClient.on('notification', onNotify);

    req.on('close', async () => {
      dbClient.off('notification', onNotify);
      if (dbClient && !dbClient._ending && !dbClient._ended) {
        try {
          await dbClient.query('UNLISTEN briefing_ready');
        } catch (_e) {
          // Connection may already be closed
        }
      }
    });
  } catch (err) {
    sseLog.error(1, `Briefing listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

router.get('/events/blocks', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial comment to establish connection
  res.write(': connected\n\n');

  try {
    const dbClient = await getListenClient();
    
    // Subscribe to blocks_ready channel
    await dbClient.query('LISTEN blocks_ready');
    sseLog.phase(1, `Subscribed: blocks_ready`, OP.SSE);

    const onNotify = (msg) => {
      if (msg.channel !== 'blocks_ready') return;
      sseLog.done(1, `Broadcasting blocks_ready`, OP.SSE);
      res.write(`event: blocks_ready\n`);
      res.write(`data: ${msg.payload}\n\n`);
    };

    dbClient.on('notification', onNotify);

    req.on('close', async () => {
      dbClient.off('notification', onNotify);
      if (dbClient && !dbClient._ending && !dbClient._ended) {
        try {
          await dbClient.query('UNLISTEN blocks_ready');
        } catch (_e) {
          // Connection may already be closed
        }
      }
    });
  } catch (err) {
    sseLog.error(1, `Blocks listener failed`, err, OP.SSE);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

export default router;
