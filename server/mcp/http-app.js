// server/mcp/http-app.js
// Express 4 app hosting the MCP Streamable HTTP transport at /mcp.
//
// 2026-09-03: Created with the MCP server. Uses the repo's express@4 and the
// SDK's Node transport (handleRequest takes a plain IncomingMessage), so the
// SDK's nested express@5 copy is never loaded. Stateful sessions per the SDK's
// reference pattern: one McpServer + transport per Mcp-Session-Id, created on
// `initialize`, torn down on DELETE / transport close, capped to avoid growth.
//
// This app is the whole public surface of the MCP server. It is NOT mounted
// in the gateway and NOT proxied by server/agent/bridge.js — separate process,
// separate port, separate token (MCP_TOKEN).

import { randomUUID } from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { makeBearerGuard } from './auth.js';
import { SERVER_NAME } from './create-server.js';

export const MAX_SESSIONS = 64;

function jsonRpcError(res, status, code, message) {
  if (res.headersSent) return;
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * @param {object} options
 * @param {() => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} options.createServer  factory; called once per session
 * @param {string} options.token                 MCP_TOKEN (required, ≥32 chars)
 * @param {string} options.version               server version for /health
 * @param {boolean} [options.enableJsonResponse] JSON instead of SSE for POST responses (default false = SSE)
 * @param {(line: string) => void} [options.log] logger (default stderr)
 */
export function createMcpHttpApp({ createServer, token, version, enableJsonResponse = false, log = (l) => process.stderr.write(l + '\n') }) {
  if (typeof createServer !== 'function') throw new Error('createMcpHttpApp: createServer factory is required');
  const guard = makeBearerGuard(token);

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /** @type {Map<string, { transport: StreamableHTTPServerTransport, server: any, lastSeen: number }>} */
  const sessions = new Map();

  function evictIfNeeded() {
    if (sessions.size < MAX_SESSIONS) return;
    let oldestId = null; let oldest = Infinity;
    for (const [id, s] of sessions) if (s.lastSeen < oldest) { oldest = s.lastSeen; oldestId = id; }
    if (oldestId) {
      const s = sessions.get(oldestId);
      sessions.delete(oldestId);
      log(`[mcp] session evicted id=${oldestId.slice(0, 8)} (cap ${MAX_SESSIONS})`);
      s.transport.close().catch(() => {});
    }
  }

  // Unauthenticated, secret-free liveness probe.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: SERVER_NAME, version, transport: 'streamable-http', sessions: sessions.size });
  });

  app.use('/mcp', rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }));
  app.use('/mcp', guard);
  app.use('/mcp', express.json({ limit: '4mb' }));

  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId && typeof sessionId === 'string') {
        const s = sessions.get(sessionId);
        if (!s) return jsonRpcError(res, 404, -32001, 'Session not found (expired or evicted) — re-initialize');
        s.lastSeen = Date.now();
        return await s.transport.handleRequest(req, res, req.body);
      }
      if (!isInitializeRequest(req.body)) {
        return jsonRpcError(res, 400, -32000, 'Bad Request: no Mcp-Session-Id and not an initialize request');
      }
      evictIfNeeded();
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, lastSeen: Date.now() });
          log(`[mcp] session initialized id=${id.slice(0, 8)}`);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
          log(`[mcp] session closed id=${id.slice(0, 8)}`);
        },
      });
      // Client identity is only known after the initialize handshake completes
      // (the session id is minted before that), so log it from the SDK's hook.
      server.server.oninitialized = () => {
        const c = server.server.getClientVersion();
        log(`[mcp] client initialized session=${transport.sessionId ? transport.sessionId.slice(0, 8) : '?'} client=${c ? `${c.name}@${c.version}` : 'unknown'}`);
      };
      transport.onclose = () => {
        if (transport.sessionId && sessions.has(transport.sessionId)) {
          sessions.delete(transport.sessionId);
          log(`[mcp] transport closed id=${transport.sessionId.slice(0, 8)}`);
        }
      };
      await server.connect(transport);
      return await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log(`[mcp] POST /mcp error: ${err && err.message ? err.message : String(err)}`);
      jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  });

  // GET = server→client SSE stream; DELETE = explicit session teardown. Both are session-scoped.
  const sessionScoped = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const s = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!s) return jsonRpcError(res, 400, -32000, 'Bad Request: missing or unknown Mcp-Session-Id');
    s.lastSeen = Date.now();
    try {
      await s.transport.handleRequest(req, res);
    } catch (err) {
      log(`[mcp] ${req.method} /mcp error: ${err && err.message ? err.message : String(err)}`);
      jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  };
  app.get('/mcp', sessionScoped);
  app.delete('/mcp', sessionScoped);

  app.use((_req, res) => res.status(404).json({ error: 'not-found' }));

  // Exposed for graceful shutdown + tests.
  app.locals.mcpSessions = sessions;
  app.locals.closeAllSessions = async () => {
    const all = [...sessions.values()];
    sessions.clear();
    await Promise.allSettled(all.map(s => s.transport.close()));
  };
  return app;
}
