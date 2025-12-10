// server/strategy-events.js
import express from 'express';
import { getListenClient } from './db/db-client.js';

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
      res.write(`data: ${msg.payload}\n\n`); // Forward JSON payload as-is
    };

    dbClient.on('notification', onNotify);
    
    req.on('close', () => {
      console.log('[SSE] Client disconnected from strategy events');
      // Remove listener only if dbClient still exists
      if (dbClient) {
        dbClient.off('notification', onNotify);
      }
    });
  } catch (err) {
    console.error('[SSE] Failed to setup strategy listener:', err);
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
    console.log('[SSE] Subscribed to blocks_ready channel');
    
    const onNotify = (msg) => {
      if (msg.channel !== 'blocks_ready') return;
      console.log('[SSE] Broadcasting blocks_ready:', msg.payload);
      res.write(`event: blocks_ready\n`);
      res.write(`data: ${msg.payload}\n\n`); // Forward JSON payload with ranking_id and snapshot_id
    };

    dbClient.on('notification', onNotify);
    
    req.on('close', async () => {
      console.log('[SSE] Client disconnected from blocks events');
      dbClient.off('notification', onNotify);
      // Only UNLISTEN if connection is still alive
      if (dbClient && !dbClient._ending && !dbClient._ended) {
        try { 
          await dbClient.query('UNLISTEN blocks_ready'); 
          console.log('[SSE] Unsubscribed from blocks_ready');
        } catch (e) {
          console.warn('[SSE] Failed to UNLISTEN (connection may be closed):', e.message);
        }
      }
    });
  } catch (err) {
    console.error('[SSE] Failed to setup blocks listener:', err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to database' })}\n\n`);
  }
});

export default router;
