// server/mcp/auth.js
// Bearer-token guard for the standalone MCP server (mcp-server.js).
//
// 2026-09-03: Created with the MCP server. Deliberately NOT the gateway's
// validateAgentAuth (server/middleware/auth.js) and NOT server/lib/auth.js's
// bearer(): the MCP server is a separate surface from the agent bridge
// (Melody, 2026-09-03: "The MCP needs to be separate than the bridge"), so it
// carries its own token (MCP_TOKEN) and its own guard. The comparison is
// constant-time, same as validateAgentAuth — server/lib/auth.js compares with
// === and was not reused for that reason.

import crypto from 'node:crypto';

export const MIN_TOKEN_LENGTH = 32;

/**
 * Constant-time string equality. Length mismatch short-circuits (the length is
 * not secret); equal-length inputs go through crypto.timingSafeEqual.
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Extract a bearer token from an Authorization header value.
 * @returns {string|null}
 */
export function parseBearer(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return m ? m[1].trim() : null;
}

/**
 * Validate the configured token up front so a misconfigured server fails at
 * boot, not on the first request. Throws with a descriptive message.
 */
export function assertUsableToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('MCP_TOKEN is not set — the HTTP transport refuses to start without a bearer token (generate one with: openssl rand -hex 32)');
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_TOKEN is too short (${token.length} chars; minimum ${MIN_TOKEN_LENGTH}) — generate one with: openssl rand -hex 32`);
  }
}

/**
 * Express middleware: require `Authorization: Bearer <MCP_TOKEN>`.
 * Rejects with 401 + a JSON-RPC-shaped body so MCP clients surface the reason.
 */
export function makeBearerGuard(expectedToken) {
  assertUsableToken(expectedToken);
  return function mcpBearerGuard(req, res, next) {
    const presented = parseBearer(req.headers.authorization);
    if (presented && constantTimeEqual(presented, expectedToken)) {
      return next();
    }
    res.setHeader('WWW-Authenticate', 'Bearer realm="vecto-pilot-mcp"');
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: presented ? 'Unauthorized: invalid bearer token' : 'Unauthorized: missing bearer token' },
      id: null,
    });
  };
}
