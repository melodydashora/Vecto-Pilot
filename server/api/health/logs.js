// server/api/health/logs.js
//
// 2026-04-27: Authenticated log-tail API + mobile-friendly HTML viewer.
// Designed so Melody can open https://<host>/api/logs/viewer on her phone,
// authenticate with her existing token, and watch the server console live
// without needing to copy/paste from the Replit terminal.
//
// Endpoints:
//   GET  /api/logs                 - JSON {lines: [...]} of last N (default 500)
//   GET  /api/logs/raw             - text/plain of last N lines (curl-friendly)
//   GET  /api/logs/stream          - SSE live tail (1s poll interval)
//   GET  /api/logs/viewer          - HTML mobile-friendly viewer page (no auth on
//                                    HTML; the page itself authenticates the
//                                    fetch calls using the user's bearer token
//                                    via localStorage or ?token= query param)

import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import { getLogFilePaths } from '../../logger/file-tee.js';
// 2026-04-28: chainLog used by the production-refusal log line in
// requireAuthFromQueryOrHeader below.
import { chainLog } from '../../logger/workflow.js';

// 2026-04-27: SSE-friendly auth wrapper. EventSource doesn't send custom
// headers, so this wrapper accepts ?token=<bearer> query param and forwards
// it as Authorization header before delegating to requireAuth.
//
// 2026-04-28: Refuse query-param token in production. Tokens in URLs leak via
// access logs (Cloud Run, Replit, nginx), browser history, Referer headers, and
// shared bookmarks. The HMAC tokens used here are session-permanent — there is
// no short-lived JWT layer, only a 60-min sliding window plus a 2-hour hard cap
// (auth.js:200-203). A continually-active SSE stream defeats the sliding window,
// so a leaked token grants live driver PII (lat/lng, snapshot IDs, full briefing
// + strategy text) for up to two hours. Phase 2 (tracked separately) introduces
// an HttpOnly cookie ticket via POST /api/logs/ticket. Until that lands, prod
// accepts only Authorization: Bearer. The viewer page's existing 3-second
// SSE-failure fallback to polling works transparently because /api/logs and
// /api/logs/raw use requireAuth (header-only) and the polling code path already
// sends Authorization: Bearer (see VIEWER_HTML lines ~396-398, 443).
function requireAuthFromQueryOrHeader(req, res, next) {
  const isProd = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  if (isProd && req.query.token && !req.headers.authorization) {
    chainLog(
      { parent: 'HEALTH', sub: 'LOGS', callTypes: ['AUTH'], callName: 'reject-query-token' },
      `Refused query-param token in production from ${req.ip || 'unknown'} (prevents URL-leak of HMAC session token)`
    );
    return res.status(401).json({
      error: 'query-param tokens not accepted in production',
      hint: 'use Authorization: Bearer <token> header; the mobile viewer falls back to polling automatically after a brief SSE timeout',
    });
  }
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + String(req.query.token);
  }
  return requireAuth(req, res, next);
}

const router = express.Router();
const logsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
const { current: LOG_FILE } = getLogFilePaths();

