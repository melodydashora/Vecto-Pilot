// server/strategy-events.js
import express from 'express';
import { getListenClient } from './lib/db-client.js';

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
    
    const onNotify = (msg) => {
      if (msg.channel !== 'strategy_ready') return;
      console.log('[SSE] Broadcasting strategy_ready:', msg.payload);
      res.write(`event: strategy_ready\n`);
      res.write(`data: ${msg.payload}\n\n`);
    };

    dbClient.on('notification', onNotify);
    
    req.on('close', () => {
      console.log('[SSE] Client disconnected');
      dbClient.off('notification', onNotify);
    });
  } catch (err) {
    console.error('[SSE] Failed to setup listener:', err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

export default router;
