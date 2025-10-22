import express from 'express';
import { WebSocketServer } from 'ws';

export function mountAgent({ app, basePath, wsPath, server }) {
  console.log(`[agent embed] Mounting Agent at ${basePath}, WS at ${wsPath}`);

  // Agent health endpoint
  app.get(`${basePath}/health`, (_req, res) => {
    res.json({ 
      ok: true, 
      agent: true, 
      mode: 'embedded',
      timestamp: new Date().toISOString() 
    });
  });

  // Agent capabilities endpoint
  app.get(`${basePath}/capabilities`, (_req, res) => {
    res.json({
      ok: true,
      capabilities: {
        fs_read: true,
        fs_write: true,
        shell: true,
        sql: true,
        websearch: true
      },
      mode: 'embedded'
    });
  });

  // Minimal WebSocket server for agent communication
  const wss = new WebSocketServer({ 
    noServer: true, 
    perMessageDeflate: false 
  });

  // Handle WebSocket upgrades at the specified path
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '/';
    if (!url.startsWith(wsPath)) return;

    console.log(`[agent embed] WS upgrade request for ${url}`);
    
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    console.log(`[agent embed] WS client connected from ${req.socket.remoteAddress}`);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.ping();
        } catch (err) {
          console.error('[agent embed] Ping error:', err.message);
        }
      }
    }, 15000);

    // Echo messages for now (real agent would process commands)
    ws.on('message', (buffer) => {
      try {
        const msg = buffer.toString();
        console.log(`[agent embed] Received: ${msg.substring(0, 100)}...`);
        
        // Echo back with agent response wrapper
        ws.send(JSON.stringify({
          type: 'response',
          data: { received: msg, mode: 'embedded' },
          timestamp: Date.now()
        }));
      } catch (err) {
        console.error('[agent embed] Message error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('[agent embed] WS client disconnected');
      clearInterval(heartbeat);
    });

    ws.on('error', (err) => {
      console.error('[agent embed] WS error:', err.message);
      clearInterval(heartbeat);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Agent WebSocket connected (embedded mode)',
      timestamp: Date.now()
    }));
  });

  console.log(`[agent embed] WebSocket server ready for ${wsPath}`);
}