// ----- helpers -----
async function readLastLines(n) {
  try {
    const content = await fsp.readFile(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    return lines.slice(-n);
  } catch (err) {
    return [];
  }
}

// ----- /api/logs (JSON) -----
router.get('/', logsRateLimiter, requireAuth, async (req, res) => {
  const last = Math.min(parseInt(req.query.last, 10) || 500, 5000);
  const lines = await readLastLines(last);
  res.json({ count: lines.length, file: LOG_FILE, lines });
});

// ----- /api/logs/raw (plain text) -----
router.get('/raw', logsRateLimiter, requireAuth, async (req, res) => {
  const last = Math.min(parseInt(req.query.last, 10) || 500, 5000);
  const lines = await readLastLines(last);
  res.type('text/plain').send(lines.join('\n'));
});

// ----- /api/logs/stream (SSE live tail) -----
// Uses query-param auth fallback because EventSource can't send headers.
router.get('/stream', logsRateLimiter, requireAuthFromQueryOrHeader, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx-style buffering
  res.flushHeaders();

  // Send a hello so the client knows the stream is open
  res.write(`event: open\ndata: ${JSON.stringify({ file: LOG_FILE })}\n\n`);

  // Send the last 200 lines as a primer
  const primer = await readLastLines(200);
  for (const line of primer) {
    res.write(`data: ${line.replace(/\n/g, ' ')}\n\n`);
  }

  // Tail loop: poll file size; when it grows, read the new bytes and emit
  let position = 0;
  try {
    const stats = fs.statSync(LOG_FILE);
    position = stats.size;
  } catch { /* file may not exist yet */ }

  let buffer = '';
  const interval = setInterval(() => {
    try {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size < position) {
        // File rotated — start from beginning
        position = 0;
        res.write(`event: rotated\ndata: log file rotated\n\n`);
      }
      if (stats.size > position) {
        const fd = fs.openSync(LOG_FILE, 'r');
        const len = stats.size - position;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, position);
        fs.closeSync(fd);
        position = stats.size;

        buffer += buf.toString('utf8');
        const newlineIdx = buffer.lastIndexOf('\n');
        if (newlineIdx >= 0) {
          const complete = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          for (const line of complete.split('\n').filter((l) => l.length > 0)) {
            res.write(`data: ${line}\n\n`);
          }
        }
      }
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err.message || err) })}\n\n`);
    }
  }, 1000);

  // Heartbeat every 25s so connection stays open through proxies
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* connection closed */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

// ----- /api/logs/viewer (HTML page; no auth here; page does its own auth) -----
router.get('/viewer', (req, res) => {
  res.type('text/html').send(VIEWER_HTML);
});

// Mobile-friendly HTML viewer. Embedded inline so there's only one file to
// maintain. Self-authenticates by reading the bearer token from either:
//   - ?token=<bearer> query parameter (mobile-bookmark-friendly), OR
//   - localStorage['vectopilot_auth_token'] (set by SignIn flow)
const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a1a1a">
<title>Vecto Pilot — Server Logs</title>
<style>
  :root {
    --bg: #0e1116;
    --bg2: #161b22;
    --bg3: #1f242d;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --info: #79c0ff;
    --warn: #ffa657;
    --error: #ff7b72;
    --debug: #6e7681;
    --tag: #d2a8ff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    background: var(--bg2); border-bottom: 1px solid var(--border);
    padding: env(safe-area-inset-top) 12px 8px;
  }
  .row {
    display: flex; gap: 8px; align-items: center; padding: 6px 0;
  }
  .row > * { flex-shrink: 0; }
  .filter {
    flex: 1; min-width: 0;
    background: var(--bg3); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; font: inherit;
  }
  .filter::placeholder { color: var(--muted); }
  button {
    background: var(--bg3); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 12px; font: inherit; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:active { background: var(--border); }
  button.active { background: #1f6feb; border-color: #388bfd; }
  .status {
    font-size: 11px; color: var(--muted);
    padding: 4px 0;
  }
  .status .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--muted); margin-right: 4px; vertical-align: middle;
  }
  .status .dot.live { background: #3fb950; }
  .status .dot.error { background: var(--error); }
  #log {
    padding: 8px 12px env(safe-area-inset-bottom);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .line {
    white-space: pre-wrap; word-break: break-word;
    padding: 1px 0;
    border-bottom: 1px solid transparent;
  }
  .line.warn { color: var(--warn); }
  .line.error { color: var(--error); }
  .line.debug { color: var(--debug); }
  .line .tag { color: var(--tag); }
  .empty {
    text-align: center; color: var(--muted); padding: 40px 12px;
  }
  .auth-prompt {
    max-width: 480px; margin: 40px auto; padding: 16px;
    background: var(--bg2); border: 1px solid var(--border); border-radius: 8px;
  }
  .auth-prompt h2 { margin-top: 0; }
  .auth-prompt input {
    width: 100%; padding: 10px;
    background: var(--bg3); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    font: inherit;
  }
  .auth-prompt button { margin-top: 8px; width: 100%; padding: 10px; }
</style>
</head>
<body>
<header>
  <div class="row">
    <input class="filter" id="filter" placeholder="Filter (e.g. [BRIEFING] or [STRATEGY])" autocomplete="off" autocorrect="off" autocapitalize="none">
  </div>
  <div class="row">
    <button id="btnPause" class="active">Live</button>
    <button id="btnAutoscroll" class="active">Auto-scroll</button>
    <button id="btnClear">Clear</button>
    <button id="btnReload">Reload</button>
  </div>
  <div class="status">
    <span class="dot" id="dot"></span><span id="statusText">Connecting…</span>
    &nbsp;·&nbsp;<span id="lineCount">0 lines</span>
  </div>
</header>
<div id="log"></div>

<div class="auth-prompt" id="authPrompt" style="display:none">
  <h2>Authentication required</h2>
  <p>Paste your bearer token (from localStorage <code>vectopilot_auth_token</code>) or use a URL like
    <code>?token=&lt;bearer&gt;</code>.</p>
  <input id="tokenInput" placeholder="userId.hmac">
  <button id="tokenSave">Save and connect</button>
</div>

<script>
(function () {
  var qs = new URLSearchParams(location.search);
  var token = qs.get('token') ||
              localStorage.getItem('vectopilot_auth_token') ||
              localStorage.getItem('auth_token') ||
              null;

  function showAuth() {
    document.getElementById('authPrompt').style.display = '';
    document.getElementById('log').style.display = 'none';
    document.getElementById('tokenSave').addEventListener('click', function () {
      var v = document.getElementById('tokenInput').value.trim();
      if (!v) return;
      localStorage.setItem('vectopilot_auth_token', v);
      location.reload();
    });
  }
  if (!token) { showAuth(); return; }

  var logEl = document.getElementById('log');
  var filterEl = document.getElementById('filter');
  var dot = document.getElementById('dot');
  var statusText = document.getElementById('statusText');
  var lineCountEl = document.getElementById('lineCount');
  var btnPause = document.getElementById('btnPause');
  var btnAutoscroll = document.getElementById('btnAutoscroll');
  var btnClear = document.getElementById('btnClear');
  var btnReload = document.getElementById('btnReload');

  var paused = false;
  var autoscroll = true;
  var allLines = [];
  var es = null;
  var maxLines = 5000;

  function classifyLine(line) {
    if (/\\sERROR\\s/.test(line) || /\\bERROR\\b/.test(line)) return 'error';
    if (/\\sWARN\\s/.test(line) || /\\bWARN\\b/.test(line)) return 'warn';
    if (/\\sDEBUG\\s/.test(line)) return 'debug';
    return 'info';
  }

  function renderLine(line) {
    var div = document.createElement('div');
    div.className = 'line ' + classifyLine(line);
    // Highlight bracket tags
    var html = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/(\\[[A-Z][A-Z0-9_/-]*\\])/g, '<span class="tag">$1</span>');
    div.innerHTML = html;
    return div;
  }

  function applyFilter() {
    var q = filterEl.value.trim().toLowerCase();
    logEl.innerHTML = '';
    var visible = q ? allLines.filter(function (l) { return l.toLowerCase().indexOf(q) >= 0; }) : allLines;
    var slice = visible.slice(-maxLines);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < slice.length; i++) frag.appendChild(renderLine(slice[i]));
    logEl.appendChild(frag);
    lineCountEl.textContent = slice.length + ' line' + (slice.length === 1 ? '' : 's') +
      (q ? ' (filtered)' : '');
    if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
  }

  function appendLine(line) {
    if (!line) return;
    allLines.push(line);
    if (allLines.length > maxLines * 2) allLines = allLines.slice(-maxLines);
    if (paused) return;

    var q = filterEl.value.trim().toLowerCase();
    if (q && line.toLowerCase().indexOf(q) < 0) return;

    var node = renderLine(line);
    logEl.appendChild(node);
    var nodes = logEl.children;
    if (nodes.length > maxLines) logEl.removeChild(nodes[0]);

    lineCountEl.textContent = nodes.length + ' line' + (nodes.length === 1 ? '' : 's') +
      (q ? ' (filtered)' : '');
    if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
  }

  function setStatus(text, kind) {
    statusText.textContent = text;
    dot.className = 'dot ' + (kind || '');
  }

  function connect() {
    if (es) try { es.close(); } catch (e) {}
    var url = '/api/logs/stream?token=' + encodeURIComponent(token);
    setStatus('Connecting…', '');
    try {
      es = new EventSource(url);
    } catch (e) {
      setStatus('EventSource not supported', 'error');
      return;
    }
    es.onopen = function () { setStatus('Live', 'live'); };
    es.onmessage = function (ev) { appendLine(ev.data); };
    es.addEventListener('open', function () { setStatus('Live', 'live'); });
    es.addEventListener('rotated', function () {
      appendLine('--- log file rotated ---');
    });
    es.addEventListener('error', function (ev) {
      setStatus('Disconnected — retrying', 'error');
    });
    es.onerror = function () { setStatus('Disconnected — retrying', 'error'); };
  }

  // Fallback: token-as-query-param doesn't work because EventSource doesn't send
  // headers and our requireAuth middleware reads Authorization header. So instead
  // we fall back to a polling approach if SSE auth fails.
  // Simpler approach: fetch /api/logs?last=500&token=<token> in a polling loop.
  // We'll detect by trying SSE first; if onerror fires fast, swap to polling.

  var sseEarlyError = false;
  setTimeout(function () {
    if (statusText.textContent === 'Disconnected — retrying') {
      sseEarlyError = true;
      try { es.close(); } catch (e) {}
      startPolling();
    }
  }, 3000);

  var lastPollSize = 0;
  var pollInterval = null;
  function startPolling() {
    setStatus('Polling (SSE unavailable)', 'live');
    lastPollSize = allLines.length;
    if (pollInterval) clearInterval(pollInterval);
    pollOnce();
    pollInterval = setInterval(pollOnce, 2500);
  }
  function pollOnce() {
    fetch('/api/logs?last=500', {
      headers: { Authorization: 'Bearer ' + token }
    })
    .then(function (r) {
      if (r.status === 401) {
        localStorage.removeItem('vectopilot_auth_token');
        showAuth();
        if (pollInterval) clearInterval(pollInterval);
        return null;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.lines) return;
      // Replace allLines with the latest snapshot, render once
      allLines = data.lines.slice();
      applyFilter();
      setStatus('Polling — ' + new Date().toLocaleTimeString(), 'live');
    })
    .catch(function (err) {
      setStatus('Poll error: ' + err.message, 'error');
    });
  }

  // Buttons
  btnPause.addEventListener('click', function () {
    paused = !paused;
    btnPause.textContent = paused ? 'Paused' : 'Live';
    btnPause.classList.toggle('active', !paused);
    if (!paused) applyFilter();
  });
  btnAutoscroll.addEventListener('click', function () {
    autoscroll = !autoscroll;
    btnAutoscroll.classList.toggle('active', autoscroll);
    btnAutoscroll.textContent = 'Auto-scroll' + (autoscroll ? '' : ' OFF');
    if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
  });
  btnClear.addEventListener('click', function () {
    allLines = [];
    logEl.innerHTML = '';
    lineCountEl.textContent = '0 lines';
  });
  btnReload.addEventListener('click', function () { location.reload(); });
  filterEl.addEventListener('input', applyFilter);

  // Initial fetch (primer)
  fetch('/api/logs?last=500', { headers: { Authorization: 'Bearer ' + token } })
    .then(function (r) {
      if (r.status === 401) { localStorage.removeItem('vectopilot_auth_token'); showAuth(); throw new Error('401'); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      allLines = (data.lines || []).slice();
      applyFilter();
      // Try SSE for live tail
      connect();
    })
    .catch(function (err) {
      setStatus('Initial fetch failed: ' + err.message, 'error');
    });
})();
</script>
</body>
</html>`;

export default router;
