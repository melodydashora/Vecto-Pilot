// server/api/briefing/events.js
// SSE endpoints for real-time strategy and blocks notifications
import { Router } from 'express';
import { EventEmitter } from 'events';

const router = Router();

// Global event emitters for broadcasting
export const strategyEmitter = new EventEmitter();
export const blocksEmitter = new EventEmitter();
export const phaseEmitter = new EventEmitter();  // Real-time phase change events

// Set max listeners to prevent warnings with many clients
strategyEmitter.setMaxListeners(100);
blocksEmitter.setMaxListeners(100);
phaseEmitter.setMaxListeners(100);

// SSE endpoint for strategy_ready events
router.get('/strategy', (req, res) => {
  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    console.log('[SSE-Notifications] Client connected to /events/strategy SSE');
    
    const onReady = (data) => {
      const eventData = typeof data === 'string' ? { snapshot_id: data } : data;
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    };
    
    strategyEmitter.on('ready', onReady);
    
    // Clean up on disconnect
    req.on('close', () => {
      console.log('[SSE-Notifications] Client disconnected from /events/strategy SSE');
      strategyEmitter.removeListener('ready', onReady);
      res.end();
    });
    
  } catch (error) {
    console.error('[SSE-Notifications] Error setting up strategy SSE:', error);
    res.status(500).json({ error: 'Failed to connect to strategy events' });
  }
});

// SSE endpoint for blocks_ready events
router.get('/blocks', (req, res) => {
  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log('[SSE-Notifications] Client connected to /events/blocks SSE');

    const onReady = (data) => {
      const eventData = typeof data === 'string' ? { snapshot_id: data } : data;
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    };

    blocksEmitter.on('ready', onReady);

    // Clean up on disconnect
    req.on('close', () => {
      console.log('[SSE-Notifications] Client disconnected from /events/blocks SSE');
      blocksEmitter.removeListener('ready', onReady);
      res.end();
    });

  } catch (error) {
    console.error('[SSE-Notifications] Error setting up blocks SSE:', error);
    res.status(500).json({ error: 'Failed to connect to blocks events' });
  }
});

// SSE endpoint for real-time phase_change events
// Emits whenever pipeline phase changes (starting → resolving → analyzing → etc.)
// Includes timing metadata for accurate progress calculation
router.get('/phase', (req, res) => {
  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log('[SSE-Notifications] Client connected to /events/phase SSE');

    const onChange = (data) => {
      // data: { snapshot_id, phase, phase_started_at, expected_duration_ms }
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    phaseEmitter.on('change', onChange);

    // Clean up on disconnect
    req.on('close', () => {
      console.log('[SSE-Notifications] Client disconnected from /events/phase SSE');
      phaseEmitter.removeListener('change', onChange);
      res.end();
    });

  } catch (error) {
    console.error('[SSE-Notifications] Error setting up phase SSE:', error);
    res.status(500).json({ error: 'Failed to connect to phase events' });
  }
});

export default router;
