#!/usr/bin/env node
/**
 * mcp-server.js — Vecto Pilot standalone Model Context Protocol server
 *
 * 2026-09-03: Created. A real MCP-protocol server (JSON-RPC over the official
 * @modelcontextprotocol/sdk) exposing the continuity tables (claude_memory,
 * todo, lessons_learned, definitions, app_rules) and read-only repo tools to
 * MCP clients: Claude Code, Claude Desktop / Cowork, claude.ai connectors.
 *
 * SEPARATE FROM THE AGENT BRIDGE by design (Melody, 2026-09-03):
 *   - own process (this file), own port (MCP_PORT), own token (MCP_TOKEN)
 *   - not mounted in gateway-server.js, not proxied by server/agent/bridge.js,
 *     no shared token with agent-server.js (AGENT_TOKEN) or the gateway
 *     service accounts (VECTO_AGENT_SECRET / CLAUDE_BRIDGE_TOKEN)
 *   - no shell, no SQL, no file writes here — those remain on agent-server.js
 *
 * Transports:
 *   node mcp-server.js            Streamable HTTP at http://MCP_HOST:MCP_PORT/mcp
 *   node mcp-server.js --stdio    stdio (for a local `claude mcp add` / Claude Desktop
 *                                 command config); no token — the process IS the client's
 *
 * Env (names only; values live in .env.local):
 *   DATABASE_URL     required (fail-loud at import via server/db/connection-manager.js)
 *   MCP_TOKEN        required for HTTP, ≥32 chars (openssl rand -hex 32)
 *   MCP_PORT         default 5055
 *   MCP_HOST         default 0.0.0.0 (Replit port forwarding needs a non-loopback bind)
 *   MCP_READ_ONLY    '1' | 'true' → register no write tools
 *   MCP_JSON_RESPONSE '1' | 'true' → JSON instead of SSE for POST responses
 *   BASE_DIR         repo root for repo tools (default: this file's directory)
 *
 * Wire into Claude Code (HTTP):
 *   claude mcp add --transport http vecto-pilot http://127.0.0.1:5055/mcp \
 *     --header "Authorization: Bearer $MCP_TOKEN"
 * Wire into Claude Code (stdio):
 *   claude mcp add vecto-pilot -- node /home/runner/workspace/mcp-server.js --stdio
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require('./package.json');

const STDIO = process.argv.includes('--stdio');
const truthy = (v) => v === '1' || v === 'true';

// In stdio mode stdout IS the protocol channel. Redirect console.log/info
// before importing anything that might print, so the stream is never corrupted.
if (STDIO) {
  const toErr = (...a) => process.stderr.write(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
  console.log = toErr;
  console.info = toErr;
}
const log = (line) => process.stderr.write(line + '\n');

const BASE_DIR = process.env.BASE_DIR || __dirname;
const READ_ONLY = truthy(process.env.MCP_READ_ONLY);

// Dynamic imports AFTER the stdio console redirect.
const [{ db }, { createContinuityStore }, { createVectoMcpServer }] = await Promise.all([
  import('./server/db/drizzle.js'),
  import('./server/mcp/continuity-store.js'),
  import('./server/mcp/create-server.js'),
]);

const store = createContinuityStore(db);
const createServer = () => createVectoMcpServer({ store, baseDir: BASE_DIR, version, readOnly: READ_ONLY });

if (STDIO) {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = createServer();
  const transport = new StdioServerTransport();
  // Exit when the client hangs up. The SDK's StdioServerTransport (1.30) listens for
  // stdin 'data'/'error' only, never 'end', and the pg pool keeps the event loop
  // alive — so without this the process outlives its client.
  server.server.onclose = () => { log('[mcp] stdio closed — exiting'); process.exit(0); };
  process.stdin.once('end', () => { transport.close().catch(() => {}); });
  await server.connect(transport);
  log(`[mcp] stdio transport connected (readOnly=${READ_ONLY}, baseDir=${BASE_DIR})`);
} else {
  const { createMcpHttpApp } = await import('./server/mcp/http-app.js');
  const PORT = Number(process.env.MCP_PORT || 5055);
  const HOST = process.env.MCP_HOST || '0.0.0.0';
  const TOKEN = process.env.MCP_TOKEN;

  let app;
  try {
    app = createMcpHttpApp({
      createServer,
      token: TOKEN,
      version,
      enableJsonResponse: truthy(process.env.MCP_JSON_RESPONSE),
      log,
    });
  } catch (err) {
    log(`[mcp] FATAL: ${err.message}`);
    process.exit(1);
  }

  const httpServer = app.listen(PORT, HOST, () => {
    log(`[mcp] ${version} listening on http://${HOST}:${PORT}/mcp (readOnly=${READ_ONLY}, baseDir=${BASE_DIR})`);
    log('[mcp] token auth: enabled (MCP_TOKEN)');
  });
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`[mcp] FATAL: port ${PORT} already in use`);
      process.exit(1);
    }
    throw err;
  });

  const shutdown = async (signal) => {
    log(`[mcp] ${signal} — shutting down`);
    try { await app.locals.closeAllSessions(); } catch { /* best effort */ }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
