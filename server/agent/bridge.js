// 2026-05-08: Bridge — proxy unhandled /agent/* paths from gateway to standalone agent-server.js
// Reason: gateway-embedded agent (server/agent/routes.js) lacks fs/shell/sql/search-internet endpoints
// that exist on the standalone server (agent-server.js, port 43717, loopback-only).
// External clients (MCP env, browsers) can now reach the full surface through *.replit.dev/agent/*.
// See docs/architecture/agent-bridge.md for design + security analysis.

const STANDALONE_HOST = process.env.AGENT_HOST || '127.0.0.1';
const STANDALONE_PORT = Number(process.env.AGENT_PORT || 43717);
const STANDALONE_BASE = `http://${STANDALONE_HOST}:${STANDALONE_PORT}`;

const HOP_BY_HOP = new Set([
  'connection',
  'transfer-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
]);

export async function proxyToStandaloneAgent(req, res) {
  const upstreamToken = process.env.AGENT_TOKEN;
  if (!upstreamToken) {
    return res.status(503).json({
      error: 'AGENT_BRIDGE_NOT_CONFIGURED',
      message: 'Bridge requires AGENT_TOKEN env var to authenticate upstream',
    });
  }

  // req.url is path AFTER the /agent mount prefix (e.g. /shell, /fs/read).
  // We need to forward to /agent/<path> on the standalone server.
  const upstreamUrl = `${STANDALONE_BASE}/agent${req.url}`;
  // 2026-05-08: Use tokenSource (set by validateAgentAuth) for per-token audit.
  // Lets ops distinguish CLAUDE_BRIDGE_TOKEN traffic from VECTO_AGENT_SECRET traffic
  // when narrowing forensics on a leaked secret. Falls back to 'user' for Bearer
  // (logged-in user via App Token) and 'none' if somehow no auth populated req.auth.
  const authType = req.auth?.tokenSource || (req.auth?.userId ? 'user' : 'none');
  const start = Date.now();

  const headers = {
    'x-agent-token': upstreamToken,
    'content-type': req.headers['content-type'] || 'application/json',
    'accept': req.headers.accept || 'application/json',
  };

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = req.body && Object.keys(req.body).length > 0
      ? JSON.stringify(req.body)
      : undefined;
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(
      `[AGENT-BRIDGE] ${req.method} ${req.path} → 502 (${elapsed}ms) auth=${authType} err=${err.message}`,
    );
    return res.status(502).json({
      error: 'AGENT_BRIDGE_FAILURE',
      message: `Upstream agent unreachable at ${STANDALONE_BASE}: ${err.message}`,
    });
  }

  const elapsed = Date.now() - start;
  const status = upstreamRes.status;
  console.log(
    `[AGENT-BRIDGE] ${req.method} ${req.path} → ${status} (${elapsed}ms) auth=${authType}`,
  );

  res.status(status);
  upstreamRes.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  const text = await upstreamRes.text();
  res.send(text);
}
