import express from 'express';
import { WebSocketServer } from 'ws';
import agentRoutes from './routes.js';
import { requireAuth } from '../middleware/auth.js';

// 2026-01-06: Security - IP allowlist check for agent routes
// 2026-01-07: SECURITY FIX - Block '*' wildcard in production (was defeating IP protection)
function checkAgentAllowlist(req, res, next) {
  const rawAllowedIPs = process.env.AGENT_ALLOWED_IPS || '127.0.0.1,::1,localhost';
  const clientIP = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';

  // Normalize IPv6 localhost
  const normalizedIP = clientIP === '::ffff:127.0.0.1' ? '127.0.0.1' : clientIP;

  // 2026-02-17: Memory routes are safe (read/write conversations, preferences, session state).
  // They don't need IP restriction — requireAuth middleware handles authentication.
  // This fixes 403 errors when browser clients call /agent/memory/* endpoints.
  if (req.path.startsWith('/memory/') || req.path.startsWith('/memory')) {
    return next();
  }

  // In development, allow all local connections
  const isDev = !isProduction;
  const isLocalhost = normalizedIP === '127.0.0.1' || normalizedIP === '::1' || normalizedIP === 'localhost';

  if (isDev && isLocalhost) {
    return next();
  }

  // 2026-01-07: SECURITY - Block '*' wildcard in production
  // The '*' wildcard defeats the entire purpose of IP allowlist protection.
  // If you need to allow all IPs in production, disable agent instead.
  const allowedIPs = rawAllowedIPs.split(',').map(ip => ip.trim());
  if (isProduction && allowedIPs.includes('*')) {
    console.error('[agent embed] ⛔ SECURITY ERROR: AGENT_ALLOWED_IPS contains "*" in production - refusing to allow wildcard');
    return res.status(403).json({
      error: 'AGENT_CONFIG_ERROR',
      message: 'Wildcard IP allowlist not permitted in production'
    });
  }

  if (!allowedIPs.includes(normalizedIP)) {
    console.warn(`[agent embed] ⛔ Blocked request from unauthorized IP: ${clientIP}`);
    return res.status(403).json({
      error: 'AGENT_ACCESS_DENIED',
      message: 'Agent access not permitted from this IP address'
    });
  }

  next();
}

// 2026-01-07: Admin-only middleware for dangerous operations
// Only users in AGENT_ADMIN_USERS can access protected routes
function requireAgentAdmin(req, res, next) {
  // req.auth is set by requireAuth middleware
  if (!req.auth?.userId) {
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
  }

  const adminUsers = (process.env.AGENT_ADMIN_USERS || '').split(',').map(u => u.trim()).filter(Boolean);

  // If no admins configured, block access in production (fail-secure)
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  if (adminUsers.length === 0 && isProduction) {
    console.error(`[agent embed] ⛔ Admin route blocked - no AGENT_ADMIN_USERS configured in production`);
    return res.status(403).json({
      error: 'AGENT_ADMIN_NOT_CONFIGURED',
      message: 'Admin users not configured for this operation'
    });
  }

  // In development without config, allow all authenticated users (for testing)
  if (adminUsers.length === 0 && !isProduction) {
    console.warn(`[agent embed] ⚠️ Dev mode: allowing ${req.auth.userId.substring(0, 8)} as admin (no AGENT_ADMIN_USERS set)`);
    return next();
  }

  // Check if current user is in admin list
  if (!adminUsers.includes(req.auth.userId)) {
    console.warn(`[agent embed] ⛔ Admin access denied for user ${req.auth.userId.substring(0, 8)}`);
    return res.status(403).json({
      error: 'AGENT_ADMIN_REQUIRED',
      message: 'This operation requires admin privileges'
    });
  }

  next();
}

export { requireAgentAdmin };

export function mountAgent({ app, basePath, wsPath, server }) {
  // 2026-01-06: SECURITY - Agent must be explicitly enabled
  // This prevents accidental exposure of powerful admin endpoints
  if (process.env.AGENT_ENABLED !== 'true') {
    console.log(`[agent embed] ⚠️ Agent DISABLED (set AGENT_ENABLED=true to enable)`);

    // Mount a stub that returns 503 to indicate the feature is disabled
    app.use(basePath, (_req, res) => {
      res.status(503).json({
        error: 'AGENT_DISABLED',
        message: 'Agent functionality is not enabled on this server'
      });
    });
    return;
  }

  console.log(`[agent embed] Mounting Agent at ${basePath}, WS at ${wsPath}`);

  // 2026-01-06: SECURITY - Agent routes require authentication + IP allowlist
  // These routes expose powerful operations (env updates, config reads, shell access)
  app.use(basePath, checkAgentAllowlist, requireAuth, agentRoutes);
  console.log(`[agent embed] ✅ Agent routes mounted at ${basePath} (auth + IP allowlist required)`);

  // Agent health endpoint - PUBLIC (for load balancer checks)
  // 2026-01-06: Intentionally unauthenticated for infrastructure health checks
  app.get(`${basePath}/health`, (_req, res) => {
    res.json({
      ok: true,
      agent: true,
      mode: 'embedded',
      enabled: process.env.AGENT_ENABLED === 'true',
      timestamp: new Date().toISOString()
    });
  });

  // Agent capabilities endpoint - PROTECTED (reveals system capabilities)
  // 2026-01-06: Requires auth to prevent reconnaissance
  app.get(`${basePath}/capabilities`, checkAgentAllowlist, requireAuth, (_req, res) => {
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
  // 2026-01-06: SECURITY - Validate token before allowing WS upgrade
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '/';
    if (!url.startsWith(wsPath)) return;

    console.log(`[agent embed] WS upgrade request for ${url}`);

    // Extract token from query string (WebSockets can't use headers for auth)
    const urlObj = new URL(url, `http://${req.headers.host}`);
    const token = urlObj.searchParams.get('token');

    if (!token) {
      console.warn(`[agent embed] ⛔ WS upgrade rejected - no token provided`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Basic token validation (in production, verify JWT properly)
    // For now, just check it's not empty and has reasonable length
    if (token.length < 10) {
      console.warn(`[agent embed] ⛔ WS upgrade rejected - invalid token`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

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
